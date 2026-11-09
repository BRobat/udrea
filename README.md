# udrea: Ea-nasir's Copper Gazette

An aggregator for copper news. It has a copper theme, a COMEX copper price ticker, and Ea-nasir himself as the logo.

*Quality copper, guaranteed. Complaints to Nanni.*

## How it works

The site is static and lives in `site/`, hosted on GitHub Pages. Browsers can't read RSS feeds or Yahoo Finance directly because of CORS, so a scheduled GitHub Action does the fetching and commits the results as JSON:

| File | Produced by | Source |
| --- | --- | --- |
| `site/data/news.json` | `scripts/fetch-news.mjs` | RSS feeds listed in `scripts/feeds.json`: Google News queries, MINING.COM, The Northern Miner, Mining Weekly, Investing News Network |
| `site/data/prices.json` | `scripts/fetch-prices.mjs` | COMEX copper futures `HG=F` (Yahoo Finance chart API) and EUR/USD from Frankfurter (ECB) |

`.github/workflows/update-data.yml` runs every 30 minutes and can also be started manually. It fetches both files, commits any changes, and redeploys the site. `.github/workflows/pages.yml` deploys `site/` on every push to `main`.

- If a feed fails, the remaining feeds are still used.
- If the price fetch fails, the previous price is kept and shown with a **stale** badge.

The repository ships with **sample** JSON so the layout can be previewed. Real data replaces it on the first Action run.

## Setup

1. Merge to `main`.
2. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Under **Actions → Update copper data**, click **Run workflow** to fetch real data right away.

## Images

- `site/assets/ea-nasir.png` is the logo: the meme face of Ea-nasir, as used on ea-nasir-shop.com. Until this file is added, the page falls back to `ea-nasir-placeholder.svg`. The logo is also used as the favicon.
- `site/assets/nanni-tablet.jpg` is a photo of Nanni's complaint tablet (British Museum BM 131236). It appears in the banner and the empty state. Until it is added, a CSS "clay tablet" is shown instead.

## Local development

```bash
npm ci
npm test          # unit tests (fixtures, no network)
npm run fetch     # fetch real news + prices into site/data/
npm run serve     # preview site/ locally
```

To add a news source, add an entry to `scripts/feeds.json`. Every item from every feed must mention copper (in its title, summary or categories) to be kept. Publisher spellings are merged in `canonicalSource()` in `scripts/lib.mjs`.
