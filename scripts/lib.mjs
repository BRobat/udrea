// Pure helpers shared by the fetch scripts (unit-tested in test/).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const LB_PER_TONNE = 2204.62262;
export const LB_PER_KG = 2.20462262;

// Copper-only producers and mines whose news is copper news even when the word isn't used.
const COPPER_NAMES_RE = /\b(codelco|kghm|escondida|grasberg|kamoa|kakula|antofagasta|freeport[- ]mcmoran|cobre|oyu tolgoi|collahuasi|chuquicamata|resolution copper)\b/i;

export function isCopperRelated(text) {
  const t = text || '';
  // "Cu" is matched case-sensitively so e.g. "CU Boulder" doesn't count.
  return /\bcopper\b/i.test(t) || /\bCu\b/.test(t) || COPPER_NAMES_RE.test(t);
}

const COPPER_WORD_RE = /\bcopper\b|\bCu\b|\b(codelco|kghm|escondida|grasberg|kamoa|kakula|antofagasta|freeport[- ]mcmoran|cobre|oyu tolgoi|collahuasi|chuquicamata)\b/i;
const OTHER_COMMODITY_RE = /\b(gold|silver|lithium|uranium|nickel|zinc|iron ore|coal|rare earths?|platinum|palladium|diamonds?|oil|gas|potash|graphite|vanadium|tungsten|antimony|tin)\b/i;
const SPORTS_RE = /\b(volleyball|football|basketball|hockey|soccer|baseball|softball|wrestling|lacrosse|playoffs?|tournament|varsity|district title|state title|homecoming|copper kings|coppermen|copperheads)\b/i;

/**
 * Strict headline test: copper must be what the story is about.
 * - the headline mentions copper (or a copper-only producer or mine),
 * - no other commodity is named before copper ("Northstar Gold … copper" is a gold story),
 * - it isn't a sports story about a team named after copper.
 */
export function isCopperHeadline(title, link = '') {
  const t = String(title || '');
  const copper = COPPER_WORD_RE.exec(t);
  if (!copper) return false;
  const other = OTHER_COMMODITY_RE.exec(t);
  if (other && other.index < copper.index) return false;
  if (SPORTS_RE.test(t) || /\/sports?\//i.test(link)) return false;
  return true;
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

// Known spellings of the same publisher, keyed by lowercase name without "www.".
const SOURCE_ALIASES = {
  'mining.com': 'MINING.COM',
  'marketscreener.com': 'MarketScreener',
  'proactive financial news': 'Proactive',
  'proactive investors': 'Proactive',
  'reuters.com': 'Reuters',
  'the globe and mail': 'The Globe and Mail',
};

/** Normalize publisher names so e.g. "Mining.com" and "MINING.COM" share one filter chip. */
export function canonicalSource(name) {
  const clean = String(name || '').trim().replace(/^www\./i, '');
  if (!clean) return 'Unknown';
  return SOURCE_ALIASES[clean.toLowerCase()] || clean;
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
  source = canonicalSource(source || feed.name);

  // Google News descriptions are just a link list repeating the title — skip them.
  const rawSummary = isGoogle ? '' : (item.contentSnippet || item.summary || item.content || '');
  const summary = truncate(stripHtml(rawSummary));

  // Only stories whose headline is about copper (or a copper-only producer or mine).
  if (!isCopperHeadline(title, item.link) || isJunkTitle(title)) {
    return null;
  }

  const dateStr = item.isoDate || item.pubDate;
  const date = dateStr ? new Date(dateStr) : null;
  const published = date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;

  const image = extractItemImage(item);

  return { title, link: item.link, source, published, summary, image };
}

/** Map case-only variants of a source name to its most common spelling. */
export function unifySourceSpellings(articles) {
  const counts = new Map();
  for (const a of articles) {
    if (!a) continue;
    const key = String(a.source || "").toLowerCase();
    const byName = counts.get(key) || new Map();
    byName.set(a.source || "", (byName.get(a.source || "") || 0) + 1);
    counts.set(key, byName);
  }
  const best = new Map();
  for (const [key, byName] of counts) {
    best.set(key, [...byName].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0]);
  }
  return articles.map((a) => (a && a.source ? { ...a, source: best.get(a.source.toLowerCase()) } : a));
}

/** Quote pages and other non-articles that search feeds return. */
export function isJunkTitle(title) {
  const t = String(title || '').trim();
  return /stock price (&|and) latest news/i.test(t) || /^[A-Z0-9.^%:_-]+\s+-\s*(\||$)/.test(t);
}

// ---------- Google News link decoding ----------
// Google News RSS links are opaque redirects (news.google.com/rss/articles/<id>) that often
// stop on a consent page. These helpers turn them into the publisher's own URL.

export function googleArticleId(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'news.google.com') return null;
    const m = /\/(?:rss\/)?articles\/([^/?#]+)/.exec(u.pathname);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Older ids are base64 protobufs that contain the URL in plain text. */
export function decodeOldStyleId(id) {
  try {
    const bytes = Buffer.from(id.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
    const m = /https?:\/\/[\x21-\x7e]+/.exec(bytes);
    if (!m) return null;
    // Newer ids hold an opaque token ("AU_yqL…") instead and need the online lookup.
    const url = m[0];
    return isHttpUrl(url) && !/news\.google\.com/.test(url) ? url : null;
  } catch {
    return null;
  }
}

/** Signature and timestamp embedded in a news.google.com article page. */
export function parseGoogleSignature(html) {
  const sg = /data-n-a-sg="([^"]+)"/.exec(html || '')?.[1];
  const ts = /data-n-a-ts="([^"]+)"/.exec(html || '')?.[1];
  return sg && ts ? { signature: sg, timestamp: ts } : null;
}

