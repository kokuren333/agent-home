import { randomUUID } from 'node:crypto';

export function createApp({ db }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS demo_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS demo_messages_created_idx ON demo_messages(created_at);
  `);

  const message = (row) => ({ id: row.id, role: row.role, content: row.content, createdAt: row.created_at });

  async function run(input, { backend, signal, emit }) {
    const content = String(input?.message || '').trim();
    if (!content || content.length > 4000) throw new Error('messageは1〜4000文字で入力してください');
    db.prepare('INSERT INTO demo_messages (id, role, content, created_at) VALUES (?, ?, ?, ?)').run(randomUUID(), 'user', content, Date.now());
    const prompt = `ユーザーからの入力に、簡潔で役に立つ日本語で回答してください。入力をそのまま繰り返さず、前置きも不要です。\n\nユーザー入力:\n${content}`;
    let answer = '';
    for await (const delta of backend.stream(prompt, { signal })) {
      if (signal.aborted) return;
      answer += delta;
      emit('message.delta', { text: delta });
    }
    if (signal.aborted) return;
    const record = { id: randomUUID(), role: 'assistant', content: answer, createdAt: Date.now() };
    db.prepare('INSERT INTO demo_messages (id, role, content, created_at) VALUES (?, ?, ?, ?)').run(record.id, record.role, record.content, record.createdAt);
    emit('message.completed', { message: record });
    emit('result.completed', { result: { message: record } });
  }

  async function resources({ method, path }) {
    const name = path.replace(/^\/+|\/+$/g, '');
    if (name === 'messages' && method === 'GET') return { status: 200, data: { messages: db.prepare('SELECT * FROM demo_messages ORDER BY created_at, rowid').all().map(message) } };
    if (name === 'messages' && method === 'DELETE') { db.exec('DELETE FROM demo_messages'); return { status: 204, data: null }; }
    return { status: 404, data: { error: { code: 'not_found', message: 'Demo resource not found' } } };
  }

  return { run, resources };
}
