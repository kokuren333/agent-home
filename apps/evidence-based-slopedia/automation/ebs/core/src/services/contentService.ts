import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { assertTransition, generateArticleSlug, type ArticleMetadata, type ArticleStatus } from "../domain/article.js";
import type { ArticleOperation, ArticleRevision, ManagementEvent } from "../domain/revision.js";
import type { ArticleGenerator } from "../ports/articleGenerator.js";
import type { ArticleRepository } from "../ports/articleRepository.js";
import { parseFrontmatter, sha256 } from "../migration/articleInventory.js";
import { ArticleResolver } from "./articleResolver.js";
import { FilesystemMutationLock } from "../infrastructure/filesystemMutationLock.js";
import { canonicalizePath, resolveContentPath } from "../infrastructure/contentPaths.js";

export interface OperationContext { actor: string; origin: string; jobId?: string; gitSha?: string; summary?: string; }
export interface CreateArticleInput { id?: string; title: string; slug?: string; category?: string; subfield?: string; aliases?: string[]; sourcePath?: string; prompt?: string; context: OperationContext; autonomous?: ArticleMetadata["autonomous"]; }
export interface EditArticleInput { title?: string; slug?: string; aliases?: string[]; category?: string; subfield?: string; replaceFile?: string; context: OperationContext; }

export class ContentService {
  readonly resolver: ArticleResolver;
  private readonly pendingResults = new WeakSet<object>();
  private readonly operationLocks: FilesystemMutationLock;
  constructor(private readonly vaultRoot: string, private readonly repository: ArticleRepository, private readonly generator?: ArticleGenerator) { this.resolver = new ArticleResolver(repository); this.operationLocks = new FilesystemMutationLock(vaultRoot); }

  list() { return this.repository.list(); }
  show(target: string) { return this.resolver.resolve(target); }

  async create(input: CreateArticleInput): Promise<ArticleMetadata> {
    const now = new Date().toISOString(); const id = generateArticleId();
    const slug = input.slug ?? generateArticleSlug(input.category, input.title);
    await this.assertSlugAvailable(slug);
    let article: ArticleMetadata = { id: input.id ?? id, type: "encyclopedia", title: input.title, slug, status: "draft", sourcePath: input.sourcePath ?? `_working/pending/${input.id ?? id}.md`, createdAt: now, updatedAt: now, aliases: input.aliases ?? [], category: input.category, subfield: input.subfield, image: null, currentRevision: 0, autonomous: input.autonomous };
    return this.execute("create", article, input.context, async (operationId) => {
      await this.assertSlugAvailable(slug);
      await this.repository.save(article);
      if (this.generator) {
        const generated = await this.generator.generate({ operation: "create", article, operationId, prompt: input.prompt });
        article = { ...article, sourcePath: generated.sourcePath ?? article.sourcePath, lastJobId: generated.jobId, lastGitSha: generated.gitSha };
        if (generated.pending) { await this.repository.save(article); this.pendingResults.add(article); return article; }
      }
      article.contentHash = await this.hashIfExists(article.sourcePath);
      if (article.contentHash) article.status = "review";
      await this.repository.save(article);
      return this.recordRevision(article, "create", { ...input.context, jobId: article.lastJobId ?? input.context.jobId, gitSha: article.lastGitSha ?? input.context.gitSha }, undefined, "Article identity created", operationId);
    });
  }

  async edit(target: string, input: EditArticleInput): Promise<ArticleMetadata> {
    const article = await this.resolver.resolve(target); const previousHash = article.contentHash;
    if (input.slug && input.slug !== article.slug) await this.assertSlugAvailable(input.slug, article.id);
    return this.execute("edit", article, input.context, async (operationId) => { if (input.replaceFile) await fs.copyFile(path.resolve(input.replaceFile), this.absolute(article.sourcePath)); const updated: ArticleMetadata = { ...article, title: input.title ?? article.title, slug: input.slug ?? article.slug, aliases: input.aliases ?? article.aliases, category: input.category ?? article.category, subfield: input.subfield ?? article.subfield, contentHash: await this.hashIfExists(article.sourcePath), updatedAt: new Date().toISOString() }; await this.repository.save(updated); return this.recordRevision(updated, "edit", input.context, previousHash, "Deterministic metadata/body edit", operationId); });
  }

