import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { generateArticleId } from "../services/contentService.js";
import { defaultJobPriority, JOB_PRIORITY_ORDER, type BotState, type CreateJobInput, type Job, type JobStatus } from "../domain/job.js";
import type { JobRepository } from "../ports/jobRepository.js";

interface StoreData { jobs: Job[]; state?: BotState; }

export class JsonJobRepository implements JobRepository<Job, CreateJobInput> {
  private lock: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string, private readonly createId: () => string = () => `job-${randomUUID()}`) {}
  async init(): Promise<void> { await fs.mkdir(path.dirname(this.file), { recursive: true }); try { await fs.access(this.file); } catch { await fs.writeFile(this.file, JSON.stringify({ jobs: [], state: defaultState() }, null, 2), "utf8"); } }
  async create(input: CreateJobInput): Promise<Job> { return this.withLock(async () => { const data = await this.read(); const existing = input.idempotencyKey && data.jobs.find((job) => job.idempotencyKey === input.idempotencyKey && ["queued", "running", "waiting_publish", "publishing"].includes(job.status)); if (existing) return existing; const now = new Date().toISOString(); const job = makeJob(input, this.createId(), now); data.jobs.push(job); await this.write(data); return job; }); }
  async createMany(inputs: CreateJobInput[]): Promise<Job[]> { return this.withLock(async () => { const data = await this.read(); const now = new Date().toISOString(); const jobs = inputs.map((input) => makeJob(input, this.createId(), now)); data.jobs.push(...jobs); await this.write(data); return jobs; }); }
  async all(): Promise<Job[]> { return (await this.read()).jobs; }
  async state(): Promise<BotState> { return (await this.read()).state ?? defaultState(); }
  async setQueuePaused(paused: boolean): Promise<BotState> { return this.withLock(async () => { const data = await this.read(); data.state = { queuePaused: paused, updatedAt: new Date().toISOString() }; await this.write(data); return data.state; }); }
  async recent(limit = 10): Promise<Job[]> { return (await this.all()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit); }
  async get(id: string): Promise<Job | undefined> { return (await this.all()).find((job) => job.id === id); }
  async nextQueued(): Promise<Job | undefined> { return this.withLock(async () => { const data = await this.read(); if (data.state?.queuePaused) return undefined; const now = new Date().toISOString(); const job = data.jobs.filter((candidate) => ["queued", "publish_retry_pending"].includes(candidate.status) && (!candidate.scheduledAt || candidate.scheduledAt <= now)).sort((a, b) => JOB_PRIORITY_ORDER[defaultJobPriority(a)] - JOB_PRIORITY_ORDER[defaultJobPriority(b)] || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0]; if (!job) return undefined; job.publishRetryOnly = job.status === "publish_retry_pending"; job.status = "running"; job.priority ??= defaultJobPriority(job); job.startedAt = new Date().toISOString(); job.cancelRequested = false; job.updatedAt = job.startedAt; await this.write(data); return job; }); }
  async cancel(id: string): Promise<Job> { return this.withLock(async () => { const data = await this.read(); const job = required(data.jobs, id); const now = new Date().toISOString(); if (["queued", "publish_retry_pending"].includes(job.status)) { job.status = "cancelled"; job.finishedAt = now; job.errorMessage = "Cancelled before start."; } else if (["running", "waiting_publish", "publishing"].includes(job.status)) { job.cancelRequested = true; job.errorMessage = "Cancellation requested."; } else throw new Error(`Job cannot be cancelled from status: ${job.status}`); job.updatedAt = now; await this.write(data); return job; }); }
  async retry(id: string): Promise<Job> { return this.withLock(async () => { const data = await this.read(); const source = required(data.jobs, id); if (!["failed", "failed_review_required", "cancelled"].includes(source.status)) throw new Error(`Only failed or cancelled jobs can be retried. Current status: ${source.status}`); const now = new Date().toISOString(); const job = makeJob(source, this.createId(), now); job.resultSummary = `Retry of ${source.id}`; data.jobs.push(job); await this.write(data); return job; }); }
  async recoverInterruptedJobs(): Promise<Job[]> { return this.withLock(async () => { const data = await this.read(); const interrupted = data.jobs.filter((job) => ["running", "waiting_publish", "publishing"].includes(job.status) || (job.publishRetryOnly && Boolean(job.worktreePath)) || (job.status === "failed" && /mutation lock timeout|publisher interrupted/i.test(job.errorMessage ?? "") && Boolean(job.worktreePath)) || (job.status === "failed_review_required" && ["daily_news", "daily_forecast"].includes(job.jobType ?? "") && Boolean(job.worktreePath))); const now = new Date().toISOString(); for (const job of interrupted) { const publishPhase = job.publishRetryOnly || ["promoting", "rebuilding", "building", "deploying", "pushed", "verifying"].includes(job.currentPhase ?? "") || ["waiting_publish", "publishing"].includes(job.status) || (job.status === "failed" && /mutation lock timeout|publisher interrupted/i.test(job.errorMessage ?? "")) || (job.status === "failed_review_required" && ["daily_news", "daily_forecast"].includes(job.jobType ?? "")); if (publishPhase && job.worktreePath) { job.status = "publish_retry_pending"; job.publishRetryOnly = true; job.errorMessage = "Publisher interrupted or lock-contended; publish-only retry is queued."; } else { job.status = "failed_review_required"; job.errorMessage = "Bot restarted while generation was active. Review or retry the job."; } job.updatedAt = now; } if (interrupted.length) await this.write(data); return interrupted; }); }
  async update(id: string, patch: Partial<Job>): Promise<Job> { return this.withLock(async () => { const data = await this.read(); const job = required(data.jobs, id); Object.assign(job, patch, { updatedAt: new Date().toISOString() }); await this.write(data); return job; }); }
  async remove(id: string): Promise<void> { await this.withLock(async () => { const data = await this.read(); const index = data.jobs.findIndex((job) => job.id === id); if (index >= 0) { data.jobs.splice(index, 1); await this.write(data); } }); }
  async countByStatus(status: JobStatus): Promise<number> { return (await this.all()).filter((job) => job.status === status).length; }
  async dailyJobsForDate(date: string): Promise<Job[]> { return (await this.all()).filter((job) => job.jobType === "daily_news" && job.daily?.date === date); }
  async forecastJobsForDate(date: string): Promise<Job[]> { return (await this.all()).filter((job) => job.jobType === "daily_forecast" && job.forecast?.date === date); }
  private async read(): Promise<StoreData> { await this.init(); const data = JSON.parse(await fs.readFile(this.file, "utf8")) as StoreData; data.state ??= defaultState(); return data; }
  private async write(data: StoreData): Promise<void> {
    const tmp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    let lastError: unknown;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await fs.rename(tmp, this.file);
        return;
      } catch (error) {
        lastError = error;
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
    throw lastError;
  }
  private async withLock<T>(fn: () => Promise<T>): Promise<T> { const run = this.lock.then(fn, fn); this.lock = run.catch(() => undefined); return run; }
}

function makeJob(input: CreateJobInput, id: string, now: string): Job { const job: Job = { id, jobType: input.jobType ?? "article", query: input.query, mode: input.mode, status: "queued", discordUserId: input.discordUserId, channelId: input.channelId, guildId: input.guildId, createdAt: now, updatedAt: now, model: input.model, reasoningEffort: input.reasoningEffort, daily: input.daily, forecast: input.forecast, mocMaintenance: input.mocMaintenance, imageMaintenance: input.imageMaintenance, article: input.article, priority: input.priority, scheduledAt: input.scheduledAt, idempotencyKey: input.idempotencyKey }; if (job.jobType === "article" && job.mode === "new" && !job.article) { const articleId = generateArticleId(); job.article = { articleId, operation: "create", sourcePath: `_working/pending/${articleId}.md`, operationId: randomUUID() }; } job.priority ??= defaultJobPriority(job); return job; }
function required(jobs: Job[], id: string): Job { const job = jobs.find((candidate) => candidate.id === id); if (!job) throw new Error(`Job not found: ${id}`); return job; }
function defaultState(): BotState { return { queuePaused: false, updatedAt: new Date().toISOString() }; }
