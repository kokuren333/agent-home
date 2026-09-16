import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ArticleMetadata } from "../domain/article.js";
import type { ArticleRepository } from "../ports/articleRepository.js";
import { FilesystemMutationLock } from "../infrastructure/filesystemMutationLock.js";
import { canonicalStateHash, collectPublicArticles, type PublicArticle } from "./publicationPolicy.js";

export interface LinkAnalysis { outbound: Record<string, string[]>; backlinks: Record<string, string[]>; broken: Array<{ sourceId: string; target: string; reason: "missing" | "ambiguous" }>; }
export interface IndexManifest { generation_id: string; generated_at: string; article_count: number; public_article_count: number; source_revision_hash: string; complete: boolean; index_source_hashes: Record<string, string>; indexes: Record<string, string>; }

export class IndexService {
  readonly generatedDir: string; private readonly lock: FilesystemMutationLock;
  constructor(private readonly vaultRoot: string, private readonly repository: ArticleRepository) { this.generatedDir = path.join(vaultRoot, "generated"); this.lock = new FilesystemMutationLock(vaultRoot); }

  async rebuildSearch() { return this.rebuildSelected(["search"]); }
  async rebuildCategories() { return this.rebuildSelected(["category"]); }
  async rebuildMoc() { return this.rebuildSelected(["category", "moc"]); }
  async rebuildRelated() { return this.rebuildSelected(["backlinks", "related"]); }
  async rebuildBacklinks() { return this.rebuildSelected(["backlinks"]); }
  async rebuildSitemap() { return this.rebuildSelected(["sitemap"]); }
  async rebuildAll() { return this.rebuildSelected(["search", "category", "moc", "backlinks", "related", "sitemap"]); }

  async analyzeLinks(publicArticles?: PublicArticle[]): Promise<LinkAnalysis> { return analyzeLinks(publicArticles ?? (await collectPublicArticles(this.vaultRoot, this.repository)).publicArticles); }

  private async rebuildSelected(kinds: string[]): Promise<IndexManifest> {
    return this.lock.withLock("global-rebuild", async () => {
      const all = await this.repository.list(); const { publicArticles } = await collectPublicArticles(this.vaultRoot, this.repository); const full = ["search", "category", "moc", "backlinks", "related", "sitemap"].every((kind) => kinds.includes(kind)); if (full) await fs.rm(this.generatedDir, { recursive: true, force: true }); await fs.mkdir(this.generatedDir, { recursive: true });
      const links = analyzeLinks(publicArticles); const categories = categoryIndex(publicArticles); const written: string[] = [];
      if (kinds.includes("search")) { await writeJson(path.join(this.generatedDir, "search-index.json"), searchIndex(publicArticles)); written.push("search-index.json"); }
      if (kinds.includes("category")) { await writeJson(path.join(this.generatedDir, "category-index.json"), categories); written.push("category-index.json"); }
      if (kinds.includes("backlinks")) { await writeJson(path.join(this.generatedDir, "backlink-index.json"), { backlinks: links.backlinks, outbound: links.outbound, broken: links.broken }); written.push("backlink-index.json"); }
      if (kinds.includes("related")) { await writeJson(path.join(this.generatedDir, "related.json"), relatedIndex(publicArticles, links)); written.push("related.json"); }
      if (kinds.includes("sitemap")) { await atomicWrite(path.join(this.generatedDir, "sitemap.xml"), sitemap(publicArticles)); written.push("sitemap.xml"); }
      if (kinds.includes("moc")) { await renderMocs(this.vaultRoot, this.generatedDir, categories, publicArticles); written.push("moc"); }
      const sourceHash = await canonicalStateHash(this.vaultRoot, this.repository); const previous = await readJson<IndexManifest>(path.join(this.generatedDir, "index-manifest.json")); const indexSourceHashes = { ...(previous?.index_source_hashes ?? {}) }; for (const kind of kinds) indexSourceHashes[kind === "search" ? "search-index" : kind === "category" ? "category-index" : kind === "backlinks" ? "backlink-index" : kind] = sourceHash; const complete = ["search-index", "category-index", "moc", "related", "backlink-index", "sitemap"].every((key) => indexSourceHashes[key] === sourceHash); const manifest = await buildManifest(this.generatedDir, all.length, publicArticles, complete ? sourceHash : `partial:${sourceHash}`, indexSourceHashes, complete);
      await writeJson(path.join(this.generatedDir, "index-manifest.json"), manifest); return manifest;
    });
  }
}

export function articleUrl(article: ArticleMetadata): string { return `/articles/${article.slug.split("/").map(encodeURIComponent).join("/")}/`; }

