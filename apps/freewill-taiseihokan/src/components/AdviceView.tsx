import { useEffect, useRef } from 'react';
import mermaid from 'mermaid';
import type { AdviceFlowNode, AdviceRule } from '../types';
import { Notice, Panel } from './Common';

let mermaidReady = false;

function safeId(value: string) {
  return `n_${value.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function escapeLabel(value: string) {
  return value.replace(/"/g, '&quot;').replace(/[<>]/g, '');
}

function toMermaid(rule: AdviceRule) {
  const flow = rule.flowchart;
  if (!flow?.nodes.length) return '';
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const lines = ['flowchart TD'];
  for (const node of flow.nodes) {
    const shape = node.type === 'question' ? `{${escapeLabel(node.label)}}` : `[${escapeLabel(node.label)}]`;
    lines.push(`  ${safeId(node.id)}${shape}`);
  }
  for (const node of flow.nodes) {
    if (node.type !== 'question') continue;
    if (node.yes && byId.has(node.yes)) lines.push(`  ${safeId(node.id)} -->|はい| ${safeId(node.yes)}`);
    if (node.no && byId.has(node.no)) lines.push(`  ${safeId(node.id)} -->|いいえ| ${safeId(node.no)}`);
  }
  return lines.join('\n');
}

function Flowchart({ rule, index }: { rule: AdviceRule; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const source = toMermaid(rule);
  useEffect(() => {
    let cancelled = false;
    if (!source || !ref.current) return;
    if (!mermaidReady) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
      mermaidReady = true;
    }
    void mermaid.render(`advice-flow-${index}-${rule.id.replace(/[^a-zA-Z0-9_-]/g, '')}`, source).then(({ svg }) => {
      if (!cancelled && ref.current) ref.current.innerHTML = svg;
    }).catch(() => {
      if (!cancelled && ref.current) ref.current.textContent = source;
    });
    return () => { cancelled = true; };
  }, [index, rule.id, source]);
  return source ? <><h4>行動フロー</h4><div className="mermaid-flow" ref={ref} aria-label={`${rule.title}の行動フロー`} /></> : null;
}

export function AdviceView({ advice }: { advice?: AdviceRule[] }) {
  if (!advice?.length) return <Notice tone="info">この大政奉還データには恒久的な行動規範がまだ含まれていません。新しい自由意志ZIPから再生成してください。</Notice>;
  return <div className="stack-lg">
    <Panel><p className="eyebrow">大政奉還</p><h1>行動規範</h1><p>基本方針を日常の行動へ変換する恒久的な運用ルールです。状態監査の副状態は行動規範を自動上書きしません。</p></Panel>
    {advice.map((rule, index) => <Panel key={rule.id}><h2>{rule.title}</h2><p><strong>発動条件：</strong>{rule.trigger}</p><div className="advice-columns"><div><h3>優先する行動</h3><ul>{rule.actions.map((item, i) => <li key={i}>{item}</li>)}</ul></div><div><h3>避ける行動</h3><ul>{rule.avoidActions.map((item, i) => <li key={i}>{item}</li>)}</ul></div></div><h3>再評価条件</h3><ul>{rule.reevaluate.map((item, i) => <li key={i}>{item}</li>)}</ul><Flowchart rule={rule} index={index} /></Panel>)}
  </div>;
}
