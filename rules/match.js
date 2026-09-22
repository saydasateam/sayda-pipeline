// match.js — the same-model filter. The ONLY place that decides whether a listing found in another
// store may be used as a price reference. Pure functions, node + browser safe.
//
// WHY THIS IS A FILE AND NOT A JUDGEMENT CALL
// On 2026-09-19 a sweep of 62 branded Trendyol candidates was matched by "cheapest listing whose
// title looks right". It returned a screen protector as the market price of a 675-riyal Huawei
// watch, a nylon strap for a Xiaomi band, a charging cable for an Amazfit, a replacement headband
// for JBL earphones, and a Koolen air fryer as the reference for a Black&Decker one. Published as
// written, the page would have claimed a 96% overprice on a correctly priced item. Every one of
// those passes an eyeball test and fails a written one, which is why the filter lives here.
//
// The four conditions are the RUNBOOK's, unchanged. Two more were added on 2026-09-20 when the
// comparator source widened from hand-probing to a shopping index: country and condition. A
// reference that silently mixes a Cairo price into a Saudi comparison is worse than no reference.

// 1. accessory guard — a thing that goes WITH the product is never the product
const ACCESSORY = /\b(strap|band for|bands|case|cover|protector|screen|cable|cord|charger for|replacement|compatible|suitable for|holder|stand|pouch|sleeve|film|glass|skin|mount|adapter for|lens cap|remote for)\b|جراب|حافظة|واقي|حزام|كابل|بديل|متوافق|حامل|غطاء|لاصق|شاحن لـ/i;

// 5. condition — a used or refurbished unit is a different product at a different price
const USED = /\b(used|pre-?owned|refurb\w*|renewed|open box|second hand|for parts)\b|مستعمل|مجدد|مستخدم|إعادة تصنيع/i;

// 6. country — KSA merchants only. A price from Egypt, Tunisia or a US furniture store is not a
//    Saudi comparison, whatever currency the index chose to display it in.
const NON_KSA = /\b(egypt|eg\b|uae|dubai|emirates|kuwait|qatar|bahrain|oman|tunisia|jordan|lebanon|iraq|turkey|usa|united states|uk\b|india|china)\b|مصر|الإمارات|دبي|الكويت|قطر|البحرين|عُمان|تونس|الأردن|لبنان|العراق|تركيا|أمريكا/i;

const norm = s => String(s || '')
  .toLowerCase()
  .replace(/[ـً-ْ]/g, '')      // Arabic tatweel + diacritics
  .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

/** A model token is anything with a digit, or a 3+ char alphanumeric code. "band 10", "ecam12.121",
 *  "qn80f", "dlc36362" are model tokens; "smart", "tv", "بوصة" are not. */
const isModelToken = t => /\d/.test(t) && t.length >= 2;

/** Whole-word presence, with the run-together variant: "dlc 36362" matches "dlc36362" and back.
 *  Deliberately NOT a substring test. An earlier draft fell back to `hay.includes(token)`, which
 *  accepts "QN80FX" as "QN80F" and "Band 100" as "Band 10" — the same near-miss class that put a
 *  Band 9 strap on a Band 10 row. The fused form is only consulted for a MULTI-part token, where
 *  the separator is the thing that differs, and it must still land on a token boundary. */
function hasToken(hayTokens, hay, token) {
  if (hayTokens.includes(token)) return true;
  if (!/\s/.test(token)) return false;                       // single token: whole word or nothing
  const fused = token.replace(/\s+/g, '');
  return hayTokens.includes(fused);                          // "dlc 36362" ↔ "dlc36362", boundary kept
}

/**
 * Decide whether `listing` may serve as the market reference for `row`.
 *
 * row     { name, price, brand?, model? }   — brand/model optional; derived from name when absent
 * listing { title, price, merchant, country?, condition?, url }
 * opts    { minRatio = 0.35, maxRatio = 3 }
 *
 * returns { ok: boolean, reason: string }   — reason is always populated, for the audit trail
 */
