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

// 6b. cross-border marketplaces — the country regex is a net with holes. On 22 Sep a toys sweep
//     returned eBay, desertcart.com.sa, Jomla.ae and Smallable as comparators for a Saudi row.
//     None of them is a store the reader can buy from at that price here, and eBay's was a US
//     dollar price converted for display. These are named and rejected.
//
//     Deliberately a DENY list, not an allow list: the first draft here was an allow list of Saudi
//     retailers, and it rejected Al Rugaib Furniture — a real Riyadh store and a correct Ashley
//     comparator that the test suite already covers. An allow list silently drops every legitimate
//     merchant nobody thought to write down, and a dropped comparator looks exactly like no
//     comparator, so the loss never shows up as an error.
const BLOCKED_MERCHANT = /\b(ebay|aliexpress|alibaba|desertcart|jomla|smallable|etsy|walmart|temu|wish|shein|amazon\.(com|co\.uk|de|ae|eg)|banggood|joom|ubuy|mcgrocer|toybox\.ae|playanddream|finnegan)\b/i;

const norm = s => String(s || '')
  .toLowerCase()
  .replace(/[ـً-ْ]/g, '')      // Arabic tatweel + diacritics
  .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

/** A model token is anything with a digit, or a 3+ char alphanumeric code. "band 10", "ecam12.121",
 *  "qn80f", "dlc36362" are model tokens; "smart", "tv", "بوصة" are not. */
/** Words that carry no identity in a product name: colours, packaging, ages and filler. They are
 *  dropped before the name comparison so that a colour word alone cannot reject a true match — the
 *  identity has to come from the product words that remain. */
const NAME_STOP = new Set(['the','and','for','with','of','in','a','an','to','kids','kid','children','child','toy','toys','baby','babies','years','year','age','ages','months','month','old','set','pcs','pieces','piece','multicolor','multicolour','assorted','colour','color','red','blue','green','pink','white','black','grey','gray','yellow','purple','orange','brown','new','free','packaging','edition','ver','version','sar','size','large','small','medium','boys','girls','learning','educational','interactive','plush','wooden','wood']);

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
  if (BLOCKED_MERCHANT.test(String(listing.merchant || ''))) return { ok: false, reason: `cross-border marketplace (${listing.merchant})` };

  // — 0. the row's own store is not a comparator —
  //   The shopping index lists the row's own store too, so the first toys sweep proposed
  //   "same price as Dabdoob" for four Dabdoob rows and "same price as FirstCry" for two FirstCry
  //   ones. A row cannot be evidence about itself, and a reader who clicked «دليل السعر» would have
  //   landed back on the page they came from.
  const rowStore = norm(row.store || '');
  if (rowStore) {
    const mnorm = norm(listing.merchant || '').replace(/\s+/g, '');
    const alias = { firstcry: 'firstcry', dabdoob: 'dabdoob', mumzworld: 'mumzworld', mothercare: 'mothercare',
                    noon: 'noon', amazon: 'amazon', jarir: 'jarir', extra: 'extra', namshi: 'namshi',
                    trendyol: 'trendyol', nahdi: 'nahdi', aldawaa: 'dawaa', saco: 'saco', almanea: 'almanea' }[rowStore];
    if (alias && mnorm.includes(alias)) return { ok: false, reason: `merchant is the row's own store (${listing.merchant})` };
  }

  // — 0b. product class: a powered toy and a static model are different products —
  //   Maisto sells a 28-inch radio-controlled F-150 and a 1:21 diecast F-150. They share the model
  //   code, sit 2.3× apart in price, and the first sweep proposed the diecast as the reference for
  //   the RC truck — the same class of error as pricing a 75" against an 85".
  const RC = /\b(remote control|remote-control|radio control|r\/?c|2\.4 ?ghz)\b|ريموت|بريموت|تحكم عن بعد/i;
  const STATIC_MODEL = /\b(die-?\s?cast|diecast|scale model|1:\d{2,3}|collectible model)\b|مجسم|دايكاست/i;
  const rowText = `${row.name || ''} ${row.enName || ''}`;
  //   The requirement is positive, not "does not contradict": the first fix only rejected listings
  //   that SAID diecast, so an untitled static model ("Maisto Ford F-150 SVT Lightning Pickup
  //   Truck", 159) still priced a 323-riyal RC truck. If being remote-controlled is part of what the
  //   row is, the comparator has to say so too.
  if (RC.test(rowText) && !RC.test(title)) return { ok: false, reason: 'row is remote-controlled, listing does not say it is' };
  if (STATIC_MODEL.test(rowText) && RC.test(title) && !STATIC_MODEL.test(title)) return { ok: false, reason: 'row is a static model, listing is remote-controlled' };

  // — 0c. a converted price is not a Saudi price —
  //   The index prints the original next to the converted figure ("(€85)", "($113)", "(AED 799)")
  //   when the merchant sells in another currency. Whatever the display says in riyals, that is not
  //   a price anyone pays here, and Milo Toys Shop at "SAR 365 (€85)" was about to become the
  //   reference for a Dabdoob piano.
  if (listing.foreign) return { ok: false, reason: `price converted from another currency (${listing.merchant})` };

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
  if (!required.length) {
    // NAME MATCH — for products that genuinely have no model code. Toys are the reason: a LeapTop
    // Touch, a Park & Go garage and a 2000-piece New York puzzle carry no code anywhere, so the
    // model rule rejects every one of them and the whole category is unverifiable.
    //
    // This is NOT a loosening into "the title looks right". It needs the row's own English product
    // name — the store's own slug, not our paraphrase — and it requires EVERY distinctive word of
    // it to appear in the listing as a whole word. "leaptop touch" therefore does not match
    // "My Own Leaptop", and "new york 2000" does not match the 1000-piece New York. Fewer than two
    // distinctive words is a brand-only match and stays rejected.
    const nm = norm(row.enName || '');
    if (!nm) return { ok: false, reason: 'row carries no model token — brand-only matches are rejected' };
    const brandWords = new Set(brand.split(' ').filter(Boolean));
    const words = nm.split(' ').filter(w => w && !brandWords.has(w) && !NAME_STOP.has(w) && w.length > 1);
    if (words.length < 2) return { ok: false, reason: `name "${nm}" has fewer than two distinctive words` };
    const missing = words.find(w => !hayTokens.includes(w));
    if (missing) return { ok: false, reason: `name word "${missing}" not present as a whole word` };
    if (row.size && !hayTokens.includes(String(row.size))) return { ok: false, reason: `row is ${row.size}", listing does not say so` };
    const pn = Number(listing.price), rpn = Number(row.price);
    if (!(pn > 0 && rpn > 0)) return { ok: false, reason: 'missing price' };
    const rn = pn / rpn;
    if (rn < minRatio || rn > maxRatio) return { ok: false, reason: `price ${pn} is ${rn.toFixed(2)}× the row (outside ${minRatio}–${maxRatio})` };
    return { ok: true, reason: `same product by name (${words.length} words)` };
  }
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
