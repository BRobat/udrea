#!/usr/bin/env node
// Fetches COMEX copper (Yahoo HG=F) and EUR/USD, writes site/data/prices.json.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readJson, writeJson, buildPrices, fetchWithTimeout } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'site/data/prices.json');

const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

async function getYahoo() {
  let lastErr;
  for (const host of YAHOO_HOSTS) {
    try {
      const res = await fetchWithTimeout(`https://${host}/v8/finance/chart/HG=F?interval=1d&range=5d`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function getEurPerUsd() {
  try {
    const res = await fetchWithTimeout('https://api.frankfurter.app/latest?from=USD&to=EUR');
    const j = await res.json();
    return j?.rates?.EUR ?? null;
  } catch (e) {
    console.warn('FX fetch failed:', e.message);
    return null;
  }
}

try {
  const [chart, eur] = await Promise.all([getYahoo(), getEurPerUsd()]);
  const prev = await readJson(OUT);
  const eurRate = eur ?? prev?.conversions?.eurPerUsd ?? null;
  const data = buildPrices(chart, eurRate);
  await writeJson(OUT, data);
  console.log(`COMEX HG=F ${data.comex.price} USD/lb (${data.comex.changePct}%), ${data.conversions.usdPerTonne} USD/t`);
} catch (e) {
  console.error('Price fetch failed:', e.message);
  const prev = await readJson(OUT);
  if (prev && !prev.stale) {
    prev.stale = true;
    await writeJson(OUT, prev);
    console.error('Marked existing prices.json as stale.');
  }
}