export function buildBatchExecuteBody(id, { signature, timestamp }) {
  const inner = JSON.stringify([
    'garturlreq',
    [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id,
    Number(timestamp),
    signature,
  ]);
  return 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]));
}

/** Pull the article URL out of a batchexecute response. */
export function parseBatchExecuteResponse(text) {
  const body = String(text || '').replace(/^\)\]\}'\s*/, '');
  // The response is a series of length-prefixed JSON chunks; find the one with our payload.
  for (const line of body.split('\n')) {
    if (!line.includes('garturlres')) continue;
    try {
      const outer = JSON.parse(line);
      for (const entry of outer) {
        if (entry && entry[0] === 'wrb.fr' && typeof entry[2] === 'string') {
          const url = JSON.parse(entry[2])[1];
          if (isHttpUrl(url)) return url;
        }
      }
    } catch { /* try the next line */ }
  }
  return null;
}

/** Resolve a Google News link to the publisher URL, or null. */
export async function decodeGoogleNewsUrl(url, fetchImpl = fetchWithTimeout) {
  const id = googleArticleId(url);
  if (!id) return null;
  const direct = decodeOldStyleId(id);
  if (direct) return direct;
  const page = await fetchImpl(`https://news.google.com/articles/${id}`, { timeout: 10000 });
  const sig = parseGoogleSignature(await page.text());
  if (!sig) return null;
  const res = await fetchImpl('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    timeout: 10000,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: buildBatchExecuteBody(id, sig),
  });
  return parseBatchExecuteResponse(await res.text());
}

/** Best image URL carried by an RSS item itself (enclosure, media tags, or first <img> in the content). */
export function extractItemImage(item) {
  const candidates = [];
  const enc = item.enclosure;
  if (enc && enc.url && /^image\//.test(enc.type || 'image/')) candidates.push(enc.url);
  for (const key of ['media:content', 'media:thumbnail']) {
    const m = item[key];
    for (const entry of Array.isArray(m) ? m : [m]) {
      if (entry && entry.$ && entry.$.url && (!entry.$.medium || entry.$.medium === 'image')) candidates.push(entry.$.url);
    }
  }
  const html = `${item['content:encoded'] || ''} ${item.content || ''}`;
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) candidates.push(m[1].replace(/&amp;/g, '&'));
  return candidates.find((u) => isHttpUrl(u) && !isTrackingPixel(u)) || null;
}

function isTrackingPixel(url) {
  return /(feedburner|pixel|tracking|1x1|spacer|gravatar|blank\.gif|\/emoji\/)/i.test(url);
}

/** Pull og:image / twitter:image out of an article page's HTML, resolved against the page URL. */
export function extractOgImage(html, pageUrl) {
  const metas = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  const wanted = ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'];
  const found = {};
  for (const tag of metas) {
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (key && content && wanted.includes(key) && !found[key]) found[key] = content.replace(/&amp;/g, '&').trim();
  }
  for (const key of wanted) {
    if (!found[key]) continue;
    try {
      const abs = new URL(found[key], pageUrl).toString();
      if (isHttpUrl(abs) && !isTrackingPixel(abs)) return abs;
    } catch { /* ignore bad URL */ }
  }
  return null;
}

/** Dedupe by URL and normalized title, sort newest first, cap the list. */
export function mergeArticles(articles, { limit = 60, maxAgeDays = 30, now = Date.now() } = {}) {
  const seenTitles = new Set();
  const seenUrls = new Set();
  const out = [];
  const minTime = now - maxAgeDays * 86400e3;
  articles = unifySourceSpellings(articles);
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

/**
 * Turn a Yahoo chart response into compact [unixSeconds, close] points.
 * `scale` converts units (e.g. USD/lb -> USD/kg); London prices in pence (GBp) become pounds.
 */
export function parseYahooSeries(chart, { scale = 1, currency } = {}) {
  const result = chart?.chart?.result?.[0];
  if (!result) throw new Error(chart?.chart?.error?.description || 'Yahoo response has no result');
  const meta = result.meta || {};
  let factor = scale;
  let cur = currency || meta.currency || null;
  if (cur === 'GBp' || cur === 'GBX') {
    factor /= 100;
    cur = 'GBP';
  }
  const times = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const round = (n) => Number(n.toPrecision(6));
  const points = [];
  times.forEach((t, i) => {
    const c = closes[i];
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) points.push([t, round(c * factor)]);
  });
  const last = typeof meta.regularMarketPrice === 'number' ? round(meta.regularMarketPrice * factor) : points.at(-1)?.[1] ?? null;
  // Make the newest point match the live price so the chart ends where the headline number is.
  if (last != null && points.length && meta.regularMarketTime && meta.regularMarketTime >= points.at(-1)[0]) {
    points[points.length - 1] = [points.at(-1)[0], last];
  }
  return { currency: cur, last, points };
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
