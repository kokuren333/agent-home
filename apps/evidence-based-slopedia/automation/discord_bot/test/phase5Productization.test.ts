import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { phase3Fixture, readTree } from "./phase3Fixture.js";
import { PublicUrlService } from "../../ebs/core/src/services/publicUrlService.js";
import { BuildService } from "../../ebs/core/src/services/buildService.js";
import { IndexService } from "../../ebs/core/src/services/indexService.js";
import { ImageService } from "../../ebs/core/src/services/imageService.js";
import { BackupService } from "../../ebs/core/src/services/backupService.js";
import { DeployService, DirectoryDeploymentTarget } from "../../ebs/core/src/services/deployService.js";
import { createGitFixture, git } from "./gitFixture.js";

test("public URL service separates Windows paths, Japanese URL encoding, and base paths", () => {
  const urls = new PublicUrlService({ basePath: "/ebs/", origin: "https://example.test" });
  assert.equal(urls.articleUrl({ slug: "技術・AI/GPU" }), "/ebs/articles/%E6%8A%80%E8%A1%93%E3%83%BBAI/GPU/");
  assert.equal(urls.topicUrl("技術・AI"), "/ebs/topics/%E6%8A%80%E8%A1%93%E3%83%BBAI/");
  assert.equal(urls.assetUrl("articles/art_x.webp"), "/ebs/assets/articles/art_x.webp");
});

