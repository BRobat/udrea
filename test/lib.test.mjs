import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Parser from 'rss-parser';
import {
  isCopperRelated, stripHtml, truncate, splitGoogleTitle, normalizeItem, mergeArticles, buildPrices, LB_PER_TONNE,
} from '../scripts/lib.mjs';

test('isCopperRelated', () => {
  assert.ok(isCopperRelated('Copper prices rise'));
  assert.ok(isCopperRelated('Cu cathode premiums'));
  assert.ok(!isCopperRelated('CU Boulder wins'));
  assert.ok(!isCopperRelated('Gold rallies'));
});

test('stripHtml and truncate', () => {
  assert.equal(stripHtml('<p>A &amp; B</p><script>x()</script>'), 'A & B');
  const t = truncate('word '.repeat(100), 50);
  assert.ok(t.length <= 51 && t.endsWith('…'));
});

test('splitGoogleTitle', () => {
  assert.deepEqual(splitGoogleTitle('Copper jumps 3% - Reuters'), { title: 'Copper jumps 3%', publisher: 'Reuters' });
  assert.equal(splitGoogleTitle('No publisher here').publisher, null);
});

test('normalizeItem on fixture feed filters off-topic and unsafe links', async () => {
  const xml = await readFile(new URL('./fixtures/mining.xml', import.meta.url), 'utf8');
  const parsed = await new Parser({ customFields: { item: [['media:content', 'media:content']] } }).parseString(xml);
  const feed = { name: 'Mining', source: 'MINING.COM', url: 'https://www.mining.com/feed/', copperOnly: false };
  const items = parsed.items.map((i) => normalizeItem(i, feed)).filter(Boolean);
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'MINING.COM');
  assert.equal(items[0].image, 'https://example.com/a.jpg');
  assert.match(items[0].summary, /Copper & zinc rallied/);
  assert.equal(items[0].published, '2026-11-09T10:00:00.000Z');
});

test('normalizeItem Google News splits publisher', () => {
  const feed = { name: 'G', source: null, url: 'https://news.google.com/rss/search?q=copper', copperOnly: true };
  const a = normalizeItem({ title: 'Copper slides - Bloomberg', link: 'https://news.google.com/x', isoDate: '2026-11-09T00:00:00Z', contentSnippet: 'dup' }, feed);
  assert.equal(a.title, 'Copper slides');
  assert.equal(a.source, 'Bloomberg');
  assert.equal(a.summary, '');
});

test('mergeArticles dedupes, sorts, drops old', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const arts = [
    { title: 'A story', link: 'https://x/1?utm_source=a', published: '2026-11-08T00:00:00Z' },
    { title: 'A Story!', link: 'https://x/2', published: '2026-11-09T00:00:00Z' },
    { title: 'B', link: 'https://x/1', published: '2026-11-07T00:00:00Z' },
    { title: 'Old', link: 'https://x/3', published: '2025-01-01T00:00:00Z' },
    { title: 'C', link: 'https://x/4', published: '2026-11-09T06:00:00Z' },
  ];
  const out = mergeArticles(arts, { now });
  assert.deepEqual(out.map((a) => a.title), ['C', 'A Story!', 'B']);
});

test('buildPrices', () => {
  const chart = { chart: { result: [{ meta: { symbol: 'HG=F', currency: 'USD', regularMarketPrice: 5, chartPreviousClose: 4.8, regularMarketTime: 1762700000 } }] } };
  const p = buildPrices(chart, 0.9, new Date('2026-11-09T00:00:00Z'));
  assert.equal(p.comex.price, 5);
  assert.equal(p.comex.change, 0.2);
  assert.equal(p.comex.changePct, 4.17);
  assert.equal(p.conversions.usdPerTonne, Math.round(5 * LB_PER_TONNE));
  assert.equal(p.conversions.eurPerTonne, Math.round(5 * LB_PER_TONNE * 0.9));
  assert.throws(() => buildPrices({}, 0.9));
});
