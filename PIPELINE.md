
---

## v2.1 — coverage & thresholds (2026-09-18)

Driven by reader feedback that the page showed too few real deals (188 rows, but only 48 verified-good
and in stock, and the page already opens filtered to those).

**1. The candidate filter was the bottleneck, not the verdict threshold.**
The old flat gate (`minSaving 75` + `minClaimedPct 25%`) silently discarded a 3,000 ر.س laptop at 20% off
(a 600 ر.س saving) and every sub-300 ر.س item that wasn't at least 25% off — i.e. almost all fashion,
beauty, baby and accessories. It is now **tiered by live price** (`config/rules.json → candidate.tiers`):
cheap items must show a big percentage, expensive items must return real money.

**2. The verdict is now two-track.** A deal is `ok` when the verified discount clears `okMin` (10%),
**or** when it clears `warnMin` (5%) and the money saved clears its price-band floor
(`verdict.okSavingTiers`). A flat percentage treated 6 ر.س off a 60 ر.س item and 500 ر.س off a 5,000 ر.س
TV as the same thing. Replaying this over the existing 188 rows: **48 → 72** verified-and-available.

**3. KanBkam's `?seller=` filter was removed upstream** and now returns zero rows for every category —
Amazon *and* Extra discovery were silently collecting nothing. `kanbkam.listing()` now fetches the
unfiltered category listing and filters client-side on the merchant key carried in each item's
`data-gtmid` (`amazon` / `extraStores` / `noon` / `xcite`). One fetch per category now serves all of them.

**4. Collection widened.** Noon +9 verified category paths (women's fashion, shoes, baby, diapering,
toys, sports, fitness, bedding); Amazon 51 KanBkam categories and Extra 30, both previously falling back
to a hardcoded electronics list; Trendyol +11 Arabic search terms. Every collector now applies a
**per-category quota** before the global cap — a plain top-N by absolute saving is all electronics and
starves the categories where a real deal is worth fewer riyals.

**5. Categories are assigned deterministically.** `config/categories.json` grew from a flat chip array to
`{ chips, map, fallback }`; `map` translates a collect-path slug to a chip id, and `apply.js new` applies it.
Unknown slugs land in `fallback` and are listed in `work/report.json → uncategorised`. Adding a category
is now one chip + its slugs, with no per-run judgement. (The array shape still loads, for older data.)

**6. We keep our own price history.** `data/state/<store>.history.json` records every observed price per row
(`[firstSeen, price, lastSeen]`, 60 points max). KanBkam only covers Noon/Amazon/Extra electronics, so
fashion and furniture had no reference and landed as `na` forever. After `verdict.ownHistoryMinDays`
distinct days, `apply.js check` re-judges `na` rows against what *we* measured — which also catches the
classic fashion trick of a "before" price the product has never actually been sold at.

**7. New stores.** Namshi (`adapters/namshi.js`, DOM-based — no `__NEXT_DATA__`, CSS-module class
prefixes matched with `[class*=]`). Styli has no reachable storefront of its own (`www.styli.com` →
`DNS_PROBE_FINISHED_NXDOMAIN`, checked 2026-09-18), so it is collected as a brand path under Namshi
(`women-clothing/styli`) rather than as a separate store. `run.js` now skips any store marked
`enabled: false` unless it is named explicitly with `--store`, so a half-finished adapter can be
committed without it breaking a scheduled run.

**Adding a store is still:** one entry in `stores.json` + one adapter file.
**Adding a category is still:** one chip + its slugs in `categories.json`.

---

## v2.2 — campaigns are config (2026-11-19, White Friday)

The pipeline was built during National Day and said so in eight places in the template, in the
artifact title and in the runbook's end date. White Friday is the second campaign, so the campaign
became data:

**1. `config/campaign.json` carries the campaign.** `id`, `campaign`, `campaignShort`,
`campaignStart`, `campaignEnd`, `searchPlaceholder`, `theme` (light and dark) and `archive` links.
`build.js` fills the template from it; with an old two-field file it builds the National Day page
exactly as before.

**2. The theme is the campaign's, the verified green is not.** `--green` did two jobs: brand colour
and the «✓ خصم مؤكّد» colour. They are now `--accent` (from the theme) and `--ok` (fixed). White
Friday is ink on white, so the only colour on the page is the verdict.

**3. Furniture wording follows the enabled stores.** The furniture note, the two methodology items
and the «أشلي مقابل ميداس» clause render only while those stores are enabled. A category chip with
no rows is not rendered. Travel and cars pointers and sections render only when they have entries.

**4. `scripts/new-campaign.js`** archives the previous campaign's rows to `data/archive/<id>/` and
starts the state empty, keeping each enabled store's price-history shard. `build.js` refuses to
build an empty page.

**Starting a campaign is now:** edit two config files, run one script, run the pipeline.

---

## v2.3 — a shop page in two languages (2026-11-20)

**1. Product cards.** The table became a grid of cards: picture, store, name, price now, the store's
struck-through «قبل», the verified reference, verdict, finding, and a button to the store. The badge
on the picture is our measured discount, never the store's claim. Evidence opens in a dialog.

**2. Pictures.** Rows carry `img`: the store's own picture, read in the browser by `SAYDA.images`
(`og:image`; Amazon `hiRes`; Noon's catalog image key) and written by `scripts/apply-images.js`.
Hotlinked with no referrer; a failed picture falls back to a neutral tile.

**3. English is half of every build.** `build.js` writes `dist/en/index.html` from `template/en.html`
on every build and fails if it cannot. Product names are the stores' own English titles (`name_en`,
`SAYDA.names`, `scripts/apply-names.js`, `store.en` rules in `config/stores.json`); nothing is
translated. English findings are generated at build time from the same stored numbers as the Arabic
ones; `finding_en` overrides and is required when the Arabic finding states a condition. Coupons,
travel and cars need `*_en` fields. Stores, categories and the campaign carry `label_en` / `campaign_en`.
`template/en.html` shares the Arabic page's CSS (lifted from the built page) and has its own small
script; when the Arabic page gains a section, add it there too.

**4. A publish is two writes (20 Nov 2026):** one `git push` to the private site repo carrying `index.html`
and `en/index.html` in a single commit, then one upload-form commit of the state shards to this repo. See RUNBOOK §4.

