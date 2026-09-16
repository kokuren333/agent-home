import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonJobRepository } from "../../ebs/core/src/infrastructure/jsonJobRepository.js";
import { FilesystemArticleRepository } from "../../ebs/core/src/infrastructure/filesystemArticleRepository.js";
import { ContentService } from "../../ebs/core/src/services/contentService.js";
import { ReconciliationService } from "../../ebs/core/src/services/reconciliationService.js";
import type { CreateJobInput, Job } from "../../ebs/core/src/domain/job.js";

test("succeeded queued generation reconciles final hash/revision/event idempotently", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-reconcile-")); const articles = new FilesystemArticleRepository(root); const jobs = new JsonJobRepository(path.join(root, "jobs.json")); let queued!: Job;
  const service = new ContentService(root, articles, { async generate(request) { queued = await jobs.create({ query: "create", mode: "new", jobType: "article", article: { articleId: request.article.id, operation: request.operation, sourcePath: request.article.sourcePath, operationId: request.operationId }, discordUserId: "test", channelId: "test", guildId: null, model: "test", reasoningEffort: "low" }); return { jobId: queued.id, pending: true }; } });
  const created = await service.create({ title: "Queued", sourcePath: "articles/queued.md", context: { actor: "cli", origin: "cli" } }); assert.equal(created.currentRevision, 0); assert.equal((await articles.events()).at(-1)?.phase, "queued");
  await fs.mkdir(path.join(root, "articles")); await fs.writeFile(path.join(root, created.sourcePath), "---\ntitle: Queued\n---\n# Queued\n\ncompleted\n"); queued = await jobs.update(queued.id, { status: "succeeded", pushedCommitSha: "git-final", finishedAt: new Date().toISOString() }); const reconciliation = new ReconciliationService(root, articles, jobs); const first = await reconciliation.reconcileJob(queued); assert.equal(first?.repaired, true); const updated = await articles.getById(created.id); assert.equal(updated?.status, "review"); assert.equal(updated?.currentRevision, 1); const revision = (await articles.history(created.id))[0]; assert.equal(revision.gitSha, "git-final"); assert.equal(revision.operationId, queued.article?.operationId);
  const second = await reconciliation.reconcileJob(queued); assert.equal(second?.code, "ALREADY_RECONCILED"); assert.equal((await articles.history(created.id)).length, 1);
});

test("orphaned started operation is reported as review required", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-reconcile-started-")); const articles = new FilesystemArticleRepository(root); const jobs = new JsonJobRepository(path.join(root, "jobs.json")); const now = new Date().toISOString(); await articles.save({ id: "art_ORPHAN", type: "encyclopedia", title: "Orphan", slug: "test/orphan", status: "draft", sourcePath: "orphan.md", createdAt: now, updatedAt: now, aliases: [], image: null, currentRevision: 0 }); await articles.appendEvent({ operationId: "op-orphan", articleId: "art_ORPHAN", operation: "edit", phase: "started", timestamp: now, actor: "test", origin: "test" }); const running = await jobs.create({ query: "running", mode: "update", discordUserId: "test", channelId: "test", guildId: null, model: "test", reasoningEffort: "low" }); await jobs.update(running.id, { status: "running" }); const result = await new ReconciliationService(root, articles, jobs).reconcileAll(false); assert.ok(result.findings.some((finding) => finding.code === "INTERRUPTED_OPERATION" && finding.reviewRequired)); assert.ok(result.findings.some((finding) => finding.code === "JOB_PROCESS_MISSING_REVIEW_REQUIRED" && finding.jobId === running.id));
});
