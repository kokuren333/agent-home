import React, { useState } from 'react';
import { detailSections } from '../data/detailSections';
import type { FreeWillData } from '../types';
import { Button, Modal, Panel, ProgressBar } from './Common';
import PsychForm from './PsychForm';
import { ReferenceSourcesForm } from './ReferenceSourcesForm';

const quickFields = {
  profile: [
    ['age', '年齢'], ['living_status', '現在の生活状況'], ['occupation', '職業・所属'], ['domain', '主な専門領域'],
    ['available_time', '現在利用可能な時間'], ['economic_constraints', '経済的制約'], ['geographic_constraints', '居住・移動上の制約'],
  ],
  current: [
    ['situation', '現在の状況を説明してください'], ['biggest_problem', '現在最も大きい問題は何ですか'], ['current_work', '現在取り組んでいることは何ですか'],
  ],
  preferences: [
    ['achieve', '達成したいこと'], ['try_once', '一度はやってみたいこと'], ['avoid', '避けたい状態'], ['maintain', '維持したい生活条件'], ['not_lose', '失いたくないもの'],
  ],
} as const;

function InputAssist({ theme }: { theme: string }) {
  const [open, setOpen] = useState(false);
  const prompt = `以下のテーマについて自分史を書きたいです。私に一問ずつ質問し、回答を整理してください。勝手な推測はせず、不明な点は確認してください。最後に、このフォームへ貼り付けられる文章として整理してください。\n\nテーマ: ${theme}`;
  return <>
    <Button variant="quiet" type="button" onClick={() => setOpen(true)}>入力を補助する</Button>
    {open && <Modal title="ChatGPT貼り付け用プロンプト" onClose={() => setOpen(false)} footer={<Button variant="primary" onClick={() => navigator.clipboard.writeText(prompt)}>コピー</Button>}>
      <pre className="prompt-box">{prompt}</pre>
      <p className="muted">このサイトからChatGPTへ自動送信はしません。</p>
    </Modal>}
  </>;
}

function TextField({ label, value, onChange, compact = false, allowUnknown = false }: { label: string; value: string; onChange: (v: string) => void; compact?: boolean; allowUnknown?: boolean }) {
  return <div className="field">
    <div className="field-head"><label>{label}</label><div className="field-actions">{allowUnknown && <Button variant="quiet" type="button" onClick={() => onChange('不明')}>不明</Button>}<Button variant="quiet" type="button" onClick={() => onChange('回答しない')}>回答しない</Button>{!compact && <InputAssist theme={label} />}</div></div>
    {compact ? <input value={value} onChange={(e) => onChange(e.target.value)} /> : <textarea rows={4} value={value} onChange={(e) => onChange(e.target.value)} />}
  </div>;
}

export function QuickForm({ data, onChange }: { data: FreeWillData; onChange: (d: FreeWillData) => void }) {
  const setProfile = (key: string, value: string) => onChange({ ...data, mode: 'quick', updatedAt: new Date().toISOString(), profile: { ...data.profile, [key]: value } });
  const current = data.lifeHistory.current ?? {};
  const setCurrent = (key: string, value: string) => onChange({ ...data, mode: 'quick', updatedAt: new Date().toISOString(), lifeHistory: { ...data.lifeHistory, current: { ...current, [key]: value } } });
  const setPref = (key: string, value: string) => onChange({ ...data, mode: 'quick', updatedAt: new Date().toISOString(), preferences: { ...data.preferences, [key]: value } });
  return <div className="stack-lg">
    <Panel><div className="section-heading"><div><h2>簡易入力</h2><p>目安約10分。詳細入力と同一データ構造を使用します。センシティブ情報は任意です。</p></div><span className="status-chip">自動保存</span></div></Panel>
    <Panel><h3>基本情報</h3>{quickFields.profile.map(([key, label]) => <TextField key={key} label={label} compact value={data.profile[key] ?? ''} onChange={(v) => setProfile(key, v)} />)}</Panel>
    <Panel><h3>現状</h3>{quickFields.current.map(([key, label]) => <TextField key={key} label={label} value={current[key] ?? ''} onChange={(v) => setCurrent(key, v)} />)}</Panel>
    <Panel><h3>希望</h3>{quickFields.preferences.map(([key, label]) => <TextField key={key} label={label} value={data.preferences[key] ?? ''} onChange={(v) => setPref(key, v)} />)}</Panel>
    <PsychForm mode="quick" data={data} onChange={onChange} />
    <ReferenceSourcesForm data={data} onChange={onChange} />
  </div>;
}