test("Phase 5 build creates portable portal pages, topic routes, crawl-safe assets, and base path links", async () => {
  const { root, repository, seed } = await phase3Fixture(); const japanese = await seed("art_JA", "日本語記事", "技術・AI/gpu", "published", "## 概要\n\nGPUの解説です。\n\n## 詳細\n\n追加情報です。"); await repository.save({ ...japanese, category: "技術・AI" });
  const indexes = new IndexService(root, repository); await indexes.rebuildAll(); await new BuildService(root, repository, indexes, { basePath: "/ebs/" }).build(); const tree = await readTree(path.join(root, "dist"));
  for (const file of ["index.html", "articles/index.html", "topics/index.html", "recent/index.html", "news/index.html", "search/index.html", "about/index.html", "404.html", "robots.txt", "feed.xml"]) assert.ok(tree[file], file);
  assert.ok(tree["articles/技術・AI/gpu/index.html"]); assert.ok(tree["topics/技術・AI/index.html"]); assert.match(tree["index.html"], /\/ebs\/articles\//); assert.match(tree["articles/技術・AI/gpu/index.html"], /class="toc"/); assert.match(tree["articles/技術・AI/gpu/index.html"], /summary-card/); assert.match(tree["assets/ebs.css"], /clip:rect\(0,0,0,0\)/); assert.match(tree["assets/ebs.css"], /overflow-wrap:anywhere/); assert.doesNotMatch(Object.values(tree).join("\n"), /source_path|worktree|canonical\//i);
});

test("build accepts ContentRoot input and writes dist only to the AppRoot output", async () => {
  const { root, repository, seed } = await phase3Fixture();
  await seed("art_ROOTS", "Separated roots", "science/separated-roots", "published", "ContentRoot article\n");
  const indexes = new IndexService(root, repository);
  await indexes.rebuildAll();
  const appRoot = path.join(root, "app-root");
  const result = await new BuildService(root, repository, indexes, { basePath: "/" }, appRoot).build();
  assert.equal(result.distDir, path.join(appRoot, "dist"));
  assert.ok(await fs.stat(path.join(appRoot, "dist", "articles", "science", "separated-roots", "index.html")));
  await assert.rejects(() => fs.stat(path.join(root, "dist")));
});

test("image migration converts PNG atomically to canonical WebP and removes original", async () => {
  const { root, repository, seed } = await phase3Fixture(); const article = await seed("art_IMAGE", "Image", "science/image", "published"); const original = path.join(root, "50_Assets", "Infographics", "image.png"); await fs.mkdir(path.dirname(original), { recursive: true }); await sharp({ create: { width: 1200, height: 675, channels: 3, background: "#135" } }).png().toFile(original);
  const service = new ImageService(root, repository); const result = await service.migrate(false); assert.equal(result[0].status, "migrated"); await assert.rejects(() => fs.stat(original)); const refreshed = await repository.getById(article.id); assert.match(refreshed!.image!.path, /\.webp$/); assert.ok(await fs.stat(path.join(root, refreshed!.image!.path))); assert.equal((await service.inspect(refreshed!.image!)).issue, undefined);
});

test("directory deployment is atomic/no-op aware and backups verify/stage without overwriting canonical state", async () => {
  const { root, repository, seed } = await phase3Fixture(); await seed("art_DEPLOY", "Deploy", "science/deploy", "published"); const indexes = new IndexService(root, repository); await indexes.rebuildAll(); await new BuildService(root, repository, indexes).build(); const deployed = path.join(root, "host"); const deploy = new DeployService(root, new DirectoryDeploymentTarget(deployed)); const first = await deploy.deploy(); assert.equal(first.result, "succeeded"); assert.ok(await fs.stat(path.join(deployed, "index.html"))); const second = await deploy.deploy(); assert.match(second.error ?? "", /no-op/);
  const backup = new BackupService(root); const manifest = await backup.create(); assert.equal((await backup.verify(manifest.id)).valid, true); const staged = await backup.stageRestore(manifest.id); assert.ok(await fs.stat(path.join(staged, "manifest.json"))); assert.ok(await repository.getById("art_DEPLOY"));
});

test("GitHub Pages directory deploy commits and returns the actual Pages commit SHA", async () => {
  const fixture = await createGitFixture("ebs-pages-"); const dist = path.join(fixture.root, "dist"); await fs.mkdir(path.join(dist, "assets"), { recursive: true }); await fs.writeFile(path.join(dist, "index.html"), "new site\n"); await fs.writeFile(path.join(dist, "build-manifest.json"), JSON.stringify({ article_count: 0, base_path: "/" })); await fs.writeFile(path.join(dist, "search-index.json"), "[]"); await fs.writeFile(path.join(dist, "sitemap.xml"), "<urlset/>\n");
  const target = new DirectoryDeploymentTarget(fixture.vault); const changed = await target.deploy(dist, "hash-1"); assert.match(changed.message, /pushed origin\/main/); assert.match(changed.remoteRevision ?? "", /^[0-9a-f]{40}$/); assert.equal(changed.remoteRevision, (await git(fixture.vault, "rev-parse", "HEAD")).trim()); assert.equal(await git(fixture.vault, "status", "--porcelain"), ""); assert.match(await fs.readFile(path.join(fixture.seed, "README.md"), "utf8"), /fixture/);
  const unchanged = await target.deploy(dist, "hash-1"); assert.match(unchanged.message, /no Pages repository changes/); assert.equal(unchanged.remoteRevision, changed.remoteRevision); assert.equal(await fs.stat(path.join(fixture.vault, ".git")) !== undefined, true);
});

test("GitHub Pages deploy reports push failure", async () => {
  const fixture = await createGitFixture("ebs-pages-fail-"); const dist = path.join(fixture.root, "dist"); await fs.mkdir(dist); await fs.writeFile(path.join(dist, "index.html"), "site\n"); await fs.writeFile(path.join(dist, "build-manifest.json"), JSON.stringify({ article_count: 0, base_path: "/" })); await fs.writeFile(path.join(dist, "search-index.json"), "[]"); await fs.writeFile(path.join(dist, "sitemap.xml"), "<urlset/>\n"); await git(fixture.vault, "remote", "set-url", "origin", path.join(fixture.root, "missing.git"));
  await assert.rejects(() => new DirectoryDeploymentTarget(fixture.vault).deploy(dist, "hash-fail"), /Pages git push origin main failed/); assert.ok(await fs.stat(path.join(fixture.vault, ".git")));
});

test("backup retention preserves daily, weekly, and monthly recovery points", async () => {
  const { root } = await phase3Fixture(); const backup = new BackupService(root);
  const rootDir = path.join(root, "backups"); await fs.mkdir(rootDir, { recursive: true });
  for (const [id, createdAt] of [["backup-old", "2025-01-02T00:00:00.000Z"], ["backup-week", "2025-01-09T00:00:00.000Z"], ["backup-current", "2025-01-10T00:00:00.000Z"]] as const) { const directory=path.join(rootDir,id); await fs.mkdir(directory,{recursive:true}); await fs.writeFile(path.join(directory,"manifest.json"),JSON.stringify({id,createdAt,schemaVersion:1,files:[]})); }
  const result = await backup.prune({ daily: 1, weekly: 2, monthly: 1 }); assert.deepEqual(result.removed, ["backup-week"]); assert.equal((await backup.list()).length, 2);
  const pruned = await backup.prune({ daily: 1, weekly: 1, monthly: 1 }); assert.deepEqual(pruned.removed, ["backup-old"]); assert.equal((await backup.list()).length, 1);
});