  regenerate(target: string, context: OperationContext, prompt?: string) { return this.generateExisting(target, "regenerate", context, prompt); }
  researchUpdate(target: string, context: OperationContext, prompt?: string) { return this.generateExisting(target, "research_update", context, prompt); }
  publish(target: string, context: OperationContext) { return this.transition(target, "published", "publish", context, true); }
  async repairMissingAsset(target: string, missingAssetPath: string, context: OperationContext): Promise<ArticleMetadata> {
    const article = await this.resolver.resolve(target);
    return this.operationLocks.withLock(`article-operation-${article.id}`, async () => {
      const current = await this.repository.getById(article.id); if (!current || current.currentRevision !== article.currentRevision) throw new Error("Concurrent article mutation detected");
      const source = await resolveContentPath(this.vaultRoot, current.sourcePath); const oldBody = await fs.readFile(source, "utf8");
      const oldHash = sha256(oldBody); if (current.currentRevision !== 4 || current.contentHash !== oldHash) throw new Error("REPAIR_PRECONDITION_FAILED");
      const marker = missingAssetPath.replace(/\\/g, "/"); const lines = oldBody.split(/\r?\n/); const body = lines.filter((line) => !line.includes(marker) && !line.trim().startsWith("infographic_path:")).join("\n");
      const newHash = sha256(body); const now = new Date().toISOString(); const operationId = randomUUID(); const updated = { ...current, sourcePath: canonicalizePath(current.sourcePath), contentHash: newHash, currentRevision: 5, updatedAt: now };
      const revision = { articleId: updated.id, revision: 5, timestamp: now, operation: "repair" as const, operationId, actor: context.actor, origin: context.origin, previousHash: oldHash, newHash, summary: "Remove dangling asset reference", metadataSnapshot: updated, bodySnapshot: body };
      await fs.writeFile(source, body, "utf8"); await this.repository.save(updated); await this.repository.appendRevision(revision); await this.repository.appendEvent({ operationId, articleId: updated.id, operation: "repair", phase: "completed", timestamp: now, actor: context.actor, origin: context.origin, revision: 5, reason: "dangling_asset_reference_removed", contentHash: newHash, sourcePath: updated.sourcePath, evidence: { fromRevision: 4, toRevision: 5, missingAssetPath, oldContentHash: oldHash, newContentHash: newHash } }); return updated;
    });
  }
  unpublish(target: string, context: OperationContext) { return this.transition(target, "unpublished", "unpublish", context); }
  archive(target: string, context: OperationContext, reason?: string) { return this.transition(target, "archived", "archive", context, false, { archiveReason: reason }); }

  async delete(target: string, context: OperationContext, reason?: string): Promise<ArticleMetadata> {
    const article = await this.resolver.resolve(target); if (article.status === "deleted") return article;
    if (article.status === "published") throw new Error("Published article must be unpublished before delete");
    assertTransition(article.status, "deleted");
    return this.execute("delete", article, context, async (operationId) => {
      await this.repository.saveTombstone({ articleId: article.id, deletedAt: new Date().toISOString(), previousStatus: article.status, slug: article.slug, sourcePath: article.sourcePath, lastRevision: article.currentRevision, reason });
      const updated = { ...article, status: "deleted" as const, updatedAt: new Date().toISOString() }; await this.repository.save(updated); return this.recordRevision(updated, "delete", context, article.contentHash, reason ?? "Soft delete", operationId);
    });
  }

