import { config } from "./config.js";
import path from "node:path";
import { createDiscordClient } from "./discord/client.js";
import { JobStore } from "./queue/jobStore.js";
import { WorkerPool } from "./queue/workerPool.js";
import { enqueueDailyNewsJobs } from "./services/dailyNews.js";
import { Notifier } from "./services/notifier.js";
import { ensureDir } from "./utils/paths.js";
import { createEbsApplication } from "../../ebs/core/src/application.js";
import { FilesystemArticleRepository } from "../../ebs/core/src/infrastructure/filesystemArticleRepository.js";
import { ReconciliationService } from "../../ebs/core/src/services/reconciliationService.js";
import { CandidateRegistry } from "../../ebs/core/src/services/candidateRegistry.js";
import { GoogleNewsRssClient, HttpWikipediaClient, TopicDiscoveryService } from "../../ebs/core/src/services/topicDiscoveryService.js";
import { AutoGenerationService } from "../../ebs/core/src/services/autoGenerationService.js";
import { SchedulerService } from "../../ebs/core/src/services/schedulerService.js";
import { FilesystemMutationLock } from "../../ebs/core/src/infrastructure/filesystemMutationLock.js";
import { ContentService } from "../../ebs/core/src/services/contentService.js";
import { createResourceGuard } from "./services/resourceGuard.js";
import type { ArticleGenerator } from "../../ebs/core/src/ports/articleGenerator.js";
import { ScheduledTaskService } from "../../ebs/core/src/services/scheduledTaskService.js";
import { BackupService } from "../../ebs/core/src/services/backupService.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

await ensureDir(config.paths.dataDir);
await ensureDir(config.paths.logDir);
await ensureDir(config.paths.worktreeRoot);
const sourceCommit = await execFileAsync("git", ["-C", config.paths.vaultRoot, "rev-parse", "HEAD"]).then((result) => result.stdout.trim()).catch(() => "unknown");
console.info(JSON.stringify({ event: "startup", packageVersion: "0.1.0", sourceCommit, buildTimestamp: new Date().toISOString(), pid: process.pid, appRoot: config.paths.vaultRoot, contentRoot: config.paths.contentRoot, pagesRepo: process.env.EBS_GITHUB_PAGES_DIR, autoDeploy: config.autoDeploy.enabled }));

const store = new JobStore();
await store.init();
const { jobService } = createEbsApplication(store);
const articleRepository = new FilesystemArticleRepository(config.paths.contentRoot, { eventsFile: path.join(config.paths.runtimeDir, "content-management-events.jsonl") });
const autoGenerator: ArticleGenerator = { generate: async (request) => { const job = await jobService.enqueue({ query: request.prompt ?? `Create autonomous EBS article ${request.article.title}`, mode: "new", jobType: "article", article: { articleId: request.article.id, operation: "create", sourcePath: request.article.sourcePath, operationId: request.operationId }, discordUserId: "auto-generation-scheduler", channelId: config.dailyNews.channelId || "scheduler", guildId: config.discord.guildId, model: config.codex.model, reasoningEffort: config.codex.reasoningEffort, priority: "P4", idempotencyKey: `auto:${request.article.title.normalize("NFKC").toLocaleLowerCase("ja")}` }); return { jobId: job.id, sourcePath: request.article.sourcePath, pending: true }; } };
// Scheduler/control-plane state is runtime state. The vault registry is an
// artifact produced by article workers and must never be written by the bot
// process while the main checkout is being used for publication.
const candidateRegistry = new CandidateRegistry(path.join(config.paths.runtimeDir, "autonomous", "registry.json"));
const autoService = new AutoGenerationService(store, candidateRegistry, new TopicDiscoveryService(articleRepository, candidateRegistry, new HttpWikipediaClient(), undefined, undefined, undefined, new GoogleNewsRssClient()), new ContentService(config.paths.contentRoot, articleRepository, autoGenerator), createResourceGuard(), { maxPerHour: config.autoGeneration.maxPerHour, maxPerDay: config.autoGeneration.maxPerDay, cooldownMinutes: [60, 360, 1440, 10080], circuitWindow: 10, circuitMaxFailures: 5, circuitCooldownMinutes: 60, languages: ["ja", "en"] });
const scheduler = new SchedulerService(autoService, candidateRegistry, new FilesystemMutationLock(config.paths.contentRoot), { minIntervalMinutes: config.autoGeneration.minIntervalMinutes, maxIntervalMinutes: Math.max(config.autoGeneration.minIntervalMinutes, config.autoGeneration.maxIntervalMinutes) });
const backupService = new BackupService(config.paths.vaultRoot);
const recovered = await store.recoverInterruptedJobs();
if (recovered.length > 0) {
  const publishRetries = recovered.filter((job) => job.status === "publish_retry_pending").length;
  console.warn(`Recovered ${recovered.length} interrupted jobs; queued ${publishRetries} publish-only retries.`);
}
// Startup inspection must not repair the main checkout. Repairs belong to the
// worker branch that owns the job, otherwise recovery itself makes main dirty.
const reconciliation = await new ReconciliationService(config.paths.contentRoot, articleRepository, store).reconcileAll(false);
if (reconciliation.reviewRequired > 0) console.warn(`EBS reconciliation requires review for ${reconciliation.reviewRequired} finding(s).`);

let workerPool: WorkerPool;
const client = createDiscordClient(store, jobService, () => workerPool, { auto: autoService, scheduler });
const notifier = new Notifier(client);
workerPool = new WorkerPool(store, notifier);

await client.login(config.discord.token);
workerPool.start();
if (config.autoGeneration.enabled) scheduler.start();
const scheduledTasks = new ScheduledTaskService([
  ...(config.dailyNews.enabled && config.dailyNews.channelId ? [{ id: "daily-news", hour: config.dailyNews.hourJst, minute: config.dailyNews.minuteJst, run: async (date: string) => { const result = await enqueueDailyNewsJobs(store, { channelId: config.dailyNews.channelId, guildId: config.discord.guildId, discordUserId: "daily-news-scheduler", date }); await notifier.send(config.dailyNews.channelId, `daily news queued: ${date} jobs=${result.jobs.length}`); } }] : []),
  ...(config.backup.enabled ? [{ id: "daily-backup", hour: config.backup.hourJst, minute: config.backup.minuteJst, run: async () => { const manifest = await backupService.create(); const pruned = await backupService.prune(config.backup.retention); console.info(`daily backup completed: ${manifest.id}; pruned=${pruned.removed.length}`); } }] : []),
]);
scheduledTasks.start();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown(): Promise<void> {
  workerPool.stop();
  scheduler.stop();
  scheduledTasks.stop();
  client.destroy();
  process.exit(0);
}
