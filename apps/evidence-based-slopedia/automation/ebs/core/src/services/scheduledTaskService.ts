export interface DailyTask { id: string; hour: number; minute: number; run(date: string): Promise<void>; }
export class ScheduledTaskService {
  private timer?: NodeJS.Timeout; private readonly completed = new Set<string>();
  constructor(private readonly tasks: DailyTask[], private readonly now: () => Date = () => new Date()) {}
  async tick(): Promise<void> { const current = jst(this.now()); for (const task of this.tasks) { const key = `${task.id}:${current.date}`; if (current.hour !== task.hour || current.minute !== task.minute || this.completed.has(key)) continue; this.completed.add(key); try { await task.run(current.date); } catch (error) { this.completed.delete(key); throw error; } } }
  start(): void { void this.tick(); this.timer = setInterval(() => void this.tick().catch((error) => console.error("scheduled task failed", error)), 60_000); }
  stop(): void { if (this.timer) clearInterval(this.timer); }
}
function jst(date: Date) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date); const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00"; return { date: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")), minute: Number(value("minute")) }; }