  async restore(target: string, context: OperationContext): Promise<ArticleMetadata> {
    const article = await this.resolver.resolve(target); if (article.status !== "deleted") throw new Error(`Article is not deleted: ${article.id}`);
    if (!await this.repository.getTombstone(article.id)) throw new Error(`Tombstone missing: ${article.id}`);
    return this.execute("restore", article, context, async (operationId) => { const updated = { ...article, status: "unpublished" as const, updatedAt: new Date().toISOString() }; await this.repository.save(updated); await this.repository.removeTombstone(article.id); return this.recordRevision(updated, "restore", context, article.contentHash, "Restored to unpublished", operationId); });
  }

  async rename(target: string, input: { title?: string; slug?: string; context: OperationContext }): Promise<ArticleMetadata> {
    const article = await this.resolver.resolve(target); const slug = input.slug ?? article.slug; const title = input.title ?? article.title;
    if (slug === article.slug && title === article.title) return article;
    if (slug !== article.slug) await this.assertSlugAvailable(slug, article.id);
    return this.execute("rename", article, input.context, async (operationId) => { const updated = { ...article, slug, title, updatedAt: new Date().toISOString() }; await this.repository.save(updated); if (slug !== article.slug) await this.repository.addRedirect(article.slug, slug, article.id); return this.recordRevision(updated, "rename", input.context, article.contentHash, `Renamed ${article.slug} -> ${slug}`, operationId); });
  }

  async history(target: string): Promise<ArticleRevision[]> { return this.repository.history((await this.resolver.resolve(target)).id); }

  async rollback(target: string, revisionNumber: number, context: OperationContext): Promise<ArticleMetadata> {
    const current = await this.resolver.resolve(target); const targetRevision = (await this.repository.history(current.id)).find((revision) => revision.revision === revisionNumber);
    if (!targetRevision) throw new Error(`Revision not found: ${current.id}#${revisionNumber}`);
    return this.execute("rollback", current, context, async (operationId) => {
      const snapshot = { ...targetRevision.metadataSnapshot, id: current.id, currentRevision: current.currentRevision, updatedAt: new Date().toISOString() };
      if (targetRevision.bodySnapshot !== undefined) { await fs.mkdir(path.dirname(this.absolute(snapshot.sourcePath)), { recursive: true }); await fs.writeFile(this.absolute(snapshot.sourcePath), targetRevision.bodySnapshot, "utf8"); }
      snapshot.contentHash = await this.hashIfExists(snapshot.sourcePath); await this.repository.save(snapshot); return this.recordRevision(snapshot, "rollback", context, current.contentHash, `Rollback to revision ${revisionNumber}`, operationId);
    });
  }

  async completeQueuedGeneration(target: string, operation: "create" | "regenerate" | "research_update", operationId: string, context: OperationContext, sourcePath?: string): Promise<ArticleMetadata> { const id = (await this.resolver.resolve(target)).id; return this.operationLocks.withLock(`article-operation-${id}`, () => this.completeQueuedGenerationUnlocked(id, operation, operationId, context, sourcePath)); }

  private async completeQueuedGenerationUnlocked(target: string, operation: "create" | "regenerate" | "research_update", operationId: string, context: OperationContext, sourcePath?: string): Promise<ArticleMetadata> {
    const events = await this.repository.events(); const completed = events.find((event) => event.operationId === operationId && event.phase === "completed");
    const article = await this.resolver.resolve(target); if (completed) return article;
    const queued = events.find((event) => event.operationId === operationId && event.phase === "queued"); if (!queued) throw new Error(`Queued article operation not found: ${operationId}`);
    try {
      const finalPath = sourcePath ?? article.sourcePath; const contentHash = await this.hashIfExists(finalPath); if (!contentHash) throw new Error(`Completed job source is missing: ${finalPath}`);
      const updated: ArticleMetadata = { ...article, sourcePath: finalPath, contentHash, status: operation === "create" && article.status === "draft" ? "review" : article.status, lastJobId: context.jobId ?? article.lastJobId, lastGitSha: context.gitSha ?? article.lastGitSha, updatedAt: new Date().toISOString() };
      await this.repository.save(updated); const revision = await this.recordRevision(updated, operation, context, article.contentHash, context.summary ?? `Worker completed ${operation}`, operationId);
      await this.repository.appendEvent({ operationId, articleId: article.id, operation, phase: "completed", timestamp: new Date().toISOString(), actor: context.actor, origin: context.origin, jobId: context.jobId, gitSha: context.gitSha, revision: revision.currentRevision }); return revision;
    } catch (error) { await this.repository.appendEvent({ operationId, articleId: article.id, operation, phase: "failed", timestamp: new Date().toISOString(), actor: context.actor, origin: context.origin, jobId: context.jobId, gitSha: context.gitSha, error: error instanceof Error ? error.message : String(error) }); throw error; }
  }

