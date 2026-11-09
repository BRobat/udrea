import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Parser from 'rss-parser';
import {
  isCopperRelated, canonicalSource, isJunkTitle, googleArticleId, decodeOldStyleId,
  parseGoogleSignature, parseBatchExecuteResponse, buildBatchExecuteBody, decodeGoogleNewsUrl, extractItemImage, extractOgImage, unifySourceSpellings, stripHtml, truncate, splitGoogleTitle, normalizeItem, mergeArticles, buildPrices, LB_PER_TONNE,
} from '../scripts/lib.mjs';

test('isCopperRelated', () => {
  assert.ok(isCopperRelated('Copper prices rise'));
  assert.ok(isCopperRelated('Cu cathode premiums'));
  assert.ok(!isCopperRelated('CU Boulder wins'));
  assert.ok(!isCopperRelated('Gold rallies'));
  assert.ok(isCopperRelated("Chile's Codelco needs private partners"));
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
  const feed = { name: 'Mining', source: 'MINING.COM', url: 'https://www.mining.com/feed/' };
  const items = parsed.items.map((i) => normalizeItem(i, feed)).filter(Boolean);
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'MINING.COM');
  assert.equal(items[0].image, 'https://example.com/a.jpg');
  assert.match(items[0].summary, /Copper & zinc rallied/);
  assert.equal(items[0].published, '2026-11-09T10:00:00.000Z');
});

