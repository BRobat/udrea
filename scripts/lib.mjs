// Pure helpers shared by the fetch scripts (unit-tested in test/).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const LB_PER_TONNE = 2204.62262;

export function isCopperRelated(text) {
  const t = text || '';
  // "Cu" is matched case-sensitively so e.g. "CU Boulder" doesn't count.
  return /\bcopper\b/i.test(t) || /\bCu\b/.test(t);
}

export function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(text, max = 260) {
  if (!text || text.length <= max) return text || '';
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, '') + '…';
}

// Google News titles look like "Headline - Publisher"; split the publisher off.
export function splitGoogleTitle(title) {
  const m = /^(.*\S)\s+[-–—]\s+([^-–—]{2,60})$/.exec(title || '');
  return m ? { title: m[1], publisher: m[2].trim() } : { title, publisher: null };
}

export function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^utm_|^oc$|^ref$/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return url;
  }
}

export function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Turn one rss-parser item into our article shape, or null if unusable / off-topic. */
export function normalizeItem(item, feed) {
  if (!item || !item.title || !isHttpUrl(item.link)) return null;
  const isGoogle = /news\.google\.com/.test(feed.url);
  let title = stripHtml(item.title);
  let source = feed.source;
  if (isGoogle) {
    const split = splitGoogleTitle(title);
    title = split.title;
    source = source || split.publisher || (item.source && (item.source._ || item.source)) || 'Google News';
  }
  source = source || feed.name;

  // Google News descriptions are just a link list repeating the title — skip them.
  const rawSummary = isGoogle ? '' : (item.contentSnippet || item.summary || item.content || '');
  const summary = truncate(stripHtml(rawSummary));

  if (!feed.copperOnly && !isCopperRelated(`${title} ${summary} ${(item.categories || []).join(' ')}`)) {
    return null;
  }

  const dateStr = item.isoDate || item.pubDate;
  const date = dateStr ? new Date(dateStr) : null;
  const published = date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;

  let image = null;
  const enc = item.enclosure;
  if (enc && enc.url && /^image\//.test(enc.type || 'image/') && isHttpUrl(enc.url)) image = enc.url;
  const media = item['media:content'] || item['media:thumbnail'];
  if (!image && media && media.$ && isHttpUrl(media.$.url)) image = media.$.url;

  return { title, link: item.link, source, published, summary, image };
}

/** Dedupe by URL and normalized title, sort newest first, cap the list. */
export function mergeArticles(articles, { limit = 60, maxAgeDays = 30, now = Date.now() } = {}) {
  const seenTitles = new Set();
  const seenUrls = new Set();
  const out = [];
  const minTime = now - maxAgeDays * 86400e3;
  const sorted = [...articles].sort(
    (a, b) => (b.published ? Date.parse(b.published) : 0) - (a.published ? Date.parse(a.published) : 0),
  );
  for (const a of sorted) {
    if (!a) continue;
    if (a.published && Date.parse(a.published) < minTime) continue;
    if (a.published && Date.parse(a.published) > now + 86400e3) continue; // bogus future dates
    const t = normalizeTitle(a.title);
    const u = normalizeUrl(a.link);
    if (!t || seenTitles.has(t) || seenUrls.has(u)) continue;
    seenTitles.add(t);
    seenUrls.add(u);
    out.push(a);
    if (out.length >= limit) break;
  }
  return out;
}

/** Build prices.json content from Yahoo chart meta and an EUR-per-USD rate. */
export function buildPrices(yahooChart, eurPerUsd, now = new Date()) {
  const result = yahooChart?.chart?.result?.[0];
  const meta = result?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== 'number' || !(price > 0)) throw new Error('Yahoo response has no regularMarketPrice');
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const change = typeof prev === 'number' ? price - prev : null;
  const changePct = typeof prev === 'number' && prev > 0 ? (change / prev) * 100 : null;
  const usdPerTonne = price * LB_PER_TONNE;
  const round = (n, d) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
  return {
    generatedAt: now.toISOString(),
    stale: false,
    comex: {
      symbol: meta.symbol || 'HG=F',
      name: 'COMEX Copper Futures',
      currency: meta.currency || 'USD',
      unit: 'lb',
      price: round(price, 4),
      previousClose: round(prev, 4),
      change: round(change, 4),
      changePct: round(changePct, 2),
      marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    },
    conversions: {
      usdPerTonne: round(usdPerTonne, 0),
      eurPerTonne: typeof eurPerUsd === 'number' ? round(usdPerTonne * eurPerUsd, 0) : null,
      eurPerUsd: round(eurPerUsd, 5),
    },
  };
}

export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}

export async function fetchWithTimeout(url, { timeout = 20000, ...opts } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CopperGazetteBot/1.0)', ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}
