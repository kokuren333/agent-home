const apps = document.querySelector('#apps');
const health = document.querySelector('#health');
const settingsDialog = document.querySelector('#agent-settings-dialog');
const settingsForm = document.querySelector('#agent-settings-form');
const modelSelect = document.querySelector('#agent-model');
const customModelWrap = document.querySelector('#custom-model-wrap');
const customModel = document.querySelector('#custom-model');
const reasoningSelect = document.querySelector('#agent-reasoning');
const settingsStatus = document.querySelector('#agent-settings-status');
let currentCatalogModels = [];

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
    health.className = `status ${state.ok ? 'online' : 'offline'}`; health.innerHTML = `<i></i>${state.ok ? 'オンライン' : 'Gateway停止中'}`;
    apps.innerHTML = list.map((app) => `<a class="app-card" href="${escapeHtml(app.entry)}"><span class="app-icon">${String(app.icon || '').startsWith('/') ? `<img src="${escapeHtml(app.icon)}" alt="">` : escapeHtml(app.icon)}</span><span class="app-copy"><strong>${escapeHtml(app.name)}</strong><small>${escapeHtml(app.description)}</small></span><span class="arrow">›</span></a>`).join('');
  } catch { health.className = 'status offline'; health.innerHTML = '<i></i>接続できません'; apps.innerHTML = '<div class="empty">Gatewayに接続できません。サーバー状態を確認してください。</div>'; }
}

document.querySelector('#refresh').addEventListener('click', load);
document.querySelector('#agent-settings').addEventListener('click', openAgentSettings);
modelSelect.addEventListener('change', () => { showCustomModel(); renderReasoningOptions(currentCatalogModels); });
settingsForm.addEventListener('submit', saveAgentSettings);
load();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/launcher/sw.js');
