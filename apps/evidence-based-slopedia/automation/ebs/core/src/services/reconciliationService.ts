import fs from "node:fs/promises";
import path from "node:path";
import type { Job, ArticleJobMeta } from "../domain/job.js";
import type { ArticleRepository } from "../ports/articleRepository.js";
import type { JobRepository } from "../ports/jobRepository.js";
import { ContentService } from "./contentService.js";

export interface ReconciliationFinding { code: string; severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL"; message: string; articleId?: string; jobId?: string; operationId?: string; repaired: boolean; reviewRequired: boolean; }
export interface ReconciliationResult { findings: ReconciliationFinding[]; repaired: number; reviewRequired: number; }

export class ReconciliationService {
  private readonly content: ContentService;
  constructor(private readonly vaultRoot: string, private readonly articles: ArticleRepository, private readonly jobs?: Pick<JobRepository<Job>, "all" | "get">) { this.content = new ContentService(vaultRoot, articles); }

  async reconcileJob(job: Job, sourcePath?: string): Promise<ReconciliationFinding | undefined> {
    if (!job.article) return undefined; const operationId = job.article.operationId ?? (await this.articles.events()).find((event) => event.jobId === job.id && event.phase === "queued")?.operationId;
    if (!operationId) return finding("QUEUE_OPERATION_MISSING", "ERROR", `Job ${job.id} has no queued operation`, job.article, job, false, true);
    const terminal = (await this.articles.events()).find((event) => event.operationId === operationId && ["completed", "failed"].includes(event.phase)); if (terminal) return finding("ALREADY_RECONCILED", "INFO", `Operation ${operationId} already ${terminal.phase}`, job.article, job, false, false);
    if (job.status === "succeeded") {
      try { await this.content.completeQueuedGeneration(job.article.articleId, job.article.operation, operationId, { actor: "worker", origin: "reconcile", jobId: job.id, gitSha: job.pushedCommitSha ?? job.commitSha }, sourcePath ?? job.article.sourcePath); return finding("JOB_COMPLETION_RECONCILED", "INFO", `Completed ${job.article.operation}`, job.article, job, true, false); }
      catch (error) { return finding("JOB_COMPLETION_REVIEW_REQUIRED", "ERROR", error instanceof Error ? error.message : String(error), job.article, job, false, true); }
    }
    if (["failed", "failed_review_required", "cancelled"].includes(job.status)) {
      const article = await this.articles.getById(job.article.articleId);
      if (!article) return finding("JOB_ARTICLE_NOT_CANONICALIZED", "WARNING", `Article ${job.article.articleId} is not present in canonical metadata; retained for review`, job.article, job, false, true);
      await this.content.failQueuedGeneration(job.article.articleId, job.article.operation, operationId, { actor: "worker", origin: "reconcile", jobId: job.id, gitSha: job.pushedCommitSha ?? job.commitSha }, job.errorMessage ?? `Job ended as ${job.status}`);
      return finding("JOB_FAILURE_RECONCILED", "WARNING", `Recorded ${job.status}`, job.article, job, true, job.status === "failed_review_required");
    }
    return finding("JOB_NOT_TERMINAL", "INFO", `Job remains ${job.status}`, job.article, job, false, false);
  }

  async reconcileAll(fix = true): Promise<ReconciliationResult> {
    const findings: ReconciliationFinding[] = []; const jobs = await this.jobs?.all() ?? []; for (const job of jobs) { const result = await this.reconcileJob(job); if (result && result.code !== "JOB_NOT_TERMINAL") findings.push(result); if (["running", "waiting_publish", "publishing"].includes(job.status)) findings.push({ code: "JOB_PROCESS_MISSING_REVIEW_REQUIRED", severity: "ERROR", message: `Job remains ${job.status}; process liveness cannot be proven`, articleId: job.article?.articleId, jobId: job.id, operationId: job.article?.operationId, repaired: false, reviewRequired: true }); }
    const events = await this.articles.events(); const terminal = new Set(events.filter((event) => ["completed", "failed"].includes(event.phase)).map((event) => event.operationId));
    for (const event of events.filter((candidate) => candidate.phase === "started" && !terminal.has(candidate.operationId))) { const queued = events.some((candidate) => candidate.operationId === event.operationId && candidate.phase === "queued"); const job = event.jobId ? jobs.find((candidate) => candidate.id === event.jobId) : undefined; if (!queued && !job) findings.push({ code: "INTERRUPTED_OPERATION", severity: "WARNING", message: `Started operation has no terminal event`, articleId: event.articleId, operationId: event.operationId, repaired: false, reviewRequired: true }); }
    for (const article of await this.articles.list()) { const history = await this.articles.history(article.id); const max = history.at(-1)?.revision ?? 0; if (max !== article.currentRevision) { if (fix && max >= 0) { await this.articles.update(article.id, { currentRevision: max }); findings.push({ code: "REVISION_COUNTER_REPAIRED", severity: "WARNING", message: `${article.currentRevision} -> ${max}`, articleId: article.id, repaired: true, reviewRequired: false }); } else findings.push({ code: "REVISION_COUNTER_MISMATCH", severity: "ERROR", message: `${article.currentRevision} != ${max}`, articleId: article.id, repaired: false, reviewRequired: false }); }
      const tombstone = await this.articles.getTombstone(article.id); if (article.status === "deleted" && !tombstone) findings.push({ code: "DELETED_WITHOUT_TOMBSTONE", severity: "CRITICAL", message: "Deleted metadata has no tombstone", articleId: article.id, repaired: false, reviewRequired: true }); if (article.status !== "deleted" && tombstone) findings.push({ code: "ACTIVE_WITH_TOMBSTONE", severity: "CRITICAL", message: "Non-deleted article has tombstone", articleId: article.id, repaired: false, reviewRequired: true }); }
    return { findings, repaired: findings.filter((item) => item.repaired).length, reviewRequired: findings.filter((item) => item.reviewRequired).length };
  }

  async discoverCompletedSource(job: Job): Promise<string | undefined> { if (!job.article) return undefined; if (await exists(path.resolve(this.vaultRoot, job.article.sourcePath))) return job.article.sourcePath; return undefined; }
}

function finding(code: string, severity: ReconciliationFinding["severity"], message: string, meta: ArticleJobMeta, job: Job, repaired: boolean, reviewRequired: boolean): ReconciliationFinding { return { code, severity, message, articleId: meta.articleId, jobId: job.id, operationId: meta.operationId, repaired, reviewRequired }; }
async function exists(file: string): Promise<boolean> { return fs.access(file).then(() => true).catch(() => false); }
