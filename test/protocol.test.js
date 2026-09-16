import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let child, base, temp;
async function request(url, options) { const response = await fetch(base + url, options); const data = response.status === 204 ? null : await response.json(); return { response, data }; }
before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'agent-home-')); const port = 19000 + Math.floor(Math.random() * 500); base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--experimental-sqlite', 'gateway/server.js'], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, PORT: String(port), DATA_DIR: temp, AGENT_BACKEND: 'mock' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { const result = await fetch(base + '/api/health'); if (result.ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error('Gateway did not start');
});
after(async () => { if (child && child.exitCode === null) { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited; } await rm(temp, { recursive: true, force: true }); });

test('discovers apps from manifests, including the protocol-only demo app', async () => {
  const { response, data } = await request('/api/apps'); assert.equal(response.status, 200); const ids = data.map((app) => app.id);
  for (const id of ['challenge-tree', 'character-chat', 'demo-app', 'evidence-based-slopedia']) assert.ok(ids.includes(id));
  assert.equal((await request('/api/apps/demo-app')).data.capabilities.includes('run'), true);
  assert.equal((await request('/api/apps/challenge-tree')).data.capabilities.includes('storage'), true);
  assert.equal((await request('/api/apps/evidence-based-slopedia')).data.capabilities.includes('resources'), true);
  assert.equal((await fetch(base + '/ui/styles.css')).status, 200);
});

test('persists launcher app order without changing the app manifests', async () => {
  const initial = await request('/api/apps');
  const initialIds = initial.data.map((app) => app.id);
  const reversed = [...initialIds].reverse();
  const saved = await request('/api/apps/order', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appIds: reversed }) });
  assert.equal(saved.response.status, 200);
  assert.deepEqual((await request('/api/apps')).data.map((app) => app.id), reversed);
  assert.deepEqual((await request('/api/apps/order')).data.appIds, reversed);
  const invalid = await request('/api/apps/order', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appIds: [reversed[0]] }) });
  assert.equal(invalid.response.status, 400);
  await request('/api/apps/order', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appIds: initialIds }) });
});

test('persists launcher app visibility separately from app manifests', async () => {
  const apps = await request('/api/apps?includeHidden=true');
  const ids = apps.data.map((app) => app.id);
  const hidden = [ids[0]];
  const saved = await request('/api/apps/visibility', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hiddenAppIds: hidden }) });
  assert.equal(saved.response.status, 200);
  assert.deepEqual((await request('/api/apps/visibility')).data.hiddenAppIds, hidden);
  assert.equal((await request('/api/apps')).data.some((app) => app.id === ids[0]), false);
  assert.equal((await request('/api/apps?includeHidden=true')).data.find((app) => app.id === ids[0]).hidden, true);
  await request('/api/apps/visibility', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hiddenAppIds: [] }) });
});

