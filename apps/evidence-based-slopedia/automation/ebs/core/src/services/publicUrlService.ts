import type { ArticleMetadata } from "../domain/article.js";

export interface PublicSiteConfig { basePath?: string; origin?: string; }

/** Pure public URL factory. Filesystem paths are deliberately never accepted. */
export class PublicUrlService {
  readonly basePath: string;
  constructor(config: PublicSiteConfig = {}) { this.basePath = normalizeBasePath(config.basePath ?? "/"); this.origin = config.origin?.replace(/\/$/, ""); }
  private readonly origin?: string;
  homeUrl() { return this.withBase("/"); }
  articlesUrl() { return this.withBase("/articles/"); }
  articleUrl(article: Pick<ArticleMetadata, "slug">) { return this.withBase(`/articles/${segments(article.slug).join("/")}/`); }
  topicsUrl() { return this.withBase("/topics/"); }
  topicUrl(topic: string) { return this.withBase(`/topics/${encodeURIComponent(topic)}/`); }
  recentUrl() { return this.withBase("/recent/"); }
  searchUrl() { return this.withBase("/search/"); }
  newsUrl(news?: { date?: string; slug?: string }) { return news?.date && news.slug ? this.withBase(`/news/${encodeURIComponent(news.date)}/${segments(news.slug).join("/")}/`) : this.withBase("/news/"); }
  newsDateUrl(date: string) { return this.withBase(`/news/${encodeURIComponent(date)}/`); }
  forecastUrl(forecast?: { date?: string; slug?: string }) { return forecast?.date && forecast.slug ? this.withBase(`/forecast/${encodeURIComponent(forecast.date)}/${segments(forecast.slug).join("/")}/`) : this.withBase("/forecast/"); }
  forecastDateUrl(date: string) { return this.withBase(`/forecast/${encodeURIComponent(date)}/`); }
  aboutUrl() { return this.withBase("/about/"); }
  assetUrl(asset: string) { return this.withBase(`/assets/${segments(asset).join("/")}`); }
  pathUrl(route: string) { return this.withBase(route.startsWith("/") ? route : `/${route}`); }
  absolute(url: string) { return this.origin ? `${this.origin}${url}` : undefined; }
  private withBase(route: string) { return this.basePath === "/" ? route : `${this.basePath.slice(0, -1)}${route}`; }
}

export function normalizeBasePath(value: string): string { const clean = value.replace(/\\/g, "/").trim(); if (!clean || clean === "/") return "/"; return `/${clean.replace(/^\/+|\/+$/g, "")}/`; }
function segments(value: string): string[] { return value.replace(/\\/g, "/").split("/").filter(Boolean).map(encodeURIComponent); }
