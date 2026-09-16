(() => {
  const page = document.querySelector('#article-page');
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const imageUrl = (value) => `/apps/evidence-based-slopedia/${String(value || '').split('/').map(encodeURIComponent).join('/')}`;
  function linkifyLine(value) {
    const links = [];
    const protect = (html) => `EBE_LINK_${links.push(html) - 1}`;
    let source = String(value).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => protect(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`));
    source = source.replace(/https?:\/\/[^\s<（）】）]+/g, (url) => protect(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`));
    let html = escapeHtml(source);
    return html.replace(/EBE_LINK_(\d+)/g, (_match, index) => links[Number(index)] || '');
  }
  const params = new URLSearchParams(location.search);
  const path = params.get('path') || '';
  const renderContent = (value, math = []) => value.split(/\r?\n/).map((line) => {
    if (!line.trim()) return '';
    if (line.startsWith('![[50_Assets/') || line.startsWith('![')) return '';
    if (line.startsWith('### ')) return `<h3>${escapeHtml(line.slice(4))}</h3>`;
    if (line.startsWith('## ')) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
    if (line.startsWith('# ')) return '';
    let html = linkifyLine(line);
    html = html.replace(/EBE_MATH_(\d+)/g, (_match, index) => math[Number(index)] || '');
    return `<p>${html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`;
  }).join('');
  async function load() {
    try {
      const response = await fetch(`/api/apps/evidence-based-slopedia/resources/article?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
      const article = await response.json();
      if (!response.ok) throw new Error(article?.error?.message || '記事を読み込めません。');
      document.title = `${article.title} | Evidence Based Slopedia`;
      page.innerHTML = `<article class="article-detail"><p class="kicker">ARTICLE</p><h1>${escapeHtml(article.title)}</h1>${article.date ? `<time datetime="${escapeHtml(article.date)}">${escapeHtml(article.date)}</time>` : ''}${article.imagePath ? `<img class="article-hero-image" src="${escapeHtml(imageUrl(article.imagePath))}" alt="">` : ''}<div class="article-body">${renderContent(article.content, article.math)}</div><a class="back-link" href="./index.html">ホームへ戻る ›</a></article>`;
    } catch (error) { page.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
  }
  load();
})();
