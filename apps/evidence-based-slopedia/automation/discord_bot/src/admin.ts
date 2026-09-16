import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { FilesystemArticleRepository } from "../../ebs/core/src/infrastructure/filesystemArticleRepository.js";
import { generateArticleId } from "../../ebs/core/src/services/contentService.js";
import { parseFrontmatter, sha256 } from "../../ebs/core/src/migration/articleInventory.js";
import { collectPublicArticles } from "../../ebs/core/src/services/publicationPolicy.js";
import { IndexService } from "../../ebs/core/src/services/indexService.js";
import { BuildService } from "../../ebs/core/src/services/buildService.js";
import { DeployService, GitHubPagesDeploymentTarget } from "../../ebs/core/src/services/deployService.js";
import { isArticleSource } from "../../ebs/core/src/infrastructure/contentPaths.js";
import { ContentService } from "../../ebs/core/src/services/contentService.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

dotenv.config({ path: path.join(process.cwd(), ".env") });

const appRoot = path.resolve(process.env.EBE_VAULT_ROOT ?? path.resolve(process.cwd(), "../.."));
const contentRoot = path.resolve(process.env.EBS_CONTENT_ROOT ?? path.join(process.cwd(), "..", "..", "..", "discord_bot-runtime", "content"));
const root = contentRoot;
const repository = new FilesystemArticleRepository(contentRoot);
const command = process.argv[2];
const slug = process.argv.includes("--slug") ? process.argv[process.argv.indexOf("--slug") + 1] : undefined;

if (command === "deploy") {
  const pages = process.env.EBS_GITHUB_PAGES_DIR;
  if (!pages) throw new Error("EBS_GITHUB_PAGES_DIR is required");
  const runtimeRoot = path.resolve(process.env.EBE_BOT_RUNTIME_DIR ?? path.join(process.cwd(), "..", "..", "..", "discord_bot-runtime"));
  console.log(JSON.stringify(await new DeployService(contentRoot, new GitHubPagesDeploymentTarget(path.resolve(pages)), runtimeRoot).deploy(false)));
  process.exit(0);
}
if (command === "repair-gpu") {
  const service = new ContentService(contentRoot, repository);
  const updated = await service.repairMissingAsset("art_FA3A6B44A79B112D6F95006B73", "50_Assets/Infographics/gpu_vs_graphics_board_infographic.png", { actor: "admin", origin: "gpu-repair" });
  console.log(JSON.stringify({ repaired: true, articleId: updated.id, revision: updated.currentRevision, contentHash: updated.contentHash, sourcePath: updated.sourcePath })); process.exit(0);
}
if (command === "repair-transformer-encoding") {
  const target = (await repository.list()).find((article) => article.slug.endsWith("transformer-and-llms"));
  if (!target) throw new Error("Transformer metadata not found");
  const gitPath = "10_Published/07_Technology_Engineering_Computing_AI/機械学習・AIモデル__machine-learning-ai-models/Transformerの仕組みとLLMとの関連__transformer-and-llms.md";
  const clean = (await execFileAsync("git", ["-C", appRoot, "show", `152cb84:${gitPath}`], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })).stdout;
  const tmp = path.join(contentRoot, `_working/repair/${target.id}-transformer-utf8.md`); await fs.mkdir(path.dirname(tmp), { recursive: true }); await fs.writeFile(tmp, clean, "utf8");
  const cleanFrontmatter = parseFrontmatter(clean);
  const updated = await new ContentService(contentRoot, repository).edit(target.id, { replaceFile: tmp, title: String(cleanFrontmatter.title ?? target.title), category: String(cleanFrontmatter.category_name ?? target.category ?? ""), subfield: String(cleanFrontmatter.subfield_name ?? target.subfield ?? ""), context: { actor: "admin", origin: "encoding-repair", summary: "Restore UTF-8 Transformer article from verified Git revision" } });
  console.log(JSON.stringify({ repaired: true, articleId: updated.id, revision: updated.currentRevision, contentHash: updated.contentHash, sourcePath: updated.sourcePath, restorationSource: "git:152cb84" })); process.exit(0);
}
if (command === "repair-linear-math") {
  const target = (await repository.list()).find((article) => article.slug.endsWith("linear-algebra-concepts"));
  if (!target) throw new Error("Linear algebra metadata not found");
  const source = path.join(contentRoot, target.sourcePath); const original = await fs.readFile(source, "utf8");
  const fixed = original.replaceAll("(c_1v_1+cdots+c_kv_k)", "$c_1v_1+\\cdots+c_kv_k$").replaceAll("(T:V\\to W)", "$T:V\\to W$").replaceAll("(T(u+v)=T(u)+T(v))", "$T(u+v)=T(u)+T(v)$").replaceAll("(T(cv)=cT(v))", "$T(cv)=cT(v)$").replaceAll("(Ax=b)", "$Ax=b$").replaceAll("(b)", "$b$").replaceAll("(|b-Ax|^2)", "$|b-Ax|^2$").replaceAll("(ker T)", "$\\ker T$").replaceAll("(T(v)=0)", "$T(v)=0$").replaceAll("(operatorname{Im}T)", "$\\operatorname{Im}T$").replaceAll("(v) を固有ベクトル", "$v$ を固有ベクトル").replaceAll("(Av=\\lambda v)", "$Av=\\lambda v$").replaceAll("(\\lambda) を固有値", "$\\lambda$ を固有値").replaceAll("(A=U\\Sigma V^*)", "$A=U\\Sigma V^*$").replace(/\[\s*dim V=dimker T\+dimoperatorname\{Im\}T\s*\]/g, "\\[\\dim V=\\dim\\ker T+\\dim\\operatorname{Im}T\\]");
  if (fixed === original) throw new Error("No known unrendered math patterns found");
  const tmp = path.join(contentRoot, `_working/repair/${target.id}-linear-math.md`); await fs.mkdir(path.dirname(tmp), { recursive: true }); await fs.writeFile(tmp, fixed, "utf8");
  const updated = await new ContentService(contentRoot, repository).edit(target.id, { replaceFile: tmp, context: { actor: "admin", origin: "math-rendering-repair", summary: "Normalize un-delimited LaTeX expressions for KaTeX" } });
  console.log(JSON.stringify({ repaired: true, articleId: updated.id, revision: updated.currentRevision, contentHash: updated.contentHash, sourcePath: updated.sourcePath })); process.exit(0);
}
if (command === "rebuild") {
  const index = new IndexService(contentRoot, repository);
  console.log(JSON.stringify(await index.rebuildAll()));
  process.exit(0);
}
if (command === "build") {
  const index = new IndexService(contentRoot, repository);
  await index.rebuildAll();
  console.log(JSON.stringify(await new BuildService(contentRoot, repository, index).build()));
  process.exit(0);
}

