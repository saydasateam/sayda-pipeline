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
for **jarir** any jarir.com page works even if it 404s), then **fetch the adapter AND the rows inside the browser** rather
than pasting either into the injection. `node scripts/inject.js <id> boot check` prints the whole thing —
355 bytes instead of 15.9 KB:
```js
const RAW='https://raw.githubusercontent.com/saydasateam/sayda-pipeline/main';
(0,eval)(await fetch(RAW+'/adapters/_core.js').then(r=>r.text()));
(0,eval)(await fetch(RAW+'/adapters/<adapter>.js').then(r=>r.text()));
await SAYDA.boot('<id>');
SAYDA.start('check:<id>', () => SAYDA.adapters['<id>'].check(SAYDA.ctx.rows, SAYDA.ctx.store, SAYDA.ctx.rules));
```
`SAYDA.boot()` fetches `config/stores.json`, `config/rules.json` and `data/state/<id>.json` and returns a
one-line receipt. Across all 16 stores this is 241.6 KB of injection down to 43.7 KB — and injected bytes are
the expensive kind, because everything pasted into a tab stays in context for every later call of the run.
Per-store shards are what make the rows half affordable: it pulls one store's file, not the whole page's data.

`node scripts/inject.js <id> check` still prints the old self-contained bundle — keep it for
**jarir, ikea and midas**, whose Content-Security-Policy blocks the `fetch` above (`boot` refuses
those three by name rather than emitting something that will fail in the tab). `boot` reads the
COMMITTED files, so pass a branch while testing: `node scripts/inject.js <id> boot check <branch>`. Do 2 stores per `browser_batch`: larger batches with heavy injections time out reliably.
- Stores whose adapter has `render: true` (**homecentre, homebox, panhome, trendyol**) have no fetch-based `check`: for each of their rows `navigate` → wait 4 s → inject core+adapter (`node scripts/inject.js <id>` without action) → `SAYDA.adapters['<id>'].checkCurrent({id, url})`. Batch 3 rows per call. (panhome: run the GraphQL `check` first, then render.)
- Wait ~90 s, then per tab: `SAYDA.status('check:<id>')`. When done: `SAYDA.show('check:<id>')` then `get_page_text` on that tab → save the JSON after the `SAYDA:` line to `work/check/<id>.json`. (javascript results are truncated at ~1 KB; page text is not — that is what `show()` is for.)
- Extra is slow by design (sequential, ~5 min for 18 rows). Start it first.
- A store that errors twice: write `[]` to its file and mention it in the summary. Never mark rows from memory.

Then: `node apply.js check` → prints counts; `work/report.json` lists newlyUnavailable / restocked / priceChanged / fixedLinks / unchecked.

## 2. FULL run only — discovery (≈ 12 calls)
- **Almanea: collect RENDERED, not fetched.** Its pager calls an authenticated API, so the fetch collector only ever saw
  page 1 — 32 of ~1,009 National Day offers. Rendered on 22 Sep: 31 pages, 902 products, 798 gate-passing candidates, ~2.5 min.
  (Blackbox stays fetch-collected for now — see `config/stores.json → blackbox.collect._render`.)
  Open the tab on `store.landing` (the campaign category), wait until product cards show, inject core + `nextdata.js`, then
  `SAYDA.start('collect:<id>', () => SAYDA.adapters['<id>'].collectRender(<store>, <rules>))`. It presses the store's own
  «Next page», reads each card's React props (the same structured object `__NEXT_DATA__`
  carries — never DOM price text), and merges the hand-listed category paths via `collect()`. `stats.stop` says why it
  stopped (`lastPage` is the healthy answer for Almanea); `stats.reachable` is how many campaign products it saw.
  Keep the tab in the foreground while it runs — background tabs throttle timers.
- Same injection with action `collect` (for extra & amazon use the kanbkam tab: `node scripts/inject.js kanbkam` then
  `SAYDA.start('collect:extra', ()=>SAYDA.kanbkam.listing(13, <cats from config>, <rules>))`, seller 1 for amazon).
