import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
loadDotEnv(path.resolve(process.cwd(), ".env"));

function loadDotEnv(file: string) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
import { JsonJobRepository } from "../../core/src/infrastructure/jsonJobRepository.js";
import { JobNotFoundError, JobService } from "../../core/src/services/jobService.js";
import type { CreateJobInput, Job } from "../../core/src/domain/job.js";
import { FilesystemArticleRepository } from "../../core/src/infrastructure/filesystemArticleRepository.js";
import { ContentService } from "../../core/src/services/contentService.js";
import type { ArticleGenerator } from "../../core/src/ports/articleGenerator.js";
import { IndexService } from "../../core/src/services/indexService.js";
import { BuildService } from "../../core/src/services/buildService.js";
import { DoctorService } from "../../core/src/services/doctorService.js";
import { ReconciliationService } from "../../core/src/services/reconciliationService.js";
import { CandidateRegistry } from "../../core/src/services/candidateRegistry.js";
import { HttpWikipediaClient, TopicDiscoveryService } from "../../core/src/services/topicDiscoveryService.js";
import { AutoGenerationService } from "../../core/src/services/autoGenerationService.js";
import { SchedulerService } from "../../core/src/services/schedulerService.js";
import { FilesystemMutationLock } from "../../core/src/infrastructure/filesystemMutationLock.js";
import { ImageService } from "../../core/src/services/imageService.js";
import { BackupService } from "../../core/src/services/backupService.js";
import { DeployService, GitHubPagesDeploymentTarget } from "../../core/src/services/deployService.js";
import { contentPaths } from "../../core/src/infrastructure/contentPaths.js";

export const ExitCode = { success: 0, failure: 1, invalidArguments: 2, notFound: 3 } as const;

