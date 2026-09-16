import dotenv from "dotenv";
import path from "node:path";

const botRoot = process.cwd();
dotenv.config({ path: path.join(botRoot, ".env") });

function env(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function intEnv(name: string, fallback: number): number {
  const raw = env(name, String(fallback));
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid integer environment variable ${name}: ${raw}`);
  }
  return parsed;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = env(name, String(fallback));
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function listEnv(name: string, fallback?: string): string[] {
  return env(name, fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveBotPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(botRoot, value);
}

const guildIds = listEnv("DISCORD_GUILD_IDS", env("DISCORD_GUILD_ID", ""));
if (guildIds.length === 0) {
  throw new Error("Missing required environment variable: DISCORD_GUILD_IDS or DISCORD_GUILD_ID");
}

export const config = {
  botRoot,
  discord: {
    token: env("DISCORD_TOKEN"),
    clientId: env("DISCORD_CLIENT_ID"),
    guildId: guildIds[0],
    guildIds,
    adminUserIds: new Set(
      env("DISCORD_ADMIN_USER_IDS")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  },
  paths: {
    vaultRoot: path.resolve(env("EBE_VAULT_ROOT")),
    contentRoot: path.resolve(env("EBS_CONTENT_ROOT", path.join("..", "..", "..", "discord_bot-runtime", "content"))),
    worktreeRoot: path.resolve(env("EBE_WORKTREE_ROOT")),
    // Keep mutable bot state outside the Vault checkout. A bot process must
    // never create untracked files beside the worker-published content.
    runtimeDir: resolveBotPath(env("EBE_BOT_RUNTIME_DIR", path.join("..", "..", "..", "discord_bot-runtime"))),
    dataDir: resolveBotPath(env("EBE_BOT_DATA_DIR", path.join("..", "..", "..", "discord_bot-runtime", "data"))),
    logDir: resolveBotPath(env("EBE_BOT_LOG_DIR", path.join("..", "..", "..", "discord_bot-runtime", "logs"))),
    managementEventsFile: resolveBotPath(env("EBE_BOT_MANAGEMENT_EVENTS_FILE", path.join("..", "..", "..", "discord_bot-runtime", "management-events.jsonl"))),
  },
  workers: {
    maxWorkers: Math.max(1, intEnv("EBE_MAX_WORKERS", 1)),
    maxPublishers: Math.max(1, intEnv("EBE_MAX_PUBLISHERS", 1)),
    keepFailedWorktrees: boolEnv("EBE_KEEP_FAILED_WORKTREES", true),
    keepSuccessfulWorktrees: boolEnv("EBE_KEEP_SUCCESSFUL_WORKTREES", false),
  },
  codex: {
    model: env("CODEX_DEFAULT_MODEL", "gpt-5.5"),
    reasoningEffort: env("CODEX_DEFAULT_REASONING_EFFORT", "low"),
    commandTemplate: env(
      "CODEX_COMMAND_TEMPLATE",
      "codex exec --model {model} -c model_reasoning_effort={effort} --cd {cwd} --dangerously-bypass-approvals-and-sandbox -",
    ),
  },
  git: {
    remote: env("GIT_REMOTE", "origin"),
    branch: env("GIT_BRANCH", "main"),
    commitMessage: env("GIT_COMMIT_MESSAGE", "article update"),
    userName: env("GIT_BOT_USER_NAME", "ebe-discord-bot"),
    userEmail: env("GIT_BOT_USER_EMAIL", "ebe-discord-bot@example.invalid"),
  },
  resourceGuard: {
    enabled: boolEnv("EBE_RESOURCE_GUARD_ENABLED", true),
    maxMemoryPercent: intEnv("EBE_MAX_MEMORY_PERCENT", 85),
    maxCpuPercent: intEnv("EBE_MAX_CPU_PERCENT", 95),
  },
  dailyNews: {
    enabled: boolEnv("EBE_DAILY_NEWS_ENABLED", true),
    channelId: env("DISCORD_DAILY_NEWS_CHANNEL_ID", ""),
    hourJst: intEnv("EBE_DAILY_NEWS_HOUR_JST", 6),
    minuteJst: intEnv("EBE_DAILY_NEWS_MINUTE_JST", 0),
  },
  backup: {
    enabled: boolEnv("EBS_BACKUP_ENABLED", true),
    hourJst: intEnv("EBS_BACKUP_HOUR_JST", 3),
    minuteJst: intEnv("EBS_BACKUP_MINUTE_JST", 30),
    retention: { daily: intEnv("EBS_BACKUP_RETENTION_DAILY", 7), weekly: intEnv("EBS_BACKUP_RETENTION_WEEKLY", 4), monthly: intEnv("EBS_BACKUP_RETENTION_MONTHLY", 3) },
  },
  autoDeploy: {
    enabled: boolEnv("EBS_AUTO_DEPLOY_ENABLED", false),
    publicUrl: process.env.EBS_PAGES_PUBLIC_URL?.trim() || undefined,
  },
  autoGeneration: {
    enabled: boolEnv("EBS_AUTO_ENABLED", true), minIntervalMinutes: intEnv("EBS_AUTO_MIN_INTERVAL_MINUTES", 5), maxIntervalMinutes: intEnv("EBS_AUTO_MAX_INTERVAL_MINUTES", 10), maxPerHour: intEnv("EBS_AUTO_MAX_PER_HOUR", 6), maxPerDay: intEnv("EBS_AUTO_MAX_PER_DAY", 50),
  },
};
