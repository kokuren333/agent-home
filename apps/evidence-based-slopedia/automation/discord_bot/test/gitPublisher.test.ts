import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createGitFixture, git } from "./gitFixture.js";
import { setTestEnv } from "./testEnv.js";

const fixture = await createGitFixture("ebs-publisher-");
setTestEnv(fixture.vault);
process.env.EBE_WORKTREE_ROOT = fixture.worktrees;
const { createWorktree, removeWorktree } = await import("../src/runners/workspaceManager.js");
const { commitWorkerChanges, publishWorkerBranch } = await import("../src/runners/gitPublisher.js");

const makeJob = async (id: string, filename: string) => {
  const base = { id, query: "test", mode: "new" as const, status: "running" as const, discordUserId: "actor", channelId: "channel", guildId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), model: "test", reasoningEffort: "low" };
  const workspace = await createWorktree(base);
  await fs.mkdir(path.join(workspace.worktreePath, "docs"), { recursive: true });
  await fs.writeFile(path.join(workspace.worktreePath, "docs", filename), `${id}\n`, "utf8");
  return { ...base, ...workspace };
};

test("worker commit, rebase, no-ff merge, and push", async () => {
  const job = await makeJob("publish-one", "publish-one.txt");
  const commit = await commitWorkerChanges(job);
  assert.ok(commit);
  const published = await publishWorkerBranch({ ...job, commitSha: commit });
  assert.ok(published);
  assert.equal((await fs.readFile(path.join(fixture.vault, "docs", "publish-one.txt"), "utf8")).trim(), "publish-one");
  assert.equal(await git(fixture.remote, "rev-parse", "main"), published);
  await removeWorktree(job.worktreePath, job.branchName);
});

test("forbidden path is rejected before worker commit", async () => {
  const job = await makeJob("forbidden", "secret-material.txt");
  await assert.rejects(commitWorkerChanges(job), /Forbidden paths/);
  await removeWorktree(job.worktreePath, job.branchName);
});

test("dirty main rejects publication", async () => {
  const job = await makeJob("dirty-main", "dirty-main.txt");
  const commit = await commitWorkerChanges(job);
  await fs.appendFile(path.join(fixture.vault, "README.md"), "dirty\n", "utf8");
  await assert.rejects(publishWorkerBranch({ ...job, commitSha: commit }), /must be clean/);
  await git(fixture.vault, "checkout", "--", "README.md");
  await removeWorktree(job.worktreePath, job.branchName);
});

test("main canonical dirt is rejected instead of being auto-committed", async () => {
  const job = await makeJob("canonical-state", "canonical-state.txt"); const commit = await commitWorkerChanges(job); const metadata = path.join(fixture.vault, "canonical", "metadata", "articles", "art_TEST.yml"); await fs.mkdir(path.dirname(metadata), { recursive: true }); await fs.writeFile(metadata, "{}\n"); await assert.rejects(publishWorkerBranch({ ...job, commitSha: commit }), /must be clean/); await fs.rm(path.join(fixture.vault, "canonical"), { recursive: true, force: true }); await removeWorktree(job.worktreePath, job.branchName);
});

test("publish preflight still rejects unrelated main changes", async () => {
  const job = await makeJob("unrelated-main", "unrelated-main.txt");
  const commit = await commitWorkerChanges(job);
  await fs.appendFile(path.join(fixture.vault, "README.md"), "dirty\n", "utf8");
  await assert.rejects(publishWorkerBranch({ ...job, commitSha: commit }), /must be clean/);
  await git(fixture.vault, "checkout", "--", "README.md");
  await removeWorktree(job.worktreePath, job.branchName);
});

test("single-process publish lock serializes concurrent publications", async () => {
  const first = await makeJob("serial-a", "serial-a.txt");
  const second = await makeJob("serial-b", "serial-b.txt");
  const firstCommit = await commitWorkerChanges(first);
  const secondCommit = await commitWorkerChanges(second);
  const results = await Promise.all([
    publishWorkerBranch({ ...first, commitSha: firstCommit }),
    publishWorkerBranch({ ...second, commitSha: secondCommit }),
  ]);
  assert.equal(results.length, 2);
  assert.equal((await fs.readFile(path.join(fixture.vault, "docs", "serial-a.txt"), "utf8")).trim(), "serial-a");
  assert.equal((await fs.readFile(path.join(fixture.vault, "docs", "serial-b.txt"), "utf8")).trim(), "serial-b");
  await removeWorktree(first.worktreePath, first.branchName);
  await removeWorktree(second.worktreePath, second.branchName);
});