function searchIndex(articles: PublicArticle[]) { return articles.map(({ metadata, body }) => ({ id: metadata.id, title: metadata.title, slug: metadata.slug, aliases: metadata.aliases, category: metadata.category ?? "uncategorized", subfield: metadata.subfield, summary: summary(body), updated_at: metadata.updatedAt, source_path: metadata.sourcePath, url: articleUrl(metadata) })).sort((a, b) => a.id.localeCompare(b.id)); }
function categoryIndex(articles: PublicArticle[]): Record<string, string[]> { const result: Record<string, string[]> = {}; for (const { metadata } of articles) { const key = metadata.category ?? "uncategorized"; (result[key] ??= []).push(metadata.id); } for (const ids of Object.values(result)) ids.sort(); return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b))); }

function analyzeLinks(articles: PublicArticle[]): LinkAnalysis {
  const outbound: Record<string, string[]> = {}; const backlinks: Record<string, string[]> = {}; const broken: LinkAnalysis["broken"] = []; const byTarget = new Map<string, Set<string>>();
  for (const { metadata } of articles) for (const key of [metadata.id, metadata.slug, metadata.sourcePath, path.basename(metadata.sourcePath, ".md"), metadata.title, ...metadata.aliases]) { const normalized = normalizeTarget(key); const ids = byTarget.get(normalized) ?? new Set(); ids.add(metadata.id); byTarget.set(normalized, ids); }
  for (const { metadata, body } of articles) {
    const targets = new Set<string>();
    for (const raw of extractInternalTargets(stripFrontmatter(body))) { const ids = byTarget.get(normalizeTarget(raw)); if (!ids?.size) broken.push({ sourceId: metadata.id, target: raw, reason: "missing" }); else if (ids.size > 1) broken.push({ sourceId: metadata.id, target: raw, reason: "ambiguous" }); else targets.add([...ids][0]); }
    outbound[metadata.id] = [...targets].sort(); for (const target of targets) (backlinks[target] ??= []).push(metadata.id);
  }
  for (const { metadata } of articles) { backlinks[metadata.id] ??= []; backlinks[metadata.id].sort(); }
  broken.sort((a, b) => `${a.sourceId}:${a.target}`.localeCompare(`${b.sourceId}:${b.target}`)); return { outbound: sortRecord(outbound), backlinks: sortRecord(backlinks), broken };
}

function relatedIndex(articles: PublicArticle[], links: LinkAnalysis): Record<string, Array<{ id: string; score: number }>> {
  const result: Record<string, Array<{ id: string; score: number }>> = {}; const metadata = new Map(articles.map((a) => [a.metadata.id, a.metadata]));
  for (const { metadata: source } of articles) { const scores = new Map<string, number>(); for (const { metadata: target } of articles) { if (source.id === target.id) continue; let score = 0; if (source.subfield && source.subfield === target.subfield) score += 5; if (source.category && source.category === target.category) score += 3; if (links.outbound[source.id]?.includes(target.id)) score += 4; if (links.backlinks[source.id]?.includes(target.id)) score += 2; const shared = new Set(source.aliases.map(normalizeTarget)); if (target.aliases.some((alias) => shared.has(normalizeTarget(alias)))) score += 1; if (score > 0) scores.set(target.id, score); }
    result[source.id] = [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score || (metadata.get(a.id)?.title ?? a.id).localeCompare(metadata.get(b.id)?.title ?? b.id)).slice(0, 10);
  } return sortRecord(result);
}

async function renderMocs(vaultRoot: string, generatedDir: string, categories: Record<string, string[]>, articles: PublicArticle[]): Promise<void> {
  const dir = path.join(generatedDir, "moc"); await fs.rm(dir, { recursive: true, force: true }); await fs.mkdir(dir, { recursive: true }); const byId = new Map(articles.map((a) => [a.metadata.id, a.metadata])); const existingMocFiles = (await listFiles(path.join(vaultRoot, "10_Published"))).filter((file) => path.basename(file).toLowerCase() === "_moc.md"); const existingMocText = (await Promise.all(existingMocFiles.map((file) => fs.readFile(file, "utf8")))).join("\n"); const report: string[] = ["# Deterministic MOC Diff", "", "Generated MOCs are staged under generated/moc; existing MOCs were not deleted.", `Existing MOC files inspected: ${existingMocFiles.length}`, ""];
  for (const [category, ids] of Object.entries(categories)) { const rows = ids.map((id) => byId.get(id)!).sort((a, b) => a.title.localeCompare(b.title, "ja") || a.id.localeCompare(b.id)); const file = `${safeFile(category)}.md`; const text = [`# ${category}`, "", ...rows.map((article) => `- [${article.title}](${articleUrl(article)}) <!-- ${article.id} -->`), ""].join("\n"); await atomicWrite(path.join(dir, file), text); const absent = rows.filter((article) => !existingMocText.includes(article.title)).map((article) => article.title); report.push(`- ${category}: generated ${rows.length}; absent from existing MOC text ${absent.length}${absent.length ? ` (${absent.join(", ")})` : ""}`); }
  const reportDir = path.join(vaultRoot, "_working", "migration_reports"); await fs.mkdir(reportDir, { recursive: true }); await atomicWrite(path.join(reportDir, "moc-diff.md"), `${report.join("\n")}\n`);
}

