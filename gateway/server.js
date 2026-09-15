import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { Store } from './store.js';
import { createBackend } from './backend.js';
import { createImageGenerator } from './imagegen.js';
import { PROTOCOL_VERSION, errorPayload, isValidManifest } from '../packages/app-protocol/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = new Store();
const backend = createBackend();
const imageGenerator = createImageGenerator(ROOT);
const apps = new Map();
const controllers = new Map();
const subscribers = new Map();
const REASONING_EFFORTS = new Set(['', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
let modelCatalog = { models: [], fetchedAt: 0 };

async function discoverApps() {
  const appsDir = path.join(ROOT, 'apps');
  for (const name of fs.readdirSync(appsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
    try {
      const dir = path.join(appsDir, name);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      if (!isValidManifest(manifest)) throw new Error('invalid manifest');
      const module = await import(`../apps/${name}/runtime.js`);
      apps.set(manifest.id, { manifest, runtime: module.createApp({ db: store.db, store, imageGenerator }) });
    } catch (error) { console.error(`Could not load app ${name}:`, error.message); }
  }
}

async function getAgentModels() {
  const now = Date.now();
  if (now - modelCatalog.fetchedAt < 60_000) return modelCatalog;
  try {
    const models = typeof backend.listModels === 'function' ? await backend.listModels() : [];
    modelCatalog = { models, fetchedAt: now };
  } catch (error) {
    modelCatalog = { models: [], fetchedAt: now, error: { code: 'model_catalog_unavailable', message: error.message } };
  }
  return modelCatalog;
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(payload === null ? '' : JSON.stringify(payload));
}
function protocolError(res, status, code, message, details) { json(res, status, errorPayload(code, message, details)); }
async function readBody(req) {
  let raw = ''; for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Request body must be JSON'), { status: 400, code: 'invalid_json' }); }
}
function emit(runId, type, data) {
  const event = store.addEvent(runId, type, data);
  for (const listener of subscribers.get(runId) || []) listener(event);
  return event;
}
function sse(res, event) { res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`); }
function startRun(run, app) {
  const controller = new AbortController(); controllers.set(run.id, controller);
  void (async () => {
    store.updateRun(run.id, 'running'); emit(run.id, 'run.started', { runId: run.id });
    try {
      const runBackend = typeof backend.withSettings === 'function' ? backend.withSettings(store.getAgentSettings()) : backend;
      await app.runtime.run(run.input, { backend: runBackend, signal: controller.signal, emit: (type, data) => emit(run.id, type, data), store, db: store.db });
      if (controller.signal.aborted) { store.updateRun(run.id, 'cancelled'); emit(run.id, 'run.cancelled', {}); }
      else { store.updateRun(run.id, 'completed'); emit(run.id, 'run.completed', {}); }
    } catch (error) {
      store.updateRun(run.id, 'failed', error.message); emit(run.id, 'run.failed', { code: 'run_failed', message: error.message });
    } finally { controllers.delete(run.id); }
  })();
}
function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'launcher/index.html' : pathname.replace(/^\//, '');
  const target = path.resolve(ROOT, relative);
  const publicRoots = [path.join(ROOT, 'launcher'), path.join(ROOT, 'apps'), path.join(ROOT, 'ui'), path.join(ROOT, 'data', 'character-icons')];
  const isPublic = publicRoots.some((root) => target === root || target.startsWith(root + path.sep));
  if (!isPublic || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return protocolError(res, 404, 'not_found', 'File not found');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  res.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream', 'cache-control': pathname.includes('/assets/') ? 'public, max-age=3600' : 'no-store' });
  fs.createReadStream(target).pipe(res);
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost'); const pathname = url.pathname; const method = req.method;
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
  try {
    if (pathname === '/api/health' && method === 'GET') return json(res, 200, { ok: true, protocolVersion: PROTOCOL_VERSION, backend: await backend.health(), agentSettings: store.getAgentSettings(), apps: apps.size, time: new Date().toISOString() });
    if (pathname === '/api/settings/agent' && method === 'GET') return json(res, 200, store.getAgentSettings());
    if (pathname === '/api/settings/agent/models' && method === 'GET') return json(res, 200, { source: backend.name, ...(await getAgentModels()) });
    if (pathname === '/api/settings/agent' && method === 'PUT') {
      const body = await readBody(req);
      const model = String(body.model || '').trim();
      const reasoningEffort = String(body.reasoningEffort || '').trim().toLowerCase();
      if (model.length > 100 || /\s/.test(model)) return protocolError(res, 400, 'invalid_input', 'モデル名は空白なしで100文字以内にしてください');
      if (!REASONING_EFFORTS.has(reasoningEffort)) return protocolError(res, 400, 'invalid_input', 'reasoning effortが不正です');
      return json(res, 200, store.updateAgentSettings({ model, reasoningEffort }));
    }
    if (pathname === '/api/apps' && method === 'GET') return json(res, 200, [...apps.values()].map(({ manifest }) => manifest));
    const appMatch = pathname.match(/^\/api\/apps\/([^/]+)(?:\/(.*))?$/);
    if (appMatch) {
      const app = apps.get(decodeURIComponent(appMatch[1])); const tail = appMatch[2] || '';
      if (!app) return protocolError(res, 404, 'app_not_found', 'App not found');
      if (!tail && method === 'GET') return json(res, 200, app.manifest);
      if (tail === 'resources' || tail.startsWith('resources/')) {
        if (!app.runtime.resources) return protocolError(res, 404, 'unsupported', 'This app has no resources capability');
        const body = ['POST', 'PATCH', 'PUT'].includes(method) ? await readBody(req) : {};
        const result = await app.runtime.resources({ method, path: tail.replace(/^resources/, ''), body, query: url.searchParams });
        return json(res, result.status, result.data);
      }
      if (tail === 'runs' && method === 'POST') { const run = store.createRun(app.manifest.id, await readBody(req)); startRun(run, app); return json(res, 202, run); }
    }
    const runMatch = pathname.match(/^\/api\/runs\/([^/]+)(?:\/(events|cancel))?$/);
    if (runMatch) {
      const run = store.getRun(runMatch[1]); if (!run) return protocolError(res, 404, 'run_not_found', 'Run not found');
      if (!runMatch[2] && method === 'GET') return json(res, 200, run);
      if (runMatch[2] === 'cancel' && method === 'POST') { const controller = controllers.get(run.id); if (controller) controller.abort(); return json(res, 202, { ...run, status: controller ? 'cancelling' : run.status }); }
      if (runMatch[2] === 'events' && method === 'GET') {
        if (!req.headers.accept?.includes('text/event-stream')) return json(res, 200, store.listEvents(run.id));
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
        for (const event of store.listEvents(run.id)) sse(res, event);
        if (['completed', 'failed', 'cancelled'].includes(run.status)) return res.end();
        const listeners = subscribers.get(run.id) || new Set();
        const cleanup = () => { listeners.delete(listener); if (!listeners.size) subscribers.delete(run.id); };
        const listener = (event) => { sse(res, event); if (['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)) { cleanup(); res.end(); } };
        listeners.add(listener); subscribers.set(run.id, listeners); req.on('close', cleanup); return;
      }
    }
    return protocolError(res, 404, 'not_found', 'Endpoint not found');
  } catch (error) { return protocolError(res, error.status || 500, error.code || 'internal_error', error.message); }
}

await discoverApps();
const port = Number(process.env.PORT || 8787);
http.createServer(handler).listen(port, '0.0.0.0', () => console.log(`agent-home listening on http://0.0.0.0:${port} (${apps.size} apps)`));
