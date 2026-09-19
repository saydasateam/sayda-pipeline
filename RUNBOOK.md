# RUNBOOK — one scheduled run (interim mode: Claude session + your Chrome)

Read this top to bottom, then execute. Target: ≤ 60 min, ≤ 110 tool calls. Never improvise a parser — every store has an adapter.

## 0. Setup (2 calls)
```
git clone https://github.com/saydasateam/sayda-pipeline.git && cd sayda-pipeline && node build.js   # sanity
```
**EVERY run is FULL** — availability + price re-check of existing rows, then discovery, coupons and travel — at all four
Riyadh times (08:30 · 12:30 · 16:30 · 20:30). There is no CHECK-only run. (Until 2026-09-19 this file said 08:30 was the
only full run and the other three were availability-only; that is no longer true and was the reason three quarters of the
day's runs added nothing.)

**Browser — check this FIRST, before the clone.** Call `mcp__claude-in-chrome__tabs_context_mcp` (the user's Chrome, signed
in to GitHub as saydasateam). If that errors, try `mcp__remote-devices__Claude_Browser__tabs_context`. If neither answers:
wait 5 minutes and try both again, up to three attempts spread over ~15 minutes — a laptop that is still waking is the
common case and a single probe at :30 gives a false negative. Only after the third failure, PushNotification
«التحديث لم يعمل: لا يوجد متصفح متاح» with the exact tool error, and stop. A run that ends inside ten minutes has almost
certainly taken this branch; say so plainly in the summary so a 4-minute no-op is never mistaken for a clean run.

## 1. CHECK phase — every row, all stores in parallel (≈ 12 calls)
For each store id in `config/stores.json` (16), open one Chrome tab on `store.home` (for **saco** open `store.landing`;
for **jarir** any jarir.com page works even if it 404s), then **bootstrap the adapter from raw GitHub** rather than pasting a
bundle into the injection:
```js
(0,eval)(await fetch('https://raw.githubusercontent.com/saydasateam/sayda-pipeline/main/adapters/_core.js').then(r=>r.text()));
(0,eval)(await fetch('https://raw.githubusercontent.com/saydasateam/sayda-pipeline/main/adapters/<id>.js').then(r=>r.text()));
SAYDA.start('check:<id>', () => SAYDA.adapters['<id>'].check(<rows>))
```
Two short lines instead of an 11 KB paste, and the adapter is always the committed version. `node scripts/inject.js <id> check`
still prints the old self-contained bundle — keep it for **jarir, ikea and midas**, whose Content-Security-Policy blocks the
`fetch` above. Do 2 stores per `browser_batch`: larger batches with heavy injections time out reliably.
- Stores whose adapter has `render: true` (**homecentre, homebox, panhome, trendyol**) have no fetch-based `check`: for each of their rows `navigate` → wait 4 s → inject core+adapter (`node scripts/inject.js <id>` without action) → `SAYDA.adapters['<id>'].checkCurrent({id, url})`. Batch 3 rows per call. (panhome: run the GraphQL `check` first, then render.)
- Wait ~90 s, then per tab: `SAYDA.status('check:<id>')`. When done: `SAYDA.show('check:<id>')` then `get_page_text` on that tab → save the JSON after the `SAYDA:` line to `work/check/<id>.json`. (javascript results are truncated at ~1 KB; page text is not — that is what `show()` is for.)
- Extra is slow by design (sequential, ~5 min for 18 rows). Start it first.
- A store that errors twice: write `[]` to its file and mention it in the summary. Never mark rows from memory.

Then: `node apply.js check` → prints counts; `work/report.json` lists newlyUnavailable / restocked / priceChanged / fixedLinks / unchecked.

## 2. FULL run only — discovery (≈ 12 calls)
- Same injection with action `collect` (for extra & amazon use the kanbkam tab: `node scripts/inject.js kanbkam` then
  `SAYDA.start('collect:extra', ()=>SAYDA.kanbkam.listing(13, <cats from config>, <rules>))`, seller 1 for amazon).
- Read each store's candidates with `SAYDA.show('collect:<id>', r => r.candidates.slice(0,40).map(c=>[c.key,c.brand,c.name.slice(0,45),c.price,c.was,c.url].join('|')).join('\n'))` + `get_page_text`.
- Shortlist **up to 8 per store — a ceiling, never a quota.** Take none from a store that has nothing worth taking; an empty
  store is a correct result, not a gap to fill. The old «~2–4 per store» capped good stores and flattered poor ones: a store with
  twenty genuine deals lost sixteen of them while a store with one weak deal still spent a slot. `apply.js new` then ranks ALL
  candidates together — verified savings first, then money saved — and keeps the top `rules.page.maxNewPerRun`, so the stores that
  actually earned the slots get them. The rest are re-collected next run, not lost.
  Qualifying gate comes from `config/rules.json → candidate.tiers` (tiered by live price) — never a number written here.
  Also: well-known brand, not already in `data/state.json` (match by id `store:key`), one variant per model.
  Trendyol: skip cards with `plusOnly` unless instructive — that price needs a subscription. Trendyol candidates carrying
  `lowestRecent` can be judged with no extra lookup, so they are the cheapest to verify in the whole pipeline.
- Evidence: noon/amazon/extra → `SAYDA.kanbkam.history(ids, mid)` on the kanbkam tab (mid from config; extra ids are `e<id>`). jarir/blackbox/almanea/saco/trendyol → `SAYDA.kanbkam.market(['brand model', …])`, keep only the SAME model. ashley ↔ midas: compare the same piece. ikea/homecentre/homebox/panhome/cityw/baytonia → verdict `na` with the store's discounted-share sentence.

  **«keep only the SAME model» is a hard filter, not a hint — write the filter, do not eyeball it.** On 2026-09-19 a sweep of
  62 branded Trendyol candidates was matched by «cheapest listing whose title looks right». It returned a screen protector as
  the market price of a 675-riyal Huawei watch, a nylon strap for a Xiaomi band, a charging cable for an Amazfit, a
  replacement headband for JBL earphones, and a **Koolen** air fryer as the reference for a **Black&Decker** one. Published as
  written, the page would have claimed a 96% overprice on an item priced correctly. Every market lookup must pass all four:
  1. **accessory guard** — drop titles matching `strap|band for|bands|case|cover|protector|screen|cable|cord|charger for|replacement|compatible|suitable for|holder|stand|pouch|sleeve|film|glass|skin|جراب|حافظة|واقي|حزام|كابل|بديل|متوافق`;
  2. **brand as a whole word** — `\bblack\b` must not match «Koolen … black»; a two-word brand must match both words;
  3. **model as a whole word, or run together** — `dlc 36362` and `dlc36362` both count, `band 10` never matches «Band 9»,
     and a query with no model token at all is rejected outright rather than matched on the brand alone;
  4. **sanity band** — reject a candidate priced below 0.35× or above 3× the row's price.
  Expect a low hit rate and do not force it: of those 62 queries, 49 returned listings, 12 survived the filter, and only 5
  became deals. Most of a marketplace's catalogue is own-label stock that exists in no other Saudi store, so **no evidence is
  the correct answer** for those rows — they stay `na`. An unverifiable row is a row we do not publish as a discount; it is
  never a reason to loosen the filter.
- For each kept candidate compute `verdict(price, was, evidence, rules)` (or `trendyolVerdict`) from `rules/verdict.js` in node, then write the row: `{id, store, cat, name(Arabic, short), price, was, ref, refKind, refUrl, verdict, finding(Arabic — refine the default text), url, avail, availNote}`;
  `refKind` is `history` when `ref` came from a price record and `market` when it came from another store's price — the page words the two
  differently («✓ خصم مؤكّد» vs «✓ أرخص من متجر آخر»), so it is not optional. `refUrl` is the URL of the **compared** product, required when
  `refKind` is `market`: without it the «دليل السعر» panel asserts a cross-store comparison the reader has no way to check. Omit it for history rows.
  **`ref` is whatever `verdict()` returned — never a number you picked.** On 2026-09-19, 29 of 118 history-referenced rows carried a
  reference taken from KanBkam's 12-month **max** (or a mid-range average) instead of `previousPrice`. The page read «خصم ٦٧٪» on an
  item whose price had not moved: 1,899 before, 1,899 now. That is the exact practice this site exists to expose, published under our
  own name. The methodology promises «السعر الذي كان يُباع به فعلاً قبل العرض» — that is `previousPrice`, nothing else.
  Store the evidence with the row so the claim can be re-checked later without the network:
  `ev: {prev, min, max, src:'kanbkam'|'market', on:'YYYY-MM-DD'}`. `node scripts/replay.js` re-derives every row that has `ev` and
  fails the run if a stored `ref` disagrees with it.
  avail from the collect output (inStock/qty) is provisional — mark `in` only if the collect data says in stock. Save as `work/new-rows.json`, then `node apply.js new work/new-rows.json`. Row budget comes from `rules.json → page` (`targetRows`, `maxRows`, `maxNewPerRun`) — never from a number written here.

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
Final message in Arabic, concise: top 7 verified deals available now (store, price, real vs claimed), new rows, newly
unavailable / restocked / price changes (from work/report.json), coupon and travel changes, stores skipped and why, and
confirmation of both commits.

**Prove the run did something before calling it done.** Read `https://github.com/saydasateam/sayda-deals/commits/main` and
confirm the newest commit is this run's. Then:
- newest commit is this run's → clean run, stay silent.
- **no commit from this run, for any reason** → PushNotification. This is not optional and it outranks «stay silent»: a run
  that publishes nothing and says nothing is indistinguishable from a healthy one in the schedule's own record, which reports
  SUCCEEDED either way. On 2026-09-19 all four runs ended in ~4 minutes having committed nothing; only the user noticing the
  stale page revealed it. State what stopped it (no browser, adapter failures, budget) and how far the run got.
PushNotification also when: a store failed, a commit failed, or ≥ 5 deals ended at once.
If today is after 30 Sep 2026: say the sale is over and suggest pausing the task.

## Safety
Never buy, add to cart, sign in, accept cookie banners, or submit any form other than the two GitHub commits. Never read or use tokens. Never curl store sites from the sandbox — adapters run in the browser only.
