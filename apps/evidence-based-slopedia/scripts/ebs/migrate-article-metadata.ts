import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { blockingCollisionCount, inventoryArticles } from "../../automation/ebs/core/src/migration/articleInventory.js";
import { FilesystemArticleRepository } from "../../automation/ebs/core/src/infrastructure/filesystemArticleRepository.js";
import type { ArticleMetadata, ArticleStatus } from "../../automation/ebs/core/src/domain/article.js";

const apply = process.argv.includes("--apply");
const vaultRoot = path.resolve(process.env.EBS_VAULT_ROOT ?? await findVaultRoot(process.cwd()));
const inventory = await inventoryArticles(vaultRoot);
const encyclopedia = inventory.articles.filter((article) => article.type === "encyclopedia");
const blocking = blockingCollisionCount(inventory);
const invalid = encyclopedia.filter((article) => !article.title || !article.path || !/^art_[A-Za-z0-9._-]+$/.test(article.proposedId) || (article.status !== undefined && !validStatus(article.status))).length;
const repository = new FilesystemArticleRepository(vaultRoot);
let registryConflicts = 0;
for (const item of encyclopedia) {
  const byId = await repository.getById(item.proposedId); const bySlug = await repository.getBySlug(item.proposedSlug);
  if (byId && normalizePath(byId.sourcePath) !== normalizePath(item.path)) registryConflicts += 1;
  if (bySlug && bySlug.id !== item.proposedId) registryConflicts += 1;
}
const safe = blocking === 0 && invalid === 0 && registryConflicts === 0;
const report = { generatedAt: new Date().toISOString(), mode: apply ? "apply" : "dry-run", totalArticles: inventory.articles.length, encyclopediaArticles: encyclopedia.length, articlesWithExistingId: encyclopedia.filter((a) => a.existingId).length, proposedIds: encyclopedia.filter((a) => !a.existingId).length, duplicateTitles: inventory.collisions.duplicateTitles.length, duplicateNormalizedTitles: inventory.collisions.duplicateNormalizedTitles.length, slugCollisions: inventory.collisions.duplicateSlugCandidates.length, duplicateIds: inventory.collisions.duplicateExistingIds.length, sameContentCandidates: inventory.collisions.sameContentHashes.length, unresolvedMetadata: invalid, registryConflicts, safeToApplyCount: safe ? encyclopedia.length : 0, manualReviewCount: safe ? 0 : encyclopedia.length, applied: false };
if (apply && !safe) throw new Error(`Migration apply blocked: ${blocking} blocking collision group(s), ${invalid} invalid article(s), ${registryConflicts} registry conflict(s).`);
if (apply) {
  for (const item of encyclopedia) {
    const existing = await repository.getById(item.proposedId);
    if (existing) continue;
    const now = new Date().toISOString();
    const operationId = randomUUID();
    const status = validStatus(item.status) ? item.status : "published";
    const metadata: ArticleMetadata = { id: item.proposedId, type: "encyclopedia", title: item.title, slug: item.proposedSlug, status, sourcePath: item.path, createdAt: item.created ?? now, updatedAt: item.updated ?? now, aliases: item.aliases, category: item.category, subfield: item.subfield, image: null, currentRevision: 1, contentHash: item.contentHash };
    await repository.save(metadata);
    await repository.appendEvent({ operationId, articleId: metadata.id, operation: "create", phase: "started", timestamp: now, actor: "system", origin: "migration" });
    await repository.appendRevision({ articleId: metadata.id, revision: 1, timestamp: now, operation: "create", operationId, actor: "system", origin: "migration", previousHash: undefined, newHash: metadata.contentHash, summary: "Imported existing Vault article into EBS article registry", metadataSnapshot: metadata, bodySnapshot: await fs.readFile(path.join(vaultRoot, item.path), "utf8") });
    await repository.appendEvent({ operationId, articleId: metadata.id, operation: "create", phase: "completed", timestamp: new Date().toISOString(), actor: "system", origin: "migration", revision: 1 });
  }
  report.applied = true;
}
const reportDir = path.join(vaultRoot, "_working", "migration_reports");
await fs.mkdir(reportDir, { recursive: true });
const lines = ["# EBS v0.1 Article Migration", "", ...Object.entries(report).map(([key, value]) => `- ${key}: ${value}`), ""];
await fs.writeFile(path.join(reportDir, "ebs-v0.1-article-migration.md"), lines.join("\n"), "utf8");
console.log(JSON.stringify(report, null, 2));

function validStatus(value: string | undefined): value is ArticleStatus { return ["draft", "review", "published", "unpublished", "archived", "deleted"].includes(value ?? ""); }
function normalizePath(value: string): string { return value.replace(/\\/g, "/").normalize("NFC").toLowerCase(); }
async function findVaultRoot(start: string): Promise<string> { let current = path.resolve(start); while (true) { try { await fs.access(path.join(current, "AGENTS.md")); await fs.access(path.join(current, "10_Published")); return current; } catch { /* continue */ } const parent = path.dirname(current); if (parent === current) throw new Error("Could not locate EBS Vault root. Set EBS_VAULT_ROOT."); current = parent; } }
