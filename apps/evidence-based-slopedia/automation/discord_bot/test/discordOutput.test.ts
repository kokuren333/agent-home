import assert from "node:assert/strict";
import test from "node:test";
import { safeListOutput, safeSections } from "../src/services/discordOutput.js";

test("Discord list output never exceeds 2000 characters", () => {
  const output = safeListOutput("targets:", Array.from({ length: 500 }, (_, i) => `${i} ${"x".repeat(40)}`));
  assert.ok(output.length <= 2000);
  assert.match(output, /more/);
});

test("Discord cleanup sections stay within the API limit", () => {
  const output = safeSections("cleanup:", [
    { label: "worktrees", items: Array.from({ length: 100 }, (_, i) => `worktree-${i}-${"x".repeat(30)}`) },
    { label: "jobs", items: ["job-a"] },
    { label: "logs", items: ["log-a"] },
  ]);
  assert.ok(output.length <= 2000);
});
