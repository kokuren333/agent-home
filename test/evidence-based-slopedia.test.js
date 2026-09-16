import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../apps/evidence-based-slopedia/runtime.js';

test('EBS queue accepts article queries and prevents duplicate daily-news batches', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agent-home-ebs-'));
  const db = new DatabaseSync(path.join(root, 'test.db'));
  try {
    const app = createApp({ db });
    const article = await app.run({ action: 'enqueue_article', query: '量子コンピュータの誤り訂正' });
    assert.equal(article.status, 'queued');
    assert.equal(article.job.jobType, 'article');
    assert.match(article.job.createdAt, /^\d{4}-\d{2}-\d{2}T/);

    const first = await app.run({ action: 'enqueue_daily_news', date: '2026-09-16' });
    assert.equal(first.queuedCount, 10);
    assert.equal(first.activeCount, 10);
    const second = await app.run({ action: 'enqueue_daily_news', date: '2026-09-16' });
    assert.equal(second.skipped, true);
    assert.equal(second.status, 'generating');
    assert.equal(app.resources({ method: 'GET', path: '/jobs', query: new URLSearchParams('activeOnly=true') }).data.jobs.length, 11);

    db.prepare("UPDATE ebs_jobs SET status='completed' WHERE job_type='daily_news'").run();
    const complete = await app.run({ action: 'enqueue_daily_news', date: '2026-09-16' });
    assert.equal(complete.skipped, true);
    assert.equal(complete.status, 'generated');
    assert.equal(complete.existingCount, 10);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('EBS UI has only the launcher return, article query, news, and queue controls', async () => {
  const manifest = JSON.parse(await fs.readFile(path.resolve('apps/evidence-based-slopedia/manifest.json'), 'utf8'));
  assert.equal(manifest.entry, '/apps/evidence-based-slopedia/ui/index.html');
  assert.ok(manifest.description && manifest.icon && manifest.version);
  const ui = await Promise.all(['ui/index.html', 'ui/app.js', 'ui/runtime.js', 'ui/styles.css', 'ui/archive.html', 'ui/archive.js', 'ui/search.html', 'ui/search.js'].map((file) => fs.readFile(path.resolve('apps/evidence-based-slopedia', file), 'utf8')));
  const joined = ui.join('\n');
  assert.doesNotMatch(joined, /forecast|forcast|占い|運勢|webp|localStorage|indexedDB/i);
  assert.match(joined, /Launcherへ戻る/);
  assert.match(joined, /今日のニュースを生成/);
  assert.match(joined, /記事Queryを送信/);
  assert.match(joined, /投入/);
  assert.match(joined, /削除/);
  assert.match(joined, /archive\.html\?kind=articles/);
  assert.match(joined, /search\.html/);
  assert.doesNotMatch(joined, /Explore Topics|href="#topics"|href="\.\/index\.html#topics"/);
});

test('EBS upper search reads existing published articles without enqueueing a job', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agent-home-ebs-search-'));
  const db = new DatabaseSync(path.join(root, 'test.db'));
  try {
    await fs.mkdir(path.join(root, '10_Published'), { recursive: true });
    await fs.writeFile(path.join(root, '10_Published', 'sample.md'), '---\ntitle: 太陽光発電の基礎\n---\n\n発電量と蓄電池について。', 'utf8');
    const app = createApp({ db, root });
    const result = app.resources({ method: 'GET', path: '/search', query: new URLSearchParams('q=蓄電池') });
    assert.equal(result.data.articles.length, 1);
    assert.equal(result.data.articles[0].title, '太陽光発電の基礎');
    assert.equal(app.resources({ method: 'GET', path: '/jobs', query: new URLSearchParams('activeOnly=true') }).data.jobs.length, 0);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('EBS queue deletion is limited to queued or failed jobs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agent-home-ebs-delete-'));
  const db = new DatabaseSync(path.join(root, 'test.db'));
  try {
    const app = createApp({ db, root });
    const queued = await app.run({ action: 'enqueue_article', query: '削除テスト' });
    const removed = app.resources({ method: 'DELETE', path: `/jobs/${queued.job.id}`, query: new URLSearchParams() });
    assert.equal(removed.data.deleted, true);
    const running = await app.run({ action: 'enqueue_article', query: '処理中削除テスト' });
    db.prepare("UPDATE ebs_jobs SET status='running', phase='source_discovery' WHERE id=?").run(running.job.id);
    const refused = app.resources({ method: 'DELETE', path: `/jobs/${running.job.id}`, query: new URLSearchParams() });
    assert.equal(refused.status, 409);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('completed daily news exposes its article and image for the portal card', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agent-home-ebs-news-card-'));
  const db = new DatabaseSync(path.join(root, 'test.db'));
  try {
    const app = createApp({ db, root });
    const queued = await app.run({ action: 'enqueue_daily_news', date: '2026-09-16' });
    const jobId = queued.jobs.find((job) => job.newsField === 'Technology_AI').id;
    const article = path.join(root, '11_Daily', '03_Technology_AI', '2026-09', '2026-09-16_Technology_AI__card.md');
    await fs.mkdir(path.dirname(article), { recursive: true });
    await fs.writeFile(article, '---\ntitle: AIニュース\ndate: 2026-09-16\nfield: Technology_AI\ninfographic_path: 50_Assets/Infographics/Daily/2026-09-16_Technology_AI.png\n---\n\n本文', 'utf8');
    db.prepare("UPDATE ebs_jobs SET status='completed', phase='published' WHERE id=?").run(jobId);
    const state = app.resources({ method: 'GET', path: '/daily_news_state', query: new URLSearchParams('date=2026-09-16') }).data;
    const cardJob = state.jobs.find((job) => job.id === jobId);
    assert.equal(cardJob.articlePath, '11_Daily/03_Technology_AI/2026-09/2026-09-16_Technology_AI__card.md');
    assert.equal(cardJob.imagePath, '50_Assets/Infographics/Daily/2026-09-16_Technology_AI.png');
    const opened = app.resources({ method: 'GET', path: '/article', query: new URLSearchParams(`path=${cardJob.articlePath}`) });
    assert.equal(opened.status, 200);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
