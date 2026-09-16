import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { phase3Fixture } from "./phase3Fixture.js";
import { JsonJobRepository } from "../../ebs/core/src/infrastructure/jsonJobRepository.js";
import { CandidateRegistry } from "../../ebs/core/src/services/candidateRegistry.js";
import { TopicDiscoveryService, TopicNormalizer, type WikipediaClient } from "../../ebs/core/src/services/topicDiscoveryService.js";
import { ContentService } from "../../ebs/core/src/services/contentService.js";
import { AutoGenerationService } from "../../ebs/core/src/services/autoGenerationService.js";
import { SchedulerService } from "../../ebs/core/src/services/schedulerService.js";
import { FilesystemMutationLock } from "../../ebs/core/src/infrastructure/filesystemMutationLock.js";
import type { CreateJobInput, Job } from "../../ebs/core/src/domain/job.js";

const input = (query: string, priority?: CreateJobInput["priority"]): CreateJobInput => ({ query, priority, mode: "new", discordUserId: "actor", channelId: "channel", guildId: null, model: "test", reasoningEffort: "low" });

test("priority queue runs P1 and P3 before P4 and preserves FIFO", async () => {
  const fixture = await phase3Fixture(); const jobs = new JsonJobRepository(path.join(fixture.root, "jobs.json"));
  await jobs.create(input("auto-a", "P4")); await jobs.create(input("human-a", "P1")); await jobs.create(input("news", "P3")); await jobs.create(input("human-b", "P1"));
  assert.equal((await jobs.nextQueued())?.query, "human-a"); assert.equal((await jobs.nextQueued())?.query, "human-b"); assert.equal((await jobs.nextQueued())?.query, "news"); assert.equal((await jobs.nextQueued())?.query, "auto-a");
});

test("legacy priority defaults to P1 and idempotency prevents duplicate jobs", async () => {
  const fixture = await phase3Fixture(); const jobs = new JsonJobRepository(path.join(fixture.root, "jobs.json"));
  const first = await jobs.create({ ...input("legacy"), idempotencyKey: "same" }); const second = await jobs.create({ ...input("duplicate"), idempotencyKey: "same" });
  assert.equal(first.id, second.id); assert.equal((await jobs.nextQueued())?.priority, "P1");
});

test("normalization and deterministic article/candidate dedup are auditable", async () => {
  const fixture = await phase3Fixture(); const article = await fixture.seed("art_gpu", "p値", "science/p-value", "published"); article.aliases = ["P value"]; await fixture.repository.save(article);
  const registry = new CandidateRegistry(path.join(fixture.root, "registry.json")); const discovery = new TopicDiscoveryService(fixture.repository, registry);
  assert.equal(new TopicNormalizer().normalize("初心者向けにp値を詳しく説明").preferredTitle, "p値");
  assert.equal((await discovery.evaluate("p値", "existing_article")).status, "duplicate");
  const first = await discovery.evaluate("ベイズ因子", "existing_article"); const second = await discovery.evaluate("ベイズ因子", "wikipedia_random"); assert.equal(first.id, second.id);
});

test("Wikipedia unsuitable pages reject while network/source failure can fall back", async () => {
  const fixture = await phase3Fixture(); await fixture.seed("art_seed", "GPU", "technology/gpu", "published");
  const unsuitable: WikipediaClient = { random: async () => ({ title: "2020年", url: "https://example.test/2020", summary: "x".repeat(100) }) };
  const registry = new CandidateRegistry(path.join(fixture.root, "registry.json")); assert.equal((await new TopicDiscoveryService(fixture.repository, registry, unsuitable).fromWikipedia()).status, "rejected");
  const failed: WikipediaClient = { random: async () => { throw new Error("offline"); } }; const discovery = new TopicDiscoveryService(fixture.repository, registry, failed); assert.ok((await discovery.fromExisting()).some((item) => item.status === "accepted"));
});

