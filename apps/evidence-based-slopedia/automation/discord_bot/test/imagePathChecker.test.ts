import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { assertArticleImagePaths } from "../src/runners/imagePathChecker.js";
import { phase3Fixture } from "./phase3Fixture.js";

test("article image validation is isolated to the changed article", async () => {
  const { root, seed } = await phase3Fixture();
  const target = await seed("art_TARGET", "Target", "test/target", "published", "![target](50_Assets/target.png)");
  await seed("art_EXISTING", "Existing", "test/existing", "published", "![existing](50_Assets/missing.png)");
  await fs.mkdir(path.join(root, "50_Assets"), { recursive: true });
  await fs.writeFile(path.join(root, "50_Assets", "target.png"), "fixture");

  await assertArticleImagePaths(root, "published", [target.sourcePath]);
  await assert.rejects(() => assertArticleImagePaths(root, "published"), /art_EXISTING\.md/);
});