export function DetailedForm({ data, onChange }: { data: FreeWillData; onChange: (d: FreeWillData) => void }) {
  const [active, setActive] = useState(detailSections[0].id);
  const [showPsych, setShowPsych] = useState(false);
  const section = detailSections.find((s) => s.id === active)!;
  const sectionData = section.id === 'basic' ? data.profile : section.id === 'goals' ? data.goals : section.id === 'maintenance' ? data.preferences : section.id === 'avoid' ? data.constraints : (data.lifeHistory[section.id] ?? {});
  const completeCount = data.meta.completedSections.filter((id) => detailSections.some((s) => s.id === id)).length;

  const setField = (fieldId: string, value: string) => {
    const common = { ...data, mode: 'detailed' as const, updatedAt: new Date().toISOString() };
    if (section.id === 'basic') return onChange({ ...common, profile: { ...data.profile, [fieldId]: value } });
    if (section.id === 'goals') return onChange({ ...common, goals: { ...data.goals, [fieldId]: value } });
    if (section.id === 'maintenance') return onChange({ ...common, preferences: { ...data.preferences, [fieldId]: value } });
    if (section.id === 'avoid') return onChange({ ...common, constraints: { ...data.constraints, [fieldId]: value } });
    onChange({ ...common, lifeHistory: { ...data.lifeHistory, [section.id]: { ...sectionData, [fieldId]: value } } });
  };
  const toggleCompleted = () => {
    const set = new Set(data.meta.completedSections);
    set.has(section.id) ? set.delete(section.id) : set.add(section.id);
    onChange({ ...data, mode: 'detailed', updatedAt: new Date().toISOString(), meta: { ...data.meta, completedSections: [...set] } });
  };
  const toggleSkipped = () => {
    const set = new Set(data.meta.skippedSections);
    if (set.has(section.id)) set.delete(section.id); else set.add(section.id);
    onChange({ ...data, mode: 'detailed', updatedAt: new Date().toISOString(), meta: { ...data.meta, skippedSections: [...set] } });
  };

  return <div className="stack-lg">
    <Panel>
      <div className="section-heading"><div><h2>詳細入力</h2><p>60〜90分程度を想定。時間制限はありません。閉じても再開できます。</p></div><span className="status-chip">途中保存</span></div>
      <ProgressBar value={completeCount} max={14} label={`${completeCount} / 14 セクション完了`} />
    </Panel>
    <div className="detail-layout">
      <aside className="detail-nav" aria-label="詳細入力セクション">
        {detailSections.map((s, i) => <button key={s.id} className={`${active === s.id && !showPsych ? 'active' : ''} ${data.meta.completedSections.includes(s.id) ? 'complete' : ''}`} onClick={() => { setActive(s.id); setShowPsych(false); }}><span>{String(i + 1).padStart(2, '0')}</span>{s.title}</button>)}
        <button className={showPsych ? 'active' : ''} onClick={() => setShowPsych(true)}><span>15</span>心理測定</button>
      </aside>
      <main className="detail-main">
        {showPsych ? <PsychForm mode="detailed" data={data} onChange={onChange} /> : <Panel>
          <div className="section-heading"><div><p className="eyebrow">SECTION {String(detailSections.indexOf(section) + 1).padStart(2, '0')}</p><h2>{section.title}</h2>{section.description && <p>{section.description}</p>}</div></div>
          <div className="form-stack">{section.fields.map((f) => <TextField key={f.id} label={f.label} compact={f.compact} allowUnknown={f.allowUnknown} value={sectionData[f.id] ?? ''} onChange={(v) => setField(f.id, v)} />)}</div>
          <div className="section-footer">
            <label className="checkline"><input type="checkbox" checked={data.meta.skippedSections.includes(section.id)} onChange={toggleSkipped} />このセクションは回答しない</label>
            <Button variant={data.meta.completedSections.includes(section.id) ? 'default' : 'primary'} onClick={toggleCompleted}>{data.meta.completedSections.includes(section.id) ? '完了を解除' : 'セクション完了'}</Button>
          </div>
        </Panel>}
      </main>
    </div>
    <ReferenceSourcesForm data={data} onChange={onChange} />
  </div>;
}

export function FreeWillReview({ data }: { data: FreeWillData }) {
  const answered = Object.values(data.psychometrics.responses).filter((v) => typeof v === 'number').length;
  return <div className="stack-lg">
    <Panel><h2>入力内容確認</h2><div className="stats-grid"><div><strong>{data.mode}</strong><span>入力モード</span></div><div><strong>{data.meta.completedSections.length}/14</strong><span>完了セクション</span></div><div><strong>{answered}</strong><span>心理回答数</span></div><div><strong>{data.psychometrics.consistency}</strong><span>回答一貫性</span></div></div></Panel>
    <Panel><h3>free-will.json プレビュー</h3><pre className="json-preview">{JSON.stringify(data, null, 2)}</pre></Panel>
  </div>;
}
