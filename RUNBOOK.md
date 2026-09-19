# RUNBOOK — one scheduled run (interim mode: Claude session + your Chrome)

Read this top to bottom, then execute. Target: ≤ 20 min, ≤ 40 tool calls. Never improvise a parser — every store has an adapter.

## 0. Setup (2 calls)
```
git clone https://github.com/saydasateam/sayda-pipeline.git && cd sayda-pipeline && node build.js   # sanity
```
Decide the run type from Riyadh time (UTC+3): **08:30 → FULL** (check + collect + coupons + travel). **12:30 / 16:30 / 20:30 → CHECK** (availability only).
Browser: Claude in Chrome (`mcp__claude-in-chrome__*`). If it is not connected, try the built-in browser; if neither works → PushNotification "refresh could not run: no browser" and stop.

## 1. CHECK phase — every row, all stores in parallel (≈ 12 calls)
For each store id in `config/stores.json` (16): `node scripts/inject.js <id> check > /tmp/<id>.js` prints core + adapter + a `SAYDA.start('check:<id>', …)` call.
- Open one Chrome tab per store on `store.home` (for **saco** open `store.landing`; for **jarir** any jarir.com page works even if it 404s).
- Inject the whole file content with `javascript_tool` (`cat /tmp/<id>.js` and paste). Do 4–5 stores per `browser_batch`.
- Stores whose adapter has `render: true` (**homecentre, homebox, panhome, trendyol**) have no fetch-based `check`: for each of their rows `navigate` → wait 4 s → inject core+adapter (`node scripts/inject.js <id>` without action) → `SAYDA.adapters['<id>'].checkCurrent({id, url})`. Batch 3 rows per call. (panhome: run the GraphQL `check` first, then render.)
- Wait ~90 s, then per tab: `SAYDA.status('check:<id>')`. When done: `SAYDA.show('check:<id>')` then `get_page_text` on that tab → save the JSON after the `SAYDA:` line to `work/check/<id>.json`. (javascript results are truncated at ~1 KB; page text is not — that is what `show()` is for.)
- Extra is slow by design (sequential, ~5 min for 18 rows). Start it first.
- A store that errors twice: write `[]` to its file and mention it in the summary. Never mark rows from memory.

Then: `node apply.js check` → prints counts; `work/report.json` lists newlyUnavailable / restocked / priceChanged / fixedLinks / unchecked.

## 2. FULL run only — discovery (≈ 12 calls)
- Same injection with action `collect` (for extra & amazon use the kanbkam tab: `node scripts/inject.js kanbkam` then
  `SAYDA.start('collect:extra', ()=>SAYDA.kanbkam.listing(13, <cats from config>, <rules>))`, seller 1 for amazon).
- Read each store's candidates with `SAYDA.show('collect:<id>', r => r.candidates.slice(0,40).map(c=>[c.key,c.brand,c.name.slice(0,45),c.price,c.was,c.url].join('|')).join('\n'))` + `get_page_text`.
- Shortlist ~2–4 per store: well-known brand, saving ≥ 75 SAR (furniture ≥ 500), claimed ≥ 25 %, not already in `data/state.json` (match by id `store:key`), one variant per model. Trendyol: skip cards with `plusOnly` unless instructive.
- Evidence: noon/amazon/extra → `SAYDA.kanbkam.history(ids, mid)` on the kanbkam tab (mid from config; extra ids are `e<id>`). jarir/blackbox/almanea/saco/trendyol → `SAYDA.kanbkam.market(['brand model', …])`, keep only the SAME model. ashley ↔ midas: compare the same piece. ikea/homecentre/homebox/panhome/cityw/baytonia → verdict `na` with the store's discounted-share sentence.
- For each kept candidate compute `verdict(price, was, evidence, rules)` (or `trendyolVerdict`) from `rules/verdict.js` in node, then write the row: `{id, store, cat, name(Arabic, short), price, was, ref, verdict, finding(Arabic — refine the default text), url, avail, availNote}`; avail from the collect output (inStock/qty) is provisional — mark `in` only if the collect data says in stock. Save as `work/new-rows.json`, then `node apply.js new work/new-rows.json`. Keep the page ≤ 190 rows.

