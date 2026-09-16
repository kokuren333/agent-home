const APP_STATE_ID = 1;
const MAX_STATE_BYTES = 25 * 1024 * 1024;

export function createApp({ db }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS freewill_taiseihoukan_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  return {
    async resources({ method, path, body }) {
      const resource = path.replace(/^\/+|\/+$/g, '');
      if (resource !== 'state') return { status: 404, data: { error: { code: 'not_found', message: 'State resource not found' } } };

      if (method === 'GET') {
        const row = db.prepare('SELECT data_json FROM freewill_taiseihoukan_state WHERE id=?').get(APP_STATE_ID);
        return row ? { status: 200, data: JSON.parse(row.data_json) } : { status: 204, data: null };
      }

      if (method === 'PUT') {
        if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, data: { error: { code: 'invalid_state', message: 'State must be a JSON object' } } };
        const dataJson = JSON.stringify(body);
        if (Buffer.byteLength(dataJson, 'utf8') > MAX_STATE_BYTES) return { status: 413, data: { error: { code: 'state_too_large', message: 'State is too large to save' } } };
        db.prepare(`
          INSERT INTO freewill_taiseihoukan_state (id, data_json, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at
        `).run(APP_STATE_ID, dataJson, Date.now());
        return { status: 200, data: body };
      }

      if (method === 'DELETE') {
        db.prepare('DELETE FROM freewill_taiseihoukan_state WHERE id=?').run(APP_STATE_ID);
        return { status: 204, data: null };
      }

      return { status: 405, data: { error: { code: 'method_not_allowed', message: 'Method not allowed' } } };
    },
  };
}
