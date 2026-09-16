import React, { useEffect, useRef, useState } from 'react';
import { Button, Modal, Notice, Panel } from './components/Common';
import { DetailedForm, FreeWillReview, QuickForm } from './components/FreeWillForms';
import { AuditRunner, PolicyView } from './components/Taiseihoukan';
import { AdviceView } from './components/AdviceView';
import { AuditDashboard } from './components/AuditDashboard';
import { loadAppState, saveAppState } from '../adapter/storage';
import { exportBackupZip, exportFreeWillZip, exportMemoryTaiseihoukanRequestZip, importBackupZip, importFreeWillZip, importTaiseihoukanZip } from './lib/zip';
import type { AppState, AuditHistoryEntry, FreeWillData, TaiseihoukanData } from './types';

function newFreeWill(): FreeWillData {
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0.0', mode: 'quick', createdAt: now, updatedAt: now,
    profile: {}, lifeHistory: {},
    psychometrics: { questionSetVersion: '1.0.0', responses: {}, consistency: 'insufficient', scores: {} },
    preferences: {}, goals: {}, constraints: {},
    sources: { urls: [], documents: [] },
    meta: { completedSections: [], skippedSections: [] },
  };
}

const defaultState: AppState = { initialized: false, freeWill: newFreeWill(), taiseihoukan: null, taiseihoukanArchive: null, auditHistory: [] };

function LauncherButton() {
  return <button className="button button-quiet launcher-button" type="button" onClick={() => { window.location.href = '/'; }}>ランチャーに戻る</button>;
}

function stripLegacyObjections(value: TaiseihoukanData | (TaiseihoukanData & { objections?: unknown[] }) | null): TaiseihoukanData | null {
  if (!value) return null;
  return { manifest: value.manifest, policy: value.policy, personalModel: value.personalModel, auditModel: value.auditModel, analysis: value.analysis };
}


function snapshotHistoryLabels(history: AuditHistoryEntry[], taiseihoukan: TaiseihoukanData | null): AuditHistoryEntry[] {
  if (!taiseihoukan) return history;
  const labels = new Map(taiseihoukan.auditModel.states.map((state) => [state.id, state.label]));
  const revision = String(taiseihoukan.manifest.createdAt ?? taiseihoukan.manifest.schemaVersion ?? 'unknown');
  return history.map((entry) => ({
    ...entry,
    primaryStateLabel: entry.primaryStateLabel || labels.get(entry.primaryStateId),
    secondaryStateLabel: entry.secondaryStateLabel || (entry.secondaryStateId ? labels.get(entry.secondaryStateId) : undefined),
    taiseihoukanRevision: entry.taiseihoukanRevision || revision,
  }));
}

function migrateStoredState(stored: AppState): AppState {
  const raw = stored as AppState & { taiseihoukan?: (TaiseihoukanData & { objections?: unknown[] }) | null };
  const taiseihoukan = stripLegacyObjections(raw.taiseihoukan ?? null);
  const auditHistory = snapshotHistoryLabels(Array.isArray(raw.auditHistory) ? raw.auditHistory : [], taiseihoukan);
  return {
    initialized: Boolean(raw.initialized),
    freeWill: raw.freeWill ?? newFreeWill(),
    taiseihoukan,
    taiseihoukanArchive: raw.taiseihoukanArchive ?? null,
    auditHistory,
  };
}

type Area = 'freewill' | 'taisei';
type FreeRoute = 'home' | 'quick' | 'detailed' | 'review';
type TaiseiRoute = 'home' | 'policy' | 'advice' | 'audit' | 'history';
type ExportKind = 'free' | 'memory' | 'backup';

