import type { CoreJob } from "../domain/job.js";
import type { QueueState } from "../ports/jobRepository.js";
import type { ResourceGuard } from "../ports/resourceGuard.js";

export interface WorkerSupervisorDependencies<TJob extends CoreJob> {
  repository: {
    state(): Promise<QueueState>;
    nextQueued(): Promise<TJob | undefined>;
  };
  resourceGuard: Pick<ResourceGuard, "canStart">;
  maxWorkers: number;
  runJob(job: TJob, signal: AbortSignal): Promise<void>;
  onGuardBlocked?(reason: string): Promise<void>;
}

export class WorkerSupervisor<TJob extends CoreJob> {
  private active = 0;
  private activeWorkers = new Map<string, { jobId: string; startedAt: string; abortController: AbortController }>();

  constructor(private readonly dependencies: WorkerSupervisorDependencies<TJob>) {}

  async tick(): Promise<void> {
    if ((await this.dependencies.repository.state()).queuePaused) return;
    while (this.active < this.dependencies.maxWorkers) {
      const guard = await this.dependencies.resourceGuard.canStart();
      if (!guard.ok) {
        await this.dependencies.onGuardBlocked?.(guard.reason ?? "resource guard blocked");
        return;
      }
      const job = await this.dependencies.repository.nextQueued();
      if (!job) return;
      this.active += 1;
      const abortController = new AbortController();
      this.activeWorkers.set(job.id, { jobId: job.id, startedAt: new Date().toISOString(), abortController });
      void this.dependencies.runJob(job, abortController.signal).finally(() => {
        this.active -= 1;
        this.activeWorkers.delete(job.id);
      });
    }
  }

  listActiveWorkers() { return [...this.activeWorkers.values()]; }
  cancelActiveJob(jobId: string): boolean {
    const worker = this.activeWorkers.get(jobId);
    if (!worker) return false;
    worker.abortController.abort();
    return true;
  }
}
