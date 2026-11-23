
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
**Adding a category is still:** one chip + its slugs in `categories.json`. Since 22 Nov 2026 (BLD-15) a chip may also carry
`tint` and `accent`, its colour pair: without them the category is drawn in neutral grey. No category may use a green.

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

**2a. Direction A (22 Nov 2026, BLD-15, Mahmoud's decision).** The accent is the logo blue (#2347E6, `config/campaign.json`),
the hero is an indigo-to-teal mesh gradient with a glass status pill, a glass countdown and gold on the highlighted phrase
(Mahmoud gave the colours on 23 Nov; styles in `template/index.html`), and each category has a tint and
an accent (`config/categories.json`). Green is still only `--ok`: verified, and lowest recorded. `build.js` writes four parts as
static HTML, in both languages by the same code, from the rows of that build:
- the **ticker strip** at the bottom of the hero, each deal in a glass pill: the first `rules.page.tickerItems` confirmed, available rows in the page's best-value
  order, with the last check time. CSS only; it stops under the pointer, on touch, on keyboard focus and under reduced motion;
- the **category cards**: one for every category with at least `rules.page.categoryCardMinRows` available rows, the three
  largest with the stores' own pictures of their top confirmed rows. The number is the highest discount we measured on a
  confirmed row; a category with none says so in words. No timers and no rotation;
- the **header inside a category**, shown when exactly one category is selected, and the **wallet** directly under it.
`valRow`, `tierRow` and `diversifyRows` in `build.js` mirror `VAL`, `TIER` and `diversify` in the two templates: change one,
change all three. The build stops when a template lacks one of these parts or a category colour reads below 4.5 to 1.

**3. Furniture wording follows the enabled stores.** The furniture note, the two methodology items
and the «أشلي مقابل ميداس» clause render only while those stores are enabled. A category chip with
no rows is not rendered. Travel and cars pointers and sections render only when they have entries.

**3a. App subscription offers (23 Nov 2026, BLD-27).** `data/state/_subs.json` → `{ subs: [...] }`, read by `lib/state.js`. While it
holds an offer, `build.js` writes a fourth hero panel («اشتراكات التطبيقات» / “App subscriptions”) and a section below cars on both
pages, with the travel card: the app, the offer as advertised, what the terms say, the end date, the day we read it, and a
wallet tag when `wallet` names an id from `config/wallet.json`. No price is measured here, so the card carries no percentage of
ours. An offer with a bad link, or with no app name, headline, terms, check date or end date, is held back and named; one
without `headline_en` and `terms_en` is left off the English page, and the `english:` line counts `subscriptions n of n`.
`config/stores.json` carries `carSources` and `subscriptionSources`. The rules a run follows are RUNBOOK §3a and §3c.

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

**4. A publish is two writes (21 Nov 2026):** the site, then the state. A scheduled run on the Sayda server
has no GitHub repositories attached, so it writes `index.html` and `en/index.html` to the private site repo
through GitHub's upload form in the server's Chrome, as two commits; a run started from a chat may instead
push both in one commit. The state shards always go to this repo in one upload-form commit. Check the live
pages in a browser, not with WebFetch, which keeps old copies of the site. See RUNBOOK §4.

---

## v2.4 — outside text is escaped, links are https only (2026-11-22, security audit SEC-F1 to F4)

**1. One file decides how outside text reaches the page: `lib/safe.js`.** `jsonForScript` for every value written into the
page's script (no value can close the script block or be filled in as a `{{NAME}}` placeholder), `escHtml` and `boldOnly` for
static HTML, `cleanHttps` for links.

**2. Both templates escape everything they draw.** The Arabic page now passes product names, findings, stock notes, links and
every travel, car and coupon field through `esc()`, as the English page did; both escape the single quote and the values used
inside `class`.

**3. A link is a clean https address or it is not published.** Checked when a row is added or its link corrected
(`apply.js`, `scripts/market-apply.js`) and again in `build.js`, which holds back a row or an offer whose link fails and
names it. `build.js` also stops if a page holds more than its one script block.

**4. `scripts/test-escape.js`** builds both pages from hostile rows in a temp folder and runs each page's script against a
stand-in document. It fails if any tag, attribute, handler or link on the page was made from outside text.
