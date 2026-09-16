import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FilesystemMutationLock } from "../../ebs/core/src/infrastructure/filesystemMutationLock.js";
import { FilesystemArticleRepository } from "../../ebs/core/src/infrastructure/filesystemArticleRepository.js";
import { ContentService } from "../../ebs/core/src/services/contentService.js";

test("filesystem lock serializes same-key mutations across instances", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-lock-")); const first = new FilesystemMutationLock(root); const second = new FilesystemMutationLock(root); let active = 0; let maxActive = 0; const work = (lock: FilesystemMutationLock) => lock.withLock("article-art_LOCK", async () => { active += 1; maxActive = Math.max(maxActive, active); await new Promise((resolve) => setTimeout(resolve, 40)); active -= 1; }); await Promise.all([work(first), work(second)]); assert.equal(maxActive, 1);
});

test("simultaneous duplicate revision creation cannot overwrite history", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-revision-lock-")); const a = new FilesystemArticleRepository(root); const b = new FilesystemArticleRepository(root); const metadata = { id: "art_LOCK", type: "encyclopedia" as const, title: "Lock", slug: "test/lock", status: "draft" as const, sourcePath: "lock.md", createdAt: "2026-01-01", updatedAt: "2026-01-01", aliases: [], image: null, currentRevision: 0 }; const revision = { articleId: metadata.id, revision: 1, timestamp: metadata.updatedAt, operation: "create" as const, operationId: "first", actor: "test", origin: "test", summary: "first", metadataSnapshot: metadata }; const results = await Promise.allSettled([a.appendRevision(revision), b.appendRevision({ ...revision, operationId: "second" })]); assert.equal(results.filter((result) => result.status === "fulfilled").length, 1); assert.equal((await a.history(metadata.id))[0].operationId === "first" || (await a.history(metadata.id))[0].operationId === "second", true);
});

test("same-article ContentService mutations serialize or reject stale state without ledger drift", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-content-lock-")); const repository = new FilesystemArticleRepository(root); const now = "2026-01-01"; await repository.save({ id: "art_MUTATE", type: "encyclopedia", title: "Before", slug: "test/mutate", status: "draft", sourcePath: "article.md", createdAt: now, updatedAt: now, aliases: [], image: null, currentRevision: 0 }); const one = new ContentService(root, repository); const two = new ContentService(root, repository); const context = { actor: "test", origin: "test" }; const results = await Promise.allSettled([one.edit("art_MUTATE", { title: "One", context }), two.edit("art_MUTATE", { title: "Two", context })]); const fulfilled = results.filter((result) => result.status === "fulfilled").length; assert.ok(fulfilled === 1 || fulfilled === 2); const metadata = await repository.getById("art_MUTATE"); const history = await repository.history("art_MUTATE"); assert.equal(metadata?.currentRevision, history.length); assert.equal(new Set(history.map((revision) => revision.revision)).size, history.length); assert.ok(results.filter((result) => result.status === "rejected").every((result) => String((result as PromiseRejectedResult).reason).includes("Concurrent article mutation")));
});