function sitemap(articles: PublicArticle[]): string { const urls = articles.map(({ metadata }) => `  <url><loc>${escapeXml(articleUrl(metadata))}</loc><lastmod>${escapeXml(metadata.updatedAt.slice(0, 10))}</lastmod></url>`).sort(); return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`; }
async function buildManifest(dir: string, articleCount: number, articles: PublicArticle[], sourceHash: string, indexSourceHashes: Record<string, string>, complete: boolean): Promise<IndexManifest> { const names = ["search-index.json", "category-index.json", "related.json", "backlink-index.json", "sitemap.xml"]; const indexes: Record<string, string> = {}; for (const name of names) try { indexes[name.replace(/\.(json|xml)$/, "")] = hash(await fs.readFile(path.join(dir, name))); } catch { /* partial rebuild */ } const mocFiles = await fs.readdir(path.join(dir, "moc")).catch(() => []); const mocBodies = await Promise.all(mocFiles.sort().map((file) => fs.readFile(path.join(dir, "moc", file)))); if (mocBodies.length) indexes.moc = hash(Buffer.concat(mocBodies)); return { generation_id: createHash("sha256").update(`${sourceHash}:${Date.now()}`).digest("hex"), generated_at: new Date().toISOString(), article_count: articleCount, public_article_count: articles.length, source_revision_hash: sourceHash, complete, index_source_hashes: sortRecord(indexSourceHashes), indexes: sortRecord(indexes) }; }
function extractInternalTargets(body: string): string[] { const targets: string[] = []; for (const match of body.matchAll(/(!?)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) if (!match[1] && !isAsset(match[2])) targets.push(match[2]); for (const match of body.matchAll(/(!?)\[[^\]]*\]\(([^)]+)\)/g)) if (!match[1] && !/^(?:https?:|mailto:|#)/i.test(match[2]) && !isAsset(match[2])) targets.push(match[2]); return [...new Set(targets)]; }
function stripFrontmatter(body: string): string { return body.replace(/^---[\s\S]*?---\s*/m, ""); }
function normalizeTarget(value: string): string { let target = decodeURIComponentSafe(value).replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "").replace(/^articles\//, "").replace(/\/$/, "").replace(/\/index\.html$/, "").replace(/\.md$/i, ""); return target.normalize("NFKC").toLocaleLowerCase("ja"); }
function isAsset(value: string): boolean { return /(?:^|\/)(?:50_Assets|assets)\//i.test(value) || /\.(?:png|jpe?g|gif|webp|avif|svg|pdf)$/i.test(value); }
function decodeURIComponentSafe(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }
function summary(body: string): string { return body.replace(/^---[\s\S]*?---\s*/m, "").split(/\r?\n\r?\n/).map((part) => part.replace(/[#>*_`\[\]]/g, " ").replace(/\s+/g, " ").trim()).find((part) => part.length > 30)?.slice(0, 280) ?? ""; }
function sortRecord<T>(value: Record<string, T>): Record<string, T> { return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))); }
function safeFile(value: string): string { return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-|-$/g, "") || "uncategorized"; }
function hash(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
async function writeJson(file: string, value: unknown): Promise<void> { await atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`); }
async function readJson<T>(file: string): Promise<T | undefined> { try { return JSON.parse(await fs.readFile(file, "utf8")) as T; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
async function atomicWrite(file: string, value: string): Promise<void> { await fs.mkdir(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp`; await fs.writeFile(tmp, value, "utf8"); await fs.rename(tmp, file); }
async function listFiles(dir: string): Promise<string[]> { try { const result: string[] = []; for (const entry of await fs.readdir(dir, { withFileTypes: true })) { const target = path.join(dir, entry.name); if (entry.isDirectory()) result.push(...await listFiles(target)); else result.push(target); } return result; } catch { return []; } }
function escapeXml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
