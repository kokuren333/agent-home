const resourceBase = '/api/apps/challenge-tree/resources';
const runBase = '/api/apps/challenge-tree/runs';
const state = { workspaces: [], workspace: null, selectedNodeId: null, lastGrade: null, busy: '' };
const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) { return String(value ?? '').replace(/[&<>\"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char])); }
async function api(path, options = {}) {
  const response = await fetch(`${resourceBase}${path}`, { cache: 'no-store', ...options });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || '操作に失敗しました');
  return data;
}
function setNotice(message = '') { const target = $('#notice'); target.textContent = message; target.hidden = !message; }
function formatDate(value) { return value ? new Date(value).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' }) : ''; }

async function loadHealth() {
  try {
    const health = await (await fetch('/api/health', { cache: 'no-store' })).json();
    $('#backend-state').textContent = health.backend?.ok ? `${health.backend.backend} 接続中` : 'Agent未接続';
    $('#backend-state').className = `backend-state ${health.backend?.ok ? '' : 'offline'}`;
  } catch { $('#backend-state').textContent = 'Gateway未接続'; $('#backend-state').className = 'backend-state offline'; }
}

async function loadWorkspaces() {
  try {
    state.workspaces = await api('/workspaces');
    $('#workspace-list').innerHTML = state.workspaces.length ? state.workspaces.map((item) => `<button class="workspace-card" data-workspace-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.topic)}<br>更新: ${escapeHtml(formatDate(item.updatedAt))}</small></button>`).join('') : '<p class="muted">まだ学習ワークスペースがありません。</p>';
    document.querySelectorAll('[data-workspace-id]').forEach((button) => button.addEventListener('click', () => openWorkspace(button.dataset.workspaceId)));
  } catch (error) { $('#workspace-list').innerHTML = `<p class="notice">${escapeHtml(error.message)}</p>`; }
}

async function openWorkspace(id) {
  try { state.workspace = await api(`/workspaces/${encodeURIComponent(id)}`); state.selectedNodeId = state.workspace.tree.rootNodeId; state.lastGrade = null; $('#home-view').hidden = true; $('#workspace-view').hidden = false; renderWorkspace(); }
  catch (error) { setNotice(error.message); }
}
function renderWorkspace() {
  const workspace = state.workspace;
  $('#workspace-title').textContent = workspace.project.title;
  $('#workspace-subtitle').textContent = `${workspace.project.topic} · ${workspace.project.goal}`;
  const nodes = Object.values(workspace.tree.nodes || {});
  $('#tree-list').innerHTML = nodes.length ? nodes.map((node) => `<button class="tree-node ${node.id === state.selectedNodeId ? 'selected' : ''}" data-node-id="${escapeHtml(node.id)}"><span class="node-state">${node.status === 'cleared' ? 'CLEAR' : node.status === 'unlocked' ? 'OPEN' : 'LOCKED'}</span><strong>${escapeHtml(node.title)}</strong><small>${escapeHtml(node.description || node.goal || '')}</small></button>`).join('') : '<p class="muted">ノードがありません。</p>';
  document.querySelectorAll('[data-node-id]').forEach((button) => button.addEventListener('click', () => { state.selectedNodeId = button.dataset.nodeId; state.lastGrade = null; renderWorkspace(); }));
  renderChallenge();
}
function selectedNode() { return state.workspace?.tree?.nodes?.[state.selectedNodeId]; }
function selectedChallenge() { const node = selectedNode(); return state.workspace?.challenges?.find((item) => item.id === node?.challengeIds?.[0]); }
function renderChallenge() {
  const node = selectedNode(); const challenge = selectedChallenge();
  $('#challenge-title').textContent = node?.title || 'ノードを選択';
  $('#challenge-grade').hidden = !state.lastGrade;
  if (state.lastGrade) $('#challenge-grade').textContent = state.lastGrade.grade;
  if (!node) { $('#challenge-content').innerHTML = '<div class="empty-state"><span>✦</span><strong>学習ノードを選んでください</strong></div>'; return; }
  if (!challenge) { $('#challenge-content').innerHTML = `<div class="empty-state"><span>＋</span><strong>このノードの問題はまだありません</strong><p>AIで問題を生成するには、ノードを展開してください。</p><button id="expand-node" class="secondary-button">このノードを展開</button></div>`; $('#expand-node').addEventListener('click', expandSelectedNode); return; }
  const result = state.lastGrade ? `<div class="result-card"><h4>評価: ${escapeHtml(state.lastGrade.grade)}</h4><p>${escapeHtml(state.lastGrade.summary)}</p>${state.lastGrade.nextStep ? `<p><strong>次の一歩：</strong>${escapeHtml(state.lastGrade.nextStep)}</p>` : ''}${(state.lastGrade.missing || []).length ? `<p><strong>補うとよい点</strong></p><ul>${state.lastGrade.missing.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}</div>` : '';
  $('#challenge-content').innerHTML = `<p class="challenge-label">${escapeHtml(challenge.mode || 'explain')} · 難易度 ${escapeHtml(challenge.difficulty || 1)}</p><p class="challenge-question">${escapeHtml(challenge.prompt)}</p><label class="answer-label">あなたの回答<textarea id="answer" class="answer-box" rows="6" placeholder="自分の言葉で答えてみましょう…"></textarea></label><div class="answer-actions"><button id="grade-answer" class="primary-button" ${state.busy ? 'disabled' : ''}>${state.busy === 'grade' ? '採点中…' : '回答を送る'}</button></div>${result}<div class="node-actions"><button id="expand-node" class="secondary-button" ${state.busy ? 'disabled' : ''}>このノードを展開</button></div>`;
  $('#grade-answer').addEventListener('click', gradeAnswer); $('#expand-node').addEventListener('click', expandSelectedNode);
}

async function runOperation(operation, input) {
  const created = await fetch(runBase, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, ...input }) });
  const run = await created.json();
  if (!created.ok) throw new Error(run?.error?.message || 'Agent実行を開始できません');
  return await new Promise((resolve, reject) => {
    const stream = new EventSource(`/api/runs/${encodeURIComponent(run.id)}/events`); let result;
    stream.addEventListener('result.completed', (event) => { result = JSON.parse(event.data).result; });
    stream.addEventListener('progress', (event) => { const data = JSON.parse(event.data); setNotice(data.message || '生成しています…'); });
    stream.addEventListener('run.completed', () => { stream.close(); setNotice(''); resolve(result); });
    stream.addEventListener('run.failed', (event) => { stream.close(); reject(new Error(JSON.parse(event.data).message || 'Agent実行に失敗しました')); });
    stream.onerror = () => { if (stream.readyState === EventSource.CLOSED) { stream.close(); reject(new Error('イベントストリームが切断されました')); } };
  });
}
async function saveCurrent() { state.workspace = await api(`/workspaces/${encodeURIComponent(state.workspace.project.id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state.workspace) }); }
function mergeGeneration(result, parentId) {
  const nodes = Array.isArray(result?.nodes) ? result.nodes : []; const challenges = Array.isArray(result?.challenges) ? result.challenges : [];
  const edges = Array.isArray(result?.edges) ? result.edges : []; const tree = state.workspace.tree;
  const parent = tree.nodes[parentId];
  for (const node of nodes) { if (!node?.id || !node.title) continue; tree.nodes[node.id] = { ...node, children: Array.isArray(node.children) ? node.children : [], challengeIds: Array.isArray(node.challengeIds) ? node.challengeIds : [], status: node.status || 'unlocked', xp: Number(node.xp || 0), masteryState: node.masteryState || 'familiar' }; }
  for (const challenge of challenges) { if (challenge?.id && challenge.nodeId) { state.workspace.challenges = [...state.workspace.challenges.filter((item) => item.id !== challenge.id), challenge]; tree.nodes[challenge.nodeId] ||= {}; tree.nodes[challenge.nodeId].challengeIds = [...new Set([...(tree.nodes[challenge.nodeId].challengeIds || []), challenge.id])]; } }
  tree.edges = [...tree.edges, ...edges.filter((edge) => edge?.from && edge?.to)];
  if (parent) parent.children = [...new Set([...(parent.children || []), ...nodes.map((node) => node.id)])];
}
async function generateTree() { if (!state.workspace) return; state.busy = 'tree'; renderWorkspace(); try { const result = await runOperation('tree_propose', { workspaceId: state.workspace.project.id, workspace: state.workspace }); mergeGeneration(result, state.workspace.tree.rootNodeId); await saveCurrent(); setNotice(''); } catch (error) { setNotice(error.message); } finally { state.busy = ''; renderWorkspace(); } }
async function expandSelectedNode() { if (!state.workspace || !selectedNode()) return; const parentId = state.selectedNodeId; state.busy = 'expand'; renderWorkspace(); try { const result = await runOperation('node_expand', { workspaceId: state.workspace.project.id, workspace: state.workspace, node: selectedNode() }); mergeGeneration(result, parentId); await saveCurrent(); } catch (error) { setNotice(error.message); } finally { state.busy = ''; renderWorkspace(); } }
async function gradeAnswer() { const answer = $('#answer')?.value.trim(); if (!answer || !selectedChallenge()) return; state.busy = 'grade'; renderChallenge(); try { const grade = await runOperation('answer_grade', { workspaceId: state.workspace.project.id, workspace: state.workspace, challenge: selectedChallenge(), answer }); state.lastGrade = grade; const node = selectedNode(); node.xp = Number(node.xp || 0) + ({ C: 0, B: 40, A: 70, S: 100 }[grade.grade] || 0); node.status = grade.grade === 'S' ? 'cleared' : node.status; state.workspace.attempts.push({ id: crypto.randomUUID(), challengeId: selectedChallenge().id, nodeId: node.id, answer, grade: grade.grade, feedback: grade, xpAwarded: ({ C: 0, B: 40, A: 70, S: 100 }[grade.grade] || 0), createdAt: new Date().toISOString() }); state.workspace.stats.totalChallenges += 1; await saveCurrent(); } catch (error) { setNotice(error.message); } finally { state.busy = ''; renderWorkspace(); } }

function openCreateDialog() { $('#workspace-topic').value = ''; $('#workspace-goal').value = ''; $('#workspace-dialog').showModal(); }
async function createWorkspace(event) { if (event.submitter?.value !== 'save') return; event.preventDefault(); const button = event.submitter; button.disabled = true; try { const workspace = await api('/workspaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: $('#workspace-topic').value, goal: $('#workspace-goal').value }) }); $('#workspace-dialog').close('save'); state.workspaces.unshift({ id: workspace.project.id, title: workspace.project.title, topic: workspace.project.topic, updatedAt: workspace.project.updatedAt }); await openWorkspace(workspace.project.id); } catch (error) { alert(error.message); } finally { button.disabled = false; } }
async function deleteWorkspace() { if (!state.workspace || !confirm(`「${state.workspace.project.title}」を削除しますか？`)) return; try { await api(`/workspaces/${encodeURIComponent(state.workspace.project.id)}`, { method: 'DELETE' }); state.workspace = null; $('#workspace-view').hidden = true; $('#home-view').hidden = false; await loadWorkspaces(); } catch (error) { setNotice(error.message); } }
function goHome() { state.workspace = null; $('#workspace-view').hidden = true; $('#home-view').hidden = false; setNotice(''); loadWorkspaces(); }

$('#new-workspace').addEventListener('click', openCreateDialog); $('#cancel-workspace').addEventListener('click', () => $('#workspace-dialog').close('cancel')); $('#workspace-form').addEventListener('submit', (event) => createWorkspace(event)); $('#reload-workspaces').addEventListener('click', loadWorkspaces); $('#back-home').addEventListener('click', goHome); $('#delete-workspace').addEventListener('click', deleteWorkspace); $('#generate-tree').addEventListener('click', generateTree);
loadHealth(); loadWorkspaces();
