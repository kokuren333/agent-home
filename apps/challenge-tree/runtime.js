import { randomUUID } from 'node:crypto';

const OPERATIONS = new Set(['tree_propose', 'node_expand', 'node_create', 'challenge_create', 'answer_grade']);
const iso = () => new Date().toISOString();

export function createApp({ db }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS challenge_tree_workspaces (id TEXT PRIMARY KEY, title TEXT NOT NULL, topic TEXT NOT NULL, data_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS challenge_tree_workspaces_updated_idx ON challenge_tree_workspaces(updated_at);
    CREATE TABLE IF NOT EXISTS challenge_tree_settings (id INTEGER PRIMARY KEY CHECK (id = 1), data_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS challenge_tree_snapshots (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, reason TEXT NOT NULL, data_json TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS challenge_tree_snapshots_project_idx ON challenge_tree_snapshots(project_id, created_at DESC);
  `);

  const defaultSettings = { uiLanguage: 'ja', connectorUrl: 'http://127.0.0.1:43110', reducedMotion: false, model: 'gpt-5.6-luna', reasoningEffort: 'low' };
  const read = (row) => row ? JSON.parse(row.data_json) : undefined;
  const getWorkspace = (id) => read(db.prepare('SELECT data_json FROM challenge_tree_workspaces WHERE id=?').get(id));
  const workspaceRows = () => db.prepare('SELECT id, title, topic, created_at, updated_at FROM challenge_tree_workspaces ORDER BY updated_at DESC').all();
  const getSettings = () => { const row = db.prepare('SELECT data_json FROM challenge_tree_settings WHERE id=1').get(); return row ? { ...defaultSettings, ...JSON.parse(row.data_json) } : defaultSettings; };
  if (!db.prepare('SELECT id FROM challenge_tree_settings WHERE id=1').get()) db.prepare('INSERT INTO challenge_tree_settings VALUES (1, ?, ?)').run(JSON.stringify(defaultSettings), Date.now());

  function saveWorkspace(workspace, id = workspace.project.id) {
    const stamp = Date.now();
    const next = { ...workspace, project: { ...workspace.project, id, updatedAt: new Date(stamp).toISOString() } };
    const existing = db.prepare('SELECT id FROM challenge_tree_workspaces WHERE id=?').get(id);
    if (existing) db.prepare('UPDATE challenge_tree_workspaces SET title=?, topic=?, data_json=?, updated_at=? WHERE id=?').run(next.project.title, next.project.topic, JSON.stringify(next), stamp, id);
    else db.prepare('INSERT INTO challenge_tree_workspaces VALUES (?, ?, ?, ?, ?, ?)').run(id, next.project.title, next.project.topic, JSON.stringify(next), stamp, stamp);
    return next;
  }

  function createWorkspace(body = {}) {
    const topic = String(body.topic || '').trim();
    if (!topic) return null;
    const stamp = Date.now(); const projectId = randomUUID(); const rootId = `root-${randomUUID()}`;
    const root = node(rootId, topic, 'The central idea of this learning tree.', String(body.goal || `${topic}を説明できるようになる。`), { x: 110, y: 270 });
    const workspace = {
      formatVersion: 1, appVersion: '0.1.0', schemaVersion: 1, connectorProtocolVersion: 'agent-home-gateway-v1',
      project: { id: projectId, title: String(body.title || topic), topic, goal: String(body.goal || `${topic}を説明できるようになる。`), researchMode: body.researchMode === 'ja' ? 'ja' : 'global', challengeMode: ['explain', 'short_answer', 'true_false'].includes(body.challengeMode) ? body.challengeMode : 'explain', createdAt: new Date(stamp).toISOString(), updatedAt: new Date(stamp).toISOString() },
      tree: { rootNodeId: rootId, nodes: { [rootId]: root }, edges: [] }, challenges: [], attempts: [], resources: [], research: [], settings: getSettings(),
      stats: { totalXp: 0, totalChallenges: 0, gradeDistribution: [0, 0, 0, 0], sessionXp: 0 }, draftAnswers: {},
    };
    return saveWorkspace(workspace, projectId);
  }

  function node(id, title, description, goal, position = { x: 0, y: 0 }) {
    return { id, title, description, goal, status: 'unlocked', xp: 0, masteryState: 'familiar', prerequisites: [], children: [], resourceIds: [], challengeIds: [], position, createdAt: iso(), updatedAt: iso() };
  }
  function challenge(id, nodeId, prompt, mode = 'explain') {
    const count = mode === 'true_false' ? 5 : mode === 'short_answer' ? 3 : 1;
    const questions = Array.from({ length: count }, (_, index) => ({ id: `${id}-q${index + 1}`, prompt: mode === 'true_false' ? `${prompt}。正しいか誤りか答えてください。` : mode === 'short_answer' ? `${prompt}（短く答えてください）` : prompt, modelAnswer: mode === 'true_false' ? (index % 2 === 0 ? 'true' : 'false') : mode === 'short_answer' ? '中心概念の要点。' : '中心概念と理由を説明する。', expectedConcepts: ['中心概念'], explanation: '回答の根拠と要点を確認します。' }));
    return { id, nodeId, promptStyle: 'why', difficulty: 1, prompt, expectedConcepts: ['中心概念', '理由', '具体例'], modelAnswer: `${prompt} 要点と理由を、自分の言葉で説明します。`, explanation: '要点だけでなく、なぜそうなるかまで確認します。', rubric: [{ criterion: '中心概念を説明する', required: true }], commonMisconceptions: [], resourceIds: [], createdAt: iso(), mode, questions };
  }
  function resource(id, title, url, supports = []) { return { id, title, url, language: 'ja', type: 'article', authorityTier: 'B', guidance: '概要と一次情報を確認してください。', supports, verifiedAt: iso() }; }

  function mockResult(operation, input) {
    const topic = String(input.topic || input.workspace?.project?.topic || '学習テーマ');
    if (operation === 'answer_grade') return { grade: 'B', summary: '要点を押さえています。理由や具体例を一つ加えると、さらに理解が明確になります。', correct: ['中心となる概念に触れている'], missing: ['理由または具体例'], misconceptions: [], nuance: [], recommendedAction: 'deepen', recommendedNodeIds: [], nextStep: '具体例を一つ加えて説明してみてください。' };
    if (operation === 'challenge_create') return challenge(`challenge-${randomUUID()}`, input.node?.id || 'node', `${topic}の中心的な考え方を、自分の言葉で説明してください。`, input.challengeMode || 'explain');
    if (operation === 'node_create') {
      const created = node(`node-${randomUUID()}`, String(input.title || topic), `${topic}を整理するための学習ノードです。`, String(input.goal || `${topic}を説明できるようになる。`));
      const item = challenge(`challenge-${randomUUID()}`, created.id, `${created.title}について、重要な点を説明してください。`, input.challengeMode || 'explain');
      return { node: { id: created.id, title: created.title, description: created.description, goal: created.goal }, resources: [resource(`resource-${randomUUID()}`, `${topic}の参考資料`, 'https://developer.mozilla.org/', [created.id])], challenges: [item] };
    }
    if (operation === 'tree_propose') {
      return { proposals: [0, 1, 2].map((index) => {
        const root = node(`node-${randomUUID()}`, `${topic}：${['基礎から理解する', '仕組みから掘り下げる', '実践から身につける'][index]}`, `${topic}を${['基本概念', '構造', '実例'][index]}の観点から整理します。`, `${topic}の重要な考え方を説明できる。`, { x: 70, y: 270 });
        return { id: `proposal-${randomUUID()}`, title: `${topic}：${['基礎から理解する', '仕組みから掘り下げる', '実践から身につける'][index]}`, philosophy: ['まず全体像をつかみ、段階的に深める構成です。', '内部の関係を追いながら理解する構成です。', '手を動かして具体例から一般化する構成です。'][index], learnerProfile: '全体像を整理しながら自分の言葉で理解したい人。', branches: ['基本概念', '仕組み', '応用'], advantages: ['順序が明確', '復習しやすい'], tradeoffs: '最初から細部まで扱う構成ではありません。', root, initialNodes: [root], initialEdges: [], resources: [], challenges: [challenge(`challenge-${randomUUID()}`, root.id, `${topic}の中心的な考え方を説明してください.`, input.challengeMode || 'explain')] };
      }) };
    }
    const parent = input.node?.id || input.workspace?.tree?.rootNodeId || 'root';
    const count = Math.max(1, Math.min(10, Number(input.branchCount) || 3));
    const labels = ['関連する概念', '具体例', '発展的な論点', '比較対象', '実践上の判断'];
    const items = Array.from({ length: count }, (_, index) => { const child = node(`node-${randomUUID()}`, `${topic}：${labels[index % labels.length]}`, `${topic}を${labels[index % labels.length]}の観点から整理します。`, `${topic}の${labels[index % labels.length]}を説明できる。`); const item = challenge(`challenge-${randomUUID()}`, child.id, `${child.title}について重要な点を説明してください。`, input.challengeMode || 'explain'); child.challengeIds = [item.id]; child.prerequisites = [parent]; return { child, item }; });
    return { nodes: items.map(({ child }) => child), edges: items.map(({ child }) => ({ from: parent, to: child.id, type: 'recommended' })), challenges: items.map(({ item }) => item), resources: [] };
  }

  function extractJson(text) {
    const value = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { return JSON.parse(value); } catch {}
    const start = value.indexOf('{'); const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) { try { return JSON.parse(value.slice(start, end + 1)); } catch {} }
    throw new Error('Codexの結果をJSONとして解釈できませんでした');
  }
  function outputSources(value) {
    const found = [];
    const visit = (item) => {
      if (!item || typeof item !== 'object') return;
      if (Array.isArray(item)) { for (const child of item) visit(child); return; }
      if (typeof item.url === 'string' && /^https?:\/\//i.test(item.url)) found.push({ title: typeof item.title === 'string' && item.title.trim() ? item.title : item.url, url: item.url });
      for (const child of Object.values(item)) visit(child);
    };
    visit(value);
    return found.filter((source, index) => found.findIndex((item) => item.url === source.url) === index);
  }
  function textSources(text) {
    return [...String(text || '').matchAll(/https?:\/\/[^\s"'<>`]+/g)]
      .map((match) => match[0].replace(/[),.]+$/, ''))
      .filter((url, index, urls) => urls.indexOf(url) === index)
      .map((url) => ({ title: url, url }));
  }
  function promptFor(operation, input) {
    let base = 'あなたはChallenge Treeの学習データ生成エンジンです。入力を尊重し、指定されたJSONだけを返してください。Markdownやコードフェンスは不要です。日本語で出力してください。このタスクでは、最初にWeb検索ツールを最低1回呼び出してください。Web検索を実行せずに最終JSONを出力してはいけません。信頼できる一次情報・公式ドキュメント・大学や公的機関の資料を優先し、検索結果を確認したうえで学習内容を作成してください。確認したURLをresourcesに反映し、問題のresourceIdsから参照してください。検索ツールを利用できない場合は、内容を推測で埋めず、空のJSONを返してください。';
    const mode = ['explain', 'short_answer', 'true_false'].includes(input.challengeMode) ? input.challengeMode : 'explain';
    const modeRule = mode === 'explain' ? 'challengeModeはexplain。questionsは1件だけにし、自由記述で理由や具体例を答える問題にする。' : mode === 'short_answer' ? 'challengeModeはshort_answer。questionsは必ず3件にし、各promptは短答を求める。' : 'challengeModeはtrue_false。questionsは必ず5件にし、各promptは正誤判定可能な命題にする。各modelAnswerは文字列trueまたはfalseにする。';
    const modeContract = `選択された問題形式を厳守すること。${modeRule} challengeのmodeには必ず"${mode}"を入れる。`;
    base += `\n${modeContract}`;
    if (operation === 'answer_grade') return `${base}\n${modeContract}\n回答を採点してください。gradeはC/B/A/S、recommendedActionはretry/deepen/repair/branchです。JSON: {"grade":"B","summary":"","correct":[],"missing":[],"misconceptions":[],"nuance":[],"recommendedAction":"deepen","recommendedNodeIds":[],"nextStep":""}\n問題:${JSON.stringify(input.challenge)}\n回答:${String(input.answer || '')}`;
    if (operation === 'research') return `${base}\n入力テーマについてWeb検索を実行し、検索結果から確認できた資料を3件以内で返してください。検索ツールを呼び出した後、URLは実際に確認したものだけを使ってください。JSON: {"sources":[{"title":"","url":"https://example.com"}]}\n${JSON.stringify(input)}`;
    if (operation === 'challenge_create') return `${base}\n入力に含まれるresourcesとそのURLを確認したうえで、次のノードについて1問作成してください。問題のresourceIdsには、根拠として使った入力resourcesのIDを必ず入れてください。JSON: {"id":"challenge-id","nodeId":"${input.node?.id || 'node-id'}","promptStyle":"why","difficulty":1,"prompt":"","expectedConcepts":[],"modelAnswer":"","explanation":"","rubric":[],"commonMisconceptions":[],"resourceIds":["resource-id"],"createdAt":"${iso()}"}\n${JSON.stringify(input)}`;
    if (operation === 'node_create') return `${base}\n検索で確認した出典を根拠に、新しい学習ノードと問題を1つ作成してください。resourcesには確認したURLを1件以上、challenges[0].resourceIdsにはそのresourceのIDを入れてください。JSON: {"node":{"id":"node-id","title":"","description":"","goal":""},"resources":[{"id":"resource-id","title":"","url":"https://example.com","language":"ja","type":"official_docs","authorityTier":"A","guidance":"","supports":["node-id"]}],"challenges":[{"id":"challenge-id","nodeId":"node-id","promptStyle":"why","difficulty":1,"prompt":"","expectedConcepts":[],"modelAnswer":"","explanation":"","rubric":[],"commonMisconceptions":[],"resourceIds":["resource-id"],"createdAt":"${iso()}"}]}\n${JSON.stringify(input)}`;
    if (operation === 'tree_propose') return `${base}\nまず入力テーマを検索して、各案の入口ノードと最初の問題をその検索結果から設計してください。学習ツリーの入口を3案作ってください。各案はrootとinitialNodesを含め、initialNodesには完全なNode形式を1つ入れてください。各案にchallengesを必ず1件以上入れ、その問題はrootのnodeIdを持ち、resourcesには検索で確認したURLを1件以上入れ、問題のresourceIdsから参照してください。JSON: {"proposals":[{"id":"proposal-id","title":"","philosophy":"","learnerProfile":"","branches":[],"advantages":[],"tradeoffs":"","root":{},"initialNodes":[],"initialEdges":[],"resources":[{"id":"resource-id","title":"","url":"https://example.com","language":"ja","type":"official_docs","authorityTier":"A","guidance":"","supports":["node-id"]}],"challenges":[{"id":"challenge-id","nodeId":"node-id","promptStyle":"why","difficulty":1,"prompt":"","expectedConcepts":[],"modelAnswer":"","explanation":"","rubric":[],"commonMisconceptions":[],"resourceIds":["resource-id"],"createdAt":"${iso()}"}]}]}\n${JSON.stringify(input)}`;
    if (operation === 'tree_propose') return `${base}\n学習ツリーの入口を3案作ってください。各案はrootとinitialNodesを含め、initialNodesには完全なNode形式を1つ入れてください。JSON: {"proposals":[{"id":"proposal-id","title":"","philosophy":"","learnerProfile":"","branches":[],"advantages":[],"tradeoffs":"","root":{},"initialNodes":[],"initialEdges":[],"resources":[],"challenges":[]}]}\n${JSON.stringify(input)}`;
    return `${base}\n事前調査で確認済みのverifiedResourcesを根拠に、指定ノードから${Number(input.branchCount) || 3}個の子ノードを作成してください。各子ノードに対応する問題を1つずつ作り、resourcesにはverifiedResourcesから使ったURLを含め、各問題のresourceIdsにそのIDを入れてください。JSON: {"nodes":[],"edges":[],"resources":[],"challenges":[]}。nodesとedgesとchallengesは同じ個数にしてください。${JSON.stringify(input)}`;
  }

  async function run(input, { backend, signal, emit }) {
    const operation = String(input?.operation || '').toLowerCase(); const payload = input?.payload && typeof input.payload === 'object' ? input.payload : input;
    if (!OPERATIONS.has(operation)) throw new Error('Challenge Tree operation is not supported');
    if (operation !== 'tree_propose' && operation !== 'node_create' && operation !== 'answer_grade' && payload.workspaceId && !getWorkspace(payload.workspaceId)) throw new Error('Workspace not found');
    emit('progress', { operation, message: '生成しています…' });
    let result = backend.name === 'mock' ? mockResult(operation, payload) : null;
    let research = { searchCalls: 0, searches: [], sources: [], logs: [] };
    if (backend.name !== 'mock') {
      let researchEvidence = { searchCalls: 0, searches: [], sources: [], logs: [] };
      let generationPayload = payload;
      if (['tree_propose', 'node_create', 'node_expand'].includes(operation)) {
        emit('progress', { operation, message: '出典を調査しています…' });
        let researchOutput = '';
        for await (const delta of backend.stream(promptFor('research', payload), { signal, webSearch: true })) researchOutput += delta;
        if (signal.aborted) return;
        const firstRunResearch = typeof backend.getLastResearch === 'function' ? backend.getLastResearch() : researchEvidence;
        let researchedSources = [];
        try { researchedSources = outputSources(extractJson(researchOutput)); } catch { researchedSources = textSources(researchOutput); }
        researchedSources = [...researchedSources, ...firstRunResearch.sources].filter((source, index, items) => items.findIndex((item) => item.url === source.url) === index);
        if (firstRunResearch.searchCalls < 1 || researchedSources.length < 1) throw new Error('Web検索で確認できる出典を取得できなかったため、学習データは保存しません。');
        researchEvidence = { ...firstRunResearch, sources: researchedSources };
        generationPayload = { ...payload, verifiedResources: researchedSources };
      }
      let output = '';
      for await (const delta of backend.stream(promptFor(operation, generationPayload), { signal, webSearch: true })) { output += delta; emit('message.delta', { operation, text: delta }); }
      if (signal.aborted) return;
      result = extractJson(output);
      const generationResearch = typeof backend.getLastResearch === 'function' ? backend.getLastResearch() : researchEvidence;
      research = {
        searchCalls: researchEvidence.searchCalls + generationResearch.searchCalls,
        searches: [...new Set([...researchEvidence.searches, ...generationResearch.searches])],
        sources: [...researchEvidence.sources, ...generationResearch.sources],
        logs: [...researchEvidence.logs, ...generationResearch.logs],
      };
      // The structured result is the app's durable source of truth. Preserve
      // URLs even when a particular Codex CLI version labels tool events
      // differently and the event inspector cannot see them.
      const structuredSources = outputSources(result);
      research = { ...research, sources: [...research.sources, ...structuredSources].filter((source, index, items) => items.findIndex((item) => item.url === source.url) === index) };
      // Do not silently accept an unsourced learning artifact. The UI should
      // never look complete when the question was only improvised by the LLM.
      if (['tree_propose', 'node_create', 'node_expand'].includes(operation) && (research.searchCalls < 1 || research.sources.length < 1)) {
        throw new Error('Web検索の実行結果を確認できなかったため、出典なしの学習データは保存しません。');
      }
    }
    emit('result.completed', { operation, result, research });
  }

  async function resources({ method, path, body }) {
    const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean); const [resourceName, id, subresource] = parts;
    if (resourceName === 'settings') {
      if (method === 'GET') return { status: 200, data: getSettings() };
      if (method === 'PUT') { const next = { ...getSettings(), ...(body || {}) }; db.prepare('UPDATE challenge_tree_settings SET data_json=?, updated_at=? WHERE id=1').run(JSON.stringify(next), Date.now()); return { status: 200, data: next }; }
    }
    if (resourceName !== 'workspaces') return { status: 404, data: { error: { code: 'not_found', message: 'Challenge Tree resource not found' } } };
    if (method === 'GET' && !id) return { status: 200, data: workspaceRows().map((row) => getWorkspace(row.id)).filter(Boolean) };
    if (method === 'POST' && !id) { if (subresource) return { status: 405, data: { error: { code: 'method_not_allowed', message: 'Method not allowed' } } }; const created = body?.project ? saveWorkspace(body) : createWorkspace(body); return created ? { status: 201, data: created } : { status: 400, data: { error: { code: 'invalid_input', message: 'topic is required' } } }; }
    if (!id) return { status: 404, data: { error: { code: 'not_found', message: 'Workspace not found' } } };
    if (subresource === 'snapshots') {
      if (method !== 'POST') return { status: 405, data: { error: { code: 'method_not_allowed', message: 'Method not allowed' } } };
      const workspace = getWorkspace(id); if (!workspace) return { status: 404, data: { error: { code: 'not_found', message: 'Workspace not found' } } };
      const snapshot = { id: `${id}:${Date.now()}:${randomUUID()}`, projectId: id, reason: String(body?.reason || 'manual'), createdAt: iso(), workspace: body?.workspace || workspace };
      db.prepare('INSERT INTO challenge_tree_snapshots VALUES (?, ?, ?, ?, ?)').run(snapshot.id, id, snapshot.reason, JSON.stringify(snapshot.workspace), Date.now());
      const old = db.prepare('SELECT id FROM challenge_tree_snapshots WHERE project_id=? ORDER BY created_at DESC').all(id).slice(3); for (const row of old) db.prepare('DELETE FROM challenge_tree_snapshots WHERE id=?').run(row.id);
      return { status: 201, data: snapshot };
    }
    const workspace = getWorkspace(id);
    if (method === 'GET') return workspace ? { status: 200, data: workspace } : { status: 404, data: { error: { code: 'not_found', message: 'Workspace not found' } } };
    if (method === 'PUT') {
      if (!body?.project || typeof body.project !== 'object') return { status: 400, data: { error: { code: 'invalid_input', message: 'workspace.project is required' } } };
      // PUT is an idempotent workspace replacement. It must also create the
      // resource so first-run samples and restored workspaces can use one
      // persistence path across devices.
      return { status: workspace ? 200 : 201, data: saveWorkspace(body, id) };
    }
    if (method === 'DELETE') { db.prepare('DELETE FROM challenge_tree_snapshots WHERE project_id=?').run(id); db.prepare('DELETE FROM challenge_tree_workspaces WHERE id=?').run(id); return { status: 204, data: null }; }
    return { status: 405, data: { error: { code: 'method_not_allowed', message: 'Method not allowed' } } };
  }

  return { resources, run };
}
