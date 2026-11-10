(() => {
  'use strict';

  const { $, el, relTime, safeUrl, getJson } = window.Gazette;
  const state = { articles: [], source: 'all', query: '', chipsExpanded: false };

  // ---------- Complaint tablet banner ----------
  const tabletImg = $('tablet-img');
  const tabletFallback = () => tabletImg.closest('.tablet-figure').classList.add('no-img');
  tabletImg.addEventListener('error', tabletFallback);
  if (tabletImg.complete && tabletImg.naturalWidth === 0) tabletFallback();

  const banner = $('tablet-banner');
  const BANNER_KEY = 'gazette.bannerDismissed';
  try {
    if (localStorage.getItem(BANNER_KEY) === '1') banner.hidden = true;
  } catch { /* storage unavailable */ }
  $('dismiss-banner').addEventListener('click', () => {
    banner.hidden = true;
    try { localStorage.setItem(BANNER_KEY, '1'); } catch { /* ignore */ }
  });

  // ---------- News ----------
  const CHIP_LIMIT = 8;

  function renderChips() {
    const counts = new Map();
    for (const a of state.articles) counts.set(a.source, (counts.get(a.source) || 0) + 1);
    const sources = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const chips = $('chips');
    chips.replaceChildren();
    const mk = (value, label, n) => {
      const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.source === value) },
        label, n != null ? el('span', { class: 'n' }, n) : null);
      b.addEventListener('click', () => {
        state.source = value;
        renderChips();
        renderNews();
      });
      return b;
    };
    chips.append(mk('all', 'All sources', state.articles.length));

    // Collapsed by default: the biggest sources, plus the selected one so the active filter stays visible.
    const shown = state.chipsExpanded
      ? sources
      : sources.filter(([s], i) => i < CHIP_LIMIT || s === state.source);
    for (const [s, n] of shown) chips.append(mk(s, s, n));

    const hidden = sources.length - shown.length;
    if (hidden > 0 || state.chipsExpanded) {
      const toggle = el('button', { class: 'chip chip-more', type: 'button', 'aria-expanded': String(!!state.chipsExpanded) },
        state.chipsExpanded ? 'Show fewer' : `+${hidden} more`);
      toggle.addEventListener('click', () => {
        state.chipsExpanded = !state.chipsExpanded;
        renderChips();
      });
      chips.append(toggle);
    }
  }

  // Simple string hash so each story keeps the same generated artwork between visits.
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  // Copper-plate artwork for stories whose feed has no picture.
  function art(a) {
    const h = hash(a.link || a.title || '');
    const node = el('div', { class: `card-art v${h % 6} p${(h >>> 4) % 3}`, 'aria-hidden': 'true' },
      el('span', { class: 'art-ingot' }),
      el('span', { class: 'art-ingot art-ingot-2' }),
      el('span', { class: 'art-source' }, a.source || 'Copper'));
    node.style.setProperty('--rot', `${(h >>> 3) % 16 - 8}deg`);
    node.style.setProperty('--rot2', `${(h >>> 9) % 20 - 10}deg`);
    node.style.setProperty('--size', `${18 + ((h >>> 12) % 14)}%`);
    node.style.setProperty('--x', `${4 + ((h >>> 16) % 14)}%`);
    node.style.setProperty('--y', `${35 + ((h >>> 20) % 30)}%`);
    if ((h >>> 24) % 3 === 0) node.classList.add('two');
    return node;
  }

  function card(a) {
    const href = safeUrl(a.link);
    const imgUrl = a.image ? safeUrl(a.image) : null;
    const img = imgUrl
      ? el('img', { class: 'card-img', src: imgUrl, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
      : art(a);
    if (imgUrl) img.addEventListener('error', () => img.replaceWith(art(a)), { once: true });
    const time = a.published
      ? el('time', { datetime: a.published, title: new Date(a.published).toLocaleString() }, relTime(a.published))
      : null;
    return el('article', { class: 'card' },
      img,
      el('div', { class: 'card-body' },
        el('div', { class: 'card-meta' }, el('span', { class: 'card-source' }, a.source || 'Unknown'), time),
        el('h2', {}, el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, a.title)),
        a.summary ? el('p', {}, a.summary) : null,
      ),
    );
  }

  function renderNews() {
    const q = state.query.trim().toLowerCase();
    const list = state.articles.filter((a) =>
      (state.source === 'all' || a.source === state.source) &&
      (!q || `${a.title} ${a.summary || ''} ${a.source}`.toLowerCase().includes(q)));
    const grid = $('news');
    grid.replaceChildren(...list.map(card));
    grid.setAttribute('aria-busy', 'false');
    $('empty').hidden = list.length > 0;
    if (!list.length && state.articles.length) {
      $('empty-title').textContent = 'Nothing matches.';
      $('empty-text').textContent = 'Ea-nasir swears he shipped it. Try another search.';
    }
  }

  async function loadNews() {
    try {
      const data = await getJson('data/news.json');
      state.articles = Array.isArray(data.articles) ? data.articles : [];
      const nSources = new Set(state.articles.map((a) => a.source)).size;
      let meta = `${state.articles.length} stories from ${nSources} sources · updated ${relTime(data.generatedAt)}`;
      if (data.sample) meta += ' · SAMPLE DATA: real headlines appear after the first scheduled update';
      $('news-meta').textContent = meta;
      renderChips();
      renderNews();
    } catch {
      $('news').replaceChildren();
      $('news').setAttribute('aria-busy', 'false');
      $('empty').hidden = false;
      $('empty-text').textContent = 'Nanni is writing a complaint. (The news feed could not be loaded.)';
    }
  }

  let debounce;
  $('search').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.query = e.target.value; renderNews(); }, 120);
  });

  loadNews();
})();
