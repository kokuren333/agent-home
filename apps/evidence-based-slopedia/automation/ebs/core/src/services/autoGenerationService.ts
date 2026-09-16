import { createHash } from "node:crypto";
import type { CreateJobInput, Job } from "../domain/job.js";
import type { JobRepository } from "../ports/jobRepository.js";
import type { ResourceGuard } from "../ports/resourceGuard.js";
import { ContentService } from "./contentService.js";
import { CandidateRegistry, type TopicCandidate } from "./candidateRegistry.js";
import { EBS_NEWS_CATEGORIES, TopicDiscoveryService } from "./topicDiscoveryService.js";

export interface AutoGenerationConfig { maxPerHour: number; maxPerDay: number; cooldownMinutes: number[]; circuitWindow: number; circuitMaxFailures: number; circuitCooldownMinutes: number; languages: string[]; }
export interface AutoRunResult { status: "queued" | "dry_run" | "skipped"; reason?: string; candidate?: TopicCandidate; jobId?: string; }

export class AutoGenerationService {
  constructor(private readonly jobs: JobRepository<Job, CreateJobInput>, private readonly registry: CandidateRegistry, private readonly discovery: TopicDiscoveryService, private readonly content: ContentService, private readonly resources: ResourceGuard, private readonly config: AutoGenerationConfig) {}
  async status() { const [state, candidates, jobs] = await Promise.all([this.registry.state(), this.registry.list(), this.jobs.all()]); const today = new Date().toISOString().slice(0, 10); const hour = new Date().toISOString().slice(0, 13); return { state, queue: priorityCounts(jobs), today: { generated: candidates.filter((item) => item.status === "generated" && item.lastAttemptAt?.startsWith(today)).length, failed: candidates.filter((item) => ["failed", "cooldown"].includes(item.status) && item.lastAttemptAt?.startsWith(today)).length, duplicates: candidates.filter((item) => item.status === "duplicate" && item.discoveredAt.startsWith(today)).length, rejected: candidates.filter((item) => item.status === "rejected" && item.discoveredAt.startsWith(today)).length }, hourAttempts: candidates.filter((item) => item.lastAttemptAt?.startsWith(hour)).length }; }
  pause() { return this.registry.setPaused(true); }
  resume() { return this.registry.setPaused(false); }
  candidates(status?: Parameters<CandidateRegistry["list"]>[0]) { return this.registry.list(status); }
  async retry(id: string): Promise<TopicCandidate> { const candidate = await this.registry.get(id); if (!candidate) throw new Error(`Candidate not found: ${id}`); return this.registry.update(id, { status: "accepted", cooldownUntil: undefined, rejectionReason: undefined }); }
  async runOnce(dryRun = false): Promise<AutoRunResult> {
    const admission = await this.admit(); if (admission) return { status: "skipped", reason: admission };
    let candidates = await this.discovery.fromExisting();
    let candidate = candidates.find((item) => item.status === "accepted");
    if (!candidate) {
      const newsFirst = Math.random() < 0.5;
      try { candidate = newsFirst ? await this.discovery.fromNews(EBS_NEWS_CATEGORIES) : await this.discovery.fromWikipedia(this.config.languages); } catch { candidate = undefined; }
      if (!candidate) try { candidate = newsFirst ? await this.discovery.fromWikipedia(this.config.languages) : await this.discovery.fromNews(EBS_NEWS_CATEGORIES); } catch { candidate = undefined; }
    }
    if (!candidate) return { status: "skipped", reason: "no_acceptable_candidate" };
    if (dryRun) return { status: "dry_run", candidate };
    await this.registry.update(candidate.id, { status: "accepted", attemptCount: candidate.attemptCount + 1, lastAttemptAt: new Date().toISOString() });
    try {
      const articleTitle = autonomousQuestionTitle(candidate.preferredTitle);
      const article = await this.content.create({ title: articleTitle, aliases: [candidate.preferredTitle, ...candidate.aliases], category: candidate.proposedCategory, prompt: this.prompt(candidate, articleTitle), context: { actor: "auto-generation-scheduler", origin: "autonomous", summary: `candidate=${candidate.id}` }, autonomous: { origin: "autonomous", topicSource: candidate.sourceType, seedReference: candidate.sourceReference, candidateId: candidate.id, discoveredAt: candidate.discoveredAt } });
      const updated = await this.registry.update(candidate.id, { status: "queued", articleId: article.id, jobId: article.lastJobId });
      return { status: "queued", candidate: updated, jobId: article.lastJobId };
    } catch (error) { await this.registry.recordFailure(candidate.id, this.config.cooldownMinutes); throw error; }
  }
  async markGenerated(candidateId: string, articleId: string): Promise<void> { await this.registry.update(candidateId, { status: "generated", articleId, lastAttemptAt: new Date().toISOString(), cooldownUntil: undefined }); }
  private async admit(): Promise<string | undefined> {
    const state = await this.registry.state(); if (!state.enabled) return "disabled"; if (state.manualPaused) return "manual_pause";
    const jobs = await this.jobs.all(); const activeHigher = jobs.some((job) => ["queued", "running", "waiting_publish", "publishing"].includes(job.status) && (job.priority ?? "P1") !== "P4"); if (activeHigher) return "queue_busy";
    if ((await this.jobs.state()).queuePaused) return "queue_paused";
    const guard = await this.resources.canStart(); if (!guard.ok) return guard.reason ?? "resource_high";
    const candidates = await this.registry.list(); const now = new Date(); const successful = candidates.filter((item) => item.status === "generated" && item.lastAttemptAt); if (successful.filter((item) => item.lastAttemptAt!.slice(0, 13) === now.toISOString().slice(0, 13)).length >= this.config.maxPerHour) return "hourly_cap"; if (successful.filter((item) => item.lastAttemptAt!.slice(0, 10) === now.toISOString().slice(0, 10)).length >= this.config.maxPerDay) return "daily_cap";
    const recent = candidates.filter((item) => item.lastAttemptAt).sort((a, b) => b.lastAttemptAt!.localeCompare(a.lastAttemptAt!)).slice(0, this.config.circuitWindow); if (recent.filter((item) => ["failed", "cooldown"].includes(item.status)).length >= this.config.circuitMaxFailures) return "high_failure_rate";
    return undefined;
  }
  private prompt(candidate: TopicCandidate, articleTitle: string): string { return [`Create a new Evidence Based Slopedia article with this title: ${articleTitle}`, `Research question: ${candidate.researchQuestion ?? `What is known about ${candidate.preferredTitle}, and what are its limitations?`}`, `The source title is only a seed: ${candidate.preferredTitle}`, "Do not reuse the seed/source title verbatim as the article title. The title must be a related question or explanatory inquiry.", `Private candidate ID: ${candidate.id}`, `Topic source: ${candidate.sourceType}`, `Seed reference: ${candidate.sourceReference ?? "none"}`, "Use the normal EBE evidence-first workflow and every existing publish/quality gate.", "The seed is for topic discovery only. Independently discover and appraise authoritative evidence; do not transform or rely solely on the seed source."].join("\n"); }
}

function autonomousQuestionTitle(seedTitle: string): string {
  const title = seedTitle.normalize("NFKC").trim().replace(/[？?]+$/u, "");
  return `${title}とは何か？背景・仕組み・影響と限界を検証する`;
}

function priorityCounts(jobs: Job[]) { const counts = { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 }; for (const job of jobs.filter((item) => item.status === "queued")) counts[job.priority ?? "P1"] += 1; return counts; }
export function schedulerTickId(scheduledAt: string): string { return `tick-${createHash("sha256").update(scheduledAt.slice(0, 16)).digest("hex").slice(0, 16)}`; }
