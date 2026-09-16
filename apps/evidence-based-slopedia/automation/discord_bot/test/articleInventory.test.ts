import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { blockingCollisionCount, deterministicArticleId, inventoryArticles } from "../../ebs/core/src/migration/articleInventory.js";

test("inventory excludes MOCs, proposes stable IDs, and detects slug collisions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-inventory-"));
  const dir = path.join(root, "10_Published", "05_Technology"); await fs.mkdir(dir, { recursive: true });
  const body = "---\ntitle: GPU\nslug: technology/gpu\n---\n# GPU\n";
  await fs.writeFile(path.join(dir, "one.md"), body); await fs.writeFile(path.join(dir, "two.md"), body); await fs.writeFile(path.join(dir, "_MOC.md"), "# MOC");
  const inventory = await inventoryArticles(root);
  assert.equal(inventory.articles.length, 2);
  assert.equal(inventory.collisions.duplicateSlugCandidates.length, 1);
  assert.equal(blockingCollisionCount(inventory), 1);
  assert.equal(deterministicArticleId("a.md", "hash"), deterministicArticleId("a.md", "hash"));
});
