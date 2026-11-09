(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { articles: [], source: 'all', query: '' };

  // ---------- Images (logo + tablet) with graceful fallbacks ----------
  const logo = $('logo');
  const useLogoFallback = () => {
    logo.onerror = null;
    logo.src = 'assets/ea-nasir-placeholder.svg';
  };
  logo.addEventListener('error', useLogoFallback);
  if (logo.complete && logo.naturalWidth === 0) useLogoFallback();
  logo.addEventListener('load', () => {
    if (!/placeholder/.test(logo.src)) {
      const fav = $('favicon');
      fav.type = 'image/png';
      fav.href = logo.src;
    }
  });

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

  // ---------- Formatting helpers ----------
  const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  function relTime(iso) {
    if (!iso) return '';
    const diff = (Date.parse(iso) - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 60) return 'just now';
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
    return new Date(iso).toLocaleDateString();
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  const safeUrl = (u) => {
    try {
      const url = new URL(u);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch { return null; }
  };

  async function getJson(path) {
    // Bust caches once a minute so new data commits show up quickly.
    const res = await fetch(`${path}?t=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ---------- Prices ----------
  async function loadPrices() {
    try {
      const p = await getJson('data/prices.json');
      const c = p.comex || {};
      $('p-comex').textContent = c.price != null ? `$${nf(3).format(c.price)}/lb` : '—';
      const ch = $('p-change');
      if (c.change != null && c.changePct != null) {
        const up = c.change >= 0;
        ch.textContent = `${up ? '▲' : '▼'} ${nf(3).format(Math.abs(c.change))} (${up ? '+' : '−'}${nf(2).format(Math.abs(c.changePct))}%)`;
        ch.className = `tick-change ${up ? 'up' : 'down'}`;
      }
      const conv = p.conversions || {};
      $('p-usdt').textContent = conv.usdPerTonne != null ? `$${nf(0).format(conv.usdPerTonne)}` : '—';
      $('p-eurt').textContent = conv.eurPerTonne != null ? `€${nf(0).format(conv.eurPerTonne)}` : '—';
      const when = c.marketTime || p.generatedAt;
      const upd = $('p-updated');
      upd.textContent = `Updated ${relTime(p.generatedAt)}`;
      upd.title = `Market time: ${when ? new Date(when).toLocaleString() : 'n/a'}. Delayed data, for information only.`;
      const badge = $('p-badge');
      if (p.sample || p.stale) {
        badge.hidden = false;
        badge.textContent = p.sample ? 'sample data' : 'stale';
      } else {
        badge.hidden = true;
      }
    } catch {
      $('p-updated').textContent = 'Price unavailable';
    }
  }

  // ---------- News ----------
  function renderChips() {
    const counts = new Map();
    for (const a of state.articles) counts.set(a.source, (counts.get(a.source) || 0) + 1);
    const sources = [...counts.entries()].sort((a, b) => b[1] - a[1]);
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
    for (const [s, n] of sources) chips.append(mk(s, s, n));
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
    node.style.setProperty('--rot', `${(h >>> 3) % 40 - 20}deg`);
    node.style.setProperty('--rot2', `${(h >>> 9) % 50 - 25}deg`);
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

  loadPrices();
  loadNews();
  setInterval(loadPrices, 5 * 60 * 1000);
})();
