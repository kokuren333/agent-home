import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { ArticleImage, ArticleMetadata } from "../domain/article.js";
import type { ArticleRepository } from "../ports/articleRepository.js";

export interface ImageMigrationResult { articleId: string; source?: string; target?: string; status: "migrated" | "already_webp" | "missing" | "skipped" | "failed"; message: string; }
export interface ImagePolicy { maxBytes: number; quality: number; width: number; height: number; }
const defaults: ImagePolicy = { maxBytes: 250_000, quality: 78, width: 1200, height: 675 };

export class ImageService {
  constructor(private readonly vaultRoot: string, private readonly repository: ArticleRepository, private readonly policy: ImagePolicy = defaults) {}
  async migrate(dryRun = true): Promise<ImageMigrationResult[]> { const results: ImageMigrationResult[] = []; for (const article of await this.repository.list()) { if (article.status !== "published") continue; results.push(await this.migrateArticle(article, dryRun)); } return results; }
  async migrateArticle(article: ArticleMetadata, dryRun = true): Promise<ImageMigrationResult> {
    const source = await this.sourceFor(article); if (!source) return { articleId: article.id, status: "missing", message: "No image source or metadata" };
    const targetRelative = `50_Assets/Articles/${article.id}.webp`; const target = safe(this.vaultRoot, targetRelative);
    try {
      if (source.toLowerCase().endsWith(".webp")) { const meta = await this.metadata(source, article.image?.alt ?? "Article illustration"); if (!dryRun) await this.repository.update(article.id, { image: { ...meta, path: relative(this.vaultRoot, source), source: { type: "migrated" } } }); return { articleId: article.id, source: relative(this.vaultRoot, source), target: relative(this.vaultRoot, source), status: "already_webp", message: "WebP metadata refreshed" }; }
      if (dryRun) return { articleId: article.id, source: relative(this.vaultRoot, source), target: targetRelative, status: "migrated", message: "Would convert to canonical WebP" };
      await fs.mkdir(path.dirname(target), { recursive: true }); const temporary = `${target}.tmp`; let quality = this.policy.quality; for (let i = 0; i < 5; i += 1) { await sharp(source).resize(this.policy.width, this.policy.height, { fit: "inside", withoutEnlargement: true }).webp({ quality }).toFile(temporary); if ((await fs.stat(temporary)).size <= this.policy.maxBytes || quality <= 45) break; quality -= 8; }
      await fs.rename(temporary, target); const meta = await this.metadata(target, article.image?.alt ?? `「${article.title}」に関する図解`); await this.repository.update(article.id, { image: { ...meta, path: targetRelative, source: { type: "migrated" } } });
      if (path.resolve(source) !== path.resolve(target)) await fs.rm(source, { force: true });
      return { articleId: article.id, source: relative(this.vaultRoot, source), target: targetRelative, status: "migrated", message: "Converted, attached canonical WebP, and removed original" };
    } catch (error) { return { articleId: article.id, source: relative(this.vaultRoot, source), target: targetRelative, status: "failed", message: error instanceof Error ? error.message : String(error) }; }
  }
  async inspect(image: ArticleImage): Promise<{ issue?: string; metadata?: ArticleImage }> { try { const file = safe(this.vaultRoot, image.path); const meta = await this.metadata(file, image.alt); if (!image.path.toLowerCase().endsWith(".webp")) return { issue: "non_webp", metadata: meta }; if (!image.alt.trim()) return { issue: "missing_alt", metadata: meta }; if (meta.bytes! > this.policy.maxBytes) return { issue: "oversized", metadata: meta }; if (image.sha256 && image.sha256 !== meta.sha256) return { issue: "hash_mismatch", metadata: meta }; return { metadata: meta }; } catch { return { issue: "corrupt_or_missing" }; } }
  private async sourceFor(article: ArticleMetadata): Promise<string | undefined> { if (article.image) { const candidate = safe(this.vaultRoot, article.image.path); if (await exists(candidate)) return candidate; } const directory = path.join(this.vaultRoot, "50_Assets", "Infographics"); const files = await fs.readdir(directory).catch(() => []); const name = article.slug.split("/").at(-1)?.replace(/[^A-Za-z0-9_-]/g, "") ?? ""; const candidate = files.find((file) => file.toLowerCase().includes(name.toLowerCase())) ?? files.find((file) => /\.(png|jpe?g|webp)$/i.test(file)); return candidate ? path.join(directory, candidate) : undefined; }
  private async metadata(file: string, alt: string): Promise<ArticleImage> { const [data, info] = await Promise.all([fs.readFile(file), sharp(file).metadata()]); return { path: "", alt, width: info.width, height: info.height, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), generatedAt: new Date().toISOString() }; }
}
function safe(root:string, relative:string) { const base=path.resolve(root); const target=path.resolve(base,relative.replace(/[\\/]/g,path.sep)); if(target!==base&&!target.startsWith(`${base}${path.sep}`))throw new Error("Image path escapes vault"); return target; }
function relative(root:string,file:string){return path.relative(root,file).replace(/\\/g,"/");} async function exists(file:string){return fs.access(file).then(()=>true).catch(()=>false);}
