(() => {
  const api = globalThis.evidenceBasedSlopedia;
  const $ = (selector) => document.querySelector(selector);
  const NEWS_LABELS = {
    Politics_International_Relations: '政治・国際関係',
    Economy_Finance: '経済・金融',
    Technology_AI: 'テクノロジー・AI',
    Science_Medicine_Life: '科学・医療・暮らし',
    Environment_Energy_Resources: '環境・エネルギー・資源',
    Society_Population_Education: '社会・人口・教育',
    Culture_Media_Ideas: '文化・メディア・思想',
    Law_Institutions_Ethics: '法・制度・倫理',
    Business_Industry_Innovation: 'ビジネス・産業・イノベーション',
    Incidents_Risks_Safety: '事件・リスク・安全',
  };
  const NEWS_FIELDS = Object.keys(NEWS_LABELS);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function formatCreatedAt(value) {
    if (!value) return '投入時刻不明';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '投入時刻不明';
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(date);
  }

  function activityLabel(job) {
    if (!['queued', 'running', 'waiting_publish', 'publishing'].includes(job.status)) return '';
    const value = job.heartbeatAt || job.updatedAt;
    if (!value) return '動作確認時刻不明';
    const elapsed = Date.now() - new Date(value).getTime();
    const when = formatCreatedAt(value);
    return elapsed > 90_000 ? `最終確認 ${when}（90秒以上更新なし）` : `最終確認 ${when}`;
  }

  function today() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    return Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
  }

  function todayString() {
    const value = today();
    return `${value.year}-${value.month}-${value.day}`;
  }

  function statusLabel(status, phase) {
    if (status === 'queued') return '待機中';
    if (status === 'running') {
      return ({ source_discovery: 'ソース調査中', image_generation: '画像生成中', publishing: '記事作成・公開確認中' })[phase] || '処理中';
    }
    return ({ waiting_publish: '公開待ち', publishing: '公開処理中', completed: '完了', failed: '失敗' })[status] || status || '待機中';
  }

  function jobTitle(job) {
    if (job.jobType === 'daily_news') return NEWS_LABELS[job.newsField] || '今日のニュース';
    return job.query || '記事クエリ';
  }

  function renderJobs(jobs) {
    const list = $('#jobs');
    const count = $('#queue-count');
    if (!list) return;
    if (count) count.textContent = String(jobs.length);
    if (!jobs.length) {
      list.innerHTML = '<li class="empty-job">現在キューに入っているジョブはありません。</li>';
      return;
    }
    list.innerHTML = jobs.map((job) => `<li class="job-item">
      <div class="job-main"><span class="job-type">${job.jobType === 'daily_news' ? 'NEWS' : 'ARTICLE'}</span><strong>${escapeHtml(jobTitle(job))}</strong></div>
      <div class="job-meta"><span class="job-status status-${escapeHtml(job.status)} phase-${escapeHtml(job.phase || '')}">${escapeHtml(statusLabel(job.status, job.phase))}</span><time datetime="${escapeHtml(job.createdAt || '')}">投入 ${escapeHtml(formatCreatedAt(job.createdAt))}</time>${escapeHtml(activityLabel(job))}${job.status === 'failed' ? `<button class="job-retry" type="button" data-job-id="${escapeHtml(job.id)}" data-job-action="retry">再試行</button><button class="job-restart" type="button" data-job-id="${escapeHtml(job.id)}" data-job-action="restart">最初から</button>` : ''}<button class="job-delete" type="button" data-job-id="${escapeHtml(job.id)}"${job.status === 'queued' || job.status === 'failed' ? '' : ' disabled title="処理中のジョブは削除できません"'}>削除</button></div>
    </li>`).join('');
  }

  function renderWorkerStatus(state) {
    const element = $('#worker-status');
    if (!element) return;
    element.textContent = state?.message || 'Worker状態不明';
    element.classList.toggle('worker-connected', Boolean(state?.connected));
  }

  function renderNews(state) {
    const grid = $('#news-grid');
    const progress = $('#news-progress');
    if (!grid) return;
    const jobs = state?.jobs || [];
    const byField = new Map(jobs.filter((job) => job.newsField).map((job) => [job.newsField, job]));
    const complete = Number(state?.existingCount || 0);
    const active = Number(state?.activeCount || 0);
    if (progress) progress.textContent = `${complete}/10 完了・${active}件を処理中`;
    grid.innerHTML = NEWS_FIELDS.map((field, index) => {
      const job = byField.get(field);
      const stateText = job ? statusLabel(job.status, job.phase) : '未登録';
      const stateClass = job ? `news-${escapeHtml(job.status)}` : 'news-empty';
      const image = job?.imagePath ? `<img src="/apps/evidence-based-slopedia/${String(job.imagePath).split('/').map(encodeURIComponent).join('/')}" alt="">` : '';
      const body = `<span class="news-number">${String(index + 1).padStart(2, '0')}</span>${image}<div><p>${escapeHtml(NEWS_LABELS[field])}</p><span>${escapeHtml(stateText)}</span>${job?.articlePath ? '<small>記事を読む ›</small>' : ''}</div>`;
      return job?.articlePath ? `<a class="news-card ${stateClass}" href="./article.html?path=${encodeURIComponent(job.articlePath)}">${body}</a>` : `<article class="news-card ${stateClass}">${body}</article>`;
    }).join('');
  }

  function renderArticles(data) {
    const container = $('#article-results');
    if (!container) return;
    const articles = data?.articles || [];
    if (!articles.length) {
      container.innerHTML = `<div class="empty-state">${data?.query ? '該当する記事はありません。' : '記事はありません。'}</div>`;
      return;
    }
    const articleUrl = (value) => `./article.html?path=${encodeURIComponent(String(value || ''))}`;
    const imageUrl = (value) => `/apps/evidence-based-slopedia/${String(value || '').split('/').map(encodeURIComponent).join('/')}`;
    container.innerHTML = `<div class="article-card-grid">${articles.map((article) => `<a class="article-card" href="${escapeHtml(articleUrl(article.path))}">${article.imagePath ? `<img src="${escapeHtml(imageUrl(article.imagePath))}" alt="">` : '<div class="article-card-placeholder" aria-hidden="true"></div>'}<div class="article-card-body"><span class="article-card-type">ARTICLE</span><h3>${escapeHtml(article.title)}</h3><p>${escapeHtml(article.excerpt || '')}</p><span class="article-card-link">記事を読む ›</span></div></a>`).join('')}</div>`;
  }

  async function searchArticles(query) {
    try {
      renderArticles(await api.read('search', { q: query, limit: 20 }));
    } catch (error) {
      const container = $('#article-results');
      if (container) container.innerHTML = `<div class="empty-state">検索に失敗しました：${escapeHtml(error.message)}</div>`;
    }
  }

  async function loadJobs() {
    try {
      const [jobData, newsState, workerState] = await Promise.all([api.read('jobs', { limit: 50 }), api.read('daily_news_state', { date: todayString() }), api.read('worker_status').catch(() => ({ connected: false, message: 'Worker状態を取得できません。Gatewayを再起動してください。' }))]);
      renderJobs((jobData.jobs || []).filter((job) => ['queued', 'running', 'waiting_publish', 'publishing', 'failed'].includes(job.status)));
      renderNews(newsState);
      renderWorkerStatus(workerState);
    } catch (error) {
      const message = $('#message');
      if (message) message.textContent = `読み込みに失敗しました：${error.message}`;
    }
  }

  function showMessage(text) {
    const message = $('#message');
    if (message) message.textContent = text || '';
  }

  async function enqueueNews() {
    const button = $('#news-button');
    if (button) button.disabled = true;
    try {
      const result = await api.run({ action: 'enqueue_daily_news', date: todayString() });
      showMessage(result.message || '今日のニュースの状態を更新しました。');
      await loadJobs();
    } catch (error) {
      showMessage(`ニュース生成の登録に失敗しました：${error.message}`);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function enqueueArticle(event) {
    event.preventDefault();
    const input = $('#q');
    const query = input?.value.trim();
    if (!query) {
      showMessage('記事のテーマを入力してください。');
      input?.focus();
      return;
    }
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const result = await api.run({ action: 'enqueue_article', query, mode: 'new' });
      showMessage(result.message || '記事Queryをキューに追加しました。');
      input.value = '';
      await loadJobs();
    } catch (error) {
      showMessage(`記事Queryの登録に失敗しました：${error.message}`);
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  $('#news-button')?.addEventListener('click', enqueueNews);
  $('#query-form')?.addEventListener('submit', enqueueArticle);
  $('#jobs')?.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('[data-job-action]');
    if (actionButton) {
      const id = actionButton.dataset.jobId;
      const action = actionButton.dataset.jobAction;
      if (!id || !action || !window.confirm(action === 'restart' ? 'このジョブを最初からやり直しますか？' : 'このジョブを再試行しますか？')) return;
      actionButton.disabled = true;
      try {
        await api.request(`jobs/${id}/${action}`, { method: 'POST' });
        showMessage(action === 'restart' ? 'ジョブを最初から再実行します。' : 'ジョブを再試行します。');
        await loadJobs();
      } catch (error) { showMessage(`ジョブを再実行できません：${error.message}`); actionButton.disabled = false; }
      return;
    }
    const button = event.target.closest('.job-delete');
    if (!button) return;
    const id = button.dataset.jobId;
    if (!id || !window.confirm('この待機中ジョブをキューから削除しますか？')) return;
    button.disabled = true;
    try {
      await api.remove('jobs', id);
      showMessage('ジョブを削除しました。');
      await loadJobs();
    } catch (error) {
      showMessage(`ジョブを削除できません：${error.message}`);
      button.disabled = false;
    }
  });
  $('#portal-search')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = $('#portal-search-input')?.value.trim();
    window.location.href = `./search.html${value ? `?q=${encodeURIComponent(value)}` : ''}`;
  });
  searchArticles('');
  loadJobs();
  setInterval(loadJobs, 5000);
})();
