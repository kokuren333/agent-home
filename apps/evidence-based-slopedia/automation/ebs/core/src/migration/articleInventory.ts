import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { generateArticleSlug, normalizeTitle, type ArticleType } from "../domain/article.js";

export interface InventoryArticle {
  path: string;
  filename: string;
  type: ArticleType;
  title: string;
  frontmatter: Record<string, unknown>;
  status?: string;
  category?: string;
  subfield?: string;
  created?: string;
  updated?: string;
  aliases: string[];
  existingSlug?: string;
  existingId?: string;
  contentHash: string;
  normalizedTitle: string;
  proposedId: string;
  proposedSlug: string;
}

export interface InventoryCollisions {
  duplicateTitles: string[][];
  duplicateNormalizedTitles: string[][];
  duplicateSlugCandidates: string[][];
  duplicateExistingIds: string[][];
  sameContentHashes: string[][];
  caseInsensitivePaths: string[][];
  unicodeNormalizedPaths: string[][];
}

export interface ArticleInventory { generatedAt: string; vaultRoot: string; articles: InventoryArticle[]; collisions: InventoryCollisions; }

export async function inventoryArticles(vaultRoot: string): Promise<ArticleInventory> {
  const roots: Array<[string, ArticleType]> = [["10_Published", "encyclopedia"], ["11_Daily", "daily"], ["12_Forecasting", "forecast"]];
  const articles: InventoryArticle[] = [];
  for (const [root, type] of roots) {
    for (const file of await listMarkdown(path.join(vaultRoot, root))) {
      if (path.basename(file).toLowerCase() === "_moc.md") continue;
      const body = await fs.readFile(file, "utf8");
      const relative = path.relative(vaultRoot, file).replace(/\\/g, "/");
      const frontmatter = parseFrontmatter(body);
      const title = String(frontmatter.title ?? inferTitle(body, file));
      const category = optional(frontmatter.category_name ?? frontmatter.category ?? relative.split("/")[1]);
      const subfield = optional(frontmatter.subfield_name ?? frontmatter.subfield ?? relative.split("/")[2]);
      const contentHash = sha256(body);
      articles.push({ path: relative, filename: path.basename(file), type, title, frontmatter, status: optional(frontmatter.status), category, subfield, created: optional(frontmatter.created ?? frontmatter.created_at), updated: optional(frontmatter.updated ?? frontmatter.updated_at), aliases: array(frontmatter.aliases), existingSlug: optional(frontmatter.slug), existingId: optional(frontmatter.id ?? frontmatter.ebs_id), contentHash, normalizedTitle: normalizeTitle(title), proposedId: optional(frontmatter.id ?? frontmatter.ebs_id) ?? deterministicArticleId(relative, contentHash), proposedSlug: optional(frontmatter.slug) ?? generateArticleSlug(category, title, relative) });
    }
  }
  articles.sort((a, b) => a.path.localeCompare(b.path));
  return { generatedAt: new Date().toISOString(), vaultRoot, articles, collisions: {
    duplicateTitles: duplicateGroups(articles, (a) => a.title),
    duplicateNormalizedTitles: duplicateGroups(articles, (a) => a.normalizedTitle),
    duplicateSlugCandidates: duplicateGroups(articles, (a) => a.proposedSlug.toLowerCase()),
    duplicateExistingIds: duplicateGroups(articles.filter((a) => a.existingId), (a) => a.existingId!),
    sameContentHashes: duplicateGroups(articles, (a) => a.contentHash),
    caseInsensitivePaths: duplicateGroups(articles, (a) => a.path.toLowerCase()),
    unicodeNormalizedPaths: duplicateGroups(articles, (a) => a.path.normalize("NFC")),
  } };
}

export function blockingCollisionCount(inventory: ArticleInventory): number {
  return inventory.collisions.duplicateExistingIds.length + inventory.collisions.duplicateSlugCandidates.length + inventory.collisions.caseInsensitivePaths.length + inventory.collisions.unicodeNormalizedPaths.length;
}

export function renderInventoryMarkdown(inventory: ArticleInventory): string {
  const c = inventory.collisions;
  return ["# EBS Article Inventory", "", `- Generated: ${inventory.generatedAt}`, `- Total: ${inventory.articles.length}`, `- Encyclopedia: ${inventory.articles.filter((a) => a.type === "encyclopedia").length}`, `- Daily: ${inventory.articles.filter((a) => a.type === "daily").length}`, `- Forecast: ${inventory.articles.filter((a) => a.type === "forecast").length}`, "", "## Collisions", "", `- duplicate titles: ${c.duplicateTitles.length}`, `- duplicate normalized titles: ${c.duplicateNormalizedTitles.length}`, `- duplicate slug candidates: ${c.duplicateSlugCandidates.length}`, `- duplicate existing IDs: ${c.duplicateExistingIds.length}`, `- same-content candidates: ${c.sameContentHashes.length}`, `- case-insensitive path collisions: ${c.caseInsensitivePaths.length}`, `- Unicode normalization collisions: ${c.unicodeNormalizedPaths.length}`, "", "## Articles", "", ...inventory.articles.map((a) => `- ${a.type} | ${a.proposedId} | ${a.proposedSlug} | ${a.path}`), ""].join("\n");
}

export function parseFrontmatter(text: string): Record<string, unknown> {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3); if (end < 0) return {};
  const result: Record<string, unknown> = {};
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/); if (!match) continue;
    const raw = match[2].trim();
    if (raw.startsWith("[") && raw.endsWith("]")) result[match[1]] = raw.slice(1, -1).split(",").map((v) => v.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    else if (raw === "true" || raw === "false") result[match[1]] = raw === "true";
    else result[match[1]] = raw.replace(/^['"]|['"]$/g, "");
  }
  return result;
}

export function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function deterministicArticleId(sourcePath: string, hash: string): string { return `art_${createHash("sha256").update(`${sourcePath.normalize("NFC")}:${hash}`).digest("hex").slice(0, 26).toUpperCase()}`; }

async function listMarkdown(dir: string): Promise<string[]> { try { const result: string[] = []; for (const entry of await fs.readdir(dir, { withFileTypes: true })) { const target = path.join(dir, entry.name); if (entry.isDirectory()) result.push(...await listMarkdown(target)); else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) result.push(target); } return result; } catch { return []; } }
function inferTitle(text: string, file: string): string { return text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(file, ".md").split("__")[0]; }
function optional(value: unknown): string | undefined { return value === undefined || value === null || String(value).trim() === "" ? undefined : String(value); }
function array(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : value ? [String(value)] : []; }
function duplicateGroups(items: InventoryArticle[], key: (article: InventoryArticle) => string): string[][] { const groups = new Map<string, string[]>(); for (const item of items) { const value = key(item); const group = groups.get(value) ?? []; group.push(item.path); groups.set(value, group); } return [...groups.values()].filter((group) => group.length > 1); }
