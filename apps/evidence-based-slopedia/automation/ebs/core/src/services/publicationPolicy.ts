import fs from "node:fs/promises";
import path from "node:path";
import { assertArticleMetadata, type ArticleMetadata } from "../domain/article.js";
import type { ArticleRepository } from "../ports/articleRepository.js";
import { sha256 } from "../migration/articleInventory.js";

export interface PublicArticle { metadata: ArticleMetadata; body: string; }
export interface PublicationDecision { public: boolean; reason?: string; article?: PublicArticle; }

export async function evaluatePublicArticle(vaultRoot: string, repository: ArticleRepository, article: ArticleMetadata): Promise<PublicationDecision> {
  try { assertArticleMetadata(article); } catch (error) { return { public: false, reason: error instanceof Error ? error.message : String(error) }; }
  if (article.status !== "published") return { public: false, reason: `status:${article.status}` };
  if (await repository.getTombstone(article.id)) return { public: false, reason: "tombstoned" };
  const root = path.resolve(vaultRoot); const source = path.resolve(root, article.sourcePath.replace(/[\\/]/g, path.sep));
  if (source !== root && !source.startsWith(`${root}${path.sep}`)) return { public: false, reason: "unsafe_source_path" };
  try { const body = await fs.readFile(source, "utf8"); if (!article.contentHash || sha256(body) !== article.contentHash) return { public: false, reason: "hash_mismatch" }; return { public: true, article: { metadata: article, body } }; }
  catch (error) { return { public: false, reason: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing_source" : String(error) }; }
}

export async function collectPublicArticles(vaultRoot: string, repository: ArticleRepository): Promise<{ publicArticles: PublicArticle[]; excluded: Array<{ id: string; reason: string }> }> {
  const publicArticles: PublicArticle[] = []; const excluded: Array<{ id: string; reason: string }> = [];
  for (const article of await repository.list()) { const decision = await evaluatePublicArticle(vaultRoot, repository, article); if (decision.public && decision.article) publicArticles.push(decision.article); else excluded.push({ id: article.id, reason: decision.reason ?? "invalid" }); }
  publicArticles.sort((a, b) => a.metadata.id.localeCompare(b.metadata.id)); excluded.sort((a, b) => a.id.localeCompare(b.id)); return { publicArticles, excluded };
}

export async function canonicalStateHash(vaultRoot: string, repository: ArticleRepository): Promise<string> {
  const rows: string[] = [];
  for (const article of (await repository.list()).sort((a, b) => a.id.localeCompare(b.id))) { let bodyHash = "missing"; try { bodyHash = sha256(await fs.readFile(path.resolve(vaultRoot, article.sourcePath.replace(/[\\/]/g, path.sep)), "utf8")); } catch { /* represented as missing */ } rows.push(JSON.stringify(article), (await repository.getTombstone(article.id)) ? "tombstoned" : "active", bodyHash); }
  return sha256(rows.join("\n"));
}