- Read each store's candidates with `SAYDA.show('collect:<id>', r => r.candidates.slice(0,40).map(c=>[c.key,c.brand,c.name.slice(0,45),c.price,c.was,c.url].join('|')).join('\n'))` + `get_page_text`.
- Shortlist **up to 20 per store — a ceiling, never a quota.** (Raised from 8 on 22 Sep with `maxNewPerRun` 60 → 150.) Take none from a store that has nothing worth taking; an empty
  store is a correct result, not a gap to fill. The old «~2–4 per store» capped good stores and flattered poor ones: a store with
  twenty genuine deals lost sixteen of them while a store with one weak deal still spent a slot. `apply.js new` then ranks ALL
  candidates together — verified savings first, then money saved — and keeps the top `rules.page.maxNewPerRun`, so the stores that
  actually earned the slots get them. The rest are re-collected next run, not lost.
  Qualifying gate comes from `config/rules.json → candidate.tiers` (tiered by live price) — never a number written here.
  Also: well-known brand, not already in `data/state/<store>.json` (match by id `store:key`), one variant per model.
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
- `inject.js <id> coupons` for noon, extra, blackbox, almanea, jarir, saco, amazon, ikea; read with `show()`. Update `coupons` in `data/state/_coupons.json` (node one-liner; if the file does not exist yet, create it with `node -e "const S=require('./lib/state');const st=S.load('.');S.saveShared('.','coupons',{coupons:st.coupons});S.saveShared('.','travel',{travel:st.travel,travelNone:st.travelNone,travelNone_text:st.travelNone_text});S.saveShared('.','notes',{notes:st.notes})"` first): one entry per store/bank offer, only what the store's own page says; drop expired; keep the Trendyol Plus note.
- Travel: open each `travel[].url` in `data/state/_travel.json` with `get_page_text`; update code/dates/terms/verdict/checked; bookEnd = yesterday if withdrawn; drop rows whose bookEnd is > 3 days ago. Scan `config.travelSources` for new offers. Keep `travelNone` accurate (Saudia / flyadeal today).
- Update `notes.furnitureShare` in `data/state/_notes.json` from the collect stats (`sharePct`) when available.
- **`data/state/_*.json` has exactly one writer: this slot.** These three files are the only non-per-store state left, which is why
  coupons and travel ride along in one slot and one slot only. Two slots editing them reintroduces the clobber the sharding removed.
- **Nothing hand-edits a timestamp any more.** `meta.checkedAt` is no longer stored: `lib/state.js` derives it from the
  per-store `checkedAt` values at load time (newest = the page's «آخر فحص»; `meta.oldestCheckedAt` = the honest staleness
  guarantee across all sixteen stores). `apply.js` stamps only the shards it wrote, as *Riyadh wall-clock digits carrying a
  `+03:00` suffix* (`new Date(Date.now()+3*3600e3).toISOString().replace('Z','+03:00')`) — which is what `lib/ar.js → time12()`
  reads back. Writing `new Date().toISOString()` and appending `+03:00` labels UTC digits as Riyadh and puts the page three hours
  behind, plausibly enough to ship unnoticed. A run that edits coupons or travel without a check phase changes no timestamp at all,
  and that is correct: nothing was re-checked.

## 3b. FULL run only — comparator sweep (the sidecar, ~6 calls)
Only for the four `verify: "market"` stores (jarir, blackbox, almanea, saco). Everything else is
untouched by this phase.

```
node scripts/market-apply.js --plan        # writes work/market/<store>.jobs.json, prints the work list
```
- **Rendered, one query per navigation** (22 Sep: Google serves a plain `fetch` a JavaScript wall, so `sweep()` is retired and
  returns an explicit error per job). Start with `SAYDA.adapters.market.clear()` on a google.com tab. Then, for each job in
  `work/market/<store>.jobs.json`, in `browser_batch` groups of ~5 jobs: `navigate` to
  `https://www.google.com/search?tbm=shop&gl=sa&hl=en&num=20&q=<encoded q>` → wait 3 s → inject
  ```js
  const RAW='https://raw.githubusercontent.com/saydasateam/sayda-pipeline/main';
  (0,eval)(await fetch(RAW+'/adapters/_core.js').then(r=>r.text()));
  (0,eval)(await fetch(RAW+'/adapters/market.js').then(r=>r.text()));
  JSON.stringify(SAYDA.adapters.market.here({id:'<row id>', q:'<q>'}))
  ```
  `here()` reads the RENDERED page, checks only visible text for a challenge, and appends the result to localStorage on
  google.com, so results survive the next navigation. It returns a small receipt `{id, n, error?, saved}`.
  At the end: `SAYDA.adapters.market.dump(<ids of this store>)` + `get_page_text`, save the JSON after `SAYDA:mkt` to
  `work/market/<store>.json`.
- **Requires a Saudi, non-VPN connection.** From the VPN exit on 22 Sep Google answered the first query with a CAPTCHA.
- **If any receipt reports `CHALLENGE PAGE`, stop the sweep.** Do not continue to the next query. Continuing past a
  challenge returns empty results, which are indistinguishable from "no comparator exists" — and
  that confusion is the one thing this phase must never introduce. Report it and move on.
- `gl=sa` and `hl=en` are both load-bearing and are set in the adapter, not here. `gl=sa` keeps the
  merchants Saudi; `hl=en` keeps the model code in the title. With `hl=ar` the titles come back as
  «تلفزيون سامسونج، ١٠٠ بوصة» and `rules/match.js` correctly rejects all of them, yielding nothing.

```
node scripts/market-apply.js work/market/<store>.json            # SHADOW — prints, changes nothing
node scripts/market-apply.js work/market/<store>.json --apply    # writes the rows
```
- **Shadow is the default and stays the default until a full cycle has been run both ways.** The
  hand-probed path has a measured 8% yield over 62 real queries; this one has unit tests and four
  live probes. Compare the verdicts before trusting it.
- The same-model filter is `rules/match.js`, with `scripts/test-match.js` covering all five of the
  2026-09-19 false positives plus the near-miss and size cases. The parser is `rules/listing.js`,
  with `scripts/test-listing.js` covering blocks captured verbatim from the live page. **Run both
  before the sweep** — a green test suite is what makes a sweep result trustworthy.