export async function runCli(argv: string[], output = console): Promise<number> {
  const json = argv.includes("--json");
  const args = argv.filter((arg) => arg !== "--json");
  const vaultRoot = await findVaultRoot(path.resolve(process.env.EBS_VAULT_ROOT ?? process.cwd()));
  const contentRootValue = process.env.EBS_CONTENT_ROOT;
  if (!contentRootValue?.trim()) throw new Error("EBS_CONTENT_ROOT is required for content commands.");
  const contentRoot = contentPaths(contentRootValue).root;
  const dataDir = path.resolve(process.env.EBE_BOT_DATA_DIR ?? path.join(vaultRoot, "automation", "discord_bot", "data"));
  const service = new JobService<Job, CreateJobInput>(new JsonJobRepository(path.join(dataDir, "jobs.json")));
  const articleRepository = new FilesystemArticleRepository(contentRoot);
  const generator: ArticleGenerator = {
    async generate(request) {
      const autonomous = request.article.autonomous?.origin === "autonomous";
      const job = await service.enqueue({ query: request.prompt ?? `${request.operation} EBS article ${request.article.id} at ${request.article.sourcePath}`, mode: request.operation === "create" ? "new" : "update", jobType: "article", article: { articleId: request.article.id, operation: request.operation, sourcePath: request.article.sourcePath, operationId: request.operationId }, discordUserId: autonomous ? "auto-generation-scheduler" : "ebs-cli", channelId: "cli", guildId: null, model: process.env.CODEX_DEFAULT_MODEL ?? "gpt-5.5", reasoningEffort: process.env.CODEX_DEFAULT_REASONING_EFFORT ?? "low", priority: autonomous ? "P4" : "P1", idempotencyKey: autonomous ? `auto:${request.article.title.normalize("NFKC").toLocaleLowerCase("ja")}` : undefined });
      return { jobId: job.id, sourcePath: request.article.sourcePath, summary: `${request.operation} queued`, pending: true };
    },
  };
  const content = new ContentService(contentRoot, articleRepository, generator);
  const indexes = new IndexService(contentRoot, articleRepository); const builds = new BuildService(contentRoot, articleRepository, indexes); const reconciliation = new ReconciliationService(contentRoot, articleRepository, new JsonJobRepository(path.join(dataDir, "jobs.json"))); const doctor = new DoctorService(contentRoot, articleRepository, new JsonJobRepository(path.join(dataDir, "jobs.json")));
  const registry = new CandidateRegistry(path.join(contentRoot, "canonical", "autonomous", "registry.json"));
  const discovery = new TopicDiscoveryService(articleRepository, registry, new HttpWikipediaClient());
  const auto = new AutoGenerationService(new JsonJobRepository(path.join(dataDir, "jobs.json")), registry, discovery, content, { canStart: async () => ({ ok: true }), snapshot: async () => ({ ok: true, enabled: true, memoryPercent: 0, cpuPercent: 0 }) }, { maxPerHour: Number(process.env.EBS_AUTO_MAX_PER_HOUR ?? 6), maxPerDay: Number(process.env.EBS_AUTO_MAX_PER_DAY ?? 50), cooldownMinutes: [60, 360, 1440, 10080], circuitWindow: 10, circuitMaxFailures: 5, circuitCooldownMinutes: 60, languages: ["ja", "en"] });
  const scheduler = new SchedulerService(auto, registry, new FilesystemMutationLock(contentRoot), { minIntervalMinutes: 5, maxIntervalMinutes: 10 });
  const images = new ImageService(contentRoot, articleRepository);
const deployDirectory = process.env.EBS_GITHUB_PAGES_DIR; const runtimeRoot = path.resolve(process.env.EBE_BOT_RUNTIME_DIR ?? path.join(process.cwd(), "..", "..", "..", "discord_bot-runtime")); const deploy = new DeployService(contentRoot, deployDirectory ? new GitHubPagesDeploymentTarget(path.resolve(deployDirectory)) : undefined, runtimeRoot); const backup = new BackupService(vaultRoot);
  const context = { actor: process.env.USERNAME ?? process.env.USER ?? "cli-user", origin: "cli" };
  try {
    if (args[0] === "auto") {
      if (args[1] === "status") return print(output, json, await auto.status());
      if (args[1] === "pause") return print(output, json, await auto.pause());
      if (args[1] === "resume") return print(output, json, await auto.resume());
      if (args[1] === "run-once") return print(output, json, await scheduler.tick(args.includes("--dry-run")));
      if (args[1] === "candidates") return print(output, json, await auto.candidates(option(args, "--status") as Parameters<typeof auto.candidates>[0]));
      if (args[1] === "retry") { if (!args[2]) return invalid(output, json, "candidate id is required"); return print(output, json, await auto.retry(args[2])); }
      return invalid(output, json, "usage: ebs auto status|pause|resume|run-once|candidates|retry");
    }
    if (args[0] === "image" && args[1] === "migrate") {
      const apply = args.includes("--apply"); const result = await images.migrate(!apply); const reportPath = path.join(vaultRoot, "_working", "migration_reports", "image-migration.md"); const fs = await import("node:fs/promises"); await fs.mkdir(path.dirname(reportPath), { recursive: true }); await fs.writeFile(reportPath, `# Image Migration\n\nMode: ${apply ? "apply" : "dry-run"}\n\n${result.map((item) => `- ${item.articleId}: ${item.status} — ${item.message}`).join("\n")}\n`, "utf8"); return print(output, json, { dryRun: !apply, reportPath, results: result });
    }
    if (args[0] === "deploy") {
      if (args[1] === "status") return print(output, json, await deploy.status());
      if (args[1] === "rollback") { if (!args[2]) return invalid(output, json, "deployment revision is required"); return print(output, json, await deploy.rollback(args[2])); }
      return print(output, json, await deploy.deploy(args.includes("--dry-run")));
    }
    if (args[0] === "backup") {
      if (args[1] === "create") return print(output, json, await backup.create());
      if (args[1] === "list") return print(output, json, await backup.list());
      if (args[1] === "verify") { if (!args[2]) return invalid(output, json, "backup id is required"); return print(output, json, await backup.verify(args[2])); }
      if (args[1] === "restore") { if (!args[2]) return invalid(output, json, "backup id is required"); return print(output, json, { stagedAt: await backup.stageRestore(args[2]), applied: false, message: "Restore is staged for review; no canonical data was overwritten." }); }
      if (args[1] === "prune") return print(output, json, await backup.prune({ daily: Number(process.env.EBS_BACKUP_RETENTION_DAILY ?? 7), weekly: Number(process.env.EBS_BACKUP_RETENTION_WEEKLY ?? 4), monthly: Number(process.env.EBS_BACKUP_RETENTION_MONTHLY ?? 3) }));
      return invalid(output, json, "usage: ebs backup create|list|verify|restore <id>|prune");
    }
    if (args[0] === "runtime" && args[1] === "status") return print(output, json, { uptimeSeconds: Math.floor(process.uptime()), queue: await service.getQueueStatus(), auto: await auto.status(), deploy: await deploy.status() });
    if (args[0] === "scheduler" && args[1] === "tick") return print(output, json, await scheduler.tick(args.includes("--dry-run")));
    if (args[0] === "reconcile") return print(output, json, await reconciliation.reconcileAll(true));
    if (args[0] === "index" && args[1] === "rebuild") {
      const selected = ["--search", "--category", "--moc", "--related", "--backlinks", "--sitemap", "--all"].filter((flag) => args.includes(flag)); if (selected.length !== 1) return invalid(output, json, "select exactly one index rebuild flag");
      const result = selected[0] === "--search" ? await indexes.rebuildSearch() : selected[0] === "--category" ? await indexes.rebuildCategories() : selected[0] === "--moc" ? await indexes.rebuildMoc() : selected[0] === "--related" ? await indexes.rebuildRelated() : selected[0] === "--backlinks" ? await indexes.rebuildBacklinks() : selected[0] === "--sitemap" ? await indexes.rebuildSitemap() : await indexes.rebuildAll(); return print(output, json, result);
    }
    if (args[0] === "build") { const target = option(args, "--article"); const id = target ? (await content.show(target)).id : undefined; return print(output, json, await builds.build(id)); }
    if (args[0] === "doctor") return print(output, json, { contentRoot, result: await doctor.run(args.includes("--fix")) });
    if (args[0] === "rebuild") { const reconciled = await reconciliation.reconcileAll(true); const indexManifest = await indexes.rebuildAll(); const build = await builds.build(); return print(output, json, { contentRoot, reconciled, indexManifest, build }); }
    if (args[0] === "article") {
      const command = args[1]; const target = args[2];
      if (command === "list") return print(output, json, await content.list());
      if (command === "show") { if (!target) return invalid(output, json, "article target is required"); return print(output, json, await content.show(target)); }
      if (command === "create") {
        const title = option(args, "--title"); if (!title) return invalid(output, json, "--title is required");
        return print(output, json, await content.create({ title, slug: option(args, "--slug"), category: option(args, "--category"), subfield: option(args, "--subfield"), aliases: csv(option(args, "--aliases")), sourcePath: option(args, "--source-path"), prompt: option(args, "--prompt"), context }));
      }
      if (!target) return invalid(output, json, "article target is required");
      if (command === "edit") return print(output, json, await content.edit(target, { title: option(args, "--title"), slug: option(args, "--slug"), category: option(args, "--category"), subfield: option(args, "--subfield"), aliases: option(args, "--aliases") ? csv(option(args, "--aliases")) : undefined, replaceFile: option(args, "--replace-file"), context }));
      if (command === "regenerate") return print(output, json, await content.regenerate(target, context, option(args, "--prompt")));
      if (command === "research-update") return print(output, json, await content.researchUpdate(target, context, option(args, "--prompt")));
      if (command === "publish") return print(output, json, await content.publish(target, context));
      if (command === "unpublish") return print(output, json, await content.unpublish(target, context));
      if (command === "archive") return print(output, json, await content.archive(target, context, option(args, "--reason")));
      if (command === "delete") { if (!args.includes("--yes")) return invalid(output, json, "delete requires --yes"); return print(output, json, await content.delete(target, context, option(args, "--reason"))); }
      if (command === "restore") return print(output, json, await content.restore(target, context));
      if (command === "rename") { const slug = option(args, "--slug"); if (slug && !args.includes("--yes")) return invalid(output, json, "slug rename requires --yes"); return print(output, json, await content.rename(target, { title: option(args, "--title"), slug, context })); }
      if (command === "history") return print(output, json, await content.history(target));
      if (command === "rollback") { if (!args.includes("--yes")) return invalid(output, json, "rollback requires --yes"); const revision = Number(option(args, "--revision")); if (!Number.isInteger(revision) || revision < 1) return invalid(output, json, "valid --revision is required"); return print(output, json, await content.rollback(target, revision, context)); }
      return invalid(output, json, "unknown article command");
    }
    if (args[0] === "status") {
      return print(output, json, await service.getQueueStatus());
    }
    if (args[0] === "job" && args[1] === "list") {
      return print(output, json, await service.list());
    }
    if (args[0] === "job" && ["status", "logs", "failures"].includes(args[1] ?? "")) {
      const id = args[2]; if (!id) return invalid(output, json, "job id is required"); const job = await service.status(id);
      if (args[1] === "status") return print(output, json, { contentRoot, job });
      const logDir = path.resolve(process.env.EBE_BOT_LOG_DIR ?? path.join(vaultRoot, "automation", "discord_bot", "logs")); const fs = await import("node:fs/promises"); const files = (await fs.readdir(logDir).catch(() => [])).filter((file) => file.includes(id)); const text = (await Promise.all(files.map((file) => fs.readFile(path.join(logDir, file), "utf8")))).join("");
      return print(output, json, args[1] === "failures" ? text.split(/\r?\n/).filter((line) => /phase.failed|FAILED|error/i.test(line)) : text);
    }
    if (args[0] === "job" && ["status", "retry", "cancel"].includes(args[1] ?? "")) {
      const id = args[2];
      if (!id) return invalid(output, json, "job id is required");
      const result = args[1] === "status" ? await service.status(id) : args[1] === "retry" ? await service.retry(id) : await service.cancel(id);
      return print(output, json, result);
    }
    if (args[0] === "queue" && ["pause", "resume"].includes(args[1] ?? "")) {
      return print(output, json, args[1] === "pause" ? await service.pauseQueue() : await service.resumeQueue());
    }
    return invalid(output, json, "usage: ebs article <command> | ebs auto <command> | ebs image migrate [--apply] | ebs deploy [--dry-run]|status|rollback | ebs backup <command> | ebs runtime status | ebs scheduler tick | ebs reconcile | ebs index rebuild <flag> | ebs build | ebs doctor | ebs rebuild | ebs status | ebs job <command> | ebs queue <command> [--json]");
  } catch (error) {
    if (error instanceof JobNotFoundError || (error instanceof Error && (error.message.startsWith("Job not found:") || error.message.startsWith("Article not found:")))) {
      output.error(json ? JSON.stringify({ error: { code: "not_found", message: error.message } }) : error.message); return ExitCode.notFound;
    }
    const message = error instanceof Error ? error.message : String(error); output.error(json ? JSON.stringify({ error: { code: "operation_failed", message } }) : message); return ExitCode.failure;
  }
}

