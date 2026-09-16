import type { ArticleId, ArticleMetadata } from "../domain/article.js";
import type { ArticleRevision, ArticleTombstone, ManagementEvent } from "../domain/revision.js";

export interface ArticleRepository {
  getById(id: ArticleId): Promise<ArticleMetadata | undefined>;
  getBySlug(slug: string): Promise<ArticleMetadata | undefined>;
  getByPath(sourcePath: string): Promise<ArticleMetadata | undefined>;
  list(): Promise<ArticleMetadata[]>;
  save(article: ArticleMetadata): Promise<void>;
  update(id: ArticleId, patch: Partial<ArticleMetadata>): Promise<ArticleMetadata>;
  exists(id: ArticleId): Promise<boolean>;
  appendRevision(revision: ArticleRevision): Promise<void>;
  history(id: ArticleId): Promise<ArticleRevision[]>;
  appendEvent(event: ManagementEvent): Promise<void>;
  events(): Promise<ManagementEvent[]>;
  saveTombstone(tombstone: ArticleTombstone): Promise<void>;
  getTombstone(id: ArticleId): Promise<ArticleTombstone | undefined>;
  listTombstones(): Promise<ArticleTombstone[]>;
  removeTombstone(id: ArticleId): Promise<void>;
  addRedirect(fromSlug: string, toSlug: string, articleId: ArticleId): Promise<void>;
  resolveRedirect(slug: string): Promise<ArticleMetadata | undefined>;
  redirects(): Promise<Record<string, { to: string; articleId: ArticleId }>>;
}