export default function App() {
  const [state, setState] = useState<AppState>(defaultState);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [area, setArea] = useState<Area>('freewill');
  const [freeRoute, setFreeRoute] = useState<FreeRoute>('home');
  const [taiseiRoute, setTaiseiRoute] = useState<TaiseiRoute>('home');
  const [exportKind, setExportKind] = useState<ExportKind | null>(null);
  const [resetFreeWillOpen, setResetFreeWillOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'warn' | 'error'; text: string } | null>(null);
  const freeInputRef = useRef<HTMLInputElement>(null);
  const taiseiInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadAppState().then((stored) => {
      if (stored) {
        const migrated = migrateStoredState(stored);
        setState(migrated);
        if (migrated.taiseihoukan) setArea('taisei');
      }
    }).catch(() => setMessage({ tone: 'error', text: 'ブラウザ保存データの読み込みに失敗しました。' })).finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    setSaveStatus('saving');
    const id = window.setTimeout(() => {
      saveAppState(state).then(() => setSaveStatus('saved')).catch(() => setSaveStatus('error'));
    }, 450);
    return () => window.clearTimeout(id);
  }, [state, loaded]);

  const updateFreeWill = (freeWill: FreeWillData) => setState((s) => ({ ...s, initialized: true, freeWill }));

  const onFreeImport = async (file: File) => {
    try {
      const data = await importFreeWillZip(file);
      const yes = window.confirm('既存の自由意志データを置き換えます。続行しますか？');
      if (!yes) return;
      setState((s) => ({ ...s, initialized: true, freeWill: data }));
      setArea('freewill'); setFreeRoute('review');
      setMessage({ tone: 'info', text: '自由意志ZIPを読み込みました。' });
    } catch (e) { setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'ZIPの読み込みに失敗しました。' }); }
  };

  const onTaiseiImport = async (file: File) => {
    try {
      const { data, warnings, archive } = await importTaiseihoukanZip(file);
      const yes = state.taiseihoukan
        ? window.confirm('現在の大政奉還を置き換えます。既存の状態監査履歴は履歴データとして保持します。続行しますか？')
        : true;
      if (!yes) return;
      setState((s) => ({ ...s, initialized: true, taiseihoukan: data, taiseihoukanArchive: archive, auditHistory: snapshotHistoryLabels(s.auditHistory, s.taiseihoukan) }));
      setArea('taisei'); setTaiseiRoute('policy');
      const base = state.auditHistory.length
        ? `大政奉還ZIPを読み込みました。監査履歴 ${state.auditHistory.length} 件は保持しました。`
        : '大政奉還ZIPを読み込みました。';
      setMessage({ tone: warnings.length ? 'warn' : 'info', text: warnings.length ? `${base} 警告: ${warnings.join(' / ')}` : base });
    } catch (e) { setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'ZIPの読み込みに失敗しました。' }); }
  };

  const onBackupImport = async (file: File) => {
    try {
      const { data, auditHistory, archive, warnings } = await importBackupZip(file);
      const yes = window.confirm(`バックアップから現在の大政奉還と状態監査履歴 ${auditHistory.length} 件を復元します。現在の大政奉還・監査履歴は置き換えられます。続行しますか？`);
      if (!yes) return;
      setState((s) => ({ ...s, initialized: true, taiseihoukan: data, taiseihoukanArchive: archive, auditHistory: snapshotHistoryLabels(auditHistory, data) }));
      setArea('taisei'); setTaiseiRoute('history');
      const base = `バックアップを読み込みました。大政奉還と監査履歴 ${auditHistory.length} 件を復元しました。`;
      setMessage({ tone: warnings.length ? 'warn' : 'info', text: warnings.length ? `${base} 警告: ${warnings.join(' / ')}` : base });
    } catch (e) { setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'バックアップZIPの読み込みに失敗しました。' }); }
  };

  const doExport = async () => {
    try {
      if (exportKind === 'free') await exportFreeWillZip(state.freeWill);
      if (exportKind === 'memory') await exportMemoryTaiseihoukanRequestZip();
      if (exportKind === 'backup') await exportBackupZip(state);
      setExportKind(null);
    } catch (e) { setMessage({ tone: 'error', text: e instanceof Error ? e.message : '書き出しに失敗しました。' }); setExportKind(null); }
  };

  const addAuditHistory = (entry: AuditHistoryEntry) => setState((s) => ({ ...s, auditHistory: [...s.auditHistory, entry] }));

  const resetFreeWill = () => {
    setState((s) => ({ ...s, initialized: true, freeWill: newFreeWill() }));
    setFreeRoute('home');
    setResetFreeWillOpen(false);
    setMessage({ tone: 'info', text: '自由意志の記入内容をリセットしました。大政奉還データは変更していません。' });
  };


  const exportMemoryFromOnboarding = async () => {
    const ok = window.confirm('このZIPには現在のフォーム入力を含めません。ChatGPTが利用可能なMemory・会話文脈だけを情報源として大政奉還を依頼します。書き出しますか？');
    if (!ok) return;
    try { await exportMemoryTaiseihoukanRequestZip(); }
    catch (e) { setMessage({ tone: 'error', text: e instanceof Error ? e.message : '書き出しに失敗しました。' }); }
  };

  const footerSave = saveStatus === 'saving' ? '保存中' : saveStatus === 'saved' ? '保存済み' : saveStatus === 'error' ? '保存エラー' : '';

  if (!loaded) return <div className="loading-screen">ローカルデータを確認中</div>;

  if (!state.initialized && !state.taiseihoukan) {
    return <div className="onboarding-shell">
      <div className="onboarding-launcher"><LauncherButton /></div>
      <main className="onboarding-card">
        <p className="eyebrow">STATIC SELF-GOVERNANCE INTERFACE</p>
        <h1>自由意志大政奉還</h1>
        <p>入力内容はこのブラウザ内に保存されます。AI推論はこのWebアプリ内では実行しません。</p>
        <div className="onboarding-actions">
          <Button variant="primary" onClick={() => { setState((s) => ({ ...s, initialized: true })); setFreeRoute('quick'); }}>自分で自由意志を入力する</Button>
          <Button onClick={exportMemoryFromOnboarding}>ChatGPT Memoryから大政奉還する</Button>
          <Button onClick={() => freeInputRef.current?.click()}>自由意志を読み込む</Button>
          <Button onClick={() => taiseiInputRef.current?.click()}>大政奉還を読み込む</Button>
          <Button onClick={() => backupInputRef.current?.click()}>バックアップを読み込む</Button>
        </div>
        <p className="privacy-note">このサイトは入力内容を外部サーバへ自動送信しません。ChatGPTへ送信する場合は、書き出したZIPを利用者自身がアップロードしてください。</p>
      </main>
      <input ref={freeInputRef} hidden type="file" accept=".zip,application/zip" onChange={(e) => e.target.files?.[0] && onFreeImport(e.target.files[0])} />
      <input ref={taiseiInputRef} hidden type="file" accept=".zip,application/zip" onChange={(e) => e.target.files?.[0] && onTaiseiImport(e.target.files[0])} />
      <input ref={backupInputRef} hidden type="file" accept=".zip,application/zip" onChange={(e) => e.target.files?.[0] && onBackupImport(e.target.files[0])} />
    </div>;
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand" onClick={() => area === 'freewill' ? setFreeRoute('home') : setTaiseiRoute('home')} role="button" tabIndex={0}><span>自由意志</span><strong>大政奉還</strong></div>
      <nav className="top-tabs" aria-label="トップレベルメニュー">
        <button className={area === 'freewill' ? 'active' : ''} onClick={() => setArea('freewill')}>自由意志</button>
        <button className={area === 'taisei' ? 'active' : ''} onClick={() => setArea('taisei')}>大政奉還</button>
      </nav>
      <div className={`save-indicator ${saveStatus}`}>{footerSave}</div>
      <LauncherButton />
    </header>

    <div className="workspace">
      <aside className="sidebar">
        {area === 'freewill' ? <>
          <p className="sidebar-label">自由意志</p>
          <button className={freeRoute === 'quick' ? 'active' : ''} onClick={() => setFreeRoute('quick')}>簡易入力</button>
          <button className={freeRoute === 'detailed' ? 'active' : ''} onClick={() => setFreeRoute('detailed')}>詳細入力</button>
          <button className={freeRoute === 'review' ? 'active' : ''} onClick={() => setFreeRoute('review')}>入力内容確認</button>
          <hr />
          <button onClick={() => freeInputRef.current?.click()}>自由意志を読み込む</button>
          <button onClick={() => setExportKind('free')}>自由意志を書き出す</button>
          <button onClick={() => setExportKind('memory')}>ChatGPT Memoryから大政奉還する</button>
          <button className="danger-link" onClick={() => setResetFreeWillOpen(true)}>記入内容をリセット</button>
        </> : <>
          <p className="sidebar-label">大政奉還</p>
          <button className={taiseiRoute === 'policy' ? 'active' : ''} onClick={() => setTaiseiRoute('policy')} disabled={!state.taiseihoukan}>基本方針</button>
          <button className={taiseiRoute === 'advice' ? 'active' : ''} onClick={() => setTaiseiRoute('advice')} disabled={!state.taiseihoukan}>行動規範</button>
          <button className={taiseiRoute === 'audit' ? 'active' : ''} onClick={() => setTaiseiRoute('audit')} disabled={!state.taiseihoukan}>状態監査</button>
          <button className={taiseiRoute === 'history' ? 'active' : ''} onClick={() => setTaiseiRoute('history')} disabled={!state.taiseihoukan}>監査履歴</button>
          <hr />
          <button onClick={() => taiseiInputRef.current?.click()}>大政奉還を読み込む</button>
          <button onClick={() => backupInputRef.current?.click()}>バックアップを読み込む</button>
          <button onClick={() => setExportKind('backup')} disabled={!state.taiseihoukan}>バックアップを書き出す</button>
        </>}
      </aside>

      <main className="content">
        {area === 'freewill' ? <nav className="mobile-route-nav" aria-label="自由意志モバイルメニュー">
          <button onClick={() => setFreeRoute('home')}>トップ</button><button onClick={() => setFreeRoute('quick')}>簡易</button><button onClick={() => setFreeRoute('detailed')}>詳細</button><button onClick={() => setFreeRoute('review')}>確認</button><button onClick={() => freeInputRef.current?.click()}>読込</button><button onClick={() => setExportKind('free')}>書出</button>
        </nav> : <nav className="mobile-route-nav compact" aria-label="大政奉還モバイル管理">
          <button onClick={() => setTaiseiRoute('home')}>トップ</button><button onClick={() => taiseiInputRef.current?.click()}>大政奉還読込</button><button onClick={() => backupInputRef.current?.click()}>復元</button><button disabled={!state.taiseihoukan} onClick={() => setExportKind('backup')}>バックアップ</button>
        </nav>}
        {message && <Notice tone={message.tone}>{message.text}<button className="notice-close" aria-label="閉じる" onClick={() => setMessage(null)}>×</button></Notice>}
        {area === 'freewill' && <FreeWillArea route={freeRoute} setRoute={setFreeRoute} data={state.freeWill} onChange={updateFreeWill} onImport={() => freeInputRef.current?.click()} onExport={() => setExportKind('free')} onMemory={() => setExportKind('memory')} onReset={() => setResetFreeWillOpen(true)} />}
        {area === 'taisei' && <TaiseiArea route={taiseiRoute} setRoute={setTaiseiRoute} state={state} onImport={() => taiseiInputRef.current?.click()} onBackupImport={() => backupInputRef.current?.click()} onBackupExport={() => setExportKind('backup')} onAuditComplete={addAuditHistory} onGoFreeWill={() => { setArea('freewill'); setFreeRoute('quick'); }} />}
      </main>
    </div>

    {state.taiseihoukan && <nav className="mobile-bottom-nav" aria-label="大政奉還モバイルナビ">
      <button className={area === 'taisei' && taiseiRoute === 'policy' ? 'active' : ''} onClick={() => { setArea('taisei'); setTaiseiRoute('policy'); }}>基本方針</button>
      <button className={area === 'taisei' && taiseiRoute === 'advice' ? 'active' : ''} onClick={() => { setArea('taisei'); setTaiseiRoute('advice'); }}>行動規範</button>
      <button className={area === 'taisei' && taiseiRoute === 'audit' ? 'active' : ''} onClick={() => { setArea('taisei'); setTaiseiRoute('audit'); }}>状態監査</button>
      <button className={area === 'taisei' && taiseiRoute === 'history' ? 'active' : ''} onClick={() => { setArea('taisei'); setTaiseiRoute('history'); }}>監査履歴</button>
    </nav>}

    <input ref={freeInputRef} hidden type="file" accept=".zip,application/zip" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ''; if (f) onFreeImport(f); }} />
    <input ref={taiseiInputRef} hidden type="file" accept=".zip,application/zip" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ''; if (f) onTaiseiImport(f); }} />
    <input ref={backupInputRef} hidden type="file" accept=".zip,application/zip" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ''; if (f) onBackupImport(f); }} />

    {exportKind && <Modal title="書き出し確認" onClose={() => setExportKind(null)} footer={<><Button onClick={() => setExportKind(null)}>キャンセル</Button><Button variant="primary" onClick={doExport}>書き出す</Button></>}>
      {exportKind === 'memory' ? <>
        <p>このZIPには現在のフォーム入力・free-will.jsonを含めません。</p>
        <Notice tone="warn">ChatGPTが利用可能なMemory・会話文脈だけを情報源として自由意志を構成し、そのまま大政奉還を行うための依頼ZIPです。サイト自身がChatGPT Memoryへアクセスすることはありません。</Notice>
      </> : exportKind === 'backup' ? <>
        <p>現在の大政奉還と状態監査履歴を、別端末へ移行できるバックアップZIPとして書き出します。</p>
        <Notice tone="info">大政奉還そのものは変更しません。自由意志フォームはバックアップに含めません。</Notice>
      </> : <p>このファイルには入力した個人情報・自分史・心理測定結果が含まれる可能性があります。</p>}
    </Modal>}

    {resetFreeWillOpen && <Modal title="自由意志の記入内容をリセット" onClose={() => setResetFreeWillOpen(false)} footer={<><Button onClick={() => setResetFreeWillOpen(false)}>キャンセル</Button><Button variant="danger" onClick={resetFreeWill}>リセットする</Button></>}>
      <p>簡易入力・詳細入力・心理測定回答・完了状態をすべて空に戻します。この操作は自動保存されます。</p>
      <Notice tone="warn">読み込み済みの大政奉還データと状態監査履歴は削除しません。</Notice>
    </Modal>}

  </div>;
}