  async failQueuedGeneration(target: string, operation: "create" | "regenerate" | "research_update", operationId: string, context: OperationContext, error: string): Promise<void> {
    const id = (await this.resolver.resolve(target)).id; await this.operationLocks.withLock(`article-operation-${id}`, async () => { const article = await this.resolver.resolve(id); const events = await this.repository.events(); if (events.some((event) => event.operationId === operationId && ["completed", "failed"].includes(event.phase))) return; await this.repository.appendEvent({ operationId, articleId: article.id, operation, phase: "failed", timestamp: new Date().toISOString(), actor: context.actor, origin: context.origin, jobId: context.jobId, gitSha: context.gitSha, error }); });
  }

  private async generateExisting(target: string, operation: "regenerate" | "research_update", context: OperationContext, prompt?: string): Promise<ArticleMetadata> {
    const article = await this.resolver.resolve(target); if (!this.generator) throw new Error("Article generator is not configured"); const previousHash = await this.hashIfExists(article.sourcePath);
    return this.execute(operation, article, context, async (operationId) => { const result = await this.generator!.generate({ operation, article, operationId, prompt }); const updated = { ...article, sourcePath: result.sourcePath ?? article.sourcePath, lastJobId: result.jobId, lastGitSha: result.gitSha, contentHash: result.pending ? article.contentHash : await this.hashIfExists(result.sourcePath ?? article.sourcePath), updatedAt: new Date().toISOString() }; await this.repository.save(updated); if (result.pending) { this.pendingResults.add(updated); return updated; } return this.recordRevision(updated, operation, { ...context, jobId: result.jobId ?? context.jobId, gitSha: result.gitSha ?? context.gitSha }, previousHash, result.summary ?? operation, operationId); });
  }

  private async transition(target: string, status: ArticleStatus, operation: ArticleOperation, context: OperationContext, validatePublish = false, patch: Partial<ArticleMetadata> = {}): Promise<ArticleMetadata> {
    const article = await this.resolver.resolve(target); if (article.status === status) return article; assertTransition(article.status, status); if (validatePublish) await this.validatePublish(article);
    return this.execute(operation, article, context, async (operationId) => { const updated = { ...article, ...patch, status, updatedAt: new Date().toISOString() }; await this.repository.save(updated); return this.recordRevision(updated, operation, context, article.contentHash, `${article.status} -> ${status}`, operationId); });
  }

  private async validatePublish(article: ArticleMetadata): Promise<void> {
    if (await this.repository.getTombstone(article.id)) throw new Error("Tombstoned article cannot be published");
    await this.assertSlugAvailable(article.slug, article.id);
    const file = this.absolute(article.sourcePath); const text = await fs.readFile(file, "utf8"); const hash = sha256(text);
    if (!article.contentHash) throw new Error("Article metadata is missing source hash");
    if (hash !== article.contentHash) throw new Error("Article source hash does not match metadata");
    const fm = parseFrontmatter(text);
    if (fm.title && String(fm.title) !== article.title) throw new Error("Article title does not match source frontmatter");
    if ((fm.ebs_id || fm.id) && String(fm.ebs_id ?? fm.id) !== article.id) throw new Error("Article ID does not match source frontmatter");
    if (fm.slug && String(fm.slug) !== article.slug) throw new Error("Article slug does not match source frontmatter");
    if (fm.source_path && this.normalizeSourcePath(String(fm.source_path)) !== this.normalizeSourcePath(article.sourcePath)) throw new Error("Article source path does not match source frontmatter");
    if (fm.status && String(fm.status) !== "published") throw new Error("Article frontmatter status is not publishable");
  }