test("scheduler is single-owner and duplicate ticks enqueue no work in dry-run", async () => {
  const fixture = await phase3Fixture(); await fixture.seed("art_seed", "GPU", "technology/gpu", "published");
  const jobs = new JsonJobRepository(path.join(fixture.root, "jobs.json")); const registry = new CandidateRegistry(path.join(fixture.root, "registry.json")); const content = new ContentService(fixture.root, fixture.repository); const discovery = new TopicDiscoveryService(fixture.repository, registry);
  const auto = new AutoGenerationService(jobs, registry, discovery, content, guard(true), config()); const scheduled = "2026-09-02T00:00:00.000Z";
  const a = new SchedulerService(auto, registry, new FilesystemMutationLock(fixture.root), { minIntervalMinutes: 5, maxIntervalMinutes: 10 }); const b = new SchedulerService(auto, registry, new FilesystemMutationLock(fixture.root), { minIntervalMinutes: 5, maxIntervalMinutes: 10 });
  const results = await Promise.all([a.tick(true, scheduled), b.tick(true, scheduled)]); assert.equal(results.filter((item) => item.status === "dry_run").length, 1); assert.equal(results.filter((item) => item.reason === "duplicate_tick").length, 1); assert.equal((await jobs.all()).length, 0);
});

test("busy, paused, and resource admission skip autonomous work without affecting human jobs", async () => {
  const fixture = await phase3Fixture(); await fixture.seed("art_seed", "GPU", "technology/gpu", "published"); const jobs = new JsonJobRepository(path.join(fixture.root, "jobs.json")); const registry = new CandidateRegistry(path.join(fixture.root, "registry.json")); const discovery = new TopicDiscoveryService(fixture.repository, registry); const content = new ContentService(fixture.root, fixture.repository);
  await jobs.create(input("human", "P1")); assert.equal((await new AutoGenerationService(jobs, registry, discovery, content, guard(true), config()).runOnce(true)).reason, "queue_busy"); assert.equal((await jobs.all())[0].status, "queued");
  await jobs.update((await jobs.all())[0].id, { status: "succeeded" }); await registry.setPaused(true); assert.equal((await new AutoGenerationService(jobs, registry, discovery, content, guard(true), config()).runOnce(true)).reason, "manual_pause"); await registry.setPaused(false); assert.equal((await new AutoGenerationService(jobs, registry, discovery, content, guard(false), config()).runOnce(true)).reason, "cpu_high");
});

test("accepted candidate uses normal ContentService generator and failure cooldown increases", async () => {
  const fixture = await phase3Fixture(); await fixture.seed("art_seed", "GPU", "technology/gpu", "published"); const jobs = new JsonJobRepository(path.join(fixture.root, "jobs.json")); const registry = new CandidateRegistry(path.join(fixture.root, "registry.json")); const discovery = new TopicDiscoveryService(fixture.repository, registry);
  const content = new ContentService(fixture.root, fixture.repository, { generate: async (request) => { const job = await jobs.create({ ...input(request.article.title, "P4"), article: { articleId: request.article.id, operation: "create", sourcePath: request.article.sourcePath, operationId: request.operationId }, idempotencyKey: `auto:${request.article.title}` }); return { jobId: job.id, sourcePath: request.article.sourcePath, pending: true }; } });
  const result = await new AutoGenerationService(jobs, registry, discovery, content, guard(true), config()).runOnce(false); assert.equal(result.status, "queued"); assert.equal((await jobs.all())[0].priority, "P4"); assert.ok((await fixture.repository.getById(result.candidate!.articleId!))?.autonomous);
  const failed = await registry.add({ rawTopic: "failure", normalizedTopic: "failure", preferredTitle: "failure", aliases: [], sourceType: "maintenance" }); const one = await registry.recordFailure(failed.id, [60, 360]); const two = await registry.recordFailure(failed.id, [60, 360]); assert.ok(new Date(two.cooldownUntil!).getTime() > new Date(one.cooldownUntil!).getTime());
});

function guard(ok: boolean) { return { canStart: async () => ok ? ({ ok: true }) : ({ ok: false, reason: "cpu_high" }), snapshot: async () => ({ ok, enabled: true, memoryPercent: 0, cpuPercent: ok ? 0 : 99 }) }; }
function config() { return { maxPerHour: 6, maxPerDay: 50, cooldownMinutes: [60, 360, 1440], circuitWindow: 10, circuitMaxFailures: 5, circuitCooldownMinutes: 60, languages: ["ja", "en"] }; }
