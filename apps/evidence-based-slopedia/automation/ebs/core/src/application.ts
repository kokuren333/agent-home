import type { CoreJob } from "./domain/job.js";
import type { JobRepository } from "./ports/jobRepository.js";
import { JobService } from "./services/jobService.js";

export function createEbsApplication<TJob extends CoreJob, TCreate>(repository: JobRepository<TJob, TCreate>) {
  return { jobService: new JobService<TJob, TCreate>(repository) };
}
