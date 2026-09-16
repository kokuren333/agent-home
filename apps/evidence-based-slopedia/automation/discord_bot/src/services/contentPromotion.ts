import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { canonicalizePath, isArticleSource } from "../../../ebs/core/src/infrastructure/contentPaths.js";
import { FilesystemMutationLock } from "../../../ebs/core/src/infrastructure/filesystemMutationLock.js";
const allowedRoots = ["10_Published/", "11_Daily/", "12_Forecasting/", "50_Assets/", "canonical/metadata/", "canonical/revisions/"];
export async function promoteGeneratedContent(worktree: string, contentRoot: string, changedPaths: string[]): Promise<void> {
  const lock = new FilesystemMutationLock(contentRoot);
  // Contention is normal publication queueing, not a job failure.
  return lock.withLock("content-build-deploy", async () => promoteGeneratedContentUnlocked(worktree, contentRoot, changedPaths), { timeoutMs: 6 * 60 * 60 * 1000 });
}

async function promoteGeneratedContentUnlocked(worktree: string, contentRoot: string, changedPaths: string[]): Promise<void> {
  const paths = [...new Set(changedPaths.map((item) => item.replace(/\\/g, "/")))].filter((relative) => allowedRoots.some((root) => relative.startsWith(root)));
  await validateArticlePairs(worktree, paths);
  const token = randomUUID(); const backups: Array<{ destination: string; backup: string }> = []; const copied: string[] = [];
  try {
    await fs.mkdir(contentRoot, { recursive: true });
    for (const relative of paths) {
      const source = inside(worktree, relative); const destination = inside(contentRoot, relative);
      try { await fs.access(source); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      await fs.mkdir(path.dirname(destination), { recursive: true });
      if (await exists(destination)) { const backup = `${destination}.promotion-backup-${token}`; await fs.rename(destination, backup); backups.push({ destination, backup }); }
      await fs.copyFile(source, destination); copied.push(destination);
    }
  } catch (error) {
    for (const file of copied) await fs.rm(file, { force: true }).catch(() => undefined);
    for (const { destination, backup } of backups.reverse()) await fs.rename(backup, destination).catch(() => undefined);
    throw error;
  }
  for (const { backup } of backups) await fs.rm(backup, { force: true });
}

async function validateArticlePairs(worktree: string, paths: string[]): Promise<void> {
  const published = paths.filter((file) => file.startsWith("10_Published/") && isArticleSource(file));
  if (!published.length) return;
  const metadataFiles = await fs.readdir(path.join(worktree, "canonical", "metadata", "articles")).catch(() => []);
  const metadata = await Promise.all(metadataFiles.filter((file) => file.endsWith(".yml")).map(async (file) => JSON.parse(await fs.readFile(path.join(worktree, "canonical", "metadata", "articles", file), "utf8")) as { id: string; sourcePath: string; slug: string; contentHash?: string; status?: string }));
  for (const relative of published) {
    const article = metadata.find((item) => canonicalizePath(item.sourcePath).toLowerCase() === canonicalizePath(relative).toLowerCase());
    if (!article) throw new Error(`Promotion requires canonical metadata for article source: ${relative}`);
    if (article.status !== "published") throw new Error(`Promotion article metadata is not published: ${article.id}`);
    if (path.isAbsolute(article.sourcePath) || inside(worktree, article.sourcePath) !== inside(worktree, relative)) throw new Error(`Promotion sourcePath must be ContentRoot-relative and match article: ${article.id}`);
    const body = await fs.readFile(inside(worktree, relative), "utf8");
    const hash = createHash("sha256").update(body).digest("hex");
    if (hash !== article.contentHash) throw new Error(`Promotion article hash mismatch: ${article.id}`);
    const assets = [...body.matchAll(/(?:!\[\[[^\]]*\]\]|infographic_path:\s*["']?)(50_Assets\/[^\s"'\]\)]+)/gi)].map((match) => match[1]);
    for (const asset of new Set(assets)) {
      if (!paths.includes(asset) || !(await exists(inside(worktree, asset)))) throw new Error(`Promotion required asset missing from bundle: ${asset}`);
    }
  }
}

function inside(root: string, relative: string): string { const resolved = path.resolve(root, relative); const base = path.resolve(root); if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw new Error(`Promotion path escapes root: ${relative}`); return resolved; }
async function exists(file: string): Promise<boolean> { return fs.access(file).then(() => true).catch(() => false); }