  private async assertSlugAvailable(slug: string, exceptId?: string): Promise<void> { const match = await this.repository.getBySlug(slug); if (match && match.id !== exceptId) throw new Error(`Duplicate article slug: ${slug}`); }
  private absolute(sourcePath: string): string { const resolved = path.resolve(this.vaultRoot, sourcePath); const root = path.resolve(this.vaultRoot); if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Article path escapes Vault: ${sourcePath}`); return resolved; }
  private normalizeSourcePath(sourcePath: string): string { return sourcePath.replace(/\\/g, "/").normalize("NFC").replace(/^\.\//, "").toLowerCase(); }
  private async hashIfExists(sourcePath: string): Promise<string | undefined> { try { return sha256(await fs.readFile(this.absolute(sourcePath), "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
  private async recordRevision(article: ArticleMetadata, operation: ArticleOperation, context: OperationContext, previousHash: string | undefined, summary: string, operationId: string): Promise<ArticleMetadata> {
    const revision = article.currentRevision + 1; const body = await this.readBody(article.sourcePath); const updated = { ...article, currentRevision: revision, updatedAt: new Date().toISOString() }; await this.repository.save(updated);
    await this.repository.appendRevision({ articleId: updated.id, revision, timestamp: new Date().toISOString(), operation, operationId, actor: context.actor, origin: context.origin, jobId: context.jobId, previousHash, newHash: updated.contentHash, gitSha: context.gitSha, summary, metadataSnapshot: updated, bodySnapshot: body }); return updated;
  }
  private async readBody(sourcePath: string): Promise<string | undefined> { try { return await fs.readFile(this.absolute(sourcePath), "utf8"); } catch { return undefined; } }
  private async execute<T>(operation: ArticleOperation, article: ArticleMetadata, context: OperationContext, action: (operationId: string) => Promise<T>): Promise<T> {
    return this.operationLocks.withLock(operation === "create" ? "article-operation-create" : `article-operation-${article.id}`, async () => {
      if (operation !== "create") { const latest = await this.repository.getById(article.id); if (!latest || latest.currentRevision !== article.currentRevision || latest.updatedAt !== article.updatedAt) throw new Error(`Concurrent article mutation detected: ${article.id}`); }
      const operationId = randomUUID(); const base: Omit<ManagementEvent, "phase" | "timestamp"> = { operationId, articleId: article.id, operation, actor: context.actor, origin: context.origin, jobId: context.jobId, gitSha: context.gitSha };
      await this.repository.appendEvent({ ...base, phase: "started", timestamp: new Date().toISOString() });
      try { const value = await action(operationId); const result = value as Partial<ArticleMetadata>; const revision = "currentRevision" in (value as object) ? Number(result.currentRevision) : undefined; await this.repository.appendEvent({ ...base, phase: this.pendingResults.has(value as object) ? "queued" : "completed", timestamp: new Date().toISOString(), jobId: result.lastJobId ?? base.jobId, gitSha: result.lastGitSha ?? base.gitSha, revision }); return value; }
      catch (error) { await this.repository.appendEvent({ ...base, phase: "failed", timestamp: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }); throw error; }
    });
  }
}

export function generateArticleId(now = Date.now()): string { const time = now.toString(32).toUpperCase().padStart(10, "0").slice(-10); const random = randomBytes(10).toString("hex").toUpperCase().slice(0, 16); return `art_${time}${random}`; }
