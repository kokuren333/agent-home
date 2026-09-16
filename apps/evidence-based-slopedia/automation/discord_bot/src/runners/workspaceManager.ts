import { config } from "../config.js";
import type { Job } from "../types.js";
import { ensureDir, safeBranchName, safeWorktreePath } from "../utils/paths.js";
import { requireOk, runGit } from "../utils/shell.js";
import type { WorktreeManager } from "../../../ebs/core/src/ports/worktreeManager.js";

export async function createWorktree(job: Job): Promise<{ branchName: string; worktreePath: string; baseCommit: string }> {
  await ensureDir(config.paths.worktreeRoot);
  const branchName = safeBranchName(job.id);
  const worktreePath = safeWorktreePath(config.paths.worktreeRoot, job.id);

  await requireOk(
    await runGit(config.paths.vaultRoot, ["fetch", config.git.remote, config.git.branch], 180_000),
    "git fetch before worktree add",
  );
  const add = await runGit(config.paths.vaultRoot, [
    "worktree",
    "add",
    worktreePath,
    "-b",
    branchName,
    `${config.git.remote}/${config.git.branch}`,
  ]);
  await requireOk(add, "git worktree add");
  const base = await runGit(worktreePath, ["rev-parse", "HEAD"]);
  await requireOk(base, "git rev-parse worktree base");
  return { branchName, worktreePath, baseCommit: base.stdout.trim() };
}

export async function removeWorktree(worktreePath: string, branchName: string): Promise<void> {
  await runGit(config.paths.vaultRoot, ["worktree", "remove", "--force", worktreePath], 180_000);
  await runGit(config.paths.vaultRoot, ["branch", "-D", branchName], 120_000);
}

export const gitWorktreeManager: WorktreeManager<Job> = {
  create: createWorktree,
  remove: removeWorktree,
};
