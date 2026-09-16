import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import pathModule from 'node:path';
import katex from 'katex';

const NEWS_FIELDS = [
  'Politics_International_Relations',
  'Economy_Finance',
  'Technology_AI',
  'Science_Medicine_Life',
  'Environment_Energy_Resources',
  'Society_Population_Education',
  'Culture_Media_Ideas',
  'Law_Institutions_Ethics',
  'Business_Industry_Innovation',
  'Incidents_Risks_Safety',
];
const ACTIVE = ['queued', 'running', 'waiting_publish', 'publishing'];
const GENERATED = ['completed', 'published', 'succeeded'];
const DEFAULT_WORKER_CONCURRENCY = 3;
const iso = () => new Date().toISOString();

function publicJob(row) {
  return {
    id: row.id,
    jobType: row.job_type,
    query: row.query,
    mode: row.mode,
    status: row.status,
    phase: row.phase || null,
    error: row.error || null,
    dailyDate: row.daily_date || null,
    newsField: row.news_field || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    heartbeatAt: row.heartbeat_at || null,
  };
}

function walkFiles(root, predicate = () => true) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = pathModule.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && predicate(target)) result.push(target);
    }
  };
  visit(root);
  return result;
}

function pngInfo(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length };
}

export function createApp({ db, root, imageGenerator } = {}) {
  const contentRoot = pathModule.resolve(process.env.EBS_CONTENT_ROOT || root || process.cwd());
  db.exec(`
    CREATE TABLE IF NOT EXISTS ebs_jobs (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      query TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      daily_date TEXT NOT NULL DEFAULT '',
      news_field TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      phase TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS ebs_jobs_daily_idx ON ebs_jobs(job_type, daily_date, status);
    CREATE INDEX IF NOT EXISTS ebs_jobs_updated_idx ON ebs_jobs(updated_at DESC);
  `);
  for (const statement of [
    "ALTER TABLE ebs_jobs ADD COLUMN phase TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE ebs_jobs ADD COLUMN error TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE ebs_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE ebs_jobs ADD COLUMN heartbeat_at TEXT NOT NULL DEFAULT ''",
  ]) {
    try { db.exec(statement); } catch (error) { if (!/duplicate column name/i.test(String(error.message))) throw error; }
  }
  const recovered = db.prepare("UPDATE ebs_jobs SET status='failed', phase='failed', error='Gateway再起動前に処理が中断されました。最初からやり直してください。', updated_at=? WHERE status IN ('running', 'waiting_publish', 'publishing')").run(iso());

  const rowsForDate = (date) => db.prepare(
    'SELECT * FROM ebs_jobs WHERE job_type=? AND daily_date=? ORDER BY created_at ASC',
  ).all('daily_news', date);

  function dailyState(date) {
    const rows = rowsForDate(date);
    const generatedFields = new Set(rows.filter((row) => GENERATED.includes(row.status)).map((row) => row.news_field).filter(Boolean));
    const activeFields = new Set(rows.filter((row) => ACTIVE.includes(row.status)).map((row) => row.news_field).filter(Boolean));
    return {
      date,
      existingCount: generatedFields.size,
      activeCount: activeFields.size,
      jobs: rows.map((row) => {
        const job = publicJob(row);
        const article = newsEntryForJob(row);
        return article ? { ...job, articlePath: article.path, imagePath: article.imagePath || null } : job;
      }),
      complete: generatedFields.size >= NEWS_FIELDS.length,
      generating: generatedFields.size + activeFields.size >= NEWS_FIELDS.length && generatedFields.size < NEWS_FIELDS.length,
    };
  }

  function insertJob({ jobType, query, mode = 'new', dailyDate = '', newsField = '', payload = {} }) {
    const now = iso();
    const id = randomUUID();
    db.prepare(`INSERT INTO ebs_jobs
      (id, job_type, query, mode, status, daily_date, news_field, payload_json, phase, error, created_at, updated_at, heartbeat_at)
      VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, '', '', ?, ?, ?)`).run(
      id, jobType, query, mode, dailyDate, newsField, JSON.stringify(payload), now, now, now,
    );
    return publicJob(db.prepare('SELECT * FROM ebs_jobs WHERE id=?').get(id));
  }

  function searchArticles(query, limit) {
    const articlesRoot = pathModule.join(contentRoot, '10_Published');
    if (!fs.existsSync(articlesRoot)) return [];
    const needle = query.toLocaleLowerCase('ja-JP');
    const files = [];
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = pathModule.join(directory, entry.name);
        if (entry.isDirectory()) visit(target);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(target);
      }
    };
    visit(articlesRoot);
    return files.filter((file) => !pathModule.basename(file).startsWith('MOC - ')).map((file) => {
      const body = fs.readFileSync(file, 'utf8');
      const title = body.match(/^title:\s*["']?(.+?)["']?\s*$/mi)?.[1]?.trim() || pathModule.basename(file, '.md');
      const plain = body.replace(/^---[\s\S]*?---\s*/m, '').replace(/[#>*`_\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      return { title, path: pathModule.relative(contentRoot, file).replace(/\\/g, '/'), imagePath: frontmatterValue(body, 'infographic_path'), excerpt: plain.slice(0, 180), haystack: `${title} ${plain}`.toLocaleLowerCase('ja-JP') };
    }).filter((article) => article.haystack.includes(needle)).slice(0, limit).map(({ haystack, ...article }) => article);
  }

  function frontmatterValue(body, key) {
    return body.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'mi'))?.[1]?.trim() || '';
  }

  function articleByPath(value) {
    let relative = String(value || '').replaceAll('\\\\', '/');
    while (relative.startsWith('/')) relative = relative.slice(1);
    if (!relative || relative.includes('..') || !relative.toLowerCase().endsWith('.md')) return null;
    const file = pathModule.resolve(contentRoot, relative);
    const allowedRoots = ['10_Published', '11_Daily'].map((name) => pathModule.resolve(contentRoot, name));
    if (!allowedRoots.some((root) => file.startsWith(`${root}${pathModule.sep}`)) || !fs.existsSync(file)) return null;
    const body = fs.readFileSync(file, 'utf8');
    const title = frontmatterValue(body, 'title') || pathModule.basename(file, '.md').split('__')[0];
    const date = frontmatterValue(body, 'date') || frontmatterValue(body, 'updated') || frontmatterValue(body, 'created') || '';
    const imagePath = frontmatterValue(body, 'infographic_path');
    const math = [];
    const protectMath = (expression, displayMode) => {
      const token = `EBE_MATH_${math.length}`;
      math.push(katex.renderToString(String(expression).trim(), { displayMode, throwOnError: false, output: 'mathml' }));
      return token;
    };
    let content = body.replace(/^---[\s\S]*?---\s*/m, '').trim();
    content = content.replace(/\$\$([\s\S]+?)\$\$/g, (_match, expression) => protectMath(expression, true));
    content = content.replace(/\\\[([\s\S]+?)\\\]/g, (_match, expression) => protectMath(expression, true));
    content = content.replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (_match, expression) => protectMath(expression, false));
    content = content.replace(/\\\(([^\n]+?)\\\)/g, (_match, expression) => protectMath(expression, false));
    return { title, date, imagePath, path: relative, content, math };
  }

  function archiveEntries(kind) {
    const directory = pathModule.join(contentRoot, kind === 'news' ? '11_Daily' : '10_Published');
    return walkFiles(directory, (file) => file.toLowerCase().endsWith('.md')).map((file) => {
      const body = fs.readFileSync(file, 'utf8');
      const fileName = pathModule.basename(file);
      const date = frontmatterValue(body, 'date') || frontmatterValue(body, 'updated') || frontmatterValue(body, 'created') || fileName.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      return {
        date,
        title: frontmatterValue(body, 'title') || fileName.replace(/\.md$/i, ''),
        field: frontmatterValue(body, 'field') || frontmatterValue(body, 'category_id').replace(/^\d+_/, ''),
        path: pathModule.relative(contentRoot, file).replace(/\\/g, '/'),
        imagePath: frontmatterValue(body, 'infographic_path'),
      };
    }).filter(Boolean).sort((a, b) => `${b.date}/${b.title}`.localeCompare(`${a.date}/${a.title}`));
  }

  function newsEntryForJob(job) {
    if (job.job_type !== 'daily_news' || !GENERATED.includes(job.status)) return null;
    const entries = archiveEntries('news').filter((entry) => entry.date === job.daily_date && entry.field === job.news_field);
    return entries.find((entry) => !entry.path.endsWith(`/${job.daily_date}_${job.news_field}.md`)) || entries[0] || null;
  }

  function updateJob(id, status, phase, error = '') {
    const now = iso();
    db.prepare('UPDATE ebs_jobs SET status=?, phase=?, error=?, updated_at=?, heartbeat_at=? WHERE id=?').run(status, phase || '', error || '', now, now, id);
  }

  function touchJob(id) {
    const now = iso();
    db.prepare('UPDATE ebs_jobs SET heartbeat_at=?, updated_at=? WHERE id=? AND status IN (?, ?, ?, ?)').run(now, now, id, ...ACTIVE);
  }

  function workflowPrompt(job, researchPath) {
    const target = job.job_type === 'daily_news'
      ? `今日の日付は${job.daily_date}、対象フィールドは${job.news_field}。${job.daily_date}の前日から当日（JST）のニュースを扱い、11_Dailyの固定パス規則に従う。`
      : `記事テーマは「${job.query}」。10_Published内で内容に合う大分類と小分野を選ぶ。`;
    return `EBSの記事作成Workerとして実行する。説明や手順の回答ではなく、指定されたファイルを実際に作成すること。

まずAGENTS.md、.agents/skills/ebe-orchestrator/SKILL.md、.agents/skills/EBE-SHARED-CONTRACT.md、設定ファイル、対象ワークフローのSkillを読む。${target}

信頼できる一次資料・公的機関・査読研究・公式資料を優先してライブ検索し、実際に読んだURLだけを採用する。主張と出典を対応付け、反証・不確実性を確認する。調査、分類、ソース評価、claim抽出、統合、矛盾確認、構成、草稿の工程を実行する。

公開前の調査成果とインフォグラフィックbriefを、必ず次のファイルに保存する：${researchPath}
briefには、記事の主張に対応する日本語インフォグラフィックの内容、引用番号、横長16:9、安全余白を含める。まだ10_Publishedまたは11_Dailyへ最終記事を保存しない。既存記事は上書きしない。

完了条件は、調査成果とbriefがファイルとして存在し、URL付きソースとclaim-source対応が記録されていること。条件を満たせない場合は理由を同じ作業ディレクトリ内に記録する。`;
  }

  function finalPrompt(job, researchPath, infographicPath) {
    const target = job.job_type === 'daily_news'
      ? `11_Dailyの固定フィールド・日付パスに保存する。type: daily_news、date: ${job.daily_date}を使う。`
      : '10_Published内の大分類／小分野ディレクトリに保存する。';
    return `EBSの公開工程を続行する。${researchPath}を読み、前段で実際に確認したソースだけを使う。${target}

次の工程をすべて実行する：教科書的な日本語本文への改稿、分類と小分野MOC更新、公開用frontmatter整備、画像参照の挿入、publish edit、citation audit、quality audit、Obsidian publisher。

画像はすでにimagegenで生成され、Vault内の次のPNGとして保存されている：${infographicPath}
この記事の先頭にObsidian埋め込みとして参照し、図解キャプションにも引用番号を付ける。frontmatterには必ず status: published、draft: false、publish_ready: true、has_infographic: true、および画像参照のキーを設定する。引用番号付き本文、URLとAccessed date付き参考ソース、歴史的背景、現在の標準、限界・論争点・未解決事項、更新履歴・更新日付も満たすこと。

Publish Gateを満たす場合だけ最終記事を所定の公開ディレクトリへ保存する。満たさない場合は公開ディレクトリへ置かず、理由を_working/review_reportsまたは70_Logsへ保存する。既存ファイルを上書きしない。説明だけで終わらせず、ファイルを実際に更新する。`;
  }

  function outputCandidates(job, startedAt, beforeFiles = new Set()) {
    const rootName = job.job_type === 'daily_news' ? '11_Daily' : '10_Published';
    const rootPath = pathModule.join(contentRoot, rootName);
    return walkFiles(rootPath, (file) => file.toLowerCase().endsWith('.md') && fs.statSync(file).mtimeMs >= startedAt - 2000)
      .filter((file) => !beforeFiles.has(file))
      .filter((file) => !pathModule.basename(file).startsWith('MOC - '))
      .filter((file) => job.job_type !== 'daily_news' || (file.includes(job.daily_date) && file.includes(job.news_field)));
  }

  function validatePublishedFile(file, job, infographicPath) {
    const text = fs.readFileSync(file, 'utf8');
    const required = [/status:\s*published/i, /draft:\s*false/i, /publish_ready:\s*true/i, /has_infographic:\s*true/i, /参考ソース/, /更新履歴/, /https?:\/\//i];
    if (job.job_type === 'daily_news') required.push(/type:\s*daily_news/i, new RegExp(`date:\\s*${job.daily_date}`));
    if (required.some((pattern) => !pattern.test(text))) throw new Error(`Publish Gate failed: required article fields or evidence are missing (${pathModule.relative(contentRoot, file)})`);
    if (!text.includes(infographicPath.replace(/\\/g, '/'))) throw new Error(`Publish Gate failed: infographic reference is missing (${pathModule.relative(contentRoot, file)})`);
  }

  function ensureInfographicFrontmatter(file) {
    let text = fs.readFileSync(file, 'utf8');
    if (!/^---[\s\S]*?---/m.test(text) || /^has_infographic:\s*true\s*$/mi.test(text)) return;
    text = text.replace(/^(publish_ready:\s*true\s*)$/mi, '$1\nhas_infographic: true');
    fs.writeFileSync(file, text);
  }

  async function processJob(job, backendForWorker, generator) {
    const startedAt = Date.now();
    const workDir = pathModule.join(contentRoot, '_working', 'ebs-jobs', job.id);
    const researchPath = pathModule.join(workDir, 'research.md');
    const outputName = job.job_type === 'daily_news' ? `${job.daily_date}_${job.news_field}.png` : `${job.id}.png`;
    const generatedPath = pathModule.join(generator.root || process.cwd(), 'data', 'ebs-imagegen', job.id, outputName);
    const infographicPath = job.job_type === 'daily_news' ? pathModule.join('50_Assets', 'Infographics', 'Daily', outputName) : pathModule.join('50_Assets', 'Infographics', outputName);
    const copiedPath = pathModule.join(contentRoot, infographicPath);
    fs.mkdirSync(workDir, { recursive: true });
    const heartbeat = setInterval(() => touchJob(job.id), 15_000);
    const articleRoot = pathModule.join(contentRoot, job.job_type === 'daily_news' ? '11_Daily' : '10_Published');
    try {
      const beforeFiles = new Set(walkFiles(articleRoot, (file) => file.toLowerCase().endsWith('.md')));
      updateJob(job.id, 'running', 'source_discovery');
      await backendForWorker.run(workflowPrompt(job, researchPath), { cwd: contentRoot, webSearch: true, write: true });
      if (!fs.existsSync(researchPath)) throw new Error('EBS worker did not create the required research record.');
      updateJob(job.id, 'running', 'image_generation');
      const brief = fs.readFileSync(researchPath, 'utf8').slice(0, 30000);
      await generator.generate(brief, { outputPath: generatedPath, purpose: 'infographic' });
      const image = pngInfo(generatedPath);
      if (!image || image.bytes === 0) throw new Error('imagegen did not create a valid PNG.');
      if (Math.abs(image.width / image.height - 16 / 9) > 0.12) throw new Error(`imagegen output is not 16:9 (${image.width}x${image.height}).`);
      fs.mkdirSync(pathModule.dirname(copiedPath), { recursive: true });
      fs.copyFileSync(generatedPath, copiedPath);
      const logPath = pathModule.join(contentRoot, '70_Logs', 'infographic_logs', `${job.id}.json`);
      fs.mkdirSync(pathModule.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, JSON.stringify({ jobId: job.id, sourcePath: generatedPath, copiedPath, width: image.width, height: image.height, bytes: image.bytes, format: 'PNG', readability: 'worker visual verification required' }, null, 2));
      updateJob(job.id, 'running', 'publishing');
      await backendForWorker.run(finalPrompt(job, researchPath, infographicPath), { cwd: contentRoot, webSearch: true, write: true });
      const candidates = outputCandidates(job, startedAt, beforeFiles);
      if (candidates.length !== 1) throw new Error(`EBS worker expected one new published article, found ${candidates.length}.`);
      ensureInfographicFrontmatter(candidates[0]);
      validatePublishedFile(candidates[0], job, infographicPath);
      updateJob(job.id, 'completed', 'published');
    } finally {
      clearInterval(heartbeat);
    }
  }

  let workerPromise = null;
  let workerState = { connected: false, message: 'Worker未接続。AGENT_BACKEND=codexで起動してください。' };
  const workerConcurrency = Math.max(1, Math.min(8, Number.parseInt(process.env.EBS_WORKER_CONCURRENCY || String(DEFAULT_WORKER_CONCURRENCY), 10) || DEFAULT_WORKER_CONCURRENCY));
  function claimNextJob() {
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare("SELECT * FROM ebs_jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1").get();
      if (!row) { db.exec('COMMIT'); return null; }
      db.prepare("UPDATE ebs_jobs SET status='running', phase='source_discovery', attempt_count=attempt_count+1, updated_at=? WHERE id=? AND status='queued'").run(iso(), row.id);
      const claimed = db.prepare('SELECT * FROM ebs_jobs WHERE id=?').get(row.id);
      db.exec('COMMIT');
      return claimed;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function retryableError(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function cleanupFailedAttempt(job, { force = false } = {}) {
    const startedAt = Date.parse(job.updated_at || '') || 0;
    const recent = (file) => fs.existsSync(file) && (force || !startedAt || fs.statSync(file).mtimeMs >= startedAt - 2000);
    const workDir = pathModule.join(contentRoot, '_working', 'ebs-jobs', job.id);
    const generatedName = job.job_type === 'daily_news' ? `${job.daily_date}_${job.news_field}.png` : `${job.id}.png`;
    const generatedPath = pathModule.join(root || process.cwd(), 'data', 'ebs-imagegen', job.id, generatedName);
    const infographicPath = job.job_type === 'daily_news'
      ? pathModule.join(contentRoot, '50_Assets', 'Infographics', 'Daily', generatedName)
      : pathModule.join(contentRoot, '50_Assets', 'Infographics', generatedName);
    for (const file of [generatedPath, infographicPath, pathModule.join(contentRoot, '70_Logs', 'infographic_logs', `${job.id}.json`)]) {
      if (recent(file)) { try { fs.rmSync(file, { force: true }); } catch {} }
    }
    if (recent(workDir)) { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {} }
    const articleFile = job.job_type === 'daily_news'
      ? pathModule.join(contentRoot, '11_Daily', job.news_field, job.daily_date.slice(0, 7), `${job.daily_date}_${job.news_field}.md`)
      : null;
    if (articleFile && recent(articleFile)) { try { fs.rmSync(articleFile, { force: true }); } catch {} }
  }
  function runWorker(backendForWorker, generator) {
    return (async () => {
      while (true) {
        const row = claimNextJob();
        if (!row) return;
        try { await processJob(row, backendForWorker, generator); }
        catch (error) {
          const message = retryableError(error);
          cleanupFailedAttempt(row);
          updateJob(row.id, 'failed', 'failed', message);
        }
      }
    })();
  }
  function startWorker({ backend: backendForWorker, imageGenerator: generator = imageGenerator } = {}) {
    if (!backendForWorker || backendForWorker.name !== 'codex-cli' || !generator) {
      workerState = { connected: false, message: 'Worker未接続。AGENT_BACKEND=codexで起動してください。' };
      return;
    }
    workerState = { connected: true, message: 'Worker接続済み' };
    if (workerPromise) return;
    workerPromise = Promise.all(Array.from({ length: workerConcurrency }, () => runWorker(backendForWorker, generator))).finally(() => { workerPromise = null; });
  }

  function enqueueDailyNews(date) {
    const state = dailyState(date);
    if (state.complete) return { status: 'generated', skipped: true, message: '今日のニュースは生成済みです。', ...state };
    if (state.generating) return { status: 'generating', skipped: true, message: '今日のニュースは生成中です。', ...state };
    const occupied = new Set(state.jobs.filter((job) => ACTIVE.includes(job.status) || GENERATED.includes(job.status)).map((job) => job.newsField).filter(Boolean));
    const missing = NEWS_FIELDS.filter((field) => !occupied.has(field));
    const jobs = missing.slice(0, NEWS_FIELDS.length - state.existingCount - state.activeCount)
      .map((field) => insertJob({ jobType: 'daily_news', query: `今日のニュース：${field}`, dailyDate: date, newsField: field, payload: { date, field } }));
    const next = dailyState(date);
    return { status: 'generating', skipped: false, queuedCount: jobs.length, message: `今日のニュースを生成中です（${next.existingCount + next.activeCount}/${NEWS_FIELDS.length}件）。`, ...next };
  }

  async function run(input, { emit, backend } = {}) {
    const action = String(input?.action || '');
    if (action === 'enqueue_article') {
      const query = String(input.query || '').trim();
      if (!query || query.length > 4000) throw new Error('記事Queryは1〜4000文字で入力してください。');
      const job = insertJob({ jobType: 'article', query, mode: input.mode === 'update' ? 'update' : 'new', payload: { query } });
      startWorker({ backend, imageGenerator });
      emit?.('job.queued', { job });
      emit?.('result.completed', { operation: action, result: { status: 'queued', message: '記事Queryをキューに登録しました。', job } });
      return { status: 'queued', message: '記事Queryをキューに登録しました。', job };
    }
    if (action === 'enqueue_daily_news') {
      const date = String(input.date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日付が不正です。');
      const result = enqueueDailyNews(date);
      startWorker({ backend, imageGenerator });
      emit?.('job.queued', { date, queuedCount: result.queuedCount || 0, status: result.status });
      emit?.('result.completed', { operation: action, result });
      return result;
    }
    throw new Error('未対応の操作です。');
  }

  function resources({ method, path, query }) {
    const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    const [name] = parts;
    if (name === 'jobs' && method === 'GET') {
      const requested = Number(query?.get('limit') || 50);
      const limit = Number.isFinite(requested) ? Math.max(1, Math.min(100, Math.floor(requested))) : 50;
      const activeOnly = query?.get('activeOnly') === 'true';
      const rows = activeOnly
        ? db.prepare(`SELECT * FROM ebs_jobs WHERE status IN (${ACTIVE.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT ?`).all(...ACTIVE, limit)
        : db.prepare('SELECT * FROM ebs_jobs ORDER BY created_at DESC LIMIT ?').all(limit);
      return { status: 200, data: { jobs: rows.map(publicJob) } };
    }
    if (name === 'jobs' && parts.length === 2 && method === 'DELETE') {
      const id = parts[1];
      const job = db.prepare('SELECT * FROM ebs_jobs WHERE id=?').get(id);
      if (!job) return { status: 404, data: { error: { code: 'job_not_found', message: 'ジョブが見つかりません。' } } };
      if (job.status !== 'queued' && job.status !== 'failed') return { status: 409, data: { error: { code: 'job_not_deletable', message: '処理中または完了済みのジョブは削除できません。' } } };
      db.prepare('DELETE FROM ebs_jobs WHERE id=?').run(id);
      return { status: 200, data: { deleted: true, id } };
    }
    if (name === 'jobs' && parts.length === 2 && parts[1] === 'clear-queue' && method === 'POST') {
      const result = db.prepare("DELETE FROM ebs_jobs WHERE status='queued'").run();
      return { status: 200, data: { deletedCount: result.changes } };
    }
    if (name === 'jobs' && parts.length === 3 && method === 'POST' && parts[2] === 'restart') {
      const id = parts[1];
      const job = db.prepare('SELECT * FROM ebs_jobs WHERE id=?').get(id);
      if (!job) return { status: 404, data: { error: { code: 'job_not_found', message: 'ジョブが見つかりません。' } } };
      if (job.status !== 'failed') return { status: 409, data: { error: { code: 'job_not_restartable', message: '失敗済みのジョブだけ最初からやり直せます。' } } };
      cleanupFailedAttempt(job, { force: true });
      db.prepare("UPDATE ebs_jobs SET status='queued', phase='restart_queued', error='', attempt_count=0, updated_at=?, heartbeat_at=? WHERE id=?").run(iso(), iso(), id);
      const next = publicJob(db.prepare('SELECT * FROM ebs_jobs WHERE id=?').get(id));
      return { status: 202, data: { queued: true, mode: parts[2], job: next } };
    }
    if (name === 'search' && method === 'GET') {
      const value = String(query?.get('q') || '').trim();
      const requested = Number(query?.get('limit') || 20);
      const limit = Number.isFinite(requested) ? Math.max(1, Math.min(50, Math.floor(requested))) : 20;
      return { status: 200, data: { query: value, articles: searchArticles(value, limit) } };
    }
    if (name === 'article' && method === 'GET') {
      const article = articleByPath(query?.get('path'));
      return article ? { status: 200, data: article } : { status: 404, data: { error: { code: 'article_not_found', message: '記事が見つかりません。' } } };
    }
    if (name === 'worker_status' && method === 'GET') return { status: 200, data: workerState };
    if (name === 'archive' && method === 'GET') {
      const kind = query?.get('kind') === 'news' ? 'news' : 'articles';
      return { status: 200, data: { kind, entries: archiveEntries(kind) } };
    }
    if (name === 'daily_news_state' && method === 'GET') {
      const date = String(query?.get('date') || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { status: 400, data: { error: { code: 'invalid_date', message: 'date is required' } } };
      return { status: 200, data: dailyState(date) };
    }
    return { status: 404, data: { error: { code: 'not_found', message: 'EBS resource not found' } } };
  }

  return { run, resources, startWorker };
}