function sameModel(row, listing, opts = {}) {
  const { minRatio = 0.35, maxRatio = 3 } = opts;
  const title = String(listing.title || '');
  const hay = norm(title);
  const hayTokens = hay.split(' ').filter(Boolean);

  // — condition and country first: cheapest checks, and the ones whose failure is most misleading —
  if (USED.test(title) || USED.test(listing.condition || '')) return { ok: false, reason: 'used/refurbished' };
  const where = `${listing.country || ''} ${listing.merchant || ''}`;
  if (listing.country && !/^(sa|ksa|saudi)/i.test(String(listing.country).trim())) return { ok: false, reason: `merchant outside KSA (${listing.country})` };
  if (!listing.country && NON_KSA.test(where)) return { ok: false, reason: `merchant looks non-KSA (${listing.merchant})` };

  // — 1. accessory guard —
  if (ACCESSORY.test(title)) return { ok: false, reason: 'accessory, not the product' };

  // — 2. brand as a whole word (both words when the brand is two words) —
  const brand = norm(row.brand || '');
  if (!brand) return { ok: false, reason: 'no brand on the row — cannot match' };
  for (const bw of brand.split(' ').filter(Boolean)) {
    if (!hayTokens.includes(bw)) return { ok: false, reason: `brand word "${bw}" not present as a whole word` };
  }

  // — 3. model as a whole word, or run together. No model token at all → reject outright. —
  // Two accepted spellings, because stores disagree on the separator and only on the separator:
  //   A. every digit-bearing part present as its own whole word  ("ecam12 121" in "… ECAM12.121.B")
  //   B. the whole model fused into one token                    ("dlc 36362"  in "… DLC36362 …")
  // Nothing else. A substring test would accept QN80FX for QN80F; a brand-only match would accept
  // any Samsung TV as any other, which is how a 55-inch became the reference for a 100-inch.
  const modelParts = norm(row.model || '').split(' ').filter(Boolean);
  // A multi-part model ("fit 4", "ecam12 121", "dlc 36362") requires EVERY part, letters included:
  // the series word is what keeps "fit 4" off a "Band 4", and the number is what keeps it off a
  // "Fit 3". A single-part model must itself be a code — a bare word would be a brand-only match.
  const required = modelParts.length > 1 ? modelParts : modelParts.filter(isModelToken);
  if (!required.length) return { ok: false, reason: 'row carries no model token — brand-only matches are rejected' };
  // A multi-part model may carry its number as a bare digit ("fit 4"), which isModelToken rejects
  // on its own; paired with the series word it is specific enough.
  if (modelParts.length > 1 && !modelParts.some(p => /\d/.test(p))) return { ok: false, reason: 'model has no numeric part — too weak to match on' };
  const allWholeWords = required.every(mt => hasToken(hayTokens, hay, mt));
  const fusedWhole = modelParts.length > 1 && hayTokens.includes(modelParts.join(''));
  if (!allWholeWords && !fusedWhole) {
    const missing = required.find(mt => !hasToken(hayTokens, hay, mt));
    return { ok: false, reason: `model part "${missing}" not present as a whole word, and "${modelParts.join('')}" not present fused` };
  }

  // — 3b. variant, when the row has one. "Pro", "Ultra", "Plus" and friends are not model numbers,
  //   but they separate two real products that share one. A row WITHOUT a variant must not match a
  //   listing that has one either, or the base model is priced against the upgraded one.
  //   "Mini LED" is a panel technology, not a variant — a qualifier followed by a technology word
  //   is skipped, or every Mini-LED listing reads as a different product from every other.
  const VARIANTS = ['pro', 'max', 'ultra', 'plus', 'lite', 'mini', 'air', 'edge', 'se', 'fe'];
  const TECH = ['led', 'lcd', 'oled', 'qled', 'uhd'];
  const listingVariants = hayTokens
    .map((t, i) => (VARIANTS.includes(t) && !TECH.includes(hayTokens[i + 1]) ? t : null))
    .filter(Boolean);
  const rowVariant = (row.variant || '').toLowerCase();
  if (rowVariant && !hayTokens.includes(rowVariant)) return { ok: false, reason: `row is "${rowVariant}", listing is not` };
  if (!rowVariant && listingVariants.length) return { ok: false, reason: `listing is "${listingVariants[0]}", row is the base model` };

  // — 3c. size, when the row states one. For a television the size IS the product: a 75" and an 85"
  //   share the model code and sit ~1.4× apart, which is comfortably inside the sanity band below.
  //   Nothing else in this filter separates them.
  if (row.size && !hayTokens.includes(String(row.size))) return { ok: false, reason: `row is ${row.size}", listing does not say so` };

  // — 4. sanity band —
  const p = Number(listing.price), rp = Number(row.price);
  if (!(p > 0 && rp > 0)) return { ok: false, reason: 'missing price' };
  const ratio = p / rp;
  if (ratio < minRatio || ratio > maxRatio) return { ok: false, reason: `price ${p} is ${ratio.toFixed(2)}× the row (outside ${minRatio}–${maxRatio})` };

  return { ok: true, reason: 'same model' };
}

/**
 * Reduce a set of listings to the evidence object rules/verdict.js expects.
 * Returns null when nothing survives — which is the correct answer, not a failure.
 *
 * { market: {store, price, url}, min, max, avg, merchantCount, sources[], rejected[] }
 */
function marketEvidence(row, listings, opts = {}) {
  const kept = [], rejected = [];
  for (const l of listings || []) {
    const v = sameModel(row, l, opts);
    (v.ok ? kept : rejected).push({ ...l, why: v.reason });
  }
  if (!kept.length) return { market: null, kept: [], rejected, merchantCount: 0 };
  const prices = kept.map(l => Number(l.price)).filter(n => n > 0).sort((a, b) => a - b);
  const cheapest = kept.reduce((a, b) => (Number(b.price) < Number(a.price) ? b : a));
  const merchants = new Set(kept.map(l => String(l.merchant || '').toLowerCase()).filter(Boolean));
  return {
    market: { store: cheapest.merchant, price: Math.round(Number(cheapest.price)), url: cheapest.url },
    min: prices[0],
    max: prices[prices.length - 1],
    avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
    merchantCount: merchants.size,
    sources: kept.map(l => ({ merchant: l.merchant, price: Math.round(Number(l.price)), url: l.url })),
    kept, rejected,
  };
}

module.exports = { sameModel, marketEvidence, norm, ACCESSORY, USED, NON_KSA };
