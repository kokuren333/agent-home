import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FilesystemArticleRepository } from "../../ebs/core/src/infrastructure/filesystemArticleRepository.js";
import { sha256 } from "../../ebs/core/src/migration/articleInventory.js";
import type { ArticleMetadata, ArticleStatus } from "../../ebs/core/src/domain/article.js";

export async function phase3Fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-phase3-")); await fs.mkdir(path.join(root, "10_Published"), { recursive: true }); await fs.writeFile(path.join(root, "AGENTS.md"), "fixture"); const repository = new FilesystemArticleRepository(root);
  const seed = async (id: string, title: string, slug: string, status: ArticleStatus, bodyText = "") => { const sourcePath = `10_Published/${id}.md`; const body = `---\ntitle: ${title}\nstatus: ${status === "published" ? "published" : status}\n---\n# ${title}\n\n${bodyText || `${title} summary paragraph with enough text for deterministic search extraction.`}\n`; await fs.writeFile(path.join(root, sourcePath), body, "utf8"); const metadata: ArticleMetadata = { id, type: "encyclopedia", title, slug, status, sourcePath, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", aliases: [], category: "Technology", subfield: "Hardware", image: null, currentRevision: 0, contentHash: sha256(body) }; await repository.save(metadata); return metadata; };
  return { root, repository, seed };
}

export async function readTree(root: string): Promise<Record<string, string>> { const result: Record<string, string> = {}; async function walk(dir: string) { for (const entry of await fs.readdir(dir, { withFileTypes: true })) { const target = path.join(dir, entry.name); if (entry.isDirectory()) await walk(target); else result[path.relative(root, target).replace(/\\/g, "/")] = await fs.readFile(target, "utf8"); } } await walk(root); return result; }
