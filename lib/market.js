// market.js — the cached cross-store comparator ("the sidecar").
//
// WHAT IT IS FOR
// Four stores verify by `market`: Jarir, Blackbox, Almanea, SACO. Until now that comparison was
// hand-probed per run — 62 queries producing 5 deals, an 8% yield bought with an analyst's whole
// slot. Cached, it becomes one lookup per PRODUCT rather than per run, which is what makes the
// comparison affordable across a widened catalogue instead of a shortlist of eight.
//
// WHAT IT IS NOT
// It is not a price history and must never be worded as one. It answers "is this the cheapest place
// to buy this model in KSA right now", which rules/verdict.js already renders as «أرخص من X» with
// refKind `market`. It does not answer "was this 2,699 before the sale" — nothing available to this
// pipeline answers that for a store with no public tracker, and the page should not imply otherwise.
//
// WHAT IT CANNOT DO, EVER
// Own-label goods have no second seller, so no comparator exists: IKEA, Home Centre, Home Box, Pan
// Home, CityW, Baytonia, and most Trendyol marketplace stock. 32 of the page's 39 available `na`
// rows are exactly this. For them `na` is the correct and final answer, not a gap to be closed.
//
// Sharded per store for the same reason state and history are: one writer per file.
const fs = require('fs'), path = require('path');
const DIR = root => path.join(root, 'data/market');

const REFRESH_DAYS = 7;          // a reference older than this is re-sampled
const PRICE_MOVE = 0.01;         // …and so is one whose row price has moved more than 1%

const readJson = (p, f) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return f; } };
const storeOf = id => String(id).split(':')[0];

/** Merge every shard into one { rowId: entry } map. */
function load(root) {
  const d = DIR(root);
  if (!fs.existsSync(d)) return {};
  const out = {};
  for (const f of fs.readdirSync(d).filter(n => n.endsWith('.json'))) Object.assign(out, readJson(path.join(d, f), {}));
  return out;
}

/** Write back only the stores named in `touched`. */
function save(root, m, touched) {
  const d = DIR(root);
  fs.mkdirSync(d, { recursive: true });
  const groups = {};
  for (const id of Object.keys(m)) {
    const s = storeOf(id);
    if (touched && !touched.includes(s)) continue;
    (groups[s] = groups[s] || {})[id] = m[id];
  }
  for (const [s, g] of Object.entries(groups)) fs.writeFileSync(path.join(d, s + '.json'), JSON.stringify(g, null, 1));
  return Object.keys(groups);
}

/** Is this row's cached reference still good? */
function isFresh(entry, row, today) {
  if (!entry || !entry.sampledAt) return false;
  const age = Math.round((Date.parse(today) - Date.parse(entry.sampledAt)) / 86400e3);
  if (age >= REFRESH_DAYS) return false;
  if (entry.rowPrice && row.price && Math.abs(row.price - entry.rowPrice) / entry.rowPrice > PRICE_MOVE) return false;
  return true;
}

/** Rows that need a lookup this run: the sidecar's whole work list.
 *  `stores` limits it to the slot's own stores — never enrich a store another slot owns. */
function due(rows, cache, today, stores) {
  return rows.filter(r => (!stores || stores.includes(r.store)) && !isFresh(cache[r.id], r, today));
}

// Brands as the page writes them (Arabic) mapped to the Latin form a shopping index indexes by.
// Only brands that actually appear on the page — a long speculative list costs lookups and buys
// nothing, and an unlisted brand simply means the row is not enrichable, which is a fine answer.
const BRANDS = {
  'سامسونج': 'samsung', 'جالاكسي': 'samsung', 'آيفون': 'apple', 'ايفون': 'apple', 'سكاي ورث': 'skyworth', 'بيسيل': 'bissell', 'إل جي': 'lg', 'ال جي': 'lg', 'سوني': 'sony', 'هايسنس': 'hisense',
  'تي سي إل': 'tcl', 'هواوي': 'huawei', 'شاومي': 'xiaomi', 'أبل': 'apple', 'ابل': 'apple',
  'ديل': 'dell', 'لينوفو': 'lenovo', 'اسوس': 'asus', 'أسوس': 'asus', 'اتش بي': 'hp', 'ام اس اي': 'msi',
  'ايسر': 'acer', 'فيليبس': 'philips', 'بوش': 'bosch', 'ديلونجي': 'delonghi', 'براون': 'braun',
  'باناسونيك': 'panasonic', 'نسبريسو': 'nespresso', 'كينوود': 'kenwood', 'مولينكس': 'moulinex',
  'تيفال': 'tefal', 'بلاك آند ديكر': 'black decker', 'بلاك اند ديكر': 'black decker',
  'دايسون': 'dyson', 'كانون': 'canon', 'نيكون': 'nikon', 'جي بي إل': 'jbl', 'انكر': 'anker',
  'لوجيتك': 'logitech', 'أمازفيت': 'amazfit', 'ريلمي': 'realme', 'أوبو': 'oppo', 'اوبو': 'oppo',
  'هونر': 'honor', 'نينتندو': 'nintendo', 'بلايستيشن': 'playstation', 'اكس بوكس': 'xbox',
  'أشلي': 'ashley', 'ميداس': 'midas', 'إيكيا': 'ikea', 'هاير': 'haier', 'شارب': 'sharp',
  'توشيبا': 'toshiba', 'دايكن': 'daikin', 'جري': 'gree', 'ميديا': 'midea', 'بلوإير': 'blueair',
};

