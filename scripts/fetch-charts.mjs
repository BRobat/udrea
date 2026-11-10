#!/usr/bin/env node
// Fetches price history for copper (COMEX HG=F) and the copper miners in companies.json
// from Yahoo Finance, and writes site/data/charts.json for the Charts page.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readJson, writeJson, fetchWithTimeout, parseYahooSeries, LB_PER_KG } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'site/data/charts.json');

async function yahoo(symbol, range, interval) {
  const q = `v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  let lastErr;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const res = await fetchWithTimeout(`https://${host}/${q}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// Daily closes for the last year, weekly closes for five years.
async function history(symbol, opts = {}) {
  const [daily, weekly] = await Promise.all([yahoo(symbol, '1y', '1d'), yahoo(symbol, '5y', '1wk')]);
  const d = parseYahooSeries(daily, opts);
  const w = parseYahooSeries(weekly, opts);
  return { currency: d.currency, last: d.last, previousClose: d.previousClose, daily: d.points, weekly: w.points };
}

const companies = await readJson(join(root, 'scripts/companies.json'), []);
const previous = await readJson(OUT, { companies: [] });

const copperTask = history('HG=F', { scale: LB_PER_KG, currency: 'USD', unit: 'kg' }); // USD/lb -> USD/kg
const companyTasks = companies.map((c) => history(c.symbol));
const [copperRes, ...companyRes] = await Promise.allSettled([copperTask, ...companyTasks]);

const out = { generatedAt: new Date().toISOString(), copper: null, companies: [] };

if (copperRes.status === 'fulfilled') {
  out.copper = { symbol: 'HG=F', name: 'Copper (COMEX futures)', unit: 'kg', ...copperRes.value };
  console.log(`  ok   HG=F  ${out.copper.daily.length} daily / ${out.copper.weekly.length} weekly`);
} else {
  console.log(`  FAIL HG=F  ${copperRes.reason?.message}`);
  out.copper = previous.copper || null; // keep the last good series
}

companies.forEach((c, i) => {
  const r = companyRes[i];
  if (r.status === 'fulfilled' && r.value.daily.length > 1) {
    out.companies.push({ ...c, ...r.value });
    console.log(`  ok   ${c.symbol.padEnd(8)} ${r.value.daily.length} daily / ${r.value.weekly.length} weekly (${r.value.currency})`);
  } else {
    const old = (previous.companies || []).find((p) => p.symbol === c.symbol);
    if (old) out.companies.push({ ...old, ...c, stale: true });
    console.log(`  FAIL ${c.symbol.padEnd(8)} ${r.reason?.message || 'no data'}${old ? ' (kept previous data)' : ''}`);
  }
});

if (!out.copper && out.companies.length === 0) {
  console.error('No chart data fetched; leaving charts.json untouched.');
  process.exit(0);
}

await writeJson(OUT, out);
console.log(`Wrote copper + ${out.companies.length} companies to ${OUT}`);