function FreeWillArea({ route, setRoute, data, onChange, onImport, onExport, onMemory, onReset }: { route: FreeRoute; setRoute: (r: FreeRoute) => void; data: FreeWillData; onChange: (d: FreeWillData) => void; onImport: () => void; onExport: () => void; onMemory: () => void; onReset: () => void }) {
  if (route === 'quick') return <QuickForm data={data} onChange={onChange} />;
  if (route === 'detailed') return <DetailedForm data={data} onChange={onChange} />;
  if (route === 'review') return <FreeWillReview data={data} />;
  return <div className="stack-lg">
    <Panel><p className="eyebrow">自由意志</p><h1>自由意志の取得方法</h1><p>手入力とChatGPT Memoryは独立した2つの経路です。Memory経路に現在のフォーム入力は混合しません。</p></Panel>
    <div className="dashboard-grid">
      <Panel><h3>方法A：自分で入力する</h3><p>簡易入力または詳細入力から自由意志データを作成します。両者は同一スキーマで、途中でもZIPを書き出せます。</p><div className="action-row"><Button variant="primary" onClick={() => setRoute('quick')}>簡易入力</Button><Button onClick={() => setRoute('detailed')}>詳細入力</Button><Button onClick={() => setRoute('review')}>入力内容確認</Button></div><div className="action-row"><Button onClick={onImport}>自由意志を読み込む</Button><Button onClick={onExport}>自由意志を書き出す</Button><Button variant="danger" onClick={onReset}>記入内容をリセット</Button></div></Panel>
      <Panel><h3>方法B：ChatGPT Memoryから大政奉還する</h3><p>サイト内の記入内容を使わず、ChatGPTが利用可能なMemory・会話文脈だけから自由意志を構成し、そのまま大政奉還ZIPを生成させる依頼ZIPを書き出します。</p><Notice tone="info">この経路では free-will.json をサイトから同梱しません。手入力データとの混合は行いません。</Notice><div className="action-row"><Button onClick={onMemory}>ChatGPT Memoryから大政奉還する</Button></div></Panel>
    </div>
  </div>;
}

