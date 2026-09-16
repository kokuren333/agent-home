import React, { useMemo, useState } from 'react';
import { Notice, Panel } from './Common';
import {
  buildPeriodSeries,
  historySummary,
  primaryFrequency,
  recentStateChanges,
  secondaryFrequency,
  transitionFrequency,
  type DashboardGranularity,
} from '../lib/auditHistory';
import type { AuditHistoryEntry, AuditModel } from '../types';

const granularityLabels: Record<DashboardGranularity, string> = {
  day: '日ごと',
  week: '週ごと',
  month: '月ごと',
};

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function oneDecimal(value: number) {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0';
}

function BarList({ items, empty = 'データなし' }: { items: Array<{ label: string; count: number; share: number }>; empty?: string }) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return <div className="frequency-list">
    {items.map((item) => <div className="frequency-row" key={item.label}>
      <div className="frequency-head"><span>{item.label}</span><strong>{item.count}回 / {percent(item.share)}</strong></div>
      <div className="frequency-track" aria-label={`${item.label} ${percent(item.share)}`}><span style={{ width: `${Math.max(2, item.share * 100)}%` }} /></div>
    </div>)}
  </div>;
}

function PeriodChart({ series }: { series: ReturnType<typeof buildPeriodSeries> }) {
  const max = Math.max(1, ...series.map((item) => item.count));
  return <div className="period-chart-scroll">
    <div className="period-chart" style={{ gridTemplateColumns: `repeat(${series.length}, minmax(34px, 1fr))` }}>
      {series.map((item) => <div className="period-column" key={item.key} title={`${item.label}: ${item.count}回 / 最多 ${item.topStateLabel}`}>
        <div className="period-bar-area"><span className="period-bar" style={{ height: `${item.count ? Math.max(8, (item.count / max) * 100) : 0}%` }}><i>{item.count || ''}</i></span></div>
        <small>{item.label}</small>
      </div>)}
    </div>
  </div>;
}

function trendSentence(changes: ReturnType<typeof recentStateChanges>, currentCount: number, previousCount: number) {
  if (currentCount < 3 || previousCount < 3) return '直近30日とその前30日の双方に3件以上の監査がないため、期間比較は保留します。';
  const meaningful = changes.filter((item) => Math.abs(item.delta) >= 0.1);
  if (!meaningful.length) return '直近30日では、前の30日と比べて主状態構成に10ポイント以上の変化はありません。';
  const up = meaningful.find((item) => item.delta > 0);
  const down = meaningful.find((item) => item.delta < 0);
  const parts: string[] = [];
  if (up) parts.push(`${up.label}が${Math.round(up.delta * 100)}ポイント増加`);
  if (down) parts.push(`${down.label}が${Math.abs(Math.round(down.delta * 100))}ポイント減少`);
  return `直近30日の構成変化: ${parts.join('、')}。これは出現頻度の記述であり、原因や良否の判定ではありません。`;
}

