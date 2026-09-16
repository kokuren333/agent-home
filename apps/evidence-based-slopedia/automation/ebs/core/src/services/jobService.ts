import { defaultJobPriority, type CoreJob, type JobId, type JobPriority, type JobStatus } from "../domain/job.js";
import type { JobRepository, QueueState } from "../ports/jobRepository.js";

export class JobNotFoundError extends Error {
  constructor(id: string) {
    super(`Job not found: ${id}`);
    this.name = "JobNotFoundError";
  }
}

export interface JobServiceStatus {
  queue: QueueState;
  counts: Record<JobStatus, number>;
}

export interface PriorityQueueStatus { counts: Record<JobPriority, number>; humanPending: boolean; }

export interface ServiceOperationRecord {
  service: "JobService";
  operation: string;
  jobId?: string;
  origin: string;
  result: "succeeded" | "failed";
  durationMs: number;
}

export type ServiceOperationLogger = (record: ServiceOperationRecord) => void | Promise<void>;

const statuses: JobStatus[] = [
  "queued", "running", "waiting_publish", "publishing", "publish_retry_pending", "succeeded", "failed", "failed_review_required", "cancelled",
];

export class JobService<TJob extends CoreJob = CoreJob, TCreate = Record<string, unknown>> {
  constructor(
    private readonly repository: JobRepository<TJob, TCreate>,
    private readonly operationLogger?: ServiceOperationLogger,
    private readonly origin = "system",
  ) {}

  enqueue(input: TCreate): Promise<TJob> { return this.record("enqueue", undefined, () => this.repository.create(input)); }
  enqueueMany(inputs: TCreate[]): Promise<TJob[]> { return this.record("enqueueMany", undefined, () => this.repository.createMany(inputs)); }
  list(limit = 10): Promise<TJob[]> { return this.record("list", undefined, () => this.repository.recent(limit)); }

  async status(id: JobId): Promise<TJob> {
    return this.record("status", id, async () => {
      const job = await this.repository.get(id);
      if (!job) throw new JobNotFoundError(id);
      return job;
    });
  }

  retry(id: JobId): Promise<TJob> { return this.record("retry", id, () => this.repository.retry(id)); }
  cancel(id: JobId): Promise<TJob> { return this.record("cancel", id, () => this.repository.cancel(id)); }
  pauseQueue(): Promise<QueueState> { return this.record("pauseQueue", undefined, () => this.repository.setQueuePaused(true)); }
  resumeQueue(): Promise<QueueState> { return this.record("resumeQueue", undefined, () => this.repository.setQueuePaused(false)); }

  async getQueueStatus(): Promise<JobServiceStatus> {
    return this.record("getQueueStatus", undefined, async () => {
      const counts = Object.fromEntries(await Promise.all(statuses.map(async status => [status, await this.repository.countByStatus(status)]))) as Record<JobStatus, number>;
      return { queue: await this.repository.state(), counts };
    });
  }

  async getPriorityStatus(): Promise<PriorityQueueStatus> {
    const jobs = await this.repository.all();
    const queued = jobs.filter((job) => job.status === "queued");
    const counts = { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 } satisfies Record<JobPriority, number>;
    for (const job of queued) counts[defaultJobPriority(job)] += 1;
    return { counts, humanPending: counts.P0 + counts.P1 > 0 };
  }

  private async record<T>(operation: string, jobId: string | undefined, action: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      const value = await action();
      await this.operationLogger?.({ service: "JobService", operation, jobId, origin: this.origin, result: "succeeded", durationMs: Date.now() - started });
      return value;
    } catch (error) {
      await this.operationLogger?.({ service: "JobService", operation, jobId, origin: this.origin, result: "failed", durationMs: Date.now() - started });
      throw error;
    }
  }
}
