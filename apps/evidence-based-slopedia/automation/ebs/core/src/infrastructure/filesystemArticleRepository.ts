import fs from "node:fs/promises";
import path from "node:path";
import { assertArticleMetadata, type ArticleId, type ArticleMetadata } from "../domain/article.js";
import type { ArticleRevision, ArticleTombstone, ManagementEvent } from "../domain/revision.js";
import type { ArticleRepository } from "../ports/articleRepository.js";
import { FilesystemMutationLock } from "./filesystemMutationLock.js";
import { canonicalizePath } from "./contentPaths.js";

export class FilesystemArticleRepository implements ArticleRepository {
  readonly articlesDir: string;
  readonly tombstonesDir: string;
  readonly revisionsDir: string;
  readonly eventsFile: string;
  readonly redirectsFile: string;
  private readonly locks: FilesystemMutationLock;

  constructor(readonly vaultRoot: string, options: { eventsFile?: string } = {}) {
    this.articlesDir = path.join(vaultRoot, "canonical", "metadata", "articles");
    this.tombstonesDir = path.join(vaultRoot, "canonical", "metadata", "tombstones");
    this.revisionsDir = path.join(vaultRoot, "canonical", "revisions");
    // The canonical file remains the default for CLI/library callers.  The
    // long-running Discord bot supplies a runtime event log so its control
    // plane cannot dirty the checkout used to publish worker branches.
    this.eventsFile = options.eventsFile ?? path.join(vaultRoot, "canonical", "events", "management-events.jsonl");
    this.redirectsFile = path.join(vaultRoot, "canonical", "metadata", "redirects.yml");
    this.locks = new FilesystemMutationLock(vaultRoot);
  }

  async getById(id: ArticleId): Promise<ArticleMetadata | undefined> { if (!safeId(id)) return undefined; const article = await readJson<ArticleMetadata>(path.join(this.articlesDir, `${id}.yml`)); if (article) assertArticleMetadata(article); return article; }
  async getBySlug(slug: string): Promise<ArticleMetadata | undefined> { return (await this.list()).find((article) => article.slug.toLowerCase() === slug.toLowerCase()); }
  async getByPath(sourcePath: string): Promise<ArticleMetadata | undefined> { const target = normalizePath(sourcePath); return (await this.list()).find((article) => normalizePath(article.sourcePath) === target); }
  async list(): Promise<ArticleMetadata[]> { try { const files = (await fs.readdir(this.articlesDir)).filter((file) => file.endsWith(".yml")).sort(); const articles = (await Promise.all(files.map((file) => readJson<ArticleMetadata>(path.join(this.articlesDir, file))))).filter((value): value is ArticleMetadata => Boolean(value)); articles.forEach(assertArticleMetadata); return articles; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }
  async save(article: ArticleMetadata): Promise<void> { assertArticleMetadata(article); await this.locks.withLock(`article-file-${article.id}`, () => atomicJson(path.join(this.articlesDir, `${article.id}.yml`), article)); }
  async update(id: ArticleId, patch: Partial<ArticleMetadata>): Promise<ArticleMetadata> { const current = await this.getById(id); if (!current) throw new Error(`Article not found: ${id}`); const updated = { ...current, ...patch, id, updatedAt: new Date().toISOString() }; await this.save(updated); return updated; }
  async exists(id: ArticleId): Promise<boolean> { return Boolean(await this.getById(id)); }
  async appendRevision(revision: ArticleRevision): Promise<void> { await this.locks.withLock(`revision-${revision.articleId}`, async () => { const dir = path.join(this.revisionsDir, revision.articleId); await fs.mkdir(dir, { recursive: true }); const file = path.join(dir, `${String(revision.revision).padStart(6, "0")}.json`); await fs.writeFile(file, `${JSON.stringify(revision, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); }); }
  async history(id: ArticleId): Promise<ArticleRevision[]> { const dir = path.join(this.revisionsDir, id); try { const files = (await fs.readdir(dir)).filter((file) => file.endsWith(".json")).sort(); return (await Promise.all(files.map((file) => readJson<ArticleRevision>(path.join(dir, file))))).filter((value): value is ArticleRevision => Boolean(value)); } catch { return []; } }
  async appendEvent(event: ManagementEvent): Promise<void> { await this.locks.withLock("events", async () => { await fs.mkdir(path.dirname(this.eventsFile), { recursive: true }); await fs.appendFile(this.eventsFile, `${JSON.stringify(event)}\n`, "utf8"); }); }
  async events(): Promise<ManagementEvent[]> { try { return (await fs.readFile(this.eventsFile, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as ManagementEvent); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }
  async saveTombstone(tombstone: ArticleTombstone): Promise<void> { await this.locks.withLock(`tombstone-${tombstone.articleId}`, () => atomicJson(path.join(this.tombstonesDir, `${tombstone.articleId}.yml`), tombstone)); }
  async getTombstone(id: ArticleId): Promise<ArticleTombstone | undefined> { return readJson<ArticleTombstone>(path.join(this.tombstonesDir, `${id}.yml`)); }
  async listTombstones(): Promise<ArticleTombstone[]> { try { const files = (await fs.readdir(this.tombstonesDir)).filter((file) => file.endsWith(".yml")).sort(); return (await Promise.all(files.map((file) => readJson<ArticleTombstone>(path.join(this.tombstonesDir, file))))).filter((value): value is ArticleTombstone => Boolean(value)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }
  async removeTombstone(id: ArticleId): Promise<void> { await this.locks.withLock(`tombstone-${id}`, () => fs.rm(path.join(this.tombstonesDir, `${id}.yml`), { force: true })); }
  async addRedirect(fromSlug: string, toSlug: string, articleId: ArticleId): Promise<void> { await this.locks.withLock("redirects", async () => { const redirects = (await readJson<Record<string, unknown>>(this.redirectsFile)) ?? {}; redirects[`/${fromSlug.replace(/^\//, "")}`] = { to: `/${toSlug.replace(/^\//, "")}`, articleId }; await atomicJson(this.redirectsFile, redirects); }); }
  async resolveRedirect(slug: string): Promise<ArticleMetadata | undefined> { const redirects = (await readJson<Record<string, { articleId?: string }>>(this.redirectsFile)) ?? {}; const entry = redirects[`/${slug.replace(/^\//, "")}`]; return entry?.articleId ? this.getById(entry.articleId) : undefined; }
  async redirects(): Promise<Record<string, { to: string; articleId: ArticleId }>> { return (await readJson<Record<string, { to: string; articleId: ArticleId }>>(this.redirectsFile)) ?? {}; }
}

async function atomicJson(file: string, value: unknown): Promise<void> { await fs.mkdir(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp`; await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); await fs.rename(tmp, file); }
async function readJson<T>(file: string): Promise<T | undefined> { try { return JSON.parse(await fs.readFile(file, "utf8")) as T; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
function normalizePath(value: string): string { return canonicalizePath(value).toLowerCase(); }
function safeId(value: string): boolean { return /^art_[A-Za-z0-9._-]+$/.test(value); }
