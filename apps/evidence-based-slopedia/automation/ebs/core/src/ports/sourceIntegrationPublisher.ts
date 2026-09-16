import type { CoreJob } from "../domain/job.js";

export interface SourceIntegrationPublisher<TJob extends CoreJob = CoreJob> {
  commit(job: TJob): Promise<string>;
  publish(job: TJob): Promise<string>;
}
