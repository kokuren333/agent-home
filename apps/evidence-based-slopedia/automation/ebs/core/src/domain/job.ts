export type JobId = string;

export type JobStatus =
  | "queued"
  | "running"
  | "waiting_publish"
  | "publishing"
  | "publish_retry_pending"
  | "succeeded"
  | "failed"
  | "failed_review_required"
  | "cancelled";

export type JobType =
  | "article"
  | "daily_news"
  | "daily_forecast"
  | "moc_maintenance"
  | "image_maintenance"
  | "codex";

export type JobPriority = "P0" | "P1" | "P2" | "P3" | "P4";
export type JobOrigin = "discord" | "cli" | "scheduler" | "system";
export type ArticleMode = "new" | "update";
export type JobPhase = "queued" | "generating" | "generated" | "ready_to_publish" | "validating" | "promoting" | "doctor" | "rebuilding" | "building" | "deploying" | "pushed" | "verifying" | "published" | "succeeded" | "failed" | "cancelled";

export interface JobActor {
  id: string;
  displayName?: string;
}

export interface DailyNewsMeta { date: string; yearMonth: string; fieldNumber: number; fieldName: string; fieldSlug: string; directoryName: string; targetPath: string; }
export interface DailyForecastMeta { date: string; year: string; month: string; forecastType: string; slug: string; fileName: string; targetPath: string; }
export interface MocMaintenanceMeta { scope: "all" | "published" | "daily"; }
export interface ImageMaintenanceMeta { scope: "all" | "published" | "daily"; }
export interface ArticleJobMeta { articleId: string; operation: "create" | "regenerate" | "research_update"; sourcePath: string; operationId?: string; title?: string; slug?: string; contentHash?: string; revision?: number; }
export interface WorkerResult { jobId: string; articleId: string; sourcePath: string; slug: string; }

export interface CoreJob {
  id: JobId;
  status: JobStatus;
  jobType?: JobType;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancelRequested?: boolean;
  priority?: JobPriority;
  scheduledAt?: string;
  idempotencyKey?: string;
  errorMessage?: string;
  currentPhase?: JobPhase;
  lastSuccessfulPhase?: JobPhase;
  phaseStartedAt?: string;
  phaseCompletedAt?: string;
  failedAt?: string;
  errorCode?: string;
  errorDetails?: string;
  retryable?: boolean;
  contentRoot?: string;
  publicUrl?: string;
  cleanupResult?: Record<string, unknown>;
  canonicalized?: boolean;
  publishRetryOnly?: boolean;
}

export interface Job extends CoreJob {
  query: string;
  mode: ArticleMode;
  discordUserId: string;
  channelId: string;
  guildId: string | null;
  worktreePath?: string;
  branchName?: string;
  /** Commit at worktree creation; used to include committed and uncommitted worker diffs. */
  baseCommit?: string;
  commitSha?: string;
  pushedCommitSha?: string;
  pagesCommitSha?: string;
  pagesUrl?: string;
  resultSummary?: string;
  model: string;
  reasoningEffort: string;
  daily?: DailyNewsMeta;
  forecast?: DailyForecastMeta;
  mocMaintenance?: MocMaintenanceMeta;
  imageMaintenance?: ImageMaintenanceMeta;
  article?: ArticleJobMeta;
}

export interface CreateJobInput {
  query: string; mode: ArticleMode; discordUserId: string; channelId: string; guildId: string | null; model: string; reasoningEffort: string;
  jobType?: JobType; daily?: DailyNewsMeta; forecast?: DailyForecastMeta; mocMaintenance?: MocMaintenanceMeta; imageMaintenance?: ImageMaintenanceMeta; article?: ArticleJobMeta;
  priority?: JobPriority; scheduledAt?: string; idempotencyKey?: string;
}

export const JOB_PRIORITY_ORDER: Record<JobPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
export function defaultJobPriority(job: Pick<CoreJob, "priority"> & { jobType?: JobType; discordUserId?: string }): JobPriority {
  if (job.priority) return job.priority;
  if (job.jobType === "daily_news" || job.jobType === "daily_forecast") return "P3";
  if (job.discordUserId === "auto-generation-scheduler") return "P4";
  return "P1";
}

export interface ShellResult { code: number; stdout: string; stderr: string; }
export interface BotState { queuePaused: boolean; updatedAt: string; }
