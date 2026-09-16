import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await exec("git", args, { cwd, encoding: "utf8" });
  return result.stdout.trim();
}

export async function createGitFixture(prefix: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const vault = path.join(root, "vault");
  await fs.mkdir(remote);
  await git(root, "init", "--bare", "--initial-branch=main", remote);
  await git(root, "clone", remote, seed);
  await git(seed, "config", "user.name", "fixture");
  await git(seed, "config", "user.email", "fixture@example.invalid");
  await fs.writeFile(path.join(seed, "README.md"), "fixture\n", "utf8");
  await git(seed, "add", "README.md");
  await git(seed, "commit", "-m", "initial");
  await git(seed, "push", "origin", "main");
  await git(root, "clone", remote, vault);
  return { root, remote, seed, vault, worktrees: path.join(root, "worktrees") };
}
