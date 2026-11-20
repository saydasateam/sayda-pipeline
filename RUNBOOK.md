# RUNBOOK — one scheduled run (interim mode: Claude session + your Chrome)

Read this top to bottom, then execute. Target: ≤ 60 min, ≤ 110 tool calls. Never improvise a parser — every store has an adapter.

## Current campaign — White Friday 2026 (set 19 Nov 2026)

`config/campaign.json` is the only place the campaign lives: name, dates, colour theme, archive links.
The page wording and colours follow it; nothing in `template/index.html` names a campaign any more.

- **Window:** 19–30 November 2026 (the Friday is 27 Nov). After `campaignEnd`, say the sale is over
  and do not refresh.
- **Stores: 15 enabled.** All eight furniture stores are `enabled: false` (Mahmoud, 19 Nov): ikea,
  homecentre, homebox, panhome, cityw, baytonia, ashley, midas. Skip every instruction below that
  names them — the rendered per-row check for the landmark stores, the CSP bundle for ikea and midas,
  the ashley ↔ midas comparison, `notes.furnitureShare`. **jarir is now the only CSP-blocked store.**
  firstcry is the only per-row render store left.
- **The state started empty.** `scripts/new-campaign.js national-day-96` moved the 410 National Day
  rows to `data/archive/national-day-96/`. Every row on this page is collected and judged inside this
  campaign; never copy a row or its `ev` back from the archive.
  (Landed through GitHub's upload form, which cannot move or delete: the old `data/state.json`,
  `data/history.json` and the eight furniture `*.history.json` files are still at their old paths as
  well as in the archive. They supply nothing, because every store has a shard. Delete them when there
  is push access.)
- **Campaign pages, read from each store's own home page on 20 Nov 2026** (`_landing` beside each
  in `config/stores.json`): noon `yellow-friday-sale-offers/`, almanea `mega-sale-c-7665`, mumzworld
  `collections/mumznovember-mega-deals` (plus three more collections its home page links). **extra,
  blackbox and saco link no White Friday page yet**: they are collected from their standing offer
  listings (extra `hot-deals/cp/8016`, saco `limitedtimeoffer-c-134736`, blackbox's offer and category
  paths). Blackbox's National Day category still answers 200 under its old title and is NOT collected.
  At the start of each run, look at those three home pages once; when a campaign page appears, say so
  in the summary so the config can be updated. Never guess a URL.
- `travelSources` now lists each airline's and platform's standing offers or home page, not National
  Day pages. An offer is published only when the company's own page names it for this campaign.
- **Two languages, every publish (Mahmoud, 20 Nov 2026).** The English page at `/en/` is as much a
  part of a refresh as the Arabic one: `build.js` writes `dist/index.html` AND `dist/en/index.html`,
  and a publish uploads both. A run that publishes Arabic alone has not published. See §2d and §4.
- **The page is a product grid with pictures** (20 Nov 2026), not a table. Every published row should
  carry `img` (§2c) and `name_en` (§2d).
- `build.js` refuses to build while there are 0 rows and no store has been checked. That is the
  guard against publishing an empty table under the campaign headline.

### New campaign (how this one was started, and how the next one is)
1. Edit `config/campaign.json` (id, names, dates, theme, archive links) and `config/stores.json`
   (`enabled`, landings, campaign collect paths).
2. `node scripts/new-campaign.js <archive-id>` — dry run; add `--apply` to do it. It archives the
   row shards and shared files, writes empty shards, and keeps the price-history shards of enabled stores.
3. First run as below, then `node build.js && node scripts/replay.js`.

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

## 0b. Tab hygiene — the run's memory budget (added 28 Sep 2026, and it is not optional)

Chrome, not the row count, is what has killed runs. Measured: Chromium is 0.7–1.1 GB before any page
opens, and each heavy SPA page (Trendyol, Home Centre, Amazon, Noon) adds 150–400 MB — so the budget is
**two or three store pages open at once**. The 28 Sep 23:07 run held 12 tabs for about 40 minutes and
peaked over 4 GB: Extra finished at minute 8 and its tab was still open at minute 45. Every "tab went
unresponsive" and "Browser extension is not connected" failure in the 23–28 Sep runs is consistent with
this and with nothing else.

