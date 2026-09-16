import type { CoreJob, JobId, JobStatus } from "../domain/job.js";

export interface QueueState {
  queuePaused: boolean;
  updatedAt: string;
}

export interface JobRepository<TJob extends CoreJob = CoreJob, TCreate = Record<string, unknown>> {
  init(): Promise<void>;
  create(input: TCreate): Promise<TJob>;
  createMany(inputs: TCreate[]): Promise<TJob[]>;
  all(): Promise<TJob[]>;
  recent(limit?: number): Promise<TJob[]>;
  get(id: JobId): Promise<TJob | undefined>;
  nextQueued(): Promise<TJob | undefined>;
  cancel(id: JobId): Promise<TJob>;
  retry(id: JobId): Promise<TJob>;
  recoverInterruptedJobs(): Promise<TJob[]>;
  update(id: JobId, patch: Partial<TJob>): Promise<TJob>;
  countByStatus(status: JobStatus): Promise<number>;
  state(): Promise<QueueState>;
  setQueuePaused(paused: boolean): Promise<QueueState>;
}
