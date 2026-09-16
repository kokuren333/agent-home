import assert from "node:assert/strict";
import test from "node:test";
import { WorkerSupervisor } from "../../ebs/core/src/services/workerSupervisor.js";
import type { CoreJob } from "../../ebs/core/src/domain/job.js";

function job(id: string): CoreJob { return { id, status: "queued", createdAt: id, updatedAt: id }; }
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

test("FIFO jobs run and success/failure can be persisted by handler", async () => {
  const queued = [job("1"), job("2")];
  const states = new Map<string, string>();
  const supervisor = new WorkerSupervisor({
    repository: { state: async () => ({ queuePaused: false, updatedAt: "now" }), nextQueued: async () => queued.shift() },
    resourceGuard: { canStart: async () => ({ ok: true }) },
    maxWorkers: 1,
    runJob: async (item) => { states.set(item.id, item.id === "1" ? "succeeded" : "failed"); },
  });
  await supervisor.tick();
  await flush();
  await supervisor.tick();
  await flush();
  assert.deepEqual([...states.entries()], [["1", "succeeded"], ["2", "failed"]]);
});

test("paused queue and blocked resource guard do not dequeue", async () => {
  let dequeues = 0;
  const paused = new WorkerSupervisor({
    repository: { state: async () => ({ queuePaused: true, updatedAt: "now" }), nextQueued: async () => { dequeues += 1; return job("1"); } },
    resourceGuard: { canStart: async () => ({ ok: true }) }, maxWorkers: 1, runJob: async () => undefined,
  });
  await paused.tick();
  assert.equal(dequeues, 0);

  const blocked = new WorkerSupervisor({
    repository: { state: async () => ({ queuePaused: false, updatedAt: "now" }), nextQueued: async () => { dequeues += 1; return job("2"); } },
    resourceGuard: { canStart: async () => ({ ok: false, reason: "high CPU" }) }, maxWorkers: 1, runJob: async () => undefined,
  });
  await blocked.tick();
  assert.equal(dequeues, 0);
});

test("concurrency limit and cancellation signal propagation", async () => {
  const queued = [job("1"), job("2"), job("3")];
  const releases: Array<() => void> = [];
  const signals = new Map<string, AbortSignal>();
  const supervisor = new WorkerSupervisor({
    repository: { state: async () => ({ queuePaused: false, updatedAt: "now" }), nextQueued: async () => queued.shift() },
    resourceGuard: { canStart: async () => ({ ok: true }) },
    maxWorkers: 2,
    runJob: (item, signal) => { signals.set(item.id, signal); return new Promise<void>((resolve) => releases.push(resolve)); },
  });
  await supervisor.tick();
  assert.equal(supervisor.listActiveWorkers().length, 2);
  assert.equal(queued.length, 1);
  assert.equal(supervisor.cancelActiveJob("1"), true);
  assert.equal(signals.get("1")?.aborted, true);
  releases.splice(0).forEach((release) => release());
  await flush();
});