function print(output: Pick<Console, "log">, json: boolean, value: unknown): number {
  output.log(json ? JSON.stringify(value, null, 2) : formatHuman(value)); return ExitCode.success;
}
function invalid(output: Pick<Console, "error">, json: boolean, message: string): number { output.error(json ? JSON.stringify({ error: { code: "invalid_arguments", message } }) : message); return ExitCode.invalidArguments; }
function formatHuman(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.map((entry: Job | Record<string, unknown>) => {
    if ("revision" in entry) return `r${entry.revision} ${entry.operation} ${entry.timestamp} ${entry.actor}`;
    if ("title" in entry && "slug" in entry) return `${entry.id} ${entry.status} ${entry.slug} ${entry.title}`;
    return `${entry.id} ${entry.status} ${entry.jobType ?? "article"} ${entry.createdAt}`;
  }).join("\n") : "No results.";
  if (value && typeof value === "object") return Object.entries(value).map(([key, entry]) => `${key}: ${typeof entry === "object" ? JSON.stringify(entry) : String(entry)}`).join("\n");
  return String(value);
}

function option(args: string[], name: string): string | undefined { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
function csv(value: string | undefined): string[] { return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : []; }
async function findVaultRoot(start: string): Promise<string> { const fs = await import("node:fs/promises"); let current = start; while (true) { try { await fs.access(path.join(current, "AGENTS.md")); await fs.access(path.join(current, "10_Published")); return current; } catch { /* continue */ } const parent = path.dirname(current); if (parent === current) throw new Error("Could not locate EBS Vault root. Set EBS_VAULT_ROOT."); current = parent; } }

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
