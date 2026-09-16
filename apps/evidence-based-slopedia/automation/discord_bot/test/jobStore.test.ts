import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTestEnv } from "./testEnv.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-job-store-"));
setTestEnv(root);
const { JobStore } = await import("../src/queue/jobStore.js");

const input = (query: string) => ({
  query,
  mode: "new" as const,
  discordUserId: "actor",
  channelId: "channel",
  guildId: "guild",
  model: "test-model",
  reasoningEffort: "low",
});

test("create persists a unique queued job and payload", async () => {
  const file = path.join(root, "create.json");
  const store = new JobStore(file);
  const first = await store.create(input("first"));
  const second = await store.create(input("second"));
  assert.notEqual(first.id, second.id);
  assert.equal(first.status, "queued");
  assert.ok(first.createdAt);
  assert.equal((await store.get(first.id))?.query, "first");
});

test("createMany preserves input order and recent sorts newest first", async () => {
  const store = new JobStore(path.join(root, "many.json"));
  const jobs = await store.createMany([input("a"), input("b"), input("c")]);
  assert.deepEqual(jobs.map((job) => job.query), ["a", "b", "c"]);
  await store.update(jobs[0].id, { createdAt: "2026-01-01T00:00:00.000Z" });
  await store.update(jobs[1].id, { createdAt: "2026-01-03T00:00:00.000Z" });
  await store.update(jobs[2].id, { createdAt: "2026-01-02T00:00:00.000Z" });
  assert.deepEqual((await store.recent(3)).map((job) => job.query), ["b", "c", "a"]);
});

test("cancel preserves queued and running behavior", async () => {
  const store = new JobStore(path.join(root, "cancel.json"));
  const queued = await store.create(input("queued"));
  const cancelled = await store.cancel(queued.id);
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.finishedAt);

  const running = await store.create(input("running"));
  await store.update(running.id, { status: "running" });
  const requested = await store.cancel(running.id);
  assert.equal(requested.status, "running");
  assert.equal(requested.cancelRequested, true);
});

test("cancelled queued jobs are never returned to workers and removed jobs do not reappear", async () => {
  const store = new JobStore(path.join(root, "delete-queue.json"));
  const queued = await store.create({ query: "must not run", mode: "new", discordUserId: "test", channelId: "test", guildId: null, model: "test", reasoningEffort: "low" });
  await store.cancel(queued.id);
  assert.equal(await store.nextQueued(), undefined);
  await store.remove(queued.id);
  assert.equal(await store.get(queued.id), undefined);
  assert.equal((await store.recoverInterruptedJobs()).length, 0);
});

test("retry creates a new queued job without modifying source", async () => {
  const store = new JobStore(path.join(root, "retry.json"));
  const source = await store.create(input("retry me"));
  await store.update(source.id, { status: "failed", errorMessage: "boom" });
  const retry = await store.retry(source.id);
  assert.notEqual(retry.id, source.id);
  assert.equal(retry.status, "queued");
  assert.equal(retry.query, source.query);
  assert.equal((await store.get(source.id))?.status, "failed");
});

test("pause/resume persists and prevents dequeue", async () => {
  const file = path.join(root, "pause.json");
  const store = new JobStore(file);
  await store.create(input("waiting"));
  await store.setQueuePaused(true);
  assert.equal((await new JobStore(file).state()).queuePaused, true);
  assert.equal(await store.nextQueued(), undefined);
  await store.setQueuePaused(false);
  assert.equal((await store.nextQueued())?.query, "waiting");
});

test("atomic file replacement is readable after repository restart", async () => {
  const file = path.join(root, "persist.json");
  const store = new JobStore(file);
  const job = await store.create(input("persistent"));
  assert.equal((await new JobStore(file).get(job.id))?.query, "persistent");
  await assert.rejects(fs.access(`${file}.tmp`));
});

test("interrupted generation reviews while publish jobs recover for publish-only retry", async () => {
  const store = new JobStore(path.join(root, "recover.json"));
  const jobs = await store.createMany([input("running"), input("waiting"), input("publishing"), input("queued")]);
  await store.update(jobs[0].id, { status: "running" });
  await store.update(jobs[1].id, { status: "waiting_publish" });
  await store.update(jobs[2].id, { status: "publishing", worktreePath: path.join(root, "worktree") });
  const recovered = await store.recoverInterruptedJobs();
  assert.equal(recovered.length, 3);
  assert.equal((await store.get(jobs[0].id))?.status, "failed_review_required");
  assert.equal((await store.get(jobs[1].id))?.status, "failed_review_required");
  assert.equal((await store.get(jobs[2].id))?.status, "publish_retry_pending");
  assert.equal((await store.get(jobs[2].id))?.publishRetryOnly, true);
  assert.equal((await store.get(jobs[3].id))?.status, "queued");
});
