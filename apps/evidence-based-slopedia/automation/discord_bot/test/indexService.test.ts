import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { IndexService } from "../../ebs/core/src/services/indexService.js";
import { phase3Fixture, readTree } from "./phase3Fixture.js";

test("indexes, MOCs, backlinks, related, and sitemap use one public-only rule", async () => {
  const { root, repository, seed } = await phase3Fixture(); const a = await seed("art_A", "Article A", "technology/a", "published", "Article A links to [[Article B]] for details."); const b = await seed("art_B", "Article B", "technology/b", "published"); await seed("art_PRIVATE", "Private", "technology/private", "unpublished"); const deleted = await seed("art_DELETED", "Deleted", "technology/deleted", "deleted"); await repository.saveTombstone({ articleId: deleted.id, deletedAt: "2026-01-03", previousStatus: "unpublished", slug: deleted.slug, sourcePath: deleted.sourcePath, lastRevision: 0 });
  await repository.addRedirect("technology/old-a", a.slug, a.id); const service = new IndexService(root, repository); const manifest = await service.rebuildAll(); assert.equal(manifest.public_article_count, 2); assert.equal((await repository.resolveRedirect("technology/old-a"))?.id, a.id);
  const search = JSON.parse(await fs.readFile(path.join(root, "generated", "search-index.json"), "utf8")); assert.deepEqual(search.map((entry: { id: string }) => entry.id), [a.id, b.id]);
  const links = JSON.parse(await fs.readFile(path.join(root, "generated", "backlink-index.json"), "utf8")); assert.deepEqual(links.outbound[a.id], [b.id]); assert.deepEqual(links.backlinks[b.id], [a.id]); assert.deepEqual(links.broken, []);
  const related = JSON.parse(await fs.readFile(path.join(root, "generated", "related.json"), "utf8")); assert.equal(related[a.id][0].id, b.id); assert.ok(related[a.id][0].score >= 12);
  const sitemap = await fs.readFile(path.join(root, "generated", "sitemap.xml"), "utf8"); assert.match(sitemap, /technology\/a/); assert.doesNotMatch(sitemap, /private|deleted|old-a/);
  const moc = (await readTree(path.join(root, "generated", "moc"))); assert.equal(Object.values(moc).join("\n").match(/<!-- art_/g)?.length, 2); assert.ok(await fs.stat(path.join(root, "_working", "migration_reports", "moc-diff.md")));
});

test("two complete index rebuilds are byte-stable", async () => {
  const { root, repository, seed } = await phase3Fixture(); await seed("art_STABLE", "Stable", "science/stable", "published"); const service = new IndexService(root, repository); await service.rebuildAll(); const first = await readTree(path.join(root, "generated")); await service.rebuildAll(); const second = await readTree(path.join(root, "generated")); assert.deepEqual(second, first);
});

test("Windows source separators never leak into generated URLs", async () => {
  const { root, repository, seed } = await phase3Fixture(); const article = await seed("art_WINDOWS", "Windows Path", "technology/windows-path", "published"); await repository.save({ ...article, sourcePath: article.sourcePath.replace(/\//g, "\\") }); const service = new IndexService(root, repository); await service.rebuildAll(); const search = JSON.parse(await fs.readFile(path.join(root, "generated", "search-index.json"), "utf8")); assert.equal(search[0].url, "/articles/technology/windows-path/"); assert.doesNotMatch(await fs.readFile(path.join(root, "generated", "sitemap.xml"), "utf8"), /\\/);
});
