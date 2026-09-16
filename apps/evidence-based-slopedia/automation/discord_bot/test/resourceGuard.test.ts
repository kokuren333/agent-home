import assert from "node:assert/strict";
import test from "node:test";
import { setTestEnv } from "./testEnv.js";
setTestEnv(process.cwd());
const { createResourceGuard } = await import("../src/services/resourceGuard.js");

const times = (idle: number, user: number) => [{ idle, user, nice: 0, sys: 0, irq: 0 }];

test("resource guard reports healthy, high RAM, and high CPU", async () => {
  let snapshots = [times(0, 0), times(90, 10)];
  const system = { totalMemory: () => 100, freeMemory: () => 50, cpuTimes: () => snapshots.shift()!, wait: async () => undefined };
  assert.equal((await createResourceGuard({ enabled: true, maxMemoryPercent: 85, maxCpuPercent: 95 }, system).canStart()).ok, true);

  snapshots = [times(0, 0), times(100, 0)];
  const highRam = { ...system, freeMemory: () => 10, cpuTimes: () => snapshots.shift()! };
  assert.match((await createResourceGuard({ enabled: true, maxMemoryPercent: 85, maxCpuPercent: 95 }, highRam).canStart()).reason ?? "", /memory/);

  snapshots = [times(0, 0), times(0, 100)];
  const highCpu = { ...system, cpuTimes: () => snapshots.shift()! };
  assert.match((await createResourceGuard({ enabled: true, maxMemoryPercent: 85, maxCpuPercent: 95 }, highCpu).canStart()).reason ?? "", /CPU/);
});
