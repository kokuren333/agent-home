import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_AGENT_MODEL = 'gpt-5.6-luna';
const DEFAULT_REASONING_EFFORT = 'low';

export class Store {
  constructor(filename = path.resolve(process.env.DATA_DIR || './data', 'agent-home.db')) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, app_id TEXT NOT NULL, status TEXT NOT NULL, input_json TEXT NOT NULL, created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER, error TEXT);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, type TEXT NOT NULL, data_json TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_settings (id INTEGER PRIMARY KEY CHECK (id = 1), model TEXT NOT NULL DEFAULT '', reasoning_effort TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS app_order (
        app_id TEXT PRIMARY KEY,
        position INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_visibility (
        app_id TEXT PRIMARY KEY,
        hidden INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_run_idx ON events(run_id, created_at);
    `);
    const settings = this.db.prepare('SELECT id, model, reasoning_effort FROM agent_settings WHERE id=1').get();
    if (!settings) {
      this.db.prepare('INSERT INTO agent_settings VALUES (1, ?, ?, ?)').run(DEFAULT_AGENT_MODEL, DEFAULT_REASONING_EFFORT, Date.now());
    } else if (!settings.model && !settings.reasoning_effort) {
      // Upgrade the original blank setting row without overwriting a user's explicit choice.
      this.db.prepare('UPDATE agent_settings SET model=?, reasoning_effort=?, updated_at=? WHERE id=1').run(DEFAULT_AGENT_MODEL, DEFAULT_REASONING_EFFORT, Date.now());
    }
  }
  close() { this.db.close(); }
  createRun(appId, input) {
    const run = { id: randomUUID(), appId, status: 'queued', input, createdAt: Date.now(), startedAt: null, finishedAt: null, error: null };
    this.db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(run.id, appId, run.status, JSON.stringify(input ?? {}), run.createdAt, null, null, null);
    return run;
  }
  getRun(id) {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    return row ? this.#run(row) : null;
  }
  getAgentSettings() {
    const row = this.db.prepare('SELECT * FROM agent_settings WHERE id=1').get();
    return { model: row.model, reasoningEffort: row.reasoning_effort, updatedAt: row.updated_at };
  }
  updateAgentSettings({ model = '', reasoningEffort = '' } = {}) {
    this.db.prepare('UPDATE agent_settings SET model=?, reasoning_effort=?, updated_at=? WHERE id=1').run(model, reasoningEffort, Date.now());
    return this.getAgentSettings();
  }
  getAppOrder() {
    return this.db.prepare('SELECT app_id AS appId, position FROM app_order ORDER BY position, app_id').all();
  }
  setAppOrder(appIds) {
    const stamp = Date.now();
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM app_order');
      const insert = this.db.prepare('INSERT INTO app_order (app_id, position, updated_at) VALUES (?, ?, ?)');
      appIds.forEach((appId, position) => insert.run(appId, position, stamp));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getAppOrder();
  }
  getHiddenApps() {
    return this.db.prepare('SELECT app_id AS appId FROM app_visibility WHERE hidden=1 ORDER BY app_id').all().map(({ appId }) => appId);
  }
  setHiddenApps(appIds) {
    const stamp = Date.now();
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM app_visibility');
      const insert = this.db.prepare('INSERT INTO app_visibility (app_id, hidden, updated_at) VALUES (?, 1, ?)');
      appIds.forEach((appId) => insert.run(appId, stamp));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getHiddenApps();
  }
  updateRun(id, status, error = null) {
    const now = Date.now();
    const started = status === 'running' ? now : undefined;
    this.db.prepare(`UPDATE runs SET status = ?, error = ?, started_at = COALESCE(?, started_at), finished_at = ${['completed', 'failed', 'cancelled'].includes(status) ? '?' : 'finished_at'} WHERE id = ?`)
      .run(...(status === 'running' ? [status, error, started, id] : [status, error, null, ...( ['completed', 'failed', 'cancelled'].includes(status) ? [now, id] : [id] )]));
    return this.getRun(id);
  }
  addEvent(runId, type, data) {
    const event = { id: randomUUID(), runId, type, data: data ?? {}, createdAt: Date.now() };
    this.db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?)').run(event.id, runId, type, JSON.stringify(event.data), event.createdAt);
    return event;
  }
  listEvents(runId) { return this.db.prepare('SELECT * FROM events WHERE run_id = ? ORDER BY created_at, rowid').all(runId).map((row) => this.#event(row)); }
  #run(row) { return { id: row.id, appId: row.app_id, status: row.status, input: JSON.parse(row.input_json), createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at, error: row.error }; }
  #event(row) { return { id: row.id, runId: row.run_id, type: row.type, data: JSON.parse(row.data_json), createdAt: row.created_at }; }
}
