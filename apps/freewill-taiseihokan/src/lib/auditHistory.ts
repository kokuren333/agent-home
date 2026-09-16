import type { AuditHistoryEntry, AuditModel } from '../types';

export type DashboardGranularity = 'day' | 'week' | 'month';

export interface PeriodAggregate {
  key: string;
  label: string;
  count: number;
  topStateLabel: string;
  topStateCount: number;
  averageProbability: number;
  averageQuestions: number;
}

export interface FrequencyItem {
  id: string;
  label: string;
  count: number;
  share: number;
}

export interface TransitionItem {
  from: string;
  to: string;
  count: number;
  share: number;
}

function stateLabelMap(model: AuditModel) {
  return new Map(model.states.map((state) => [state.id, state.label]));
}

function isResolved(entry: AuditHistoryEntry) {
  // statusがない過去データは、従来どおり確定済みとして扱う。
  return entry.status !== 'held';
}

export function primaryLabel(entry: AuditHistoryEntry, model: AuditModel) {
  if (!isResolved(entry)) return '判定保留';
  return entry.primaryStateLabel || stateLabelMap(model).get(entry.primaryStateId) || entry.primaryStateId || '不明';
}

export function secondaryLabel(entry: AuditHistoryEntry, model: AuditModel) {
  if (!entry.secondaryStateId) return '';
  return entry.secondaryStateLabel || stateLabelMap(model).get(entry.secondaryStateId) || entry.secondaryStateId;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date) {
  const d = startOfDay(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addPeriod(date: Date, granularity: DashboardGranularity, amount: number) {
  const d = new Date(date);
  if (granularity === 'day') d.setDate(d.getDate() + amount);
  if (granularity === 'week') d.setDate(d.getDate() + amount * 7);
  if (granularity === 'month') d.setMonth(d.getMonth() + amount);
  return d;
}

function bucketStart(date: Date, granularity: DashboardGranularity) {
  if (granularity === 'day') return startOfDay(date);
  if (granularity === 'week') return startOfWeek(date);
  return startOfMonth(date);
}

function bucketKey(date: Date, granularity: DashboardGranularity) {
  const d = bucketStart(date, granularity);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bucketLabel(date: Date, granularity: DashboardGranularity) {
  const d = bucketStart(date, granularity);
  if (granularity === 'day') return `${d.getMonth() + 1}/${d.getDate()}`;
  if (granularity === 'week') return `${d.getMonth() + 1}/${d.getDate()}週`;
  return `${d.getFullYear()}/${d.getMonth() + 1}`;
}

export function buildPeriodSeries(history: AuditHistoryEntry[], model: AuditModel, granularity: DashboardGranularity, now = new Date()): PeriodAggregate[] {
  const length = granularity === 'day' ? 30 : 12;
  const current = bucketStart(now, granularity);
  const buckets: PeriodAggregate[] = [];

  for (let offset = length - 1; offset >= 0; offset -= 1) {
    const start = addPeriod(current, granularity, -offset);
    const key = bucketKey(start, granularity);
    const entries = history.filter((entry) => bucketKey(new Date(entry.createdAt), granularity) === key);
    const counts = new Map<string, number>();
    for (const entry of entries.filter(isResolved)) {
      const label = primaryLabel(entry, model);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    buckets.push({
      key,
      label: bucketLabel(start, granularity),
      count: entries.length,
      topStateLabel: top?.[0] ?? '—',
      topStateCount: top?.[1] ?? 0,
      averageProbability: entries.length ? entries.reduce((sum, item) => sum + item.probability, 0) / entries.length : 0,
      averageQuestions: entries.length ? entries.reduce((sum, item) => sum + item.answers.length, 0) / entries.length : 0,
    });
  }
  return buckets;
}

export function primaryFrequency(history: AuditHistoryEntry[], model: AuditModel): FrequencyItem[] {
  const counts = new Map<string, { id: string; count: number }>();
  const resolved = history.filter(isResolved);
  for (const entry of resolved) {
    const label = primaryLabel(entry, model);
    const current = counts.get(label) ?? { id: entry.primaryStateId, count: 0 };
    current.count += 1;
    counts.set(label, current);
  }
  const total = resolved.length || 1;
  return [...counts.entries()]
    .map(([label, value]) => ({ id: value.id, label, count: value.count, share: value.count / total }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ja'));
}

export function secondaryFrequency(history: AuditHistoryEntry[], model: AuditModel): FrequencyItem[] {
  const usable = history.filter((entry) => entry.secondaryStateId);
  const counts = new Map<string, { id: string; count: number }>();
  for (const entry of usable) {
    const label = secondaryLabel(entry, model);
    const current = counts.get(label) ?? { id: entry.secondaryStateId!, count: 0 };
    current.count += 1;
    counts.set(label, current);
  }
  const total = usable.length || 1;
  return [...counts.entries()]
    .map(([label, value]) => ({ id: value.id, label, count: value.count, share: value.count / total }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ja'));
}

export function transitionFrequency(history: AuditHistoryEntry[], model: AuditModel): TransitionItem[] {
  const ordered = history.filter(isResolved).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const counts = new Map<string, { from: string; to: string; count: number }>();
  for (let i = 1; i < ordered.length; i += 1) {
    const from = primaryLabel(ordered[i - 1], model);
    const to = primaryLabel(ordered[i], model);
    const key = `${from}\u0000${to}`;
    const current = counts.get(key) ?? { from, to, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  const total = Math.max(1, ordered.length - 1);
  return [...counts.values()]
    .map((item) => ({ ...item, share: item.count / total }))
    .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from, 'ja'));
}

export function recentWindow(history: AuditHistoryEntry[], days: number, now = new Date()) {
  const end = now.getTime();
  const start = end - days * 86400000;
  return history.filter((entry) => {
    const t = new Date(entry.createdAt).getTime();
    return t >= start && t <= end;
  });
}

function previousWindow(history: AuditHistoryEntry[], days: number, now = new Date()) {
  const end = now.getTime() - days * 86400000;
  const start = end - days * 86400000;
  return history.filter((entry) => {
    const t = new Date(entry.createdAt).getTime();
    return t >= start && t < end;
  });
}

export function recentStateChanges(history: AuditHistoryEntry[], model: AuditModel, days = 30, now = new Date()) {
  const current = recentWindow(history, days, now);
  const previous = previousWindow(history, days, now);
  const currentFreq = new Map(primaryFrequency(current, model).map((item) => [item.label, item.share]));
  const previousFreq = new Map(primaryFrequency(previous, model).map((item) => [item.label, item.share]));
  const labels = new Set([...currentFreq.keys(), ...previousFreq.keys()]);
  return [...labels].map((label) => ({
    label,
    currentShare: currentFreq.get(label) ?? 0,
    previousShare: previousFreq.get(label) ?? 0,
    delta: (currentFreq.get(label) ?? 0) - (previousFreq.get(label) ?? 0),
  })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function historySummary(history: AuditHistoryEntry[], model: AuditModel, now = new Date()) {
  const freq = primaryFrequency(history, model);
  const secondary = secondaryFrequency(history, model);
  const last7 = recentWindow(history, 7, now).length;
  const last30 = recentWindow(history, 30, now).length;
  const averageQuestions = history.length ? history.reduce((sum, item) => sum + item.answers.length, 0) / history.length : 0;
  const averageProbability = history.length ? history.reduce((sum, item) => sum + item.probability, 0) / history.length : 0;
  const highConfidenceRate = history.length ? history.filter((item) => item.confidence === 'high').length / history.length : 0;
  const ordered = [...history].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const resolved = ordered.filter(isResolved);
  let sameAsPrevious = 0;
  for (let i = 1; i < resolved.length; i += 1) {
    if (primaryLabel(resolved[i], model) === primaryLabel(resolved[i - 1], model)) sameAsPrevious += 1;
  }
  const repeatRate = resolved.length > 1 ? sameAsPrevious / (resolved.length - 1) : 0;
  return {
    total: history.length,
    last7,
    last30,
    averageQuestions,
    averageProbability,
    highConfidenceRate,
    repeatRate,
    mostCommon: freq[0] ?? null,
    mostCommonSecondary: secondary[0] ?? null,
    lastAudit: ordered.at(-1) ?? null,
  };
}
