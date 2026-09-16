import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { IndexService } from "../../ebs/core/src/services/indexService.js";
import { BuildService } from "../../ebs/core/src/services/buildService.js";
import { sha256 } from "../../ebs/core/src/migration/articleInventory.js";
import { phase3Fixture, readTree } from "./phase3Fixture.js";

test("static build renders published articles and excludes every private state", async () => {
  const { root, repository, seed } = await phase3Fixture(); await seed("art_PUBLIC", "Public", "science/public", "published"); for (const status of ["draft", "review", "unpublished", "archived"] as const) await seed(`art_${status.toUpperCase()}`, status, `science/${status}`, status); const deleted = await seed("art_DELETED", "Deleted", "science/deleted", "deleted"); await repository.saveTombstone({ articleId: deleted.id, deletedAt: "2026-01-03", previousStatus: "unpublished", slug: deleted.slug, sourcePath: deleted.sourcePath, lastRevision: 0 }); const tombstoned = await seed("art_TOMBSTONED", "Tombstoned", "science/tombstoned", "published"); await repository.saveTombstone({ articleId: tombstoned.id, deletedAt: "2026-01-03", previousStatus: "unpublished", slug: tombstoned.slug, sourcePath: tombstoned.sourcePath, lastRevision: 0 });
  const indexes = new IndexService(root, repository); await indexes.rebuildAll(); const result = await new BuildService(root, repository, indexes).build(); assert.equal(result.articleCount, 1); const tree = await readTree(path.join(root, "dist")); assert.ok(tree["articles/science/public/index.html"]); assert.ok(tree["articles/index.html"]); assert.match(tree["assets/ebs.css"], /summary/); assert.equal("source_path" in JSON.parse(tree["search-index.json"])[0], false); assert.doesNotMatch(Object.values(tree).join("\n"), /management-events|discordUserId|worktreePath/);
});

test("failed global validation preserves the previous dist atomically", async () => {
  const { root, repository, seed } = await phase3Fixture(); const article = await seed("art_ATOMIC", "Atomic", "science/atomic", "published"); const indexes = new IndexService(root, repository); await indexes.rebuildAll(); const builds = new BuildService(root, repository, indexes); await builds.build(); const before = await readTree(path.join(root, "dist")); const source = path.join(root, article.sourcePath); const brokenBody = "---\ntitle: Atomic\nstatus: published\n---\n# Atomic\n\n[[Missing Article]]\n"; await fs.writeFile(source, brokenBody); await repository.save({ ...article, contentHash: sha256(brokenBody), updatedAt: "2026-01-03T00:00:00.000Z" }); await indexes.rebuildAll(); await assert.rejects(() => builds.build(), /Broken internal article links/); assert.deepEqual(await readTree(path.join(root, "dist")), before);
});

test("article pages render internal links and Mermaid blocks without SPA dependencies", async () => {
  const { root, repository, seed } = await phase3Fixture(); await seed("art_TARGET", "Target", "science/target", "published"); await seed("art_SOURCE", "Source", "science/source", "published", "See [[Target]].\n\n```mermaid\ngraph TD\nA-->B\n```"); const indexes = new IndexService(root, repository); await indexes.rebuildAll(); await new BuildService(root, repository, indexes).build(); const html = await fs.readFile(path.join(root, "dist", "articles", "science", "source", "index.html"), "utf8"); assert.match(html, /href="\/articles\/science\/target\/"/); assert.match(html, /<pre class="mermaid">graph TD/); assert.doesNotMatch(html, /react|webpack/i);
});