test('demo app uses generic run and event protocol', async () => {
  const created = await request('/api/apps/demo-app/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: '短い説明を書いて' }) });
  assert.equal(created.response.status, 202); const runId = created.data.id;
  for (let i = 0; i < 30; i++) { const result = await request(`/api/runs/${runId}`); if (result.data.status === 'completed') break; await new Promise((resolve) => setTimeout(resolve, 20)); }
  const events = await request(`/api/runs/${runId}/events`); assert.ok(events.data.some((event) => event.type === 'message.delta')); assert.ok(events.data.some((event) => event.type === 'message.completed')); assert.ok(events.data.some((event) => event.type === 'result.completed')); assert.ok(events.data.some((event) => event.type === 'run.completed'));
  const messages = await request('/api/apps/demo-app/resources/messages'); assert.equal(messages.data.messages.at(-1).role, 'assistant');
  await request('/api/apps/demo-app/resources/messages', { method: 'DELETE' });
});

test('evidence-based-slopedia exposes the simple query/news queue through the generic protocol', async () => {
  const manifest = await request('/api/apps/evidence-based-slopedia');
  assert.equal(manifest.response.status, 200);
  assert.equal((await fetch(base + manifest.data.entry)).status, 200);
  const body = JSON.stringify({ action: 'enqueue_daily_news', date: '2026-09-16' });
  const created = await request('/api/apps/evidence-based-slopedia/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal(created.response.status, 202);
  for (let i = 0; i < 30; i++) { const result = await request(`/api/runs/${created.data.id}`); if (result.data.status === 'completed') break; await new Promise((resolve) => setTimeout(resolve, 20)); }
  const state = await request('/api/apps/evidence-based-slopedia/resources/daily_news_state?date=2026-09-16');
  assert.equal(state.response.status, 200);
  assert.equal(state.data.activeCount, 10);
  assert.equal((await request('/api/apps/evidence-based-slopedia/resources/jobs?activeOnly=true')).data.jobs.length, 10);
});

test('challenge tree uses app-owned workspaces and generic runs', async () => {
  const manifest = await request('/api/apps/challenge-tree');
  assert.match(manifest.data.entry, /\/apps\/challenge-tree\/dist\/index\.html$/);
  assert.equal((await fetch(base + manifest.data.entry)).status, 200);
  const created = await request('/api/apps/challenge-tree/resources/workspaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: '生成AIの基礎', goal: '仕組みを説明できるようになる' }) });
  assert.equal(created.response.status, 201);
  const workspace = await request(`/api/apps/challenge-tree/resources/workspaces/${created.data.project.id}`);
  assert.equal(workspace.data.project.topic, '生成AIの基礎');
  const run = await request('/api/apps/challenge-tree/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'tree_propose', workspaceId: created.data.project.id, workspace: created.data }) });
  for (let i = 0; i < 40; i++) { const result = await request(`/api/runs/${run.data.id}`); if (result.data.status === 'completed') break; await new Promise((resolve) => setTimeout(resolve, 20)); }
  const events = await request(`/api/runs/${run.data.id}/events`); assert.ok(events.data.some((event) => event.type === 'result.completed'));
  const removed = await request(`/api/apps/challenge-tree/resources/workspaces/${created.data.project.id}`, { method: 'DELETE' }); assert.equal(removed.response.status, 204);
});

test('agent model settings are shared by every app run', async () => {
  const initial = await request('/api/settings/agent');
  assert.equal(initial.response.status, 200); assert.equal(initial.data.model, 'gpt-5.6-luna'); assert.equal(initial.data.reasoningEffort, 'low');
  const updated = await request('/api/settings/agent', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-5-codex', reasoningEffort: 'high' }) });
  assert.equal(updated.response.status, 200); assert.equal(updated.data.model, 'gpt-5-codex'); assert.equal(updated.data.reasoningEffort, 'high');
  const health = await request('/api/health'); assert.equal(health.data.agentSettings.model, 'gpt-5-codex'); assert.equal(health.data.agentSettings.reasoningEffort, 'high');
  const invalid = await request('/api/settings/agent', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'bad model', reasoningEffort: 'extreme' }) });
  assert.equal(invalid.response.status, 400);
});

test('model catalog endpoint is available through the common settings API', async () => {
  const catalog = await request('/api/settings/agent/models');
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.data.source, 'mock');
  assert.ok(Array.isArray(catalog.data.models));
});

test('character chat keeps app-specific data in SQLite and streams through generic runs', async () => {
  const defaults = await request('/api/apps/character-chat/resources/characters');
  assert.deepEqual(defaults.data.filter((item) => item.isDefault).map((item) => item.id).sort(), ['default-kokuren', 'default-mirei', 'default-ren']);
  const protectedEdit = await request('/api/apps/character-chat/resources/characters/default-kokuren', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '変更不可' }) });
  assert.equal(protectedEdit.response.status, 403);
  const protectedDelete = await request('/api/apps/character-chat/resources/characters/default-kokuren', { method: 'DELETE' });
  assert.equal(protectedDelete.response.status, 403);
  const character = await request('/api/apps/character-chat/resources/characters', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Test Bot', systemPrompt: 'Be concise.' }) });
  assert.equal(character.response.status, 201); const convo = await request('/api/apps/character-chat/resources/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ characterId: character.data.id }) });
  const run = await request('/api/apps/character-chat/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversationId: convo.data.id, message: 'hello' }) });
  for (let i = 0; i < 40; i++) { const result = await request(`/api/runs/${run.data.id}`); if (result.data.status === 'completed') break; await new Promise((resolve) => setTimeout(resolve, 20)); }
  const events = await request(`/api/runs/${run.data.id}/events`); assert.ok(events.data.some((event) => event.type === 'message.delta')); const saved = await request(`/api/apps/character-chat/resources/conversations/${convo.data.id}`); assert.equal(saved.data.messages.at(-1).role, 'assistant');
});

test('character chat features stay app-owned while using generic runs', async () => {
  const first = await request('/api/apps/character-chat/resources/characters', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Feature One', systemPrompt: 'Likes quiet cafes.' }) });
  const second = await request('/api/apps/character-chat/resources/characters', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Feature Two' }) });
  assert.equal(first.data.systemPrompt, 'Likes quiet cafes.');
  const settings = await request('/api/apps/character-chat/resources/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Reader', persona: 'Enjoys mystery stories' }) });
  assert.equal(settings.data.persona, 'Enjoys mystery stories');
  const convo = await request('/api/apps/character-chat/resources/conversations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ characterId: first.data.id, title: 'Feature Story' }) });
  await request(`/api/apps/character-chat/resources/conversations/${convo.data.id}/participants`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ characterId: second.data.id }) });
  await request(`/api/apps/character-chat/resources/conversations/${convo.data.id}/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ genre: 'mystery', pov: '一人称', pace: 'ドラマチック', plotDescription: 'A locked-room mystery' }) });
  const memory = await request(`/api/apps/character-chat/resources/conversations/${convo.data.id}/memory`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'fact', content: 'The key was hidden inside the old clock.' }) });
  assert.equal(memory.response.status, 201);
  const run = await request('/api/apps/character-chat/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversationId: convo.data.id, message: 'find the clue' }) });
  for (let i = 0; i < 40; i++) { const result = await request(`/api/runs/${run.data.id}`); if (result.data.status === 'completed') break; await new Promise((resolve) => setTimeout(resolve, 20)); }
  const messages = await request(`/api/apps/character-chat/resources/conversations/${convo.data.id}/messages`); const assistant = messages.data.findLast((item) => item.role === 'assistant');
  assert.ok(assistant?.id); assert.equal(messages.data.some((item) => /User persona|Respond only|System persona/.test(item.content)), false);
  const regen = await request('/api/apps/character-chat/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversationId: convo.data.id, targetMessageId: assistant.id, instruction: 'make it tense' }) });
  for (let i = 0; i < 40; i++) { const result = await request(`/api/runs/${regen.data.id}`); if (result.data.status === 'completed') break; await new Promise((resolve) => setTimeout(resolve, 20)); }
  const saved = await request(`/api/apps/character-chat/resources/conversations/${convo.data.id}`); assert.equal(saved.data.participants.length, 2); assert.equal(saved.data.genre, 'mystery'); assert.equal(saved.data.pov, '一人称'); assert.equal(saved.data.messages.at(-1).role, 'assistant'); assert.equal(saved.data.memory.length, 1); assert.equal(saved.data.memory[0].content, 'The key was hidden inside the old clock.');
  const removed = await request(`/api/apps/character-chat/resources/conversations/${convo.data.id}`, { method: 'DELETE' }); assert.equal(removed.response.status, 204); const missing = await request(`/api/apps/character-chat/resources/conversations/${convo.data.id}`); assert.equal(missing.response.status, 404); const missingMemory = await request(`/api/apps/character-chat/resources/conversations/${convo.data.id}/memory`); assert.equal(missingMemory.response.status, 404);
});