// Latin brand names as they appear in the page's own row names. A closed list, because the
// alternative — "take the first Latin word" — produced "edge" for a Galaxy S25 Edge, "mini" for a
// Skyworth Mini-LED and "ultra" for a Galaxy S25 Ultra. A wrong brand is worse than no brand: it
// sends a lookup after the wrong product and the same-model filter then has nothing true to reject.
const LATIN_BRANDS = {
  galaxy: 'samsung', samsung: 'samsung', iphone: 'apple', apple: 'apple', macbook: 'apple',
  huawei: 'huawei', xiaomi: 'xiaomi', redmi: 'xiaomi', honor: 'honor', oppo: 'oppo', realme: 'realme',
  sony: 'sony', lg: 'lg', hisense: 'hisense', tcl: 'tcl', skyworth: 'skyworth', sharp: 'sharp',
  toshiba: 'toshiba', haier: 'haier', midea: 'midea', gree: 'gree', daikin: 'daikin',
  dell: 'dell', lenovo: 'lenovo', asus: 'asus', acer: 'acer', msi: 'msi', hp: 'hp',
  philips: 'philips', bosch: 'bosch', delonghi: 'delonghi', braun: 'braun', panasonic: 'panasonic',
  nespresso: 'nespresso', kenwood: 'kenwood', moulinex: 'moulinex', tefal: 'tefal', dyson: 'dyson',
  canon: 'canon', nikon: 'nikon', jbl: 'jbl', anker: 'anker', logitech: 'logitech',
  amazfit: 'amazfit', marshall: 'marshall', sennheiser: 'sennheiser', bose: 'bose', blueair: 'blueair',
  nintendo: 'nintendo', playstation: 'playstation', xbox: 'xbox', ashley: 'ashley', midas: 'midas',
  ikea: 'ikea', beko: 'beko', hitachi: 'hitachi', lenova: 'lenovo',
};

/** Latin tokens that look like a model code: they carry BOTH a letter and a digit and are not a
 *  size, capacity, wattage or year. "QN80F", "ECAM12.121", "WH-1000XM5", "T10i", "S25" qualify;
 *  "4K", "128GB", "2024", "65" do not. */
