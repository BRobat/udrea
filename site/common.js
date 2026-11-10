// Shared by every page: helpers, logo fallback and the copper price ticker in the top bar.
window.Gazette = (() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ---------- Logo with graceful fallback ----------
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
  const LB_PER_KG = 2.20462262;
  async function loadPrices() {
    try {
      const p = await getJson('data/prices.json');
      const c = p.comex || {};
      // COMEX quotes USD per pound; show USD per kilogram instead.
      $('p-comex').textContent = c.price != null ? `$${nf(2).format(c.price * LB_PER_KG)}/kg` : '—';
      const ch = $('p-change');
      if (c.change != null && c.changePct != null) {
        const up = c.change >= 0;
        ch.textContent = `${up ? '▲' : '▼'} ${nf(2).format(Math.abs(c.change * LB_PER_KG))} (${up ? '+' : '−'}${nf(2).format(Math.abs(c.changePct))}%)`;
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

  loadPrices();
  setInterval(loadPrices, 5 * 60 * 1000);

  return { $, el, nf, relTime, safeUrl, getJson, LB_PER_KG };
})();