- **What a card says (20 Nov 2026, after the page review).** Beside the price: the saving against the
  VERIFIED reference, in riyals and percent («توفّر ٢٣٠ ر.س · ٢٣٪»; «أرخص بـ …» for a cross-store row).
  Under it: the reference named for what it is («السعر السابق المسجّل …» or «نفس الموديل لدى <متجر> بـ …»).
  The store's own «قبل» is never struck through beside our price; its claimed percentage appears as one
  small attributed line («المتجر يعلن خصم ٤٩٪») only where it differs from what we measured, and the
  full claim sits in «دليل السعر» under «ما أعلنه المتجر». On a phone a card is one full-width row with a
  small picture; from 600px up it is a grid. The first screen is counts, stamp, search and the first
  product: do not add a paragraph or a pointer card above the products. All of this is `template/` and
  `build.js`; a run changes none of it. To name the other store on a cross-store card, write the row's
  `refUrl` (already required) as that store's own product URL.
- **Price bar, lowest-price filter, share link (20 Nov 2026, second review).** A history-referenced row with
  `ev.min` and a `ref` above the live price gets a bar: lowest recorded price at the start, the previous
  recorded price at the end, today's price as the dot (green = saved, amber = above the lowest). It is
  drawn from `ev` alone, which is one more reason `ev` is stored with every row. «عند أقل سعر مسجّل» counts
  rows whose live price is at or under `ev.min` (1% tolerance). Each card has a share button; its link is
  the page with `?d=<row id>`, so a row's `id` must stay stable across runs. Category pills sit above the
  products and the filter bar sticks to the top while folded. Not on the page, on purpose: a countdown,
  per-product coupon pills, bank-card or membership matching, and any count of «rejected» or «fake»
  discounts. None of them has data behind it that a run verifies.
- **Close a tab the moment its result is harvested** — `tabs_close_mcp` straight after the
  `get_page_text` that reads its JSON. Never keep a finished store's tab open "in case".
- **Reuse a pool of at most 3–4 tabs.** Navigate a free tab to the next store instead of opening a new
  one. `window.SAYDA` dies on navigation and core + adapter are re-injected per store anyway, so reuse
  costs nothing and keeps peak memory independent of how many stores the run covers.
- **Never hold more than 4 store tabs open at once**, per-row render tabs included.
- **Between render rows, navigate the tab to `about:blank`** before the next product URL, so the previous
  page is torn down first. This matters most for firstcry (20 rows) and the landmark stores.
- Budget the tabs before opening any: 3–4 in flight, not one per store. 23 stores do not need 23 tabs.
- If Chrome drops mid-run, treat memory pressure as the first suspect: close every tab you are not
  using before the ~75 s retry, then re-inject.

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

## 2b. Re-check new rows BEFORE publishing (added 22 Sep — required)
`apply.js new` marks every row it adds `needsCheck`, and `build.js` does not publish a `needsCheck` row. Discovery sees
availability through a listing or a price tracker, and neither is the store saying «in stock»: on 22 Sep an Extra
tablet went up as «متاح» at 99 SAR on the tracker's inventory flag while Extra had it out of stock.
For each store that got new rows (`work/report.json → added`):
```
node scripts/inject.js <store> recheck      # self-contained: only this run's new rows, works on CSP stores too
```
run it in that store's tab, `SAYDA.show('check:<store>')` + `get_page_text`, save to `work/check/<store>.json`, then
`node apply.js check`. The first check clears `needsCheck` (listed in `report.firstChecked`); the row is then published with
the availability the STORE reported. A row still `needsCheck` at publish time stays off the page — `build.js` prints how many.
Kanbkam's `inStock` is evidence for the price record only, never for `avail`.