## 3. FULL run only — coupons & travel (≈ 6 calls)
- `inject.js <id> coupons` for noon, extra, blackbox, almanea, jarir, saco, amazon, ikea; read with `show()`. Update `state.coupons` in `data/state.json` (node one-liner): one entry per store/bank offer, only what the store's own page says; drop expired; keep the Trendyol Plus note.
- Travel: open each `state.travel[].url` with `get_page_text`; update code/dates/terms/verdict/checked; bookEnd = yesterday if withdrawn; drop rows whose bookEnd is > 3 days ago. Scan `config.travelSources` for new offers. Keep `state.travelNone` accurate (Saudia / flyadeal today).
- Update `state.notes.furnitureShare` from the collect stats (`sharePct`) when available.
- **A hand edit of `data/state.json` must never touch `meta`.** `apply.js` owns `meta.checkedAt` and `meta.updated`, and it stamps
  them as *Riyadh wall-clock digits carrying a `+03:00` suffix* (`new Date(Date.now()+3*3600e3).toISOString().replace('Z','+03:00')`)
  — which is what `lib/ar.js → time12()` reads back. Writing `new Date().toISOString()` and appending `+03:00` labels UTC digits as
  Riyadh and puts the page's "آخر فحص للتوفر" three hours behind, plausibly enough to ship unnoticed. If a run edits coupons or travel
  without a check phase, re-stamp with that exact expression, and verify with `time12(state.meta.checkedAt)` before building.

## 4. Build & publish (≈ 5 calls)
```
node build.js      # dist/index.html — note the "rows/available" counts it prints
```
- Upload `dist/index.html` to the site repo: navigate `https://github.com/saydasateam/sayda-deals/upload/main` → `find` the "Choose your files" input → `file_upload` with `<repo>/dist/index.html` → wait 7 s → set the commit message with the native setter and click the submit button, both in one `javascript_tool` call:
  `const i=document.querySelector('input[name="message"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Update <YYYY-MM-DD HH:MM> Riyadh');i.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('button')].find(b=>/^Commit changes$/.test(b.innerText.trim())&&b.type==='submit').click();`
  → wait 10 s → `location.href` must be the repo root. Verify on `/commits/main` that the newest commit is yours.
- Same for the data files into this repo: `https://github.com/saydasateam/sayda-pipeline/upload/main/data`.
  Upload **both `data/state.json` and `data/history.json` in the same commit** — select the two files in one `file_upload` call.
  `history.json` is the own-price-history store that `apply.js check` appends to every run. Each run clones `main` fresh, so a run that
  uploads only `state.json` throws its observations away: the file can never accumulate the `verdict.ownHistoryMinDays` distinct days
  that `na` rows (fashion, beauty, baby, furniture) need before they can be re-judged, and that re-judging silently never happens.
- These two commits are the ONLY forms this run may submit. Never touch README.md via upload (GitHub refuses the overwrite).
- Do not update the claude.ai artifact.

## 5. Report
Final message in Arabic, concise: top 7 verified deals available now (store, price, real vs claimed), new rows (FULL), newly unavailable / restocked / price changes (from work/report.json), coupon and travel changes (FULL), stores skipped and why, and confirmation of both commits.
PushNotification only when: a store or the whole run failed, a commit failed, or ≥ 5 deals ended at once. Otherwise stay silent.
If today is after 30 Sep 2026: say the sale is over and suggest pausing the task.

## Safety
Never buy, add to cart, sign in, accept cookie banners, or submit any form other than the two GitHub commits. Never read or use tokens. Never curl store sites from the sandbox — adapters run in the browser only.
