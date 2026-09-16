import { FilesystemMutationLock } from "../infrastructure/filesystemMutationLock.js";
import { AutoGenerationService, schedulerTickId, type AutoRunResult } from "./autoGenerationService.js";
import { CandidateRegistry } from "./candidateRegistry.js";

export interface SchedulerConfig { minIntervalMinutes: number; maxIntervalMinutes: number; }
export class SchedulerService {
  private timer?: NodeJS.Timeout;
  private tickCount = 0;
  constructor(private readonly auto: AutoGenerationService, private readonly registry: CandidateRegistry, private readonly locks: FilesystemMutationLock, private readonly config: SchedulerConfig, private readonly random: () => number = Math.random, private readonly now: () => Date = () => new Date(), private readonly maintenance?: () => Promise<void>) {}
  async tick(dryRun = false, scheduledAt = this.now().toISOString()): Promise<AutoRunResult & { tickId: string }> {
    const tickId = schedulerTickId(scheduledAt);
    try { return await this.locks.withLock("scheduler", async () => { const begun = await this.registry.beginTick(tickId, scheduledAt); if (!begun.accepted) return { status: "skipped", reason: "duplicate_tick", tickId }; const result = await this.auto.runOnce(dryRun); this.tickCount += 1; if (!dryRun && this.maintenance && this.tickCount % 12 === 0) await this.maintenance(); const next = this.nextTick(); await this.registry.completeTick(tickId, `${result.status}:${result.reason ?? result.candidate?.id ?? "ok"}`, next); return { ...result, tickId }; }); } catch (error) { if (error instanceof Error && /lock/i.test(error.message)) return { status: "skipped", reason: "scheduler_lock_busy", tickId }; throw error; }
  }
  start(): void { const schedule = () => { const delay = this.delayMs(); this.timer = setTimeout(() => { void this.tick().finally(schedule); }, delay); }; schedule(); }
  stop(): void { if (this.timer) clearTimeout(this.timer); }
  status() { return this.auto.status(); }
  private delayMs(): number { const { minIntervalMinutes: min, maxIntervalMinutes: max } = this.config; return Math.round((min + this.random() * (max - min)) * 60_000); }
  private nextTick(): string { return new Date(this.now().getTime() + this.delayMs()).toISOString(); }
}
