import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonJobRepository } from "../../ebs/core/src/infrastructure/jsonJobRepository.js";
import { FilesystemArticleRepository } from "../../ebs/core/src/infrastructure/filesystemArticleRepository.js";
import { sha256 } from "../../ebs/core/src/migration/articleInventory.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-cli-"));
process.env.EBE_BOT_DATA_DIR = root;
const { runCli, ExitCode } = await import("../../ebs/cli/src/main.js");
const repository = new JsonJobRepository(path.join(root, "jobs.json"));
const lines: string[] = [];
const output = { log: (value: unknown) => { lines.push(String(value)); }, error: (value: unknown) => { lines.push(String(value)); } } as Console;

test("CLI supports human and JSON list/status plus stable exit codes", async () => {
  const job = await repository.create({ query: "cli", mode: "new", discordUserId: "cli", channelId: "cli", guildId: null, model: "test", reasoningEffort: "low" });
  assert.equal(await runCli(["job", "list", "--json"], output), ExitCode.success);
  assert.doesNotThrow(() => JSON.parse(lines.pop()!));
  assert.equal(await runCli(["job", "status", job.id], output), ExitCode.success);
  assert.equal(await runCli(["job", "status", "missing"], output), ExitCode.notFound);
  assert.equal(await runCli(["unknown"], output), ExitCode.invalidArguments);
});

test("CLI queue pause/resume and cancel/retry use JobService", async () => {
  const job = await repository.create({ query: "manage", mode: "new", discordUserId: "cli", channelId: "cli", guildId: null, model: "test", reasoningEffort: "low" });
  assert.equal(await runCli(["queue", "pause"], output), 0);
  assert.equal((await repository.state()).queuePaused, true);
  assert.equal(await runCli(["queue", "resume"], output), 0);
  assert.equal(await runCli(["job", "cancel", job.id], output), 0);
  assert.equal(await runCli(["job", "retry", job.id], output), 0);
});

test("CLI article resolver, JSON output, and dangerous confirmation", async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-cli-vault-"));
  await fs.mkdir(path.join(vault, "10_Published")); await fs.writeFile(path.join(vault, "AGENTS.md"), "test");
  const articles = new FilesystemArticleRepository(vault);
  await articles.save({ id: "art_CLI", type: "encyclopedia", title: "CLI Article", slug: "technology/cli", status: "unpublished", sourcePath: "10_Published/article.md", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", aliases: [], image: null, currentRevision: 0 });
  const previous = process.env.EBS_VAULT_ROOT; process.env.EBS_VAULT_ROOT = vault;
  try {
    assert.equal(await runCli(["article", "show", "technology/cli", "--json"], output), ExitCode.success);
    assert.equal(JSON.parse(lines.pop()!).id, "art_CLI");
    assert.equal(await runCli(["article", "show", "missing", "--json"], output), ExitCode.notFound);
    assert.equal(JSON.parse(lines.pop()!).error.code, "not_found");
    assert.equal(await runCli(["article", "delete", "art_CLI"], output), ExitCode.invalidArguments);
    assert.equal(await runCli(["article", "rollback", "art_CLI", "--json"], output), ExitCode.invalidArguments);
    assert.equal(JSON.parse(lines.pop()!).error.code, "invalid_arguments");
    assert.equal(await runCli(["article", "delete", "art_CLI", "--yes", "--json"], output), ExitCode.success);
    assert.equal(JSON.parse(lines.pop()!).status, "deleted");
  } finally { if (previous === undefined) delete process.env.EBS_VAULT_ROOT; else process.env.EBS_VAULT_ROOT = previous; }
});

test("CLI exposes reconcile, every index rebuild, build, doctor, and rebuild as JSON", async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "ebs-cli-phase3-")); await fs.mkdir(path.join(vault, "10_Published")); await fs.writeFile(path.join(vault, "AGENTS.md"), "test"); const body = "---\ntitle: Phase 3\nstatus: published\n---\n# Phase 3\n\nA sufficiently long summary paragraph for deterministic static rendering.\n"; await fs.writeFile(path.join(vault, "10_Published", "phase3.md"), body); const articles = new FilesystemArticleRepository(vault); await articles.save({ id: "art_PHASE3", type: "encyclopedia", title: "Phase 3", slug: "test/phase-3", status: "published", sourcePath: "10_Published/phase3.md", createdAt: "2026-01-01", updatedAt: "2026-01-01", aliases: [], image: null, currentRevision: 0, contentHash: sha256(body) }); const previous = process.env.EBS_VAULT_ROOT; process.env.EBS_VAULT_ROOT = vault;
  try { for (const flag of ["--search", "--category", "--moc", "--related", "--backlinks", "--sitemap", "--all"]) { assert.equal(await runCli(["index", "rebuild", flag, "--json"], output), 0); assert.doesNotThrow(() => JSON.parse(lines.pop()!)); } assert.equal(await runCli(["build", "--article", "art_PHASE3", "--json"], output), 0); assert.equal(JSON.parse(lines.pop()!).builtArticle, "art_PHASE3"); assert.equal(await runCli(["doctor", "--json"], output), 0); assert.ok(Array.isArray(JSON.parse(lines.pop()!).findings)); assert.equal(await runCli(["reconcile", "--json"], output), 0); assert.ok(Array.isArray(JSON.parse(lines.pop()!).findings)); assert.equal(await runCli(["rebuild", "--json"], output), 0); assert.ok(JSON.parse(lines.pop()!).build.articleCount === 1); }
  finally { if (previous === undefined) delete process.env.EBS_VAULT_ROOT; else process.env.EBS_VAULT_ROOT = previous; }
});
