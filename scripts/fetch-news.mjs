#!/usr/bin/env node
// Fetches copper news from the RSS feeds in feeds.json and writes site/data/news.json.
import Parser from 'rss-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  readJson, writeJson, normalizeItem, mergeArticles, fetchWithTimeout, extractOgImage, decodeGoogleNewsUrl,
} from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'site/data/news.json');

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'media:content', { keepArray: true }],
      ['media:thumbnail', 'media:thumbnail', { keepArray: true }],
      'source',
    ],
  },
});

async function loadFeed(feed) {
  const res = await fetchWithTimeout(feed.url);
  const xml = await res.text();
  const parsed = await parser.parseString(xml);
  return (parsed.items || []).map((it) => normalizeItem(it, feed)).filter(Boolean);
}

const feeds = await readJson(join(root, 'scripts/feeds.json'), []);
const results = await Promise.allSettled(feeds.map(loadFeed));

const all = [];
const report = [];
results.forEach((r, i) => {
  if (r.status === 'fulfilled') {
    all.push(...r.value);
    report.push(`  ok   ${String(r.value.length).padStart(3)}  ${feeds[i].name}`);
  } else {
    report.push(`  FAIL      ${feeds[i].name}: ${r.reason?.message || r.reason}`);
  }
});
console.log('Feeds:\n' + report.join('\n'));

let articles = mergeArticles(all, { limit: 120 });
if (articles.length === 0) {
  // Keep whatever was there before rather than blanking the site.
  console.error('No articles fetched; leaving existing news.json untouched.');
  process.exit(0);
}

const previous = await readJson(OUT, { articles: [] });

// Run up to `n` async jobs from a list at a time.
async function pool(items, n, job) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    for (let it = queue.shift(); it; it = queue.shift()) await job(it);
  }));
}

// ---------- Google News links -> publisher URLs ----------
const knownLinks = new Map(
  (previous.articles || []).filter((a) => a.googleLink && a.link !== a.googleLink).map((a) => [a.googleLink, a.link]),
);
let decoded = 0;
let decodeFailed = 0;
await pool(articles.filter((a) => /news\.google\.com/.test(a.link)), 4, async (a) => {
  const googleLink = a.link;
  let real = knownLinks.get(googleLink);
  if (!real) {
    try {
      real = await decodeGoogleNewsUrl(googleLink);
    } catch {
      real = null;
    }
  }
  if (real) {
    a.googleLink = googleLink;
    a.link = real;
    decoded++;
  } else {
    decodeFailed++;
  }
});
console.log(`Google News links: ${decoded} resolved to publisher URLs, ${decodeFailed} left as Google links`);

// The same story often arrives both via Google and directly; dedupe again on real URLs.
articles = mergeArticles(articles);

// ---------- Images: reuse previous lookups, then try og:image on the article page ----------
const knownImages = new Map((previous.articles || []).filter((a) => a.image !== undefined).map((a) => [a.link, a.image]));

async function pageImage(link) {
  const res = await fetchWithTimeout(link, { timeout: 8000, headers: { Accept: 'text/html' } });
  if (!/html/i.test(res.headers.get('content-type') || '')) return null;
  // og tags live in <head>; don't download whole pages.
  const reader = res.body.getReader();
  let html = '';
  const decoder = new TextDecoder();
  while (html.length < 300_000) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    if (/<\/head>/i.test(html)) break;
  }
  reader.cancel().catch(() => {});
  return extractOgImage(html, res.url || link);
}

// Unresolved Google News links can't be scanned, so only publisher links are looked up.
let found = 0;
await pool(articles.filter((a) => !a.image && !/news\.google\.com/.test(a.link)), 6, async (a) => {
  if (knownImages.has(a.link)) {
    a.image = knownImages.get(a.link);
    return;
  }
  try {
    a.image = await pageImage(a.link);
  } catch {
    a.image = null;
  }
  if (a.image) found++;
});
console.log(`Images: ${articles.filter((a) => a.image).length}/${articles.length} (${found} new from article pages)`);

await writeJson(OUT, {
  generatedAt: new Date().toISOString(),
  count: articles.length,
  sources: [...new Set(articles.map((a) => a.source))].sort(),
  articles,
});
console.log(`Wrote ${articles.length} articles to ${OUT}`);
