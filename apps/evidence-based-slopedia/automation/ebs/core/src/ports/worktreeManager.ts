import type { CoreJob } from "../domain/job.js";

export interface WorktreeDescriptor {
  branchName: string;
  worktreePath: string;
}

export interface WorktreeManager<TJob extends CoreJob = CoreJob> {
  create(job: TJob): Promise<WorktreeDescriptor>;
  remove(worktreePath: string, branchName: string): Promise<void>;
}
