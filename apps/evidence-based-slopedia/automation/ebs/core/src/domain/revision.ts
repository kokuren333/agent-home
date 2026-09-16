import type { ArticleId, ArticleMetadata, ArticleStatus } from "./article.js";

export type ArticleOperation = "create" | "edit" | "regenerate" | "research_update" | "publish" | "unpublish" | "archive" | "delete" | "restore" | "rename" | "rollback" | "reconcile" | "repair";

export interface ArticleRevision {
  articleId: ArticleId;
  revision: number;
  timestamp: string;
  operation: ArticleOperation;
  operationId: string;
  actor: string;
  origin: string;
  jobId?: string;
  previousHash?: string;
  newHash?: string;
  gitSha?: string;
  summary: string;
  metadataSnapshot: ArticleMetadata;
  bodySnapshot?: string;
}

export interface ManagementEvent {
  timestamp: string;
  operationId: string;
  articleId: ArticleId;
  operation: ArticleOperation;
  phase: "started" | "queued" | "completed" | "failed";
  actor: string;
  origin: string;
  jobId?: string;
  gitSha?: string;
  revision?: number;
  error?: string;
  reason?: string;
  contentHash?: string;
  sourcePath?: string;
  evidence?: string[] | Record<string, unknown>;
  reconciliationVersion?: string;
}

export interface ArticleTombstone {
  articleId: ArticleId;
  deletedAt: string;
  previousStatus: ArticleStatus;
  slug: string;
  sourcePath: string;
  lastRevision: number;
  reason?: string;
}
