import type { ArticleMetadata } from "../domain/article.js";
import type { ArticleRepository } from "../ports/articleRepository.js";

export class ArticleResolver {
  constructor(private readonly repository: ArticleRepository) {}
  async resolve(target: string): Promise<ArticleMetadata> {
    const normalizedSlug = target.replace(/^\//, "").toLowerCase(); const normalizedPath = normalizePath(target);
    const direct = (await this.repository.list()).filter((article) => article.id === target || article.slug.replace(/^\//, "").toLowerCase() === normalizedSlug || normalizePath(article.sourcePath) === normalizedPath);
    const matches = [...direct, await this.repository.resolveRedirect(target)].filter((value): value is ArticleMetadata => Boolean(value));
    const unique = [...new Map(matches.map((article) => [article.id, article])).values()];
    if (unique.length === 0) throw new Error(`Article not found: ${target}`);
    if (unique.length > 1) throw new Error(`Ambiguous article target: ${target}`);
    return unique[0];
  }
}

function normalizePath(value: string): string { return value.replace(/\\/g, "/").normalize("NFC").replace(/^\.\//, "").toLowerCase(); }
