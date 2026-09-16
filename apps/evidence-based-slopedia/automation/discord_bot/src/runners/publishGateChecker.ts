import { runGit } from "../utils/shell.js";

const durablePrefixes = [
  "10_Published/",
  "11_Daily/",
  "12_Forecasting/",
  "20_EvidencePackets/",
  "30_Sources/",
  "40_Claims/",
  "50_Assets/",
  "60_MOCs/",
  "70_Logs/",
];

export async function hasDurableArticleChanges(cwd: string, baseCommit?: string, requiredPrefix = "10_Published/"): Promise<boolean> {
  const args = ["-c", "core.quotepath=false", "diff", "--name-only", "--diff-filter=ACMR", "-z"];
  const committed = await runGit(cwd, baseCommit ? [...args, baseCommit, "HEAD"] : ["-c", "core.quotepath=false", "diff", "--name-only", "--diff-filter=ACMR", "-z", "HEAD"]);
  const pending = await runGit(cwd, ["-c", "core.quotepath=false", "diff", "--name-only", "--diff-filter=ACMR", "-z"]);
  // EBS publish content is intentionally ignored by the source repository's
  // .gitignore and is durable in ContentRoot/worktree terms. Do not let Git's
  // ignore rules hide a newly generated published article from this gate;
  // the durable prefix filter below remains the boundary.
  const untracked = await runGit(cwd, ["-c", "core.quotepath=false", "ls-files", "--others", "-z"]);
  const paths = [...committed.stdout, ...pending.stdout, ...untracked.stdout].join("").split("\0").filter(Boolean).map((file) => file.replace(/\\/g, "/"));
  return paths.some((file) => file.startsWith(requiredPrefix) && file.endsWith(".md"));
}
