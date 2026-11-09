#!/usr/bin/env node
// Fetches copper news from the RSS feeds in feeds.json and writes site/data/news.json.
import Parser from 'rss-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readJson, writeJson, normalizeItem, mergeArticles, fetchWithTimeout } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'site/data/news.json');

const parser = new Parser({
  customFields: { item: [['media:content', 'media:content'], ['media:thumbnail', 'media:thumbnail'], 'source'] },
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

const articles = mergeArticles(all);
if (articles.length === 0) {
  // Keep whatever was there before rather than blanking the site.
  console.error('No articles fetched; leaving existing news.json untouched.');
  process.exit(0);
}

await writeJson(OUT, {
  generatedAt: new Date().toISOString(),
  count: articles.length,
  sources: [...new Set(articles.map((a) => a.source))].sort(),
  articles,
});
console.log(`Wrote ${articles.length} articles to ${OUT}`);