const NOISE = /^(\d{1,4}k|\d{2,4}hz|\d+gb|\d+tb|\d+mm|\d+cm|\d+w|\d+v|\d+l|\d+ml|\d+btu|20\d\d|\d+)$/i;
function modelTokens(name) {
  const raw = String(name || '').split(/[\s،,()«»"'‏‎]+/).map(t => t.replace(/[^\w.\-]/g, ''));
  const coded = raw.filter(t => /^[A-Za-z0-9.\-]{2,}$/.test(t) && /\d/.test(t) && /[A-Za-z]/.test(t) && !NOISE.test(t));
  if (coded.length) return coded;
  // Fallback for series-plus-number names with no code at all — "Watch Fit 4", "Momentum 4",
  // "Redmi Buds 8". Returned as one two-part token so rules/match.js requires both halves.
  // VARIANT is excluded as the series word: "Galaxy Watch Ultra 47مم" would otherwise yield the
  // model "Ultra 47", where 47 is the case size in millimetres, not a model number.
  for (let i = 0; i < raw.length - 1; i++) {
    const w = raw[i].toLowerCase();
    if (/^[A-Za-z]{3,}$/.test(raw[i]) && /^\d{1,3}$/.test(raw[i + 1]) && !LATIN_BRANDS[w] && !VARIANT.has(w)) {
      return [`${raw[i]} ${raw[i + 1]}`];
    }
  }
  return [];
}

// Variant qualifiers. These are never the model, but they DO distinguish two real products:
// "Huawei Watch Fit 4" and "Huawei Watch Fit 4 Pro" derive the same brand and model token, and
// without carrying the qualifier the Pro row would be priced against the non-Pro listing.
const VARIANT = new Set(['pro', 'max', 'ultra', 'plus', 'lite', 'mini', 'air', 'edge', 'se', 'fe']);
function variantOf(name) {
  const s = String(name || '');
  // "Mini LED" / "QD-Mini LED" is a panel technology, not a product variant. Reading it as one
  // produced the query "samsung M80H mini" and would have made every Mini-LED set look like a
  // distinct model. Only a qualifier NOT followed by a technology word counts.
  const TECH_AFTER = /^(led|lcd|oled|qled)\b/i;
  const out = [];
  const re = /[A-Za-z]+/g; let m;
  while ((m = re.exec(s))) {
    const w = m[0].toLowerCase();
    if (!VARIANT.has(w)) continue;
    if (TECH_AFTER.test(s.slice(m.index + m[0].length).replace(/^[\s\-]+/, ''))) continue;
    out.push(w);
  }
  return out.length ? out[out.length - 1] : null;
}

/** Screen or capacity size, when the name states one. For a television the size IS part of the
 *  product: a 75" and an 85" carry the same model code, sit 1.4x apart in price, and therefore sit
 *  comfortably inside the 0.35x-3x sanity band. Without this, one references the other. */
function sizeOf(name) {
  const m = String(name || '').match(/(\d{2,3})\s*(?:بوصة|بوصه|inch|")/i);
  return m ? m[1] : null;
}

/** Brand for a row. Order matters: an explicit adapter-captured brand, then the Latin list, then
 *  the Arabic lexicon longest-key-first with a boundary check — without that check "ديلونجي"
 *  (DeLonghi) matches the key "ديل" (Dell) by substring and every lookup goes to the wrong maker. */
const AR_KEYS = Object.keys(BRANDS).sort((a, b) => b.length - a.length);
const AR_LETTER = /[ء-ي]/;
function brandOf(row) {
  const b = String(row.brand || '').trim().toLowerCase();
  if (b && /[a-z]/.test(b)) return LATIN_BRANDS[b] || b;
  const name = String(row.name || '');
  for (const t of name.split(/[^A-Za-z]+/)) { const k = t.toLowerCase(); if (LATIN_BRANDS[k]) return LATIN_BRANDS[k]; }
  for (const ar of AR_KEYS) {
    const i = name.indexOf(ar);
    if (i < 0) continue;
    const before = name[i - 1], after = name[i + ar.length];
    if ((before && AR_LETTER.test(before)) || (after && AR_LETTER.test(after))) continue;  // inside a longer word
    return BRANDS[ar];
  }
  return null;
}

/** The query the adapter runs, plus the brand/model rules/match.js will check the results against.
 *  Brand + model only — a full Arabic product name returns noise, and a query with no model token
 *  is rejected by rules/match.js anyway, so it is not worth spending a lookup on.
 *  Returns null when the row cannot be enriched; that is a normal outcome, not an error. */
function queryFor(row) {
  const brand = brandOf(row);
  const models = String(row.model || '').trim() ? [String(row.model).trim()] : modelTokens(row.name);
  if (!brand || !models.length) return null;
  const model = models.slice(0, 2).join(' ');
  const variant = variantOf(row.name);
  const size = sizeOf(row.name);
  // variant and size both go in the query AND in the row passed to rules/match.js, which requires
  // each as a whole word — so a Pro row cannot be referenced against a non-Pro listing, and a 75"
  // cannot be referenced against an 85" carrying the same model code
  const q = [brand, model, variant, size].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return { q, brand, model, variant, size };
}

/** Store one sampling result. `ev` is what rules/match.js → marketEvidence returned. */
function put(cache, row, q, ev, today) {
  cache[row.id] = {
    q,
    sampledAt: today,
    rowPrice: row.price,
    n: ev.kept ? ev.kept.length : 0,
    merchantCount: ev.merchantCount || 0,
    min: ev.min ?? null, avg: ev.avg ?? null, max: ev.max ?? null,
    market: ev.market || null,
    sources: (ev.sources || []).slice(0, 6),
    // keep why things were thrown out: without it a zero-result row is indistinguishable from a
    // broken query, and that is the difference between "no comparator exists" and "the sweep failed"
    rejected: (ev.rejected || []).slice(0, 6).map(r => ({ title: String(r.title || '').slice(0, 70), why: r.why })),
  };
  return cache[row.id];
}

module.exports = { load, save, isFresh, due, queryFor, put, storeOf, brandOf, modelTokens, variantOf, sizeOf, DIR, REFRESH_DAYS, PRICE_MOVE };
