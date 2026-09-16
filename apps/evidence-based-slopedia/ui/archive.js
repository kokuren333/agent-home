(() => {
  const api = globalThis.evidenceBasedSlopedia;
  const params = new URLSearchParams(location.search);
  const kind = params.get('kind') === 'news' ? 'news' : 'articles';
  const $ = (selector) => document.querySelector(selector);
  let entries = [];
  let selectedMonth = '';

  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  function monthLabel(month) { const [year, value] = month.split('-'); return `${year}年${Number(value)}月`; }
  function appUrl(value) { return `/apps/evidence-based-slopedia/${String(value || '').split('/').map(encodeURIComponent).join('/')}`; }
  function articleUrl(value) { return `./article.html?path=${encodeURIComponent(String(value || ''))}`; }
  function changeMonth(offset) {
    const [year, month] = selectedMonth.split('-').map(Number);
    const next = new Date(year, month - 1 + offset, 1);
    selectedMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    $('#month-picker').value = selectedMonth;
    renderMonth();
  }
  function renderDayEntries(date) {
    const content = $('#day-articles');
    const items = entries.filter((entry) => entry.date === date);
    if (!items.length) { content.hidden = true; content.innerHTML = ''; return; }
    content.hidden = false;
      content.innerHTML = `<div class="day-heading"><p class="kicker">Selected date</p><h2>${date.replace(/-/g, '/')} の${kind === 'news' ? 'ニュース' : '公開記事'}</h2><span>${items.length}件</span></div><div class="day-card-grid">${items.map((item) => `<a class="archive-card" href="${escapeHtml(articleUrl(item.path))}">${item.imagePath ? `<img src="${escapeHtml(appUrl(item.imagePath))}" alt="">` : ''}<span class="archive-card-type">${kind === 'news' ? 'NEWS' : 'ARTICLE'}</span><strong>${escapeHtml(item.title)}</strong>${item.field ? `<small>${escapeHtml(item.field)}</small>` : ''}<span class="archive-card-link">記事を開く ›</span></a>`).join('')}</div>`;
  }
  function renderMonth() {
    const content = $('#archive-content');
    const [year, monthNumber] = selectedMonth.split('-').map(Number);
    const monthEntries = entries.filter((item) => item.date.startsWith(selectedMonth));
    const byDay = new Map();
    for (const item of monthEntries) { const day = item.date.slice(-2); if (!byDay.has(day)) byDay.set(day, []); byDay.get(day).push(item); }
    const daysInMonth = new Date(year, monthNumber, 0).getDate();
    const cells = Array.from({ length: daysInMonth }, (_, index) => {
      const day = String(index + 1).padStart(2, '0'); const date = `${selectedMonth}-${day}`; const dayItems = byDay.get(day) || [];
      return `<button class="calendar-day${dayItems.length ? ' calendar-day-has-entries' : ' calendar-day-empty'}" type="button" data-date="${date}"><time datetime="${date}">${index + 1}</time><div>${dayItems.map((item) => `<span class="archive-entry"><strong>${escapeHtml(item.title)}</strong>${item.field ? `<small>${escapeHtml(item.field)}</small>` : ''}</span>`).join('')}</div></button>`;
    });
    const leading = new Date(year, monthNumber - 1, 1).getDay();
    cells.unshift(...Array.from({ length: leading }, () => '<div class="calendar-day calendar-day-empty" aria-hidden="true"></div>'));
    content.innerHTML = `<section class="archive-month" aria-labelledby="month-title"><div class="month-heading"><h2 id="month-title">${monthLabel(selectedMonth)}</h2><span>${monthEntries.length}件</span></div><div class="calendar-weekdays"><span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span></div><div class="calendar-grid">${cells.join('')}</div>${monthEntries.length ? '' : '<p class="month-empty">この月に公開された記事はありません。</p>'}</section>`;
    content.querySelectorAll('[data-date]').forEach((button) => button.addEventListener('click', () => renderDayEntries(button.dataset.date)));
    renderDayEntries(monthEntries[0]?.date || '');
  }
  async function load() {
    $('#archive-title').textContent = kind === 'news' ? 'News' : 'Articles';
    $('#archive-description').textContent = kind === 'news' ? '日付ごとのニュース一覧' : '公開済み記事の日付一覧';
    try {
      const result = await api.read('archive', { kind }); entries = result.entries || [];
      const initial = entries[0]?.date?.slice(0, 7) || new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit' }).format(new Date());
      selectedMonth = initial; $('#month-picker').value = selectedMonth; renderMonth();
    } catch (error) { $('#archive-content').innerHTML = `<div class="empty-state">読み込みに失敗しました：${escapeHtml(error.message)}</div>`; }
  }
  $('#previous-month').addEventListener('click', () => changeMonth(-1));
  $('#next-month').addEventListener('click', () => changeMonth(1));
  $('#month-picker').addEventListener('change', (event) => { selectedMonth = event.target.value; renderMonth(); });
  load();
})();
