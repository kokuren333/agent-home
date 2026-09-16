import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createGitFixture, git } from "./gitFixture.js";
import { hasDurableArticleChanges } from "../src/runners/publishGateChecker.js";

test("publish gate sees worker changes committed after base and ignores working logs", async () => {
  const fixture = await createGitFixture("ebs-gate-");
  await fs.mkdir(path.join(fixture.vault, "_working"), { recursive: true });
  await fs.writeFile(path.join(fixture.vault, "_working", "job.log"), "runtime\n");
  assert.equal(await hasDurableArticleChanges(fixture.vault, await git(fixture.vault, "rev-parse", "HEAD")), false);
  await fs.mkdir(path.join(fixture.vault, "10_Published", "topic"), { recursive: true });
  await fs.writeFile(path.join(fixture.vault, "10_Published", "topic", "article.md"), "# article\n");
  await git(fixture.vault, "add", "10_Published/topic/article.md");
  await git(fixture.vault, "commit", "-m", "worker article");
  assert.equal(await hasDurableArticleChanges(fixture.vault, await git(fixture.vault, "rev-parse", "HEAD~1")), true);
});