- `ref` on an applied row is whatever `rules/verdict.js` returned from the evidence. `market-apply`
  never picks a number, and a row whose comparison was rejected is left exactly as it was.
- **Expect the `bad` count to rise.** 54 of the 84 `bad` rows on 20 Sep were bad because a
  competitor genuinely is cheaper; more comparators finds more of those. That is the filter working,
  not failing. The page gets more trustworthy before it gets bigger.
- Own-label stock (IKEA, Home Centre, Home Box, Pan Home, CityW, Baytonia, most Trendyol) has no
  second seller anywhere. Those rows stay `na` permanently. That is the correct answer, not a gap.

## 4. Build & publish (≈ 5 calls)
```
node build.js      # dist/index.html — note the "rows/available" counts it prints
```
- Upload `dist/index.html` to the site repo: navigate `https://github.com/saydasateam/sayda-deals/upload/main` → `find` the "Choose your files" input → `file_upload` with `<repo>/dist/index.html` → wait 7 s → set the commit message with the native setter and click the submit button, both in one `javascript_tool` call:
  `const i=document.querySelector('input[name="message"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Update <YYYY-MM-DD HH:MM> Riyadh');i.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('button')].find(b=>/^Commit changes$/.test(b.innerText.trim())&&b.type==='submit').click();`
  → wait 10 s → `location.href` must be the repo root. Verify on `/commits/main` that the newest commit is yours.
- Same for the data files into this repo. **State is sharded per store** — `data/state/<id>.json` and `data/state/<id>.history.json`, in ONE directory —
  so that overlapping slots cannot revert each other. Upload **only the shards this slot touched**, which `work/report.json → wrote`
  names explicitly, plus the matching history shards, **all in one commit**: select them in one `file_upload` call to
  `https://github.com/saydasateam/sayda-pipeline/upload/main/data/state`. `work/report.json → upload` lists the exact paths — it is the union of every `apply.js` call in this run (also kept in `work/upload.json`), so the check phase's shards are still listed after `apply.js new`.
  Everything a slot writes lives in `data/state/` precisely so this is possible: GitHub's upload form commits to one directory,
  so files in two folders would need two commits.
  - **Never upload a shard for a store this slot did not check.** That is the single-file clobber coming back through the
    upload step: you would be writing a copy of another slot's file taken from a clone made before that slot committed.
  - `data/state/<id>.history.json` is the own-price-history store that `apply.js check` appends to every run. A slot that uploads its
    state shard but not its history shard throws its own observations away.
  - A FULL run that also edited coupons, travel or notes uploads `data/state/_*.json` in the same commit.
  - Wait until the form's «Uploading n of m files» line is gone before clicking Commit. On 22 Sep a click during the upload
    produced an error page and no commit; the retry in a fresh tab worked.
  - **During the migration `data/state.json` is still live — do not delete it.** The legacy file and the
    shards coexist, and a shard wins for its own store, so each store moves across the first time its
    slot runs. Nothing is missing at any point in between. `node scripts/unshard.js --check` says which
    stores are still being served from the legacy file; only when it reports none may `data/state.json`
    and `data/history.json` be deleted.
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

## Rollback — how to undo the sharding change

GitHub already keeps the old version: commit `6d7527b` ("Update 2026-09-20 09:22 Riyadh") is the
last single-file state and stays in `main`'s history forever, as long as nobody force-pushes. So
the code is never actually lost. What a plain revert DOES lose is the data, and that is the part
this procedure exists for.

`git revert` restores `data/state.json` as it was on the day of the change. Every row collected
after that day would silently vanish. A rollback that loses four days of work is not a rollback, so
the data comes back first and the code second.

**In order. Do not reorder 1 and 3.**

1. `node scripts/unshard.js` — rebuilds `data/state.json` and `data/history.json` from the LIVE
   shards, so the restored files carry everything up to this minute, not up to 20 Sep. It also puts
   the campaign facts back inside `meta`, where the old `build.js` expects them. (If the migration is
   still part-way through, this is still correct: `load()` already merges the legacy file with
   whatever shards exist, so the rebuilt file carries both.)
2. Upload both files to `data/` on GitHub in one commit — the pre-change upload step.
3. Revert the code: on the merged pull request, click **Revert**. GitHub opens a branch that undoes
   the whole change; merge it. (If the change was pushed straight to `main` instead of through a PR,
   use **History → the commit → Revert**.)
4. `node build.js && node scripts/replay.js` — the page must build and replay clean before anyone
   trusts it. Compare the row count against the last good run.
5. Only once step 4 passes, delete `data/state/`.

Step 1 before step 3 is not a style preference: after the revert, `scripts/unshard.js` no longer
exists, because it is part of the change being reverted.

**Verified 20 Sep:** shards → `unshard.js` → build through the legacy single-file path produces a
page with the same 253 rows as the pre-change build. The round trip is tested, not assumed.

## Safety
Never buy, add to cart, sign in, accept cookie banners, or submit any form other than the two GitHub commits. Never read or use tokens. Never curl store sites from the sandbox — adapters run in the browser only.