export function AuditDashboard({ history, model }: { history: AuditHistoryEntry[]; model: AuditModel }) {
  const [granularity, setGranularity] = useState<DashboardGranularity>('day');
  const summary = useMemo(() => historySummary(history, model), [history, model]);
  const primary = useMemo(() => primaryFrequency(history, model), [history, model]);
  const secondary = useMemo(() => secondaryFrequency(history, model), [history, model]);
  const transitions = useMemo(() => transitionFrequency(history, model), [history, model]);
  const periods = useMemo(() => buildPeriodSeries(history, model, granularity), [history, model, granularity]);
  const changes = useMemo(() => recentStateChanges(history, model, 30), [history, model]);
  const now = Date.now();
  const current30 = history.filter((entry) => new Date(entry.createdAt).getTime() >= now - 30 * 86400000).length;
  const previous30 = history.filter((entry) => {
    const t = new Date(entry.createdAt).getTime();
    return t >= now - 60 * 86400000 && t < now - 30 * 86400000;
  }).length;
  const ordered = [...history].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (!history.length) return <div className="stack-lg">
    <Panel><p className="eyebrow">AUDIT HISTORY</p><h1>監査履歴</h1><p>状態監査を実行すると、ここに日別・週別・月別の集計と状態傾向が表示されます。</p></Panel>
    <Notice tone="info">監査履歴はブラウザ内のIndexedDBへ自動保存されます。端末間の移行やサイトデータ消去への備えには、バックアップZIPを書き出してください。</Notice>
  </div>;

  return <div className="stack-lg audit-dashboard">
    <Panel>
      <div className="section-heading"><div><p className="eyebrow">AUDIT HISTORY</p><h1>監査履歴ダッシュボード</h1><p>過去の判定を集計し、現在までの状態パターンを観測します。履歴は次回監査の事前確率には自動反映しません。</p></div><span className="status-chip">{summary.total} records</span></div>
      <div className="summary-metrics">
        <div><strong>{summary.total}</strong><span>累計監査</span></div>
        <div><strong>{summary.last7}</strong><span>直近7日</span></div>
        <div><strong>{summary.last30}</strong><span>直近30日</span></div>
        <div><strong>{oneDecimal(summary.averageQuestions)}</strong><span>平均質問数</span></div>
        <div><strong>{percent(summary.averageProbability)}</strong><span>平均主状態確率（モデル内）</span></div>
        <div><strong>{summary.lastAudit ? new Date(summary.lastAudit.createdAt).toLocaleDateString('ja-JP') : '—'}</strong><span>最終監査</span></div>
      </div>
    </Panel>

    <Panel>
      <div className="section-heading"><div><h2>期間集計</h2><p>監査回数と、その期間に最も多かった主状態を日・週・月単位で確認します。週は月曜始まりです。</p></div>
        <div className="segmented-control" role="group" aria-label="集計単位">
          {(Object.keys(granularityLabels) as DashboardGranularity[]).map((key) => <button key={key} className={granularity === key ? 'active' : ''} onClick={() => setGranularity(key)}>{granularityLabels[key]}</button>)}
        </div>
      </div>
      <PeriodChart series={periods} />
      <div className="period-table-wrap"><table className="history-table compact-table"><thead><tr><th>期間</th><th>監査</th><th>最多の主状態</th><th>平均主状態確率（モデル内）</th><th>平均質問数</th></tr></thead><tbody>
        {periods.filter((item) => item.count > 0).slice().reverse().map((item) => <tr key={item.key}><td>{item.label}</td><td>{item.count}</td><td>{item.topStateLabel}{item.topStateCount ? ` (${item.topStateCount})` : ''}</td><td>{percent(item.averageProbability)}</td><td>{oneDecimal(item.averageQuestions)}</td></tr>)}
      </tbody></table></div>
    </Panel>

    <div className="dashboard-grid">
      <Panel><h2>主状態の出現構成</h2><p className="muted">全履歴における主状態の回数。行動ルーティングに実際に使用された状態です。</p><BarList items={primary.slice(0, 12)} /></Panel>
      <Panel><h2>副状態の出現構成</h2><p className="muted">副状態は解釈補助であり、行動指示には使用されません。</p><BarList items={secondary.slice(0, 12)} empty="副状態として記録されたデータがありません。" /></Panel>
    </div>

    <Panel>
      <h2>自分自身の傾向</h2>
      <div className="tendency-grid">
        <article><span>最頻主状態</span><strong>{summary.mostCommon?.label ?? '—'}</strong><p>{summary.mostCommon ? `${summary.mostCommon.count}回 / 全監査の${percent(summary.mostCommon.share)}` : 'データなし'}</p></article>
        <article><span>最頻副状態</span><strong>{summary.mostCommonSecondary?.label ?? '—'}</strong><p>{summary.mostCommonSecondary ? `${summary.mostCommonSecondary.count}回 / 副状態記録の${percent(summary.mostCommonSecondary.share)}` : '副状態データなし'}</p></article>
        <article><span>同一主状態の連続率</span><strong>{percent(summary.repeatRate)}</strong><p>連続する監査で同じ主状態だった割合。状態の固定性そのものを意味しません。</p></article>
        <article><span>高信頼度判定率</span><strong>{percent(summary.highConfidenceRate)}</strong><p>監査アルゴリズムが「高」とした判定の割合です。</p></article>
      </div>
      <Notice tone="info">{trendSentence(changes, current30, previous30)}</Notice>
    </Panel>

    <div className="dashboard-grid">
      <Panel><h2>状態遷移</h2><p className="muted">ある監査から次の監査へ、主状態がどう移ったかを集計します。時間間隔の長短は区別しません。</p>
        {transitions.length ? <div className="transition-list">{transitions.slice(0, 10).map((item) => <div key={`${item.from}-${item.to}`}><span>{item.from}</span><b>→</b><span>{item.to}</span><strong>{item.count}回</strong></div>)}</div> : <p className="muted">遷移を計算するには2件以上の監査が必要です。</p>}
      </Panel>
      <Panel><h2>最近の監査</h2><div className="period-table-wrap"><table className="history-table"><thead><tr><th>日時</th><th>主状態</th><th>副状態</th><th>主状態確率</th><th>質問</th></tr></thead><tbody>
        {ordered.slice(0, 12).map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td>{entry.status === 'held' ? '判定保留' : entry.status === 'provisional' ? `暫定: ${entry.primaryStateLabel || model.states.find((s) => s.id === entry.primaryStateId)?.label || entry.primaryStateId}` : entry.primaryStateLabel || model.states.find((s) => s.id === entry.primaryStateId)?.label || entry.primaryStateId}</td><td>{entry.status === 'held' || entry.status === 'provisional' ? '—' : entry.secondaryStateLabel || (entry.secondaryStateId ? model.states.find((s) => s.id === entry.secondaryStateId)?.label || entry.secondaryStateId : '—')}</td><td>{percent(entry.probability)}</td><td>{entry.answers.length}</td></tr>)}
      </tbody></table></div></Panel>
    </div>

    <Notice tone="warn">このダッシュボードは履歴の記述的集計です。頻度や変化から医学的診断・人格評価・原因推定は行いません。また、過去履歴は現在の状態監査アルゴリズムへ自動フィードバックしません。</Notice>
  </div>;
}