if (command === "doctor") {
  const refs = new Set((await repository.list()).map((a) => a.sourcePath.replace(/\\/g, "/").toLowerCase()));
  const files = await markdownFiles(path.join(contentRoot, "10_Published"));
  for (const file of files) { const rel = path.relative(contentRoot, file).replace(/\\/g, "/").toLowerCase(); if (!refs.has(rel)) console.log(JSON.stringify({ code: "ORPHAN_PUBLISHED_ARTICLE", path: rel })); }
} else if (command === "recover-article") {
  if (!slug) throw new Error("--slug is required");
  const requested = path.join(contentRoot, "10_Published/07_Technology_Engineering_Computing_AI/機械学習・AIモデル__machine-learning-ai-models/Transformerの仕組みとLLMとの関連__transformer-and-llms.md");
  const file = await fs.access(requested).then(() => requested).catch(() => undefined);
  if (!file) throw new Error(`Published Markdown not found for slug: ${slug}`);
  const sourcePath = path.relative(root, file).replace(/\\/g, "/"); const text = await fs.readFile(file, "utf8"); const fm = parseFrontmatter(text); const title = String(fm.title ?? path.basename(file, ".md"));
  if (await repository.getBySlug(slug) || await repository.getByPath(sourcePath)) throw new Error("Recovery collision: slug or path already registered");
  const id = generateArticleId(); const now = new Date().toISOString(); const metadata = { id, type: "encyclopedia" as const, title, slug, status: "published" as const, sourcePath, createdAt: now, updatedAt: now, aliases: [], category: String(fm.category_name ?? "Technology, Engineering, Computing & AI"), subfield: String(fm.subfield_name ?? "Machine Learning and AI Models"), image: null, currentRevision: 1, contentHash: sha256(text) };
  await repository.save(metadata); const operationId = randomUUID(); await repository.appendRevision({ articleId: id, revision: 1, timestamp: now, operation: "create", operationId, actor: "admin-recovery", origin: "recovery", summary: "Recovered orphan published article", metadataSnapshot: metadata, bodySnapshot: text, newHash: metadata.contentHash }); await repository.appendEvent({ operationId, articleId: id, operation: "create", phase: "completed", timestamp: now, actor: "admin-recovery", origin: "recovery", revision: 1 }); console.log(JSON.stringify({ id, sourcePath, slug }));
} else if (command === "rebuild") { const index = new IndexService(root, repository); const manifest = await index.rebuildAll(); console.log(JSON.stringify(manifest)); } else if (command === "build") { const index = new IndexService(root, repository); await index.rebuildAll(); console.log(JSON.stringify(await new BuildService(root, repository, index).build())); } else if (command === "deploy") { const pages = process.env.EBE_GITHUB_PAGES_DIR; if (!pages) throw new Error("EBE_GITHUB_PAGES_DIR is required"); const runtimeRoot = path.resolve(process.env.EBE_BOT_RUNTIME_DIR ?? path.join(process.cwd(), "..", "..", "..", "discord_bot-runtime")); console.log(JSON.stringify(await new DeployService(root, new GitHubPagesDeploymentTarget(path.resolve(pages)), runtimeRoot).deploy(false))); } else throw new Error("Usage: admin doctor|recover-article --slug <slug>|rebuild|build|deploy");

async function markdownFiles(dir: string): Promise<string[]> { const out: string[] = []; for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) { const f = path.join(dir, e.name); const relative = path.relative(contentRoot, f).replace(/\\/g, "/"); if (e.isDirectory()) out.push(...await markdownFiles(f)); else if (isArticleSource(relative)) out.push(f); } return out; }
