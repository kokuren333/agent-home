import { randomUUID } from 'node:crypto';

const OPERATIONS = new Set(['tree_propose', 'node_expand', 'challenge_create', 'answer_grade']);

export function createApp({ db }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS challenge_tree_workspaces (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      topic TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS challenge_tree_workspaces_updated_idx ON challenge_tree_workspaces(updated_at);
  `);

  const now = () => Date.now();
  const readWorkspace = (row) => row && JSON.parse(row.data_json);
  const getWorkspace = (id) => readWorkspace(db.prepare('SELECT data_json FROM challenge_tree_workspaces WHERE id=?').get(id));
  const listWorkspaceRows = () => db.prepare('SELECT id, title, topic, created_at, updated_at FROM challenge_tree_workspaces ORDER BY updated_at DESC').all();

  function createWorkspace(body = {}) {
    const topic = String(body.topic || '').trim();
    if (!topic) return null;
    const stamp = now();
    const id = randomUUID();
    const title = String(body.title || topic).trim() || topic;
    const rootId = `root-${randomUUID()}`;
    const workspace = {
      formatVersion: 1,
      appVersion: '0.1.0',
      project: { id, title, topic, goal: String(body.goal || `Understand ${topic}`).trim(), researchMode: body.researchMode === 'ja' ? 'ja' : 'global', challengeMode: body.challengeMode || 'explain', createdAt: new Date(stamp).toISOString(), updatedAt: new Date(stamp).toISOString() },
      tree: { rootNodeId: rootId, nodes: { [rootId]: { id: rootId, title: topic, description: '学習の中心となるテーマ', goal: String(body.goal || `Understand ${topic}`).trim(), status: 'unlocked', xp: 0, masteryState: 'familiar', prerequisites: [], children: [], resourceIds: [], challengeIds: [], position: { x: 0, y: 0 }, createdAt: new Date(stamp).toISOString(), updatedAt: new Date(stamp).toISOString() } }, edges: [] },
      challenges: [], attempts: [], resources: [], research: [], stats: { totalXp: 0, totalChallenges: 0, sessionXp: 0, gradeDistribution: [0, 0, 0, 0] }, draftAnswers: {}
    };
    db.prepare('INSERT INTO challenge_tree_workspaces VALUES (?, ?, ?, ?, ?, ?)').run(id, title, topic, JSON.stringify(workspace), stamp, stamp);
    return workspace;
  }

  function saveWorkspace(workspace) {
    const stamp = now();
    const next = { ...workspace, project: { ...workspace.project, updatedAt: new Date(stamp).toISOString() } };
    db.prepare('UPDATE challenge_tree_workspaces SET title=?, topic=?, data_json=?, updated_at=? WHERE id=?').run(next.project.title, next.project.topic, JSON.stringify(next), stamp, next.project.id);
    return next;
  }

  function makeNode(id, title, description, goal, prerequisites = []) {
    return { id, title, description, goal, status: prerequisites.length ? 'unlocked' : 'unlocked', xp: 0, masteryState: 'familiar', prerequisites, children: [], resourceIds: [], challengeIds: [], position: { x: 0, y: 0 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }
  function makeChallenge(id, nodeId, prompt, mode = 'explain') {
    return { id, nodeId, promptStyle: 'why', difficulty: 1, prompt, expectedConcepts: [], modelAnswer: '', explanation: '', rubric: [], commonMisconceptions: [], resourceIds: [], createdAt: new Date().toISOString(), mode, questions: [{ id: `${id}-main`, prompt, modelAnswer: '', expectedConcepts: [], explanation: '' }] };
  }

  function mockResult(operation, input) {
    const topic = input.workspace?.project?.topic || input.topic || 'テーマ';
    if (operation === 'answer_grade') return { grade: 'B', summary: '要点を押さえています。もう一段、理由や具体例を加えると理解が深まります。', correct: ['中心となる概念に触れている'], missing: ['具体例または背景'], misconceptions: [], nuance: [], recommendedAction: 'deepen', recommendedNodeIds: [], nextStep: '具体例を一つ追加して説明してみてください。' };
    if (operation === 'challenge_create') return makeChallenge(`challenge-${randomUUID()}`, input.node?.id || 'node', `${topic}について、中心となる考え方を自分の言葉で説明してください。`);
    const parent = input.node?.id || input.workspace?.tree?.rootNodeId || 'root';
    const labels = operation === 'tree_propose' ? ['基本概念', '仕組み', '実践と応用'] : ['関連する概念', '具体例', '発展的な論点'];
    const nodes = labels.map((label) => {
      const node = makeNode(`node-${randomUUID()}`, `${topic}：${label}`, `${topic}を${label}の観点から整理します。`, `${topic}の${label}を説明できるようになる。`, [parent]);
      const challenge = makeChallenge(`challenge-${randomUUID()}`, node.id, `${topic}の${label}について、重要な点を説明してください.`);
      node.challengeIds = [challenge.id];
      return { node, challenge };
    });
    return { nodes: nodes.map((item) => item.node), edges: nodes.map((item) => ({ from: parent, to: item.node.id, type: 'recommended' })), challenges: nodes.map((item) => item.challenge), resources: [] };
  }

  function extractJson(text) {
    const value = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { return JSON.parse(value); } catch {}
    const start = value.indexOf('{'); const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) { try { return JSON.parse(value.slice(start, end + 1)); } catch {} }
    throw new Error('Codexの結果をJSONとして解釈できませんでした');
  }

  function promptFor(operation, input) {
    const base = 'あなたは適応型学習アプリの生成エンジンです。入力された学習データを尊重し、指定されたJSONだけを返してください。Markdown、前置き、コードフェンスは不要です。';
    if (operation === 'answer_grade') return `${base}\n回答を採点してください。gradeはC/B/A/Sのいずれか、summary/correct/missing/misconceptions/nuanceは短い日本語配列、recommendedActionはretry/deepen/repair/branchのいずれか、recommendedNodeIdsは配列、nextStepは短文です。\nJSON schema: {"grade":"B","summary":"","correct":[],"missing":[],"misconceptions":[],"nuance":[],"recommendedAction":"deepen","recommendedNodeIds":[],"nextStep":""}\n問題:\n${JSON.stringify(input.challenge)}\n回答:\n${String(input.answer || '')}`;
    if (operation === 'challenge_create') return `${base}\n1問の学習問題を作ってください。JSON schema: {"id":"challenge-id","nodeId":"${input.node?.id || 'node-id'}","promptStyle":"why","difficulty":1,"prompt":"","expectedConcepts":[],"modelAnswer":"","explanation":"","rubric":[],"commonMisconceptions":[],"resourceIds":[],"createdAt":"${new Date().toISOString()}"}\nテーマ:\n${JSON.stringify(input.workspace?.project || input.topic)}\nノード:\n${JSON.stringify(input.node)}`;
    return `${base}\n${operation === 'tree_propose' ? 'テーマから最初の学習ツリーを作り、3つの子ノードと各ノードの問題を生成してください。' : '指定ノードから、次に学ぶ3つの子ノードと各ノードの問題を生成してください。'}\nJSON schema: {"nodes":[{"id":"node-id","title":"","description":"","goal":"","status":"unlocked","xp":0,"masteryState":"familiar","prerequisites":[],"children":[],"resourceIds":[],"challengeIds":[],"position":{"x":0,"y":0},"createdAt":"","updatedAt":""}],"edges":[{"from":"","to":"","type":"recommended"}],"challenges":[{"id":"challenge-id","nodeId":"","promptStyle":"why","difficulty":1,"prompt":"","expectedConcepts":[],"modelAnswer":"","explanation":"","rubric":[],"commonMisconceptions":[],"resourceIds":[],"createdAt":""}],"resources":[]}\n学習データ:\n${JSON.stringify(input.workspace || input)}`;
  }

  async function run(input, { backend, signal, emit }) {
    const operation = String(input?.operation || '').toLowerCase();
    if (!OPERATIONS.has(operation)) throw new Error('Challenge Tree operation is not supported');
    if (operation !== 'answer_grade' && !getWorkspace(input.workspaceId || input.workspace?.project?.id)) throw new Error('Workspace not found');
    emit('progress', { operation, message: '生成しています…' });
    let result;
    if (backend.name === 'mock') result = mockResult(operation, input);
    else {
      let output = '';
      for await (const delta of backend.stream(promptFor(operation, input), { signal })) { output += delta; emit('message.delta', { operation, text: delta }); }
      if (signal.aborted) return;
      result = extractJson(output);
    }
    emit('result.completed', { operation, result });
  }

  async function resources({ method, path, body }) {
    const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    const [resource, id] = parts;
    if (resource !== 'workspaces') return { status: 404, data: { error: { code: 'not_found', message: 'Workspace resource not found' } } };
    if (method === 'GET' && !id) return { status: 200, data: listWorkspaceRows().map((row) => ({ id: row.id, title: row.title, topic: row.topic, createdAt: row.created_at, updatedAt: row.updated_at })) };
    if (method === 'POST' && !id) { const workspace = createWorkspace(body); return workspace ? { status: 201, data: workspace } : { status: 400, data: { error: { code: 'invalid_input', message: 'topic is required' } } }; }
    if (!id) return { status: 404, data: { error: { code: 'not_found', message: 'Workspace not found' } } };
    if (method === 'GET') { const workspace = getWorkspace(id); return workspace ? { status: 200, data: workspace } : { status: 404, data: { error: { code: 'not_found', message: 'Workspace not found' } } }; }
    if (method === 'PUT') { const current = getWorkspace(id); return current ? { status: 200, data: saveWorkspace({ ...body, project: { ...body.project, id } }) } : { status: 404, data: { error: { code: 'not_found', message: 'Workspace not found' } } }; }
    if (method === 'DELETE') { db.prepare('DELETE FROM challenge_tree_workspaces WHERE id=?').run(id); return { status: 204, data: null }; }
    return { status: 405, data: { error: { code: 'method_not_allowed', message: 'Method not allowed' } } };
  }

  return { resources, run };
}