## 1b. Stores added 22 Sep 2026 (breadth: fashion, kids, pharmacy)
Five stores joined so the page is not only electronics and furniture. All five boot and check exactly like
the others (`node scripts/inject.js <id> boot check`, tab on `store.home`); tested live on 22 Sep.
| id | adapter | how it reads | check |
|---|---|---|---|
| **namshi** (re-enabled) | namshi.js | fetch, server-rendered product boxes; open the tab on `/saudi-ar/` (the old `/saudi-ar/women/` landing client-redirects and killed the script — that is why it was parked) | product page |
| **mumzworld** | mumzworld.js | fetch; the listing HTML carries the Magento product objects (price_range, stock_status). Only 24 per listing are server-rendered, so it reads eight National Day collection paths | product JSON-LD |
| **mothercare** | mothercare.js | **rendered**: open `store.landing`, then `SAYDA.start('collect:mothercare', () => SAYDA.adapters.mothercare.collectRender(SAYDA.ctx.store, SAYDA.ctx.rules))` — it clicks the page's own «load more»/scrolls until ~300 cards | product JSON-LD (plain fetch) |
| **nahdi** | nahdi.js | fetch; page 1 (20 hits) of each deal listing is server-rendered — breadth = more deal paths | product page JSON |
| **aldawaa** | aldawaa.js | the storefront's own public OCC API (base read from the page's `<meta name="occ-backend-base-url">`); `price.value` = their «before», `simulatedDiscountPrice.value` = now | OCC product |
**Toys R Us has no adapter and is `enabled: false`.** On 22 Sep www.toysrus.com.sa and toysrus.sa did not resolve,
the Dynamics storefront returned 0 products for every search, and Noon's store page was 404. Re-check before
each campaign; do not substitute a reseller's listing under Toys R Us's name.

**Verification for the new stores** is the same written rule as everywhere else:
- Branded items (Dyson, Philips Avent, Joie, Chicco, Avene, La Roche-Posay, CeraVe, Aptamil…) → `SAYDA.kanbkam.market(['brand model'])`
  through `rules/match.js` (all four conditions; for beauty the size — «40 مل» — is part of the model). Nahdi ↔ Al-Dawaa is itself a
  same-product comparison when brand, name and size match.
