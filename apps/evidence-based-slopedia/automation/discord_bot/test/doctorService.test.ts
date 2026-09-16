import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DoctorService } from "../../ebs/core/src/services/doctorService.js";
import { IndexService } from "../../ebs/core/src/services/indexService.js";
import { BuildService } from "../../ebs/core/src/services/buildService.js";
import { sha256 } from "../../ebs/core/src/migration/articleInventory.js";
import { phase3Fixture } from "./phase3Fixture.js";

test("doctor detects broken links and refuses semantic retargeting", async () => {
  const { root, repository, seed } = await phase3Fixture(); await seed("art_BROKEN", "Broken", "test/broken", "published", "This links to [[Unknown Semantic Target]]."); const report = await new DoctorService(root, repository).run(true); assert.ok(report.findings.some((finding) => finding.code === "BROKEN_INTERNAL_LINK" && finding.reviewRequired && !finding.fixed)); assert.ok(report.findings.some((finding) => finding.code === "SAFE_FIX_BLOCKED"));
});

test("doctor --fix repairs revision counters and stale derived state", async () => {
  const { root, repository, seed } = await phase3Fixture(); const article = await seed("art_FIX", "Fix", "test/fix", "published"); await repository.update(article.id, { currentRevision: 9 }); const report = await new DoctorService(root, repository).run(true); assert.equal((await repository.getById(article.id))?.currentRevision, 0); assert.ok(report.findings.some((finding) => finding.code === "REVISION_COUNTER_REPAIRED" && finding.fixed)); assert.ok(await fs.stat(path.join(root, "generated", "index-manifest.json"))); assert.ok(await fs.stat(path.join(root, "dist", "index.html")));
});

test("doctor detects duplicate slugs, stale indexes, and deleted articles indexed", async () => {
  const { root, repository, seed } = await phase3Fixture(); const visible = await seed("art_VISIBLE", "Visible", "test/shared", "published"); const duplicate = await seed("art_DUP", "Duplicate", "test/shared", "unpublished"); const deleted = await seed("art_GONE", "Gone", "test/gone", "deleted"); await repository.saveTombstone({ articleId: deleted.id, deletedAt: "2026-01-03", previousStatus: "unpublished", slug: deleted.slug, sourcePath: deleted.sourcePath, lastRevision: 0 }); const indexes = new IndexService(root, repository); await indexes.rebuildAll(); await new BuildService(root, repository, indexes).build(); const searchFile = path.join(root, "generated", "search-index.json"); const search = JSON.parse(await fs.readFile(searchFile, "utf8")); search.push({ id: deleted.id }); await fs.writeFile(searchFile, JSON.stringify(search)); const body = await fs.readFile(path.join(root, visible.sourcePath), "utf8"); await repository.save({ ...visible, contentHash: sha256(`${body}\nchanged`), updatedAt: "2026-02-01" }); const report = await new DoctorService(root, repository).run(false); const codes = new Set(report.findings.map((finding) => finding.code)); assert.ok(codes.has("DUPLICATE_SLUG")); assert.ok(codes.has("STALE_INDEX")); assert.ok(codes.has("INDEX_HASH_MISMATCH")); assert.ok(codes.has("PRIVATE_ARTICLE_INDEXED")); assert.equal(duplicate.status, "unpublished");
});
