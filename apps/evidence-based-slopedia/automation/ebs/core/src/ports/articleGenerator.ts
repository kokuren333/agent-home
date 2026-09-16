import type { ArticleMetadata } from "../domain/article.js";
import type { ArticleOperation } from "../domain/revision.js";

export interface ArticleGenerationRequest {
  operation: Extract<ArticleOperation, "create" | "regenerate" | "research_update">;
  article: ArticleMetadata;
  operationId: string;
  prompt?: string;
}

export interface ArticleGenerationResult {
  jobId?: string;
  gitSha?: string;
  sourcePath?: string;
  summary?: string;
  pending?: boolean;
}

export interface ArticleGenerator {
  generate(request: ArticleGenerationRequest): Promise<ArticleGenerationResult>;
}
