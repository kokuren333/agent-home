import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createGitFixture, git } from "./gitFixture.js";
import { setTestEnv } from "./testEnv.js";

const fixture = await createGitFixture("ebs-worktree-");
setTestEnv(fixture.vault);
process.env.EBE_WORKTREE_ROOT = fixture.worktrees;
const { createWorktree, removeWorktree } = await import("../src/runners/workspaceManager.js");
const { safeBranchName, safeWorktreePath } = await import("../src/utils/paths.js");
const { JobStore } = await import("../src/queue/jobStore.js");
const { WorkerPool } = await import("../src/queue/workerPool.js");

const baseJob = (id: string) => ({ id, query: "test", mode: "new" as const, status: "running" as const, discordUserId: "actor", channelId: "channel", guildId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), model: "test", reasoningEffort: "low" });

test("job path sanitization keeps worktree and branch inside intended namespace", () => {
  assert.match(safeBranchName("job ../ bad id"), /^bot\/[A-Za-z0-9._-]+$/);
  const result = safeWorktreePath(fixture.worktrees, "job ../ bad id");
  assert.equal(path.dirname(result), path.resolve(fixture.worktrees));
});

test("create external worktree, commit change, reject collision, and clean branch", async () => {
  const job = baseJob("integration-one");
  const descriptor = await createWorktree(job);
  await fs.writeFile(path.join(descriptor.worktreePath, "created.txt"), "created\n", "utf8");
  await git(descriptor.worktreePath, "add", "created.txt");
  await git(descriptor.worktreePath, "config", "user.name", "fixture");
  await git(descriptor.worktreePath, "config", "user.email", "fixture@example.invalid");
  await git(descriptor.worktreePath, "commit", "-m", "worker change");
  await assert.rejects(createWorktree(job));
  await removeWorktree(descriptor.worktreePath, descriptor.branchName);
  await assert.rejects(fs.access(descriptor.worktreePath));
  assert.equal(await git(fixture.vault, "branch", "--list", descriptor.branchName), "");
});

test("cleanup removes old succeeded job record and retained worktree", async () => {
  const store = new JobStore(path.join(fixture.root, "cleanup-jobs.json"));
  const created = await store.create({ query: "cleanup", mode: "new", discordUserId: "actor", channelId: "channel", guildId: null, model: "test", reasoningEffort: "low" });
  const descriptor = await createWorktree({ ...created, status: "running" });
  await store.update(created.id, { status: "succeeded", finishedAt: "2000-01-01T00:00:00.000Z", ...descriptor });
  const pool = new WorkerPool(store, {} as never);
  const cleaned = await pool.cleanupFailedWorktrees(1, false);
  assert.equal(cleaned.jobs.length, 1);
  await assert.rejects(fs.access(descriptor.worktreePath));
  assert.equal(await store.get(created.id), undefined);
});

test("cleanup removes old failed and failed_review_required records but keeps active jobs", async () => {
  const store = new JobStore(path.join(fixture.root, "cleanup-status-jobs.json"));
  const make = async (status: "failed" | "failed_review_required" | "cancelled" | "queued" | "running") => {
    const job = await store.create({ query: status, mode: "new", discordUserId: "actor", channelId: "channel", guildId: null, model: "test", reasoningEffort: "low" });
    return store.update(job.id, { status, finishedAt: "2000-01-01T00:00:00.000Z" });
  };
  const removable = await Promise.all([make("failed"), make("failed_review_required"), make("cancelled")]);
  const retained = await Promise.all([make("queued"), make("running")]);
  const pool = new WorkerPool(store, {} as never);
  const cleaned = await pool.cleanupFailedWorktrees(1, false);
  assert.equal(cleaned.jobRecords.length, 3);
  for (const job of removable) assert.equal(await store.get(job.id), undefined);
  for (const job of retained) assert.ok(await store.get(job.id));
});
