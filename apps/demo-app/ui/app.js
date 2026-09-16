const form = document.querySelector('#message-form');
const input = document.querySelector('#message');
const response = document.querySelector('#response');
const status = document.querySelector('#run-status');
const history = document.querySelector('#history');
const submit = form.querySelector('button');

function escapeHtml(value) { return String(value).replace(/[&<>'\"]/g, (c) => ({ '&': '&#38;', '<': '&#60;', '>': '&#62;', "'": '&#39;', '"': '&#34;' }[c])); }
function renderHistory(messages = []) { history.innerHTML = messages.length ? messages.map((item) => `<article class="history-item"><strong>${item.role === 'user' ? '入力' : 'Agent'}</strong><p>${escapeHtml(item.content)}</p></article>`).join('') : '<p class="muted">履歴はありません。</p>'; }
async function loadHistory() { const response = await fetch('/api/apps/demo-app/resources/messages', { cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data?.error?.message || '履歴を読み込めません'); renderHistory(data.messages); }
async function readRun(runId) {
  const events = new EventSource(`/api/runs/${runId}/events`); response.textContent = '';
  return new Promise((resolve, reject) => {
    events.addEventListener('message.delta', (event) => { response.textContent += JSON.parse(event.data).text; });
    events.addEventListener('run.completed', () => { events.close(); resolve(); });
    events.addEventListener('run.failed', (event) => { events.close(); reject(new Error(JSON.parse(event.data).message || 'Agent実行に失敗しました')); });
    events.onerror = () => { if (events.readyState === EventSource.CLOSED) reject(new Error('Agentとの接続が切れました')); };
  });
}
form.addEventListener('submit', async (event) => {
  event.preventDefault(); const message = input.value.trim(); if (!message) return;
  submit.disabled = true; status.textContent = '実行中…'; response.textContent = '';
  try { const created = await fetch('/api/apps/demo-app/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) }); const run = await created.json(); if (!created.ok) throw new Error(run?.error?.message || '実行を開始できません'); await readRun(run.id); input.value = ''; status.textContent = '完了'; await loadHistory(); }
  catch (error) { response.textContent = error.message; status.textContent = '失敗'; }
  finally { submit.disabled = false; }
});
document.querySelector('#clear-history').addEventListener('click', async () => { await fetch('/api/apps/demo-app/resources/messages', { method: 'DELETE' }); await loadHistory(); });
loadHistory().catch((error) => { history.textContent = error.message; });
