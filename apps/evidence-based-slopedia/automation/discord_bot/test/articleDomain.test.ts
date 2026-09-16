import assert from "node:assert/strict";
import test from "node:test";
import { assertArticleMetadata, assertTransition, canTransition, generateArticleSlug, normalizeTitle } from "../../ebs/core/src/domain/article.js";
import { generateArticleId } from "../../ebs/core/src/services/contentService.js";

test("article status transitions enforce the lifecycle", () => {
  assert.equal(canTransition("draft", "review"), true);
  assert.equal(canTransition("review", "published"), true);
  assert.equal(canTransition("published", "deleted"), false);
  assert.throws(() => assertTransition("published", "archived"), /Invalid article status transition/);
});

test("generated article IDs are safe, unique-shaped, and time-sortable", () => {
  const earlier = generateArticleId(1_000); const later = generateArticleId(1_001);
  assert.match(earlier, /^art_[A-Z0-9]{26}$/); assert.ok(earlier < later);
  assert.throws(() => assertArticleMetadata({ id: "../escape", type: "encyclopedia", status: "published" }), /safe stable id/);
});

test("title normalization and slug generation are deterministic", () => {
  assert.equal(normalizeTitle("ＧＰＵ とは？"), normalizeTitle("GPUとは"));
  assert.equal(generateArticleSlug("05_技術・工学", "GPUとは", "GPUとは__what-is-gpu.md"), "技術-工学/what-is-gpu");
});
