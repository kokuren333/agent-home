const apps = document.querySelector('#apps');
const health = document.querySelector('#health');
const backendStatus = document.querySelector('#backend-status');
const settingsDialog = document.querySelector('#agent-settings-dialog');
const settingsForm = document.querySelector('#agent-settings-form');
const modelSelect = document.querySelector('#agent-model');
const customModelWrap = document.querySelector('#custom-model-wrap');
const customModel = document.querySelector('#custom-model');
const reasoningSelect = document.querySelector('#agent-reasoning');
const settingsStatus = document.querySelector('#agent-settings-status');
const reorderButton = document.querySelector('#toggle-reorder');
const appsOrderStatus = document.querySelector('#apps-order-status');
let currentCatalogModels = [];
let appList = [];
let reorderMode = false;

function escapeHtml(value) { return String(value).replace(/[&<>'\"]/g, (c) => ({ '&': '&#38;', '<': '&#60;', '>': '&#62;', "'": '&#39;', '"': '&#34;' }[c])); }
function setSettingsStatus(value = '') { settingsStatus.textContent = value; }
function showCustomModel() { customModelWrap.hidden = modelSelect.value !== 'custom'; }

async function getAgentSettings() {
  const response = await fetch('/api/settings/agent', { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'モデル設定を読み込めません');
  return data;
}

async function getAgentModels() {
  const response = await fetch('/api/settings/agent/models', { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'モデル一覧を読み込めません');
  return data;
}

function renderModelOptions(models, selectedModel) {
  modelSelect.replaceChildren();
  for (const model of models) {
    const option = new Option(model.name || model.id, model.id);
    modelSelect.add(option);
  }
  if (selectedModel && !models.some((model) => model.id === selectedModel)) {
    modelSelect.add(new Option(`${selectedModel}（保存済み）`, selectedModel));
  }
  modelSelect.add(new Option('CLIの既定設定を使う', ''));
  modelSelect.add(new Option('カスタム入力', 'custom'));
  modelSelect.value = selectedModel || '';
}

function renderReasoningOptions(models) {
  const selected = reasoningSelect.value;
  const selectedModel = models.find((model) => model.id === modelSelect.value);
  const efforts = selectedModel?.reasoningEfforts?.length
    ? selectedModel.reasoningEfforts
    : ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  reasoningSelect.replaceChildren(...efforts.map((effort) => new Option(effort, effort)));
  reasoningSelect.add(new Option('モデルの既定設定を使う', ''));
  reasoningSelect.value = efforts.includes(selected) ? selected : (selectedModel?.defaultReasoningEffort || 'low');
}

function renderBackendStatus(state) {
  const backend = state?.backend || {};
  const isCodex = backend.backend === 'codex-cli';
  const label = backend.ok ? (isCodex ? 'Codex CLI 接続済み' : 'Mock backend') : (isCodex ? 'Codex CLI 未接続' : 'Agent backend 未接続');
  backendStatus.className = `status backend-status ${backend.ok ? 'online' : 'offline'}`;
  backendStatus.title = backend.version || backend.reason || '';
  backendStatus.innerHTML = `<i></i>${escapeHtml(label)}`;
}

function renderApps(list = appList) {
  appList = list;
  if (!list.length) { apps.innerHTML = '<div class="empty">登録されているアプリはありません。</div>'; return; }
  if (!reorderMode) {
    apps.innerHTML = list.map((app) => `<a class="app-card" href="${escapeHtml(app.entry)}"><span class="app-icon">${String(app.icon || '').startsWith('/') ? `<img src="${escapeHtml(app.icon)}" alt="">` : escapeHtml(app.icon)}</span><span class="app-copy"><strong>${escapeHtml(app.name)}</strong><small>${escapeHtml(app.description)}</small></span><span class="arrow">›</span></a>`).join('');
    return;
  }
  apps.innerHTML = list.map((app, index) => `<article class="app-card app-card-reorder${app.hidden ? ' app-hidden' : ''}"><span class="app-order-number">${index + 1}</span><span class="app-icon">${String(app.icon || '').startsWith('/') ? `<img src="${escapeHtml(app.icon)}" alt="">` : escapeHtml(app.icon)}</span><span class="app-copy"><strong>${escapeHtml(app.name)}</strong><small>${escapeHtml(app.description)}</small></span><span class="app-order-controls"><button class="order-button" type="button" data-move-app="up" data-app-index="${index}" aria-label="${escapeHtml(app.name)}を上へ" ${index === 0 ? 'disabled' : ''}>↑</button><button class="order-button" type="button" data-move-app="down" data-app-index="${index}" aria-label="${escapeHtml(app.name)}を下へ" ${index === list.length - 1 ? 'disabled' : ''}>↓</button><button class="visibility-button" type="button" data-toggle-app="${escapeHtml(app.id)}">${app.hidden ? '表示する' : '非表示にする'}</button></span></article>`).join('');
}

function setReorderStatus(value = '') { appsOrderStatus.textContent = value; }

function moveApp(index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= appList.length) return;
  const next = [...appList]; [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  renderApps(next);
}

async function saveAppOrder() {
  reorderButton.disabled = true;
  setReorderStatus('並び順を保存しています…');
  try {
    const response = await fetch('/api/apps/order', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appIds: appList.map((app) => app.id) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || '並び順を保存できません');
    reorderMode = false;
    reorderButton.textContent = '並び替え・表示設定';
    setReorderStatus('並び順を保存しました');
    renderApps(appList.filter((app) => !app.hidden));
    setTimeout(() => { if (!reorderMode) setReorderStatus(''); }, 2200);
  } catch (error) {
    setReorderStatus(error.message);
  } finally { reorderButton.disabled = false; }
}

async function loadManagementApps() {
  const response = await fetch('/api/apps?includeHidden=true', { cache: 'no-store' });
  const list = await response.json();
  if (!response.ok) throw new Error(list?.error?.message || 'アプリ設定を読み込めません');
  return list;
}

async function saveAppVisibility() {
  const hiddenAppIds = appList.filter((app) => app.hidden).map((app) => app.id);
  const response = await fetch('/api/apps/visibility', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hiddenAppIds }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || '表示設定を保存できません');
}

async function toggleReorder() {
  if (reorderMode) { void saveAppOrder(); return; }
  try { appList = await loadManagementApps(); } catch (error) { setReorderStatus(error.message); return; }
  reorderMode = true;
  reorderButton.textContent = '設定を完了';
  setReorderStatus('上下ボタンで並び替え、表示する／非表示にするで設定できます');
  renderApps();
}

async function openAgentSettings() {
  // Open immediately so a slow or older Gateway still gives visible feedback.
  if (!settingsDialog.open) settingsDialog.showModal();
  setSettingsStatus('設定を読み込んでいます…');
  try {
    const [settings, catalog] = await Promise.all([getAgentSettings(), getAgentModels()]);
    currentCatalogModels = catalog.models || [];
    renderModelOptions(currentCatalogModels, settings.model);
    customModel.value = currentCatalogModels.some((model) => model.id === settings.model) ? '' : settings.model || '';
    reasoningSelect.value = settings.reasoningEffort || '';
    renderReasoningOptions(currentCatalogModels);
    showCustomModel();
    setSettingsStatus(catalog.error ? `モデル一覧を取得できません。カスタム入力は利用できます（${catalog.error.message}）` : '');
  } catch (error) { setSettingsStatus(error.message); }
}

async function saveAgentSettings(event) {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();
  const model = modelSelect.value === 'custom' ? customModel.value.trim() : modelSelect.value;
  if (modelSelect.value === 'custom' && !model) { setSettingsStatus('カスタムモデル名を入力してください'); return; }
  const button = event.submitter;
  button.disabled = true;
  setSettingsStatus('保存中…');
  try {
    const response = await fetch('/api/settings/agent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, reasoningEffort: reasoningSelect.value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'モデル設定を保存できません');
    settingsDialog.close('save');
    await load();
  } catch (error) { setSettingsStatus(error.message); }
  finally { button.disabled = false; }
}

async function load() {
  try {
    const [appResponse, healthResponse] = await Promise.all([fetch('/api/apps', { cache: 'no-store' }), fetch('/api/health', { cache: 'no-store' })]);
    const list = await appResponse.json(), state = await healthResponse.json();
    appList = list;
    health.className = `status ${state.ok ? 'online' : 'offline'}`; health.innerHTML = `<i></i>${state.ok ? 'Gateway オンライン' : 'Gateway停止中'}`;
    renderBackendStatus(state);
    renderApps(list);
  } catch { health.className = 'status offline'; health.innerHTML = '<i></i>Gateway停止中'; backendStatus.className = 'status backend-status offline'; backendStatus.innerHTML = '<i></i>Codex CLI 未確認'; apps.innerHTML = '<div class="empty">Gatewayに接続できません。サーバー状態を確認してください。</div>'; }
}

document.querySelector('#refresh').addEventListener('click', load);
reorderButton.addEventListener('click', toggleReorder);
apps.addEventListener('click', (event) => { const button = event.target.closest('[data-move-app]'); if (!button) return; moveApp(Number(button.dataset.appIndex), button.dataset.moveApp === 'up' ? -1 : 1); });
apps.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-toggle-app]');
  if (!button) return;
  const app = appList.find((item) => item.id === button.dataset.toggleApp);
  if (!app) return;
  app.hidden = !app.hidden;
  renderApps();
  try { await saveAppVisibility(); setReorderStatus('表示設定を保存しました'); } catch (error) { app.hidden = !app.hidden; renderApps(); setReorderStatus(error.message); }
});
document.querySelector('#agent-settings').addEventListener('click', openAgentSettings);
modelSelect.addEventListener('change', () => { showCustomModel(); renderReasoningOptions(currentCatalogModels); });
settingsForm.addEventListener('submit', saveAgentSettings);
load();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/launcher/sw.js');
