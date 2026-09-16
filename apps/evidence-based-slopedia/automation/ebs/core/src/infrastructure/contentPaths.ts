import path from "node:path";
import fs from "node:fs/promises";

/** Canonical representation for ContentRoot-relative path comparisons. */
export function canonicalizePath(value: string): string {
  return value.replace(/\\/g, "/").normalize("NFC").replace(/^\.\//, "").split("/").filter(Boolean).join("/");
}

/** Resolve names component-by-component so NFC/NFD filesystem differences do not hide files. */
export async function resolveContentPath(root: string, relative: string): Promise<string> {
  const canonical = canonicalizePath(relative);
  if (!canonical || canonical.startsWith("/") || canonical.split("/").includes("..")) throw new Error("CONTENT_PATH_OUTSIDE_ROOT");
  let current = path.resolve(root);
  for (const segment of canonical.split("/")) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    const matches = entries.filter((entry) => canonicalizePath(entry.name).toLowerCase() === segment.toLowerCase());
    if (matches.length > 1) throw new Error(`CONTENT_PATH_AMBIGUOUS: ${canonical}`);
    if (matches.length === 0) throw new Error(`CONTENT_PATH_MISSING: ${canonical}`);
    current = path.join(current, matches[0].name);
  }
  return current;
}

/** Explicit separation between application code and durable generated content. */
export interface ContentPaths {
  root: string;
  articlesRoot: string;
  dailyRoot: string;
  forecastingRoot: string;
  assetsRoot: string;
  canonicalRoot: string;
}

export function contentPaths(root: string): ContentPaths {
  const resolved = path.resolve(root);
  return {
    root: resolved,
    articlesRoot: path.join(resolved, "10_Published"),
    dailyRoot: path.join(resolved, "11_Daily"),
    forecastingRoot: path.join(resolved, "12_Forecasting"),
    assetsRoot: path.join(resolved, "50_Assets"),
    canonicalRoot: path.join(resolved, "canonical"),
  };
}

/** Publication classification shared by promotion, doctor and indexing boundaries. */
export function isMocSource(relativePath: string): boolean {
  const name = relativePath.replace(/\\/g, "/").split("/").pop()?.normalize("NFKC").toLowerCase() ?? "";
  // MOC filenames may be localized or use punctuation/parentheses around
  // the acronym. Treat the explicit MOC marker as authoritative; article
  // filenames are not allowed to use this marker.
  return name === "_moc.md" || name.includes("moc");
}

export function isArticleSource(relativePath: string): boolean {
  return relativePath.replace(/\\/g, "/").toLowerCase().endsWith(".md") && !isMocSource(relativePath);
}
