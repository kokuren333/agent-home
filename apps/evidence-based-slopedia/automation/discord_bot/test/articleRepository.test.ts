import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FilesystemArticleRepository } from "../../ebs/core/src/infrastructure/filesystemArticleRepository.js";
import type { ArticleMetadata } from "../../ebs/core/src/domain/article.js";
import { ArticleResolver } from "../../ebs/core/src/services/articleResolver.js";

test("filesystem repository persists identity, revisions, tombstones, and redirects", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-article-repo-"));
  const repository = new FilesystemArticleRepository(root);
  const article: ArticleMetadata = { id: "art_TEST", type: "encyclopedia", title: "GPU", slug: "technology/gpu", status: "draft", sourcePath: "draft.md", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", aliases: [], image: null, currentRevision: 0 };
  await repository.save(article);
  assert.equal((await repository.getBySlug("TECHNOLOGY/GPU"))?.id, article.id);
  assert.equal((await repository.getByPath("DRAFT.md"))?.id, article.id);
  await repository.save({ ...article, id: "art_SECOND", slug: "technology/second" });
  await assert.rejects(() => new ArticleResolver(repository).resolve("draft.md"), /Ambiguous article target/);
  await repository.appendRevision({ articleId: article.id, revision: 1, timestamp: article.updatedAt, operation: "create", operationId: "op", actor: "test", origin: "test", metadataSnapshot: article });
  assert.equal((await repository.history(article.id)).length, 1);
  await assert.rejects(() => repository.appendRevision({ articleId: article.id, revision: 1, timestamp: article.updatedAt, operation: "edit", operationId: "overwrite", actor: "test", origin: "test", metadataSnapshot: article }), (error: NodeJS.ErrnoException) => error.code === "EEXIST");
  await repository.saveTombstone({ articleId: article.id, deletedAt: article.updatedAt, previousStatus: "draft", slug: article.slug, sourcePath: article.sourcePath, lastRevision: 1 });
  assert.equal((await repository.getTombstone(article.id))?.previousStatus, "draft");
  await repository.addRedirect("technology/gpu", "technology/graphics-processor", article.id);
  assert.match(await fs.readFile(repository.redirectsFile, "utf8"), /graphics-processor/);
});
