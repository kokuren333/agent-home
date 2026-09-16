import type { CoreJob } from "../domain/job.js";

export interface ContentExecutor<TJob extends CoreJob = CoreJob> {
  execute(job: TJob, signal?: AbortSignal): Promise<void>;
}