function TaiseiArea({ route, setRoute, state, onImport, onBackupImport, onBackupExport, onAuditComplete, onGoFreeWill }: { route: TaiseiRoute; setRoute: (r: TaiseiRoute) => void; state: AppState; onImport: () => void; onBackupImport: () => void; onBackupExport: () => void; onAuditComplete: (e: AuditHistoryEntry) => void; onGoFreeWill: () => void }) {
  const data = state.taiseihoukan;
  if (!data) return <div className="stack-lg">
    <Panel><p className="eyebrow">大政奉還</p><h1>分析結果を読み込む</h1><p>ChatGPT等の外部分析で生成した taiseihoukan.zip を読み込むか、別端末で書き出したバックアップZIPを復元してください。</p><div className="action-row"><Button variant="primary" onClick={onImport}>大政奉還を読み込む</Button><Button onClick={onBackupImport}>バックアップを読み込む</Button></div></Panel>
  </div>;
  if (route === 'policy') return <PolicyView data={data} />;
  if (route === 'advice') return <AdviceView advice={data.policy.advice} />;
  if (route === 'audit') return <AuditRunner data={data} onComplete={onAuditComplete} />;
  if (route === 'history') return <AuditDashboard history={state.auditHistory} model={data.auditModel} />;
  const lastAudit = [...state.auditHistory].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  return <div className="stack-lg">
    <Panel><p className="eyebrow">大政奉還</p><h1>基本方針</h1><p className="lead">現在の長期目標：{data.policy.longTermGoal}</p><div className="action-row"><Button variant="primary" onClick={() => setRoute('audit')}>状態監査を開始</Button><Button onClick={() => setRoute('advice')}>行動規範</Button><Button onClick={() => setRoute('history')}>監査履歴</Button></div></Panel>
    <div className="dashboard-grid">
      <Panel><h3>状態監査履歴</h3><strong className="large-number">{state.auditHistory.length}</strong><p>{lastAudit ? `最終監査: ${new Date(lastAudit.createdAt).toLocaleString('ja-JP')}` : 'まだ監査履歴はありません。'}</p><div className="action-row"><Button variant="primary" onClick={() => setRoute('history')}>ダッシュボードを開く</Button></div></Panel>
      <Panel><h3>ポータブルバックアップ</h3><p>現在の大政奉還と監査履歴を1つのZIPに保存します。大政奉還本体は読み取り専用で、サイト側から追記・変更しません。</p><div className="action-row"><Button variant="primary" onClick={onBackupExport}>バックアップを書き出す</Button><Button onClick={onBackupImport}>バックアップを読み込む</Button></div></Panel>
      <Panel><h3>方針を更新する</h3><p>方針を更新する場合は、自由意志側で新しい事実・資料・URLを追加して、自由意志ZIPから再生成します。</p><div className="action-row"><Button onClick={onGoFreeWill}>自由意志を更新</Button></div></Panel>
    </div>
  </div>;
}
