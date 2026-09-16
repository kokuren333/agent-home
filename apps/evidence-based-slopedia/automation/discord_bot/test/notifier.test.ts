import assert from "node:assert/strict";
import test from "node:test";
import { Notifier } from "../src/services/notifier.js";
import type { Job } from "../src/types.js";

const job = (extra: Partial<Job> = {}): Job => ({ id: "job-test", status: "succeeded", query: "q", mode: "new", discordUserId: "u", channelId: "c", guildId: null, model: "m", reasoningEffort: "low", ...extra });
function capture() { const messages: string[] = []; const client = { channels: { fetch: async () => ({ send: async (message: string) => messages.push(message) }) } } as never; return { messages, notifier: new Notifier(client) }; }

test("only a Pages revision produces the public success message", async () => { const c = capture(); await c.notifier.jobSucceeded(job({ pagesCommitSha: "a".repeat(40), pagesUrl: "https://example.test/article" })); assert.match(c.messages[0], /記事を公開しました/); assert.match(c.messages[0], /https:\/\/example\.test/); assert.doesNotMatch(c.messages[0], /commit|private repo/i); });
test("private-only completion is not reported as public", async () => { const c = capture(); await c.notifier.jobSucceeded(job({ pushedCommitSha: "a".repeat(40) })); assert.doesNotMatch(c.messages[0], /記事を公開しました/); });
test("deploy failure after generation reports publication failure", async () => { const c = capture(); await c.notifier.jobFailed(job({ status: "failed", pushedCommitSha: "a".repeat(40) }), new Error("Pages git push origin main failed")); assert.match(c.messages[0], /作成には成功しましたが、公開に失敗/); assert.match(c.messages[0], /Pages git push/); });
