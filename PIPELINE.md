# Sayda deals — pipeline

Code + data live here (public). The website itself is the private `saydasateam/sayda-deals` repo (Cloudflare Pages);
every run uploads the generated `dist/index.html` there as `index.html`.

Everything that used to live in one 25 KB scheduled-task prompt now lives here. The model's job shrinks to two things:
write the Arabic *finding* for new rows, and write the summary. Everything else is code.

```
config/stores.json      one entry per store (label, group, adapter, origin, catalog paths, coupon pages, verification method)
config/categories.json  the category chips
config/rules.json       candidate thresholds, verdict cut-offs, stock rules, page size caps
data/state.json         the truth: rows, travel offers, "no offer" airlines, coupons, note-card figures, dates
template/index.html     the page shell — chips, note cards, methodology list and data blocks are filled by build.js
build.js                state + config + template → dist/index.html (site) and dist/artifact.html (claude.ai page)
adapters/_core.js       helpers shared by adapters (fetch/parse/pool/background jobs)
adapters/<name>.js      one per platform; registers SAYDA.adapters[id] = { collect, check, coupons } in the store's page
adapters/kanbkam.js     price history + market comparison + Extra/Amazon seller listings (SAYDA.kanbkam)
rules/verdict.js        THE place that decides ok/warn/bad/na and in/low/oos/ended/gone
run.js                  headless driver (Playwright): run.js collect | check | coupons [--store a,b]
apply.js                merges work/check/*.json into state.json via the rules; writes work/report.json (what changed)
scripts/inject.js       prints a bundle to paste into a browser tab (Claude-in-Chrome / DevTools) when running by hand
lib/ar.js               Arabic date/number formatting
```

## Adding a store
1. Add an entry to `config/stores.json` (copy the closest sibling). `adapter` names a file in `adapters/`.
2. If it is a new platform, add `adapters/<platform>.js` exposing `collect(cfg, rules)`, `check(rows, cfg, rules)`, `coupons(cfg)`.
   Platforms already covered: noon, amazon, extra, jarir, nextdata (BlackBox/Al-Manea), saco, ikea, landmark (Home Centre/Homebox),
   magento (Pan Home/Baytonia), woo (CityW), shopify (Ashley), midas, trendyol.
3. Nothing else changes: chips, counts, note cards and the methodology list render from config.

Adding a category = one line in `config/categories.json`. Rows carry the category id.

## Daily flow (target ≤ 20 min, ≤ 35 model calls)
```
node run.js check      # every row, all stores in parallel tabs         → work/check/*.json
node apply.js check    # state.json updated, work/report.json written
node run.js collect    # morning only: candidates per store              → work/collect/*.json
# model: pick candidates, get kanbkam history/market (adapters/kanbkam.js), write findings → work/new-rows.json
node apply.js new work/new-rows.json
node run.js coupons    # landing-page scan → model updates state.coupons
node build.js          # dist/index.html → upload to saydasateam/sayda-deals (the site repo); commit data/state.json here
```
Availability rules (rules/verdict.js): `in` = buyable & live price matches; `low` = stock ≤ 3; `oos` = no add-to-cart;
`ended` = live price back at (or above) the reference the deal was measured against; `gone` = page missing.
The 'ended' reference is only used when it sits above the deal price — a cheaper competitor price never marks a row ended.

## Adapter execution model
Adapters run *inside the store's page* (same origin, real cookies), both under Playwright and when pasted into a Chrome tab.
Long jobs use `SAYDA.start(name, fn)` and are polled with `SAYDA.status(name)`; results are read with `SAYDA.result(name, from, len)`
in slices because the Chrome extension truncates tool output at ~1 KB.

Lessons from the 18 Sep live test:
- Extra product pages must be fetched sequentially (parallel bursts bounce to /ar-sa/error); the adapter retries 3×.
- Al-Manea/BlackBox SSR pages are ~1 MB each; parsing 40 of them in one tab froze the renderer → few pages, concurrency 2–3.
- Amazon's deals page only renders when the tab is visible and virtualises cards → Amazon candidates come from KanBkam (seller=1).
- Home Centre/Homebox/Pan Home/Trendyol need the product page rendered (navigate + ~3.5 s) — those adapters expose `checkCurrent(row)`.
- Midas product URLs move (…-midas.html → …-midas-saudi-arabia.html); the adapter searches and fixes the link.