- Everything else → `na` with the store's `naFinding`, and our own history re-judges it after `ownHistoryMinDays`.
- **`intake.fillTo` stores (mumzworld, mothercare — Mahmoud's decision, 22 Sep): show the top 20 every run.** After the verified
  rows for that store are applied, save its collect output to `work/collect/<id>.json` and run
  `node scripts/fill-na.js <id> work/collect/<id>.json && node apply.js new work/fill-<id>.json`. It tops the store up to 20
  *available* rows with `na` rows (ref null, the store's naFinding — they claim nothing and stay out of the default «verified»
  filter). It never invents a reference; only `verdict()` does.

**Intake reservation.** `apply.js new` now fills `rules.page.reservedPerChip` first (fashion, personal care, kids 15 each;
perfume, sports, toys 8), best verified saving within each chip, then ranks the rest together as before. Shortlist for
those chips on purpose — a run that collects only TVs cannot use the reservation.
**Furniture cap.** `rules.page.maxPerChip` (أثاث: 25) is applied by `build.js` at render time: verified and available rows are
shown first, na/unavailable are hidden first. Nothing is deleted from state.

## 1c. Stores added 22 Sep 2026 (toys: Mahmoud's replacement for Toys R Us)
Both are `intake.fillTo: 20` and map to the «ألعاب» chip.
| id | adapter | how it reads | check |
|---|---|---|---|
| **dabdoob** | dabdoob.js | fetch; `/ar-SA/product?category_id=<id>&page=<n>` is server-rendered — 20 products a page, each carrying the store's own `{id, slug, name, brand, skus[{price:{price, old_price}, buy_limit}]}`. Category ids are the number at the end of the slugs on `/ar-SA/categories`. | product page, same objects. **`buy_limit` is the availability signal** (0 = not buyable) and doubles as the stock count |
| **firstcry** | firstcry.js | **rendered**, and unlike mothercare it cannot be injected from raw: see below | **rendered per row** — navigate, then read `#prod_price` |

**FirstCry has two traps. Read this before touching it.**
1. Its server HTML DOES contain `.prod-price` / `.prod-price-strike` nodes — they hold campaign
   thresholds (1603 / 229 on every product page), not the product's price. A fetch parser reads those
   and is confidently wrong. Prices exist only after the page renders.
2. A listing bounces back to the home page roughly ten seconds after load, and its «load more» is a
   link that navigates. So the collector only scrolls, and the driver cannot spend that window fetching
   `_core.js` + the adapter from raw.githubusercontent — by the time they land the listing is gone.
   On 22 Sep the working sequence was: navigate → wait 5 s → ONE call that reads `.list_block` cards
   straight from the DOM (`.r1` now, `.r2` was, name from `img[alt]`, key = the hex id segment in the
   product URL). Breadth comes from the configured paths, 20 cards each.
Product pages are stable for longer, so the per-row check is fine: navigate, then poll for `#prod_price`
(it IS the price element, not a container — `#prod_price .prod-price` matches nothing), read
`.original_mrp_main` for the was and treat `.sizeaddtocart` as buyable. Batch 4 rows per `browser_batch`.

**Dabdoob's long product objects** (the big outdoor sets) are split across several `self.__next_f`
flight chunks, so bracket-matching one of them fails and the row comes back `found:false` on a 200.
`check()` drops the chunk seams and reads the fields after the slug instead. If that ever regresses,
the symptom is exactly that: a 200 with no product.

**Toys R Us stays `enabled: false`** — still no storefront. Dabdoob and FirstCry are the replacement
Mahmoud chose on 22 Sep, not a rename of that slot.

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

## 2c. Pictures (added 20 Nov 2026 — every published row should have one)
The page shows products as cards, and a card without a picture shows a blank tile. After §2b, for each
store that has rows with no `img` (new rows always, older rows once):
```js
// in that store's tab, after core + boot (jarir: paste core, then pass the rows inline)
SAYDA.start('img:<id>', () => SAYDA.images(SAYDA.ctx.rows.filter(r => !r.img)));
```
`SAYDA.show('img:<id>')` + `get_page_text` → save the JSON to `work/img/<id>.json` →
`node scripts/apply-images.js work/img/<id>.json`. It writes only the shards that gained a picture, adds
them to `work/upload.json` so they ride in the state commit, and leaves `checkedAt` alone.
- The picture is the STORE'S OWN image for that product, read from its product page. Never take one from
  a search engine, a price tracker or another store. `img: null` is a correct result; the card keeps the tile.
- Works by plain fetch for amazon, extra and most stores (`og:image`); noon is read from its catalog API
  inside `SAYDA.images`. A store whose product page only renders in the browser (firstcry) needs the
  picture read from the rendered page during its per-row check: `document.querySelector('meta[property="og:image"]').content`.
- Budget: one call per store. If the run is short on time, pictures come after coverage and before coupons.

## 2d. English names (added 20 Nov 2026 — required, the English page is half of every publish)
Every row needs `name_en`: **the store's own English product title**, read from the English version of
its product page. It is never translated, by you or by anything else: all these stores publish an
English catalogue, and a name we wrote could describe a different variant from the one we priced.
For each store that has rows with no `name_en` (new rows always), in that store's tab after core + boot:
```js
SAYDA.start('en:<id>', () => SAYDA.names(SAYDA.ctx.rows.filter(r => !r.name_en), SAYDA.ctx.store));
```
`SAYDA.show('en:<id>')` + `get_page_text` → `work/en/<id>.json` → `node scripts/apply-names.js work/en/<id>.json`.
- `store.en` in `config/stores.json` says how to reach the English page: `{api:"noon"}` or
  `{try:[[from,to],…]}` URL rewrites. noon, amazon and extra are verified (50 of 50 on 20 Nov). The
  other twelve are candidate rules marked `_en`: the reader only accepts a Latin-script title from a
  200 page, so a wrong rule returns `null`, never a wrong name. When a store returns all `null`, open
  one product, use the site's own language switch, note the English URL form, and report it in the
  summary and a PushNotification so the config is corrected. Do not edit config yourself.
- A row with no `name_en` still publishes; the English page shows its Arabic name. `build.js` prints
  how many and for which stores. Name those stores in the summary every run until it is zero.
- **Everything else you write in Arabic, you also write in English, in the same step:**
  - `finding_en` on a row is REQUIRED whenever its Arabic `finding` states a condition (a code or
    coupon, Trendyol Plus, a basket threshold, a price that only appears at checkout). `build.js`
    exits 1 if such a row has none, because the English page would drop the condition. For all other
    rows leave `finding_en` out: the English finding is generated from the same stored numbers.
  - every coupon: `label_en`, `text_en` · every travel or car offer: `company_en` (if the name
    differs), `type_en`, `headline_en`, `terms_en`. An entry without them is left off the English page
    and counted in the build's `english:` line. That count must be `n of n`.
  - codes, prices and percentages are copied, never re-typed from memory.

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

## 3a. FULL run only — car offers (same slot and rules as travel, ~4 calls)
`data/state/_cars.json` → `{ cars: [...], carsNone: [...] }`, one writer: the slot that edits coupons and travel.
The page shows a 🚗 pointer at the top and the cards below travel (template `#cars`).
- For each `cars[].url` (agent or bank/leasing company's OWN page): `get_page_text`, update headline/terms/dates/verdict/checked.
  Verdicts as for travel: `clear` terms match the headline · `catch` headline bigger than terms (finance-only, «حتى», selected
  trims, until stock lasts) · `vague` no concrete terms · `pending` announced, not started. Drop a row whose `bookEnd` is more
  than 3 days ago.
- A news site, ad portal (saudiauto, syarah, motory) or a dealer's social post is a LEAD, never a source. An offer that is not
  on the company's own page is not published. A September finance campaign that is not branded National Day is not an ND offer.
- `carsNone` lists companies checked with no ND offer found; move one to `cars` when its own page publishes an offer.
- Leads worth re-checking in the browser (22 Sep): Kia Aljabr's ND page (no year on it), Al Rajhi's ND auto-lease page
  (blocked to non-browser fetches), Riyad Bank, Alinma, SAIB, Nayifat, Emkan (not yet checked).
- Upload `data/state/_cars.json` in the same state commit as the other `_*.json` files.

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
- **Three commits, not two (20 Nov 2026):** Arabic page, English page, state. Upload `dist/en/index.html` to
  `https://github.com/saydasateam/sayda-deals/upload/main/en` the same way as the Arabic page, straight after it, with the
  same commit message plus « (English)». Verify both `https://saydadeals.com/` and `https://saydadeals.com/en/` carry the
  new update stamp.
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
- These three commits (Arabic page, English page, state) are the ONLY forms this run may submit. Never touch README.md via upload (GitHub refuses the overwrite).
- Do not update the claude.ai artifact.

## 5. Report
Final message in Arabic, concise: top 7 verified deals available now (store, price, real vs claimed), new rows, newly
unavailable / restocked / price changes (from work/report.json), coupon and travel changes, stores skipped and why, and
the build's `english:` line (store names n of n, coupons n of n), and confirmation of all three commits.

**Prove the run did something before calling it done.** Read `https://github.com/saydasateam/sayda-deals/commits/main` and
confirm the newest commit is this run's. Then:
- newest commit is this run's → clean run, stay silent.
- **no commit from this run, for any reason** → PushNotification. This is not optional and it outranks «stay silent»: a run
  that publishes nothing and says nothing is indistinguishable from a healthy one in the schedule's own record, which reports
  SUCCEEDED either way. On 2026-09-19 all four runs ended in ~4 minutes having committed nothing; only the user noticing the
  stale page revealed it. State what stopped it (no browser, adapter failures, budget) and how far the run got.
PushNotification also when: a store failed, a commit failed, or ≥ 5 deals ended at once.
If today is after `config/campaign.json → campaignEnd`: say the sale is over and suggest pausing the task.

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
