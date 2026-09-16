import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FilesystemArticleRepository } from "../../ebs/core/src/infrastructure/filesystemArticleRepository.js";
import { ContentService } from "../../ebs/core/src/services/contentService.js";
import type { ArticleGenerator } from "../../ebs/core/src/ports/articleGenerator.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-content-"));
  const run = promisify(execFile);
  await run("git", ["init"], { cwd: root }); await run("git", ["config", "user.name", "EBS Test"], { cwd: root }); await run("git", ["config", "user.email", "ebs-test@example.invalid"], { cwd: root });
  const repository = new FilesystemArticleRepository(root);
  let generation = 0;
  const generator: ArticleGenerator = { async generate(request) { generation += 1; const sourcePath = `articles/${request.article.id}.md`; await fs.mkdir(path.join(root, "articles"), { recursive: true }); await fs.writeFile(path.join(root, sourcePath), `---\ntitle: "${request.article.title}"\n---\n# ${request.article.title}\n\n${request.operation} ${generation}\n`, "utf8"); await run("git", ["add", sourcePath], { cwd: root }); await run("git", ["commit", "-m", `${request.operation} ${generation}`], { cwd: root }); const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: root }); return { sourcePath, jobId: `job-${generation}`, gitSha: stdout.trim() }; } };
  return { root, repository, service: new ContentService(root, repository, generator), context: { actor: "tester", origin: "test" } };
}

test("content lifecycle records append-only revisions and events", async () => {
  const { service, repository, context } = await fixture();
  const created = await service.create({ title: "GPUとは", category: "technology", context });
  assert.equal(created.status, "review");
  assert.equal(created.currentRevision, 1);
  const published = await service.publish(created.id, context);
  assert.equal(published.status, "published");
  const unpublished = await service.unpublish(created.slug, context);
  const removed = await service.delete(unpublished.sourcePath, context, "test");
  assert.equal(removed.status, "deleted");
  assert.ok(await repository.getTombstone(created.id));
  const restored = await service.restore(created.id, context);
  assert.equal(restored.status, "unpublished");
  assert.equal((await service.history(created.id)).length, 5);
  const revisions = await service.history(created.id); const events = (await fs.readFile(repository.eventsFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(revisions.every((revision) => events.some((event) => event.phase === "completed" && event.operationId === revision.operationId && event.revision === revision.revision)));
});

test("published articles cannot be deleted and duplicate slugs are rejected", async () => {
  const { service, context } = await fixture();
  const first = await service.create({ title: "First", slug: "technology/shared", context });
  await service.publish(first.id, context);
  await assert.rejects(() => service.delete(first.id, context), /must be unpublished/);
  await assert.rejects(() => service.create({ title: "Second", slug: "technology/shared", context }), /Duplicate article slug/);
});

test("rename creates redirects and rollback restores a prior snapshot", async () => {
  const { service, repository, context } = await fixture();
  const created = await service.create({ title: "Original", slug: "technology/original", context });
  const renamed = await service.rename(created.id, { title: "Renamed", slug: "technology/renamed", context });
  assert.equal((await service.show("technology/original")).id, created.id);
  const rolledBack = await service.rollback(renamed.id, 1, context);
  assert.equal(rolledBack.title, "Original");
  assert.equal(rolledBack.currentRevision, 3);
  assert.equal((await repository.history(created.id)).at(-1)?.operation, "rollback");
});

test("edit, regenerate, research update, and archive remain distinct and traceable", async () => {
  const { root, service, context } = await fixture();
  const created = await service.create({ title: "Lifecycle", slug: "technology/lifecycle", context });
  const replacementFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "ebs-replacement-")), "replacement.md"); await fs.writeFile(replacementFile, "---\ntitle: Lifecycle\n---\n# Lifecycle\n\nmanual edit\n");
  const edited = await service.edit(created.id, { aliases: ["LC"], category: "computing", replaceFile: replacementFile, context });
  assert.deepEqual(edited.aliases, ["LC"]);
  assert.match(await fs.readFile(path.join(root, edited.sourcePath), "utf8"), /manual edit/);
  const regenerated = await service.regenerate(created.id, context);
  const researched = await service.researchUpdate(created.id, context);
  assert.notEqual(regenerated.contentHash, researched.contentHash);
  assert.notEqual(regenerated.lastGitSha, researched.lastGitSha);
  await service.publish(created.id, context); await service.unpublish(created.id, context);
  const archived = await service.archive(created.id, context, "superseded");
  assert.equal(archived.archiveReason, "superseded");
  assert.equal((await service.unpublish(created.id, context)).status, "unpublished");
  assert.deepEqual((await service.history(created.id)).map((revision) => revision.operation), ["create", "edit", "regenerate", "research_update", "publish", "unpublish", "archive", "unpublish"]);
});

test("lifecycle no-ops are idempotent and invalid restore is a safe error", async () => {
  const { service, context } = await fixture(); const created = await service.create({ title: "Idempotent", context });
  const published = await service.publish(created.id, context); const revision = published.currentRevision;
  assert.equal((await service.publish(created.id, context)).currentRevision, revision);
  const unpublished = await service.unpublish(created.id, context); assert.equal((await service.unpublish(created.id, context)).currentRevision, unpublished.currentRevision);
  assert.equal((await service.rename(created.id, { title: unpublished.title, slug: unpublished.slug, context })).currentRevision, unpublished.currentRevision);
  await assert.rejects(() => service.restore(created.id, context), /not deleted/);
  const deleted = await service.delete(created.id, context); assert.equal((await service.delete(created.id, context)).currentRevision, deleted.currentRevision);
});

test("create reserves durable identity before generation failure", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-content-failure-")); const repository = new FilesystemArticleRepository(root);
  const service = new ContentService(root, repository, { async generate() { throw new Error("generator failed"); } });
  await assert.rejects(() => service.create({ title: "Reserved", slug: "technology/reserved", context: { actor: "tester", origin: "test" } }), /generator failed/);
  const reserved = await repository.getBySlug("technology/reserved"); assert.equal(reserved?.status, "draft"); assert.equal(reserved?.currentRevision, 0);
  assert.match(await fs.readFile(repository.eventsFile, "utf8"), /"phase":"failed"/);
});

test("publish gate rejects missing hashes and tombstoned metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-publish-gate-")); const repository = new FilesystemArticleRepository(root); const sourcePath = "articles/gate.md";
  await fs.mkdir(path.join(root, "articles")); await fs.writeFile(path.join(root, sourcePath), "---\ntitle: Gate\n---\n# Gate\n");
  const metadata = { id: "art_GATE", type: "encyclopedia" as const, title: "Gate", slug: "technology/gate", status: "review" as const, sourcePath, createdAt: "2026-01-01", updatedAt: "2026-01-01", aliases: [], image: null, currentRevision: 0 };
  await repository.save(metadata); const service = new ContentService(root, repository); const context = { actor: "tester", origin: "test" };
  await assert.rejects(() => service.publish(metadata.id, context), /missing source hash/);
  const text = await fs.readFile(path.join(root, sourcePath), "utf8"); const { sha256 } = await import("../../ebs/core/src/migration/articleInventory.js"); await repository.save({ ...metadata, contentHash: sha256(text) });
  await repository.saveTombstone({ articleId: metadata.id, deletedAt: "2026-01-01", previousStatus: "unpublished", slug: metadata.slug, sourcePath, lastRevision: 0 });
  await assert.rejects(() => service.publish(metadata.id, context), /Tombstoned article/);
});
