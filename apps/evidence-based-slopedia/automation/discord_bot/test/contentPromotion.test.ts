import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promoteGeneratedContent } from "../src/services/contentPromotion.js";
test("promotion copies staging content into ContentRoot", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-promotion-")); const worktree = path.join(root, "worktree"); const content = path.join(root, "content");
  await fs.mkdir(path.join(worktree, "10_Published", "science"), { recursive: true }); await fs.mkdir(path.join(worktree, "canonical", "metadata", "articles"), { recursive: true }); await fs.writeFile(path.join(worktree, "10_Published", "science", "article.md"), "published\n"); await fs.writeFile(path.join(worktree, "canonical", "metadata", "articles", "art_test.yml"), JSON.stringify({ id: "art_test", sourcePath: "10_Published/science/article.md", slug: "science/article", status: "published", contentHash: "e41adfc0670b4e1740e6874bdb59f26e0bc6982e44796c5df37b6eead72932dc" }));
  await promoteGeneratedContent(worktree, content, ["10_Published/science/article.md"]); assert.equal(await fs.readFile(path.join(content, "10_Published", "science", "article.md"), "utf8"), "published\n");
});
test("promotion allows MOC without article metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-promotion-moc-")); const worktree = path.join(root, "worktree"); const content = path.join(root, "content");
  await fs.mkdir(path.join(worktree, "10_Published", "science"), { recursive: true }); await fs.writeFile(path.join(worktree, "10_Published", "science", "MOC - science.md"), "# Science\n");
  await promoteGeneratedContent(worktree, content, ["10_Published/science/MOC - science.md"]);
  assert.equal(await fs.readFile(path.join(content, "10_Published", "science", "MOC - science.md"), "utf8"), "# Science\n");
});
