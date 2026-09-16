import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface MutationLockOptions { timeoutMs?: number; staleMs?: number; retryMs?: number; }

export class FilesystemMutationLock {
  private readonly lockDir: string;
  constructor(vaultRoot: string, private readonly defaults: MutationLockOptions = {}) { this.lockDir = path.join(vaultRoot, "canonical", ".locks"); }

  async withLock<T>(key: string, action: () => Promise<T>, options: MutationLockOptions = {}): Promise<T> {
    await fs.mkdir(this.lockDir, { recursive: true });
    const file = path.join(this.lockDir, `${safeKey(key)}.lock`); const token = randomUUID();
    const timeoutMs = options.timeoutMs ?? this.defaults.timeoutMs ?? 10_000; const staleMs = options.staleMs ?? this.defaults.staleMs ?? 120_000; const retryMs = options.retryMs ?? this.defaults.retryMs ?? 25; const started = Date.now();
    while (true) {
      try { await fs.writeFile(file, JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() }), { encoding: "utf8", flag: "wx" }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const stat = await fs.stat(file).catch(() => undefined); if (stat && Date.now() - stat.mtimeMs > staleMs) { await fs.rm(file, { force: true }); continue; }
        if (Date.now() - started >= timeoutMs) throw new Error(`Mutation lock timeout: ${key}`);
        await delay(retryMs);
      }
    }
    try { return await action(); }
    finally { const current = await fs.readFile(file, "utf8").catch(() => ""); if (current.includes(token)) await fs.rm(file, { force: true }); }
  }
}

function safeKey(value: string): string { return value.normalize("NFKC").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "global"; }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
