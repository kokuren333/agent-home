import os from "node:os";
import { config } from "../config.js";
import type { ResourceGuard } from "../../../ebs/core/src/ports/resourceGuard.js";

export interface ResourceSystem {
  totalMemory(): number;
  freeMemory(): number;
  cpuTimes(): Array<{ user: number; nice: number; sys: number; idle: number; irq: number }>;
  wait(delayMs: number): Promise<void>;
}

const defaultSystem: ResourceSystem = {
  totalMemory: () => os.totalmem(),
  freeMemory: () => os.freemem(),
  cpuTimes: () => os.cpus().map((cpu) => ({ ...cpu.times })),
  wait: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
};

export function createResourceGuard(
  options = config.resourceGuard,
  system: ResourceSystem = defaultSystem,
): ResourceGuard {
  const measure = async (delayMs: number) => {
    const total = system.totalMemory();
    const used = total - system.freeMemory();
    const memoryPercent = Math.round((used / total) * 100);
    const cpuPercent = await sampleCpuPercent(delayMs, system);
    return { memoryPercent, cpuPercent };
  };
  return {
    async canStart() {
      if (!options.enabled) return { ok: true };
      const { memoryPercent, cpuPercent } = await measure(750);
      if (memoryPercent >= options.maxMemoryPercent) return { ok: false, reason: `memory usage is ${memoryPercent}%` };
      if (cpuPercent >= options.maxCpuPercent) return { ok: false, reason: `CPU usage is ${cpuPercent}%` };
      return { ok: true };
    },
    async snapshot() {
      const { memoryPercent, cpuPercent } = await measure(500);
      if (!options.enabled) return { enabled: false, memoryPercent, cpuPercent, ok: true };
      if (memoryPercent >= options.maxMemoryPercent) return { enabled: true, memoryPercent, cpuPercent, ok: false, reason: `memory ${memoryPercent}%` };
      if (cpuPercent >= options.maxCpuPercent) return { enabled: true, memoryPercent, cpuPercent, ok: false, reason: `CPU ${cpuPercent}%` };
      return { enabled: true, memoryPercent, cpuPercent, ok: true };
    },
  };
}

const resourceGuard = createResourceGuard();

export async function canStartWorker(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const result = await resourceGuard.canStart();
  return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? "resource guard blocked" };
}

export async function resourceSnapshot(): Promise<{
  enabled: boolean;
  memoryPercent: number;
  cpuPercent: number;
  ok: boolean;
  reason?: string;
}> {
  return resourceGuard.snapshot();
}

async function sampleCpuPercent(delayMs: number, system: ResourceSystem): Promise<number> {
  const start = system.cpuTimes();
  await system.wait(delayMs);
  const end = system.cpuTimes();
  let idle = 0;
  let total = 0;
  for (let i = 0; i < end.length; i += 1) {
    const s = start[i];
    const e = end[i];
    const idleDelta = e.idle - s.idle;
    const totalDelta =
      e.user - s.user + (e.nice - s.nice) + (e.sys - s.sys) + idleDelta + (e.irq - s.irq);
    idle += idleDelta;
    total += totalDelta;
  }
  if (total <= 0) return 0;
  return Math.round(100 - (idle / total) * 100);
}