test('normalizeItem Google News splits publisher', () => {
  const feed = { name: 'G', source: null, url: 'https://news.google.com/rss/search?q=copper' };
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

test('off-topic items are dropped even from copper searches', () => {
  const feed = { name: 'G', source: 'Reuters', url: 'https://news.google.com/rss/search?q=copper+site:reuters.com' };
  const item = { title: 'Democratic US senators see hope for permitting bill - Reuters', link: 'https://news.google.com/y', isoDate: '2026-11-09T00:00:00Z' };
  assert.equal(normalizeItem(item, feed), null);
  // Copper only in tags or summary is not enough: the headline must be about copper.
  const mfeed = { name: 'M', source: 'MINING.COM', url: 'https://www.mining.com/feed/' };
  const tagged = { title: 'Vale lifts outlook', link: 'https://x/v', isoDate: '2026-11-09T00:00:00Z', categories: [{ _: 'Copper' }], contentSnippet: 'copper and nickel' };
  assert.equal(normalizeItem(tagged, mfeed), null);
  assert.equal(normalizeItem({ title: 'Barrick targets November filing for North American IPO', link: 'https://x/b', contentSnippet: 'gold and copper' }, mfeed), null);
  assert.ok(normalizeItem({ title: 'Codelco output falls in October', link: 'https://x/c' }, mfeed));
  assert.equal(normalizeItem({ title: '5255.JNX - | Stock Price & Latest News - Reuters', link: 'https://news.google.com/x' }, feed), null);
});

test('canonicalSource and unifySourceSpellings merge publisher variants', () => {
  assert.equal(canonicalSource('Mining.com'), 'MINING.COM');
  assert.equal(canonicalSource('www.marketscreener.com'), 'MarketScreener');
  assert.equal(canonicalSource(' Kitco '), 'Kitco');
  const out = unifySourceSpellings([{ source: 'Foo News' }, { source: 'FOO NEWS' }, { source: 'Foo News' }]);
  assert.deepEqual(out.map((a) => a.source), ['Foo News', 'Foo News', 'Foo News']);
});

test('extractItemImage finds media, enclosure and inline images', () => {
  assert.equal(extractItemImage({ enclosure: { url: 'https://x/e.jpg', type: 'image/jpeg' } }), 'https://x/e.jpg');
  assert.equal(extractItemImage({ 'media:content': [{ $: { url: 'https://x/m.jpg', medium: 'image' } }] }), 'https://x/m.jpg');
  assert.equal(
    extractItemImage({ 'content:encoded': '<p><img src="https://feeds.feedburner.com/~r/pixel.gif"><img src="https://x/c.jpg?a=1&amp;b=2"></p>' }),
    'https://x/c.jpg?a=1&b=2', // tracking pixel skipped
  );
  assert.equal(extractItemImage({ content: '<img class="wp" src="https://x/c.jpg?a=1&amp;b=2">' }), 'https://x/c.jpg?a=1&b=2');
  assert.equal(extractItemImage({ title: 'none' }), null);
});

test('extractOgImage reads og/twitter tags and resolves relative URLs', () => {
  const html = '<head><meta name="twitter:image" content="https://cdn/t.jpg"><meta content="/img/og.png" property="og:image"></head>';
  assert.equal(extractOgImage(html, 'https://site.com/news/a'), 'https://site.com/img/og.png');
  assert.equal(extractOgImage('<meta name="twitter:image" content="https://cdn/t.jpg">', 'https://s.com'), 'https://cdn/t.jpg');
  assert.equal(extractOgImage('<html></html>', 'https://s.com'), null);
});

test('isJunkTitle', () => {
  assert.ok(isJunkTitle('5255.JNX - | Stock Price & Latest News'));
  assert.ok(isJunkTitle('TEKFF.GTC -'));
  assert.ok(!isJunkTitle('Copper - the metal of the future'));
});

test('Google News: article id and old-style ids', () => {
  const url = 'https://www.mining.com/copper-hits-record/';
  const proto = Buffer.concat([Buffer.from([0x08, 0x13, 0x22, url.length]), Buffer.from(url), Buffer.from([0xd2, 0x01, 0x00])]);
  const id = proto.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const link = `https://news.google.com/rss/articles/${id}?oc=5`;
  assert.equal(googleArticleId(link), id);
  assert.equal(googleArticleId('https://example.com/rss/articles/abc'), null);
  assert.equal(decodeOldStyleId(id), url);
  const newStyle = Buffer.from([0x08, 0x13, 0x22, 0x10, ...Buffer.from('AU_yqLOpaqueToken')]).toString('base64');
  assert.equal(decodeOldStyleId(newStyle), null);
});

const BATCH_RESPONSE = `)]}'

189
[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://www.reuters.com/markets/commodities/copper-rallies-2026-11-09/\\",1]",null,null,null,"generic"],["di",42],["af.httprm",42,"123",7]]
25
[["e",4,null,null,229]]
`;

test('Google News: signature parsing and batchexecute response', () => {
  const html = '<c-wiz><div jscontroller="x" data-n-a-sg="AZ5r3eSig" data-n-a-ts="1762700000" data-n-a-id="CBMiX"></div></c-wiz>';
  assert.deepEqual(parseGoogleSignature(html), { signature: 'AZ5r3eSig', timestamp: '1762700000' });
  assert.equal(parseGoogleSignature('<html></html>'), null);
  assert.equal(parseBatchExecuteResponse(BATCH_RESPONSE), 'https://www.reuters.com/markets/commodities/copper-rallies-2026-11-09/');
  assert.equal(parseBatchExecuteResponse(")]}'\n[]"), null);
  const body = decodeURIComponent(buildBatchExecuteBody('CBMiX', { signature: 'S', timestamp: '17' }).slice(6));
  const inner = JSON.parse(JSON.parse(body)[0][0][1]);
  assert.deepEqual(inner.slice(2), ['CBMiX', 17, 'S']);
});

test('decodeGoogleNewsUrl drives the two requests', async () => {
  const calls = [];
  const fakeFetch = async (url, opts = {}) => {
    calls.push([url, opts.method || 'GET']);
    const text = url.includes('batchexecute') ? BATCH_RESPONSE : '<div data-n-a-sg="SIG" data-n-a-ts="1700"></div>';
    return { text: async () => text };
  };
  const out = await decodeGoogleNewsUrl('https://news.google.com/rss/articles/CBMiOpaque?oc=5', fakeFetch);
  assert.equal(out, 'https://www.reuters.com/markets/commodities/copper-rallies-2026-11-09/');
  assert.deepEqual(calls.map((c) => c[1]), ['GET', 'POST']);
});
