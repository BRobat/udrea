// Charts page: copper and the copper miners, drawn as SVG line charts with a crosshair tooltip.
(() => {
  'use strict';

  const { $, el, nf, relTime, getJson } = window.Gazette;
  const SVG = 'http://www.w3.org/2000/svg';
  const DAY = 86400;
  const RANGES = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366, '5Y': 5 * 366 };
  const state = { data: null, range: '1Y' };

  try {
    const saved = localStorage.getItem('gazette.chartRange');
    if (saved && RANGES[saved]) state.range = saved;
  } catch { /* storage unavailable */ }

  // ---------- Formatting ----------
  const CURRENCY_SYMBOL = { USD: '$', EUR: '€', GBP: '£', PLN: 'zł', CAD: 'C$', HKD: 'HK$', AUD: 'A$' };

  function money(value, currency, unit, digits) {
    if (value == null) return '—';
    if (digits == null) digits = value >= 1000 ? 0 : 2;
    const num = nf(digits).format(value);
    const sym = CURRENCY_SYMBOL[currency];
    const text = currency === 'PLN' ? `${num} zł` : sym ? `${sym}${num}` : `${num} ${currency || ''}`.trim();
    return unit ? `${text}/${unit}` : text;
  }

  const fmtDate = (t, opts) => new Date(t * 1000).toLocaleDateString('en-GB', opts);

  // Points for the selected range: daily closes up to 1Y, weekly beyond.
  function seriesFor(item) {
    const pts = state.range === '5Y' ? item.weekly : item.daily;
    if (!pts || !pts.length) return [];
    const from = pts.at(-1)[0] - RANGES[state.range] * DAY;
    return pts.filter((p) => p[0] >= from);
  }

  function stats(points) {
    if (points.length < 2) return null;
    const first = points[0][1];
    const last = points.at(-1)[1];
    let hi = -Infinity;
    let lo = Infinity;
    for (const [, v] of points) {
      if (v > hi) hi = v;
      if (v < lo) lo = v;
    }
    return { first, last, hi, lo, change: last - first, pct: ((last - first) / first) * 100 };
  }

  function changeBadge(s) {
    if (!s) return el('span', { class: 'chg' }, '—');
    const up = s.pct >= 0;
    return el('span', { class: `chg ${up ? 'up' : 'down'}` },
      `${up ? '▲' : '▼'} ${up ? '+' : '−'}${nf(1).format(Math.abs(s.pct))}%`,
      el('span', { class: 'chg-range' }, ` ${state.range}`));
  }

  // ---------- Axis ticks ----------
  function niceTicks(min, max, count = 4) {
    if (min === max) { min -= 1; max += 1; }
    const raw = (max - min) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Number(v.toPrecision(10)));
    return ticks;
  }

  function timeTicks(t0, t1, width) {
    const n = Math.max(2, Math.min(6, Math.floor(width / 110)));
    return Array.from({ length: n }, (_, i) => t0 + ((t1 - t0) * (i + 0.5)) / n);
  }

  function svg(tag, attrs = {}) {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  // ---------- Line chart with crosshair ----------
  function drawChart(host, points, { currency, unit, height, label }) {
    host.replaceChildren();
    const width = Math.max(240, host.clientWidth);
    if (points.length < 2) {
      host.append(el('p', { class: 'chart-nodata' }, 'Not enough data for this range.'));
      return;
    }
    const m = { top: 10, right: 12, bottom: 24, left: 52 };
    const w = width - m.left - m.right;
    const h = height - m.top - m.bottom;
    const t0 = points[0][0];
    const t1 = points.at(-1)[0];
    let lo = Math.min(...points.map((p) => p[1]));
    let hi = Math.max(...points.map((p) => p[1]));
    const pad = (hi - lo) * 0.08 || hi * 0.02;
    lo -= pad;
    hi += pad;
    const yTicks = niceTicks(lo, hi, height > 200 ? 5 : 3);
    lo = Math.min(lo, yTicks[0]);
    hi = Math.max(hi, yTicks.at(-1));
    const x = (t) => m.left + ((t - t0) / (t1 - t0 || 1)) * w;
    const y = (v) => m.top + (1 - (v - lo) / (hi - lo || 1)) * h;

    const root = svg('svg', {
      viewBox: `0 0 ${width} ${height}`, width, height, class: 'chart-svg',
      role: 'img', 'aria-label': `${label}: line chart, ${state.range}`,
    });
    const gid = `g${Math.random().toString(36).slice(2, 8)}`;
    const defs = svg('defs');
    const grad = svg('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(svg('stop', { offset: '0', class: 'area-top' }), svg('stop', { offset: '1', class: 'area-bottom' }));
    defs.append(grad);
    root.append(defs);

    // grid + y labels
    const grid = svg('g', { class: 'grid' });
    const tickStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1;
    const tickDigits = tickStep >= 1 && Number.isInteger(tickStep) ? 0 : tickStep >= 0.1 ? (Number.isInteger(tickStep * 10) ? 1 : 2) : 2;
    for (const v of yTicks) {
      grid.append(svg('line', { x1: m.left, x2: m.left + w, y1: y(v), y2: y(v) }));
      const tx = svg('text', { x: m.left - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis-label' });
      tx.textContent = money(v, currency, null, tickDigits);
      grid.append(tx);
    }
    // x labels
    const spanDays = (t1 - t0) / DAY;
    const xFmt = spanDays > 400 ? { year: 'numeric' } : spanDays > 60 ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' };
    for (const t of timeTicks(t0, t1, w)) {
      const tx = svg('text', { x: x(t), y: height - 6, 'text-anchor': 'middle', class: 'axis-label' });
      tx.textContent = fmtDate(t, xFmt);
      grid.append(tx);
    }
    root.append(grid);

    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    root.append(svg('path', { d: `${line}L${x(t1)},${m.top + h}L${x(t0)},${m.top + h}Z`, fill: `url(#${gid})`, class: 'area' }));
    root.append(svg('path', { d: line, class: 'line' }));
    const end = svg('circle', { cx: x(t1), cy: y(points.at(-1)[1]), r: 4, class: 'end-dot' });
    root.append(end);

    // crosshair layer
    const cross = svg('g', { class: 'cross', visibility: 'hidden' });
    const vline = svg('line', { y1: m.top, y2: m.top + h, class: 'cross-line' });
    const dot = svg('circle', { r: 5, class: 'cross-dot' });
    cross.append(vline, dot);
    root.append(cross);
    const hit = svg('rect', { x: m.left, y: 0, width: w, height, fill: 'transparent', tabindex: 0, class: 'hit' });
    root.append(hit);

    const tip = el('div', { class: 'chart-tip', role: 'status' });
    tip.hidden = true;
    host.append(root, tip);

    const show = (i) => {
      const [t, v] = points[i];
      const cx = x(t);
      const cy = y(v);
      vline.setAttribute('x1', cx);
      vline.setAttribute('x2', cx);
      dot.setAttribute('cx', cx);
      dot.setAttribute('cy', cy);
      cross.setAttribute('visibility', 'visible');
      tip.replaceChildren(el('strong', {}, money(v, currency, unit)), el('span', {}, fmtDate(t, { day: 'numeric', month: 'short', year: 'numeric' })));
      tip.hidden = false;
      const left = Math.min(Math.max(cx - tip.offsetWidth / 2, 0), width - tip.offsetWidth);
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(cy - tip.offsetHeight - 12, 0)}px`;
    };
    const hide = () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    const nearest = (px) => {
      const t = t0 + ((px - m.left) / w) * (t1 - t0);
      let best = 0;
      for (let i = 1; i < points.length; i++) if (Math.abs(points[i][0] - t) < Math.abs(points[best][0] - t)) best = i;
      return best;
    };
    let focusIdx = points.length - 1;
    hit.addEventListener('pointermove', (e) => {
      const r = root.getBoundingClientRect();
      focusIdx = nearest(((e.clientX - r.left) / r.width) * width);
      show(focusIdx);
    });
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('focus', () => show(focusIdx));
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') focusIdx = Math.max(0, focusIdx - 1);
      else if (e.key === 'ArrowRight') focusIdx = Math.min(points.length - 1, focusIdx + 1);
      else return;
      e.preventDefault();
      show(focusIdx);
    });
  }

  // ---------- Cards ----------
  const charts = []; // { host, points, opts } for re-render on resize

  function card(item, { hero = false, unit } = {}) {
    const points = seriesFor(item);
    const s = stats(points);
    const sub = item.symbol === 'HG=F' ? 'COMEX · HG=F · USD per kg' : `${item.exchange} · ${item.symbol} · ${item.country}`;
    const host = el('div', { class: 'chart-host' });
    const node = el(hero ? 'div' : 'article', { class: `chart-card${hero ? '' : ' company'}${item.symbol === 'KGH.WA' ? ' featured' : ''}` },
      el('header', { class: 'chart-head' },
        el('div', {},
          el('h3', {}, item.name, item.stale ? el('span', { class: 'badge' }, 'stale') : null),
          el('p', { class: 'chart-sub' }, sub)),
        el('div', { class: 'chart-price' },
          el('strong', {}, money(item.last ?? s?.last, item.currency, unit)),
          changeBadge(s))),
      host,
      s ? el('p', { class: 'chart-range-stats' },
        `${state.range} high ${money(s.hi, item.currency, unit)} · low ${money(s.lo, item.currency, unit)}`) : null);
    charts.push({ host, points, opts: { currency: item.currency, unit, height: hero ? 300 : 150, label: item.name } });
    return { node, s };
  }

  function render() {
    const d = state.data;
    charts.length = 0;
    const rows = [];

    const copperCard = $('copper-card');
    copperCard.replaceChildren();
    if (d.copper) {
      const { node, s } = card(d.copper, { hero: true, unit: 'kg' });
      copperCard.replaceWith(Object.assign(node, { id: 'copper-card' }));
      node.classList.add('chart-hero');
      rows.push([d.copper, s, 'kg']);
    }

    const grid = $('company-grid');
    grid.replaceChildren();
    for (const c of d.companies) {
      const { node, s } = card(c);
      grid.append(node);
      rows.push([c, s]);
    }

    // table view: every number reachable without hovering
    const table = $('charts-table');
    table.replaceChildren(el('thead', {}, el('tr', {},
      ...['Name', 'Listing', 'Last', `${state.range} change`, `${state.range} high`, `${state.range} low`].map((h) => el('th', { scope: 'col' }, h)))));
    const body = el('tbody');
    for (const [item, s, unit] of rows) {
      body.append(el('tr', {},
        el('th', { scope: 'row' }, item.name),
        el('td', {}, item.symbol),
        el('td', {}, money(item.last ?? s?.last, item.currency, unit)),
        el('td', {}, s ? `${s.pct >= 0 ? '+' : '−'}${nf(1).format(Math.abs(s.pct))}%` : '—'),
        el('td', {}, s ? money(s.hi, item.currency, unit) : '—'),
        el('td', {}, s ? money(s.lo, item.currency, unit) : '—')));
    }
    table.append(body);

    for (const ch of charts) drawChart(ch.host, ch.points, ch.opts);
  }

  // ---------- Range picker ----------
  const picker = $('range-picker');
  const syncPicker = () => {
    for (const b of picker.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.range === state.range));
  };
  picker.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-range]');
    if (!b || !state.data) return;
    state.range = b.dataset.range;
    try { localStorage.setItem('gazette.chartRange', state.range); } catch { /* ignore */ }
    syncPicker();
    render();
  });
  syncPicker();

  // Redraw charts at their new width when the layout changes.
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { for (const ch of charts) drawChart(ch.host, ch.points, ch.opts); }, 150);
  });

  // ---------- Load ----------
  (async () => {
    try {
      state.data = await getJson('data/charts.json');
      if (!state.data.copper && !(state.data.companies || []).length) throw new Error('empty');
      $('charts-meta').textContent = `Copper and ${state.data.companies.length} copper miners · updated ${relTime(state.data.generatedAt)} · hover or use arrow keys on a chart for values`;
      render();
    } catch {
      $('charts-meta').textContent = '';
      $('copper-card').hidden = true;
      $('charts-empty').hidden = false;
    }
  })();
})();
