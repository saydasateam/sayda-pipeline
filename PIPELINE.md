
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
