export type ArticleId = string;
export type ArticleType = "encyclopedia" | "news" | "daily" | "forecast";
export type ArticleStatus = "draft" | "review" | "published" | "unpublished" | "archived" | "deleted";
export const ARTICLE_TYPES: readonly ArticleType[] = ["encyclopedia", "news", "daily", "forecast"];
export const ARTICLE_STATUSES: readonly ArticleStatus[] = ["draft", "review", "published", "unpublished", "archived", "deleted"];

export interface ArticleImage { path: string; alt: string; width?: number; height?: number; bytes?: number; sha256?: string; generatedAt?: string; source?: { type: "generated" | "migrated" | "external" }; }
export interface ArticleReference { sourceId?: string; url?: string; title?: string; }
export interface AutonomousArticleMetadata { origin: "autonomous"; topicSource: string; seedReference?: string; candidateId: string; discoveredAt: string; generationJobId?: string; }

export interface ArticleMetadata {
  id: ArticleId;
  type: ArticleType;
  title: string;
  slug: string;
  status: ArticleStatus;
  sourcePath: string;
  createdAt: string;
  updatedAt: string;
  aliases: string[];
  category?: string;
  subfield?: string;
  image: ArticleImage | null;
  references?: ArticleReference[];
  currentRevision: number;
  contentHash?: string;
  archiveReason?: string;
  lastJobId?: string;
  lastGitSha?: string;
  autonomous?: AutonomousArticleMetadata;
}

const transitions: Record<ArticleStatus, ArticleStatus[]> = {
  draft: ["review", "unpublished"],
  review: ["draft", "published", "unpublished"],
  published: ["unpublished"],
  unpublished: ["published", "archived", "deleted", "review"],
  archived: ["unpublished"],
  deleted: ["unpublished"],
};

export function canTransition(from: ArticleStatus, to: ArticleStatus): boolean {
  return from === to || transitions[from].includes(to);
}

export function assertTransition(from: ArticleStatus, to: ArticleStatus): void {
  if (!canTransition(from, to)) throw new Error(`Invalid article status transition: ${from} -> ${to}`);
}

export function assertArticleMetadata(value: unknown): asserts value is ArticleMetadata {
  if (!value || typeof value !== "object") throw new Error("Invalid article metadata: expected object");
  const article = value as Partial<ArticleMetadata>;
  if (typeof article.id !== "string" || !/^art_[A-Za-z0-9._-]+$/.test(article.id)) throw new Error("Invalid article metadata: safe stable id is required");
  if (!ARTICLE_TYPES.includes(article.type as ArticleType)) throw new Error(`Invalid article metadata type: ${String(article.type)}`);
  if (!ARTICLE_STATUSES.includes(article.status as ArticleStatus)) throw new Error(`Invalid article metadata status: ${String(article.status)}`);
  for (const field of ["title", "slug", "sourcePath", "createdAt", "updatedAt"] as const) if (typeof article[field] !== "string" || !article[field]!.trim()) throw new Error(`Invalid article metadata: ${field} is required`);
  if (!Array.isArray(article.aliases) || !article.aliases.every((alias) => typeof alias === "string")) throw new Error("Invalid article metadata: aliases must be strings");
  if (!Number.isInteger(article.currentRevision) || Number(article.currentRevision) < 0) throw new Error("Invalid article metadata: currentRevision must be a non-negative integer");
}

export function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function normalizeSlugPart(value: string): string {
  const normalized = value.normalize("NFKC").trim().toLowerCase()
    .replace(/[_\s]+/g, "-").replace(/[^\p{L}\p{N}-]+/gu, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return normalized || "article";
}

export function generateArticleSlug(category: string | undefined, title: string, sourcePath?: string): string {
  const categoryPart = normalizeSlugPart((category ?? "general").replace(/^\d+[_-]?/, ""));
  const filename = sourcePath?.replace(/\\/g, "/").split("/").pop()?.replace(/\.md$/i, "");
  const explicitEnglish = filename?.includes("__") ? filename.split("__").pop() : undefined;
  return `${categoryPart}/${normalizeSlugPart(explicitEnglish || title)}`;
}
