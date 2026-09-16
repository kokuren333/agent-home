import type { Client } from "discord.js";
import type { Job } from "../types.js";

export class Notifier {
  constructor(private readonly client: Client) {}
  async send(channelId: string, message: string): Promise<void> {
    try { const channel = await this.client.channels.fetch(channelId); if (!channel || !("send" in channel)) return; await channel.send(message); }
    catch (error) { console.warn(`Discord notification failed for channel ${channelId}: ${formatError(error)}`); }
  }
  async jobStarted(job: Job, _running: number, _max: number): Promise<void> {
    if (job.jobType === "codex") { await this.send(job.channelId, `Codex root query started.\njob: \`${job.id}\``); return; }
    await this.send(job.channelId, ["記事作成を開始しました。", `job: \`${job.id}\``, `started: \`${formatJst(new Date())}\``].join("\n"));
  }
  async jobSucceeded(job: Job): Promise<void> {
    if (job.jobType === "codex") { await this.send(job.channelId, `Codex root query completed.\njob: \`${job.id}\``); return; }
    const lines = job.pagesCommitSha ? ["記事を公開しました。", job.pagesUrl ? `公開URL: ${job.pagesUrl}` : undefined] : ["記事の作成が完了しました。公開処理は未実行または対象外です。"];
    await this.send(job.channelId, [...lines, `job: \`${job.id}\``].filter(Boolean).join("\n"));
  }
  async jobFailed(job: Job, error: unknown): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);
    const title = job.status === "cancelled" ? "記事作成ジョブをキャンセルしました。" : job.status === "publish_retry_pending" ? "記事生成は完了しました。公開処理を再試行します。" : job.status === "failed_review_required" ? "記事作成ジョブはレビューが必要な状態で停止しました。" : job.pushedCommitSha && !job.pagesCommitSha ? "記事の作成には成功しましたが、公開に失敗しました。" : "記事作成に失敗しました。";
    await this.send(job.channelId, [title, `job: \`${job.id}\``, `理由: ${reason.slice(0, 1200)}`].join("\n"));
  }
}
function formatError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function formatJst(date: Date): string { return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date); }
