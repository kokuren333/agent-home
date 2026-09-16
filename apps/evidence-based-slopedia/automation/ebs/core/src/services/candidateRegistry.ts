import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FilesystemMutationLock } from "../infrastructure/filesystemMutationLock.js";

export type CandidateStatus = "candidate" | "accepted" | "queued" | "generating" | "generated" | "duplicate" | "rejected" | "failed" | "cooldown";
export type TopicSourceType = "existing_article" | "wikipedia_random" | "news" | "maintenance";

export interface TopicCandidate {
  id: string; rawTopic: string; normalizedTopic: string; preferredTitle: string; aliases: string[];
  sourceType: TopicSourceType; sourceReference?: string; discoveredAt: string; status: CandidateStatus;
  attemptCount: number; lastAttemptAt?: string; cooldownUntil?: string; articleId?: string; jobId?: string;
  rejectionReason?: string; similarityTarget?: string; similarityScore?: number; proposedCategory?: string; researchQuestion?: string;
}
export interface SchedulerTick { id: string; scheduledAt: string; startedAt: string; completedAt?: string; result?: string; }
export interface AutoState { enabled: boolean; manualPaused: boolean; lastTickAt?: string; nextTickAt?: string; pauseReasons: string[]; circuitOpenUntil?: string; }
interface RegistryData { schemaVersion: 1; candidates: TopicCandidate[]; ticks: SchedulerTick[]; state: AutoState; }

export class CandidateRegistry {
  private lock: Promise<unknown> = Promise.resolve();
  private readonly filesystemLock: FilesystemMutationLock;
  constructor(private readonly file: string, private readonly now: () => Date = () => new Date()) { this.filesystemLock = new FilesystemMutationLock(path.resolve(path.dirname(file), "..", "..")); }
  async init(): Promise<void> { await fs.mkdir(path.dirname(this.file), { recursive: true }); try { await fs.writeFile(this.file, JSON.stringify({ schemaVersion: 1, candidates: [], ticks: [], state: { enabled: true, manualPaused: false, pauseReasons: [] } }, null, 2), { encoding: "utf8", flag: "wx" }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; } }
  async list(status?: CandidateStatus): Promise<TopicCandidate[]> { const data = await this.read(); return data.candidates.filter((item) => !status || item.status === status).sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt)); }
  async get(id: string): Promise<TopicCandidate | undefined> { return (await this.read()).candidates.find((item) => item.id === id); }
  async findNormalized(topic: string): Promise<TopicCandidate | undefined> { return (await this.read()).candidates.find((item) => item.normalizedTopic === topic && !["failed", "rejected"].includes(item.status)); }
  async add(input: Omit<TopicCandidate, "id" | "discoveredAt" | "attemptCount" | "status"> & { status?: CandidateStatus }): Promise<TopicCandidate> { return this.withLock(async () => { const data = await this.read(); const existing = data.candidates.find((item) => item.normalizedTopic === input.normalizedTopic); if (existing) return existing; const candidate: TopicCandidate = { ...input, id: `cand-${randomUUID()}`, discoveredAt: this.now().toISOString(), attemptCount: 0, status: input.status ?? "candidate" }; data.candidates.push(candidate); await this.write(data); return candidate; }); }
  async update(id: string, patch: Partial<TopicCandidate>): Promise<TopicCandidate> { return this.withLock(async () => { const data = await this.read(); const item = data.candidates.find((candidate) => candidate.id === id); if (!item) throw new Error(`Candidate not found: ${id}`); Object.assign(item, patch); await this.write(data); return item; }); }
  /** Import an identity into a worktree-owned registry without changing the source registry. */
  async upsert(candidate: TopicCandidate): Promise<TopicCandidate> { return this.withLock(async () => { const data = await this.read(); const existing = data.candidates.find((item) => item.id === candidate.id); if (existing) Object.assign(existing, candidate); else data.candidates.push({ ...candidate, aliases: [...candidate.aliases] }); await this.write(data); return existing ?? candidate; }); }
  async recordFailure(id: string, cooldownMinutes: number[]): Promise<TopicCandidate> { const item = await this.get(id); if (!item) throw new Error(`Candidate not found: ${id}`); const attemptCount = item.attemptCount + 1; const minutes = cooldownMinutes[Math.min(attemptCount - 1, cooldownMinutes.length - 1)] ?? 1440; return this.update(id, { status: "cooldown", attemptCount, lastAttemptAt: this.now().toISOString(), cooldownUntil: new Date(this.now().getTime() + minutes * 60_000).toISOString(), rejectionReason: attemptCount >= 4 ? "review_required_after_repeated_failures" : "generation_failed" }); }
  async state(): Promise<AutoState> { return (await this.read()).state; }
  async setPaused(paused: boolean): Promise<AutoState> { return this.withLock(async () => { const data = await this.read(); data.state.manualPaused = paused; data.state.pauseReasons = paused ? ["manual_pause"] : []; await this.write(data); return data.state; }); }
  async beginTick(id: string, scheduledAt: string): Promise<{ accepted: boolean; tick: SchedulerTick }> { return this.withLock(async () => { const data = await this.read(); const existing = data.ticks.find((tick) => tick.id === id); if (existing) return { accepted: false, tick: existing }; const tick = { id, scheduledAt, startedAt: this.now().toISOString() }; data.ticks.push(tick); data.state.lastTickAt = tick.startedAt; await this.write(data); return { accepted: true, tick }; }); }
  async completeTick(id: string, result: string, nextTickAt?: string, pauseReasons: string[] = []): Promise<void> { await this.withLock(async () => { const data = await this.read(); const tick = data.ticks.find((item) => item.id === id); if (tick) Object.assign(tick, { completedAt: this.now().toISOString(), result }); data.state.nextTickAt = nextTickAt; data.state.pauseReasons = pauseReasons; await this.write(data); }); }
  private async read(): Promise<RegistryData> { await this.init(); return JSON.parse(await fs.readFile(this.file, "utf8")) as RegistryData; }
  private async write(data: RegistryData): Promise<void> { const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`; await fs.writeFile(temporary, JSON.stringify(data, null, 2), "utf8"); await fs.rename(temporary, this.file); }
  private async withLock<T>(action: () => Promise<T>): Promise<T> { const guarded = () => this.filesystemLock.withLock("autonomous-registry", action); const run = this.lock.then(guarded, guarded); this.lock = run.catch(() => undefined); return run; }
}
