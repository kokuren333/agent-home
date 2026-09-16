(() => {
  const api = globalThis.evidenceBasedSlopedia;
  const input = document.querySelector('#search-input');
  const form = document.querySelector('#search-form');
  const results = document.querySelector('#search-results');
  const count = document.querySelector('#result-count');
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const articleUrl = (value) => `./article.html?path=${encodeURIComponent(String(value || ''))}`;
  const imageUrl = (value) => `/apps/evidence-based-slopedia/${String(value || '').split('/').map(encodeURIComponent).join('/')}`;
  function render(data) {
    const articles = data?.articles || [];
    if (count) count.textContent = `${articles.length}件`;
    if (!articles.length) { results.innerHTML = `<div class="empty-state">${data?.query ? '該当する記事はありません。' : '検索語を入力してください。'}</div>`; return; }
    results.innerHTML = `<div class="article-card-grid">${articles.map((article) => `<a class="article-card" href="${escapeHtml(articleUrl(article.path))}">${article.imagePath ? `<img src="${escapeHtml(imageUrl(article.imagePath))}" alt="">` : '<div class="article-card-placeholder" aria-hidden="true"></div>'}<div class="article-card-body"><span class="article-card-type">ARTICLE</span><h3>${escapeHtml(article.title)}</h3><p>${escapeHtml(article.excerpt || '')}</p><span class="article-card-link">記事を読む ›</span></div></a>`).join('')}</div>`;
  }
  async function search(value) {
    const query = value.trim();
    if (input) input.value = query;
    const url = new URL(window.location.href);
    if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
    window.history.replaceState(null, '', url);
    try { render(await api.read('search', { q: query, limit: 20 })); } catch (error) { results.innerHTML = `<div class="empty-state">検索に失敗しました：${escapeHtml(error.message)}</div>`; }
  }
  form?.addEventListener('submit', (event) => { event.preventDefault(); search(input?.value || ''); });
  search(new URLSearchParams(window.location.search).get('q') || '');
})();
