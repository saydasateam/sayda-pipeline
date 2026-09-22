// listing.js — turn a shopping-result block into a listing. Pure, node-side, testable.
//
// THE SPLIT, AND WHY
// The browser adapter does DOM extraction only: it hands back the text lines of each result block
// and the block's link. Everything that interprets those lines lives here, where it can be tested
// against captured real blocks without a browser. The alternative — a parser inside the adapter —
// is exactly what produced "18.6 / 18,999" as a price pair on 2026-09-20, because nothing could
// run it offline and see that it was wrong.
//
// BLOCK SHAPE, captured live 2026-09-20 (gl=sa, hl=en):
//   ["Samsung, 100 inch 4K Smart TV, NeoQLED", "SAR 12,999.00", "eXtra Stores", "(759)"]
//   ["100\" Mini LED M90H 4K Samsung Vision AI Smart TV (2026)", "SAR 9,999.00", "Samsung KSA", "(4)"]
//   ["Samsung 4K Smart Neo QLED TV", "SAR 6,499.00", "Alkhunaizan Co.", "Nearby, 4 km", "4.7(4.5K)"]
// The merchant is ALWAYS the line immediately after the price. An earlier heuristic took "the last
// short line" and returned "(759)", "Free" and "مجانًا" as merchant names — which would have
// published «أرخص من مجانًا» on the page.
//
// hl=en IS REQUIRED, not cosmetic. With hl=ar the same query returns titles like
// «تلفزيون سامسونج، 100 بوصة، نيو كيوليد» — no Latin brand, no model code — and rules/match.js
// correctly rejects every one of them. The country pin gl=sa is what keeps the merchants Saudi;
// the language pin is what keeps the titles matchable.

// \d is ASCII-only in JS, so the Arabic-Indic range is spelled out. Without it the line
// «٧٬٩٩٨ ر.س» is not recognised as a price at all and the whole listing is silently dropped.
// (backslashes are doubled because these are string literals feeding new RegExp, not literals)
const DIGITS = '[\\d٠-٩,٬.]';
const CUR = '(?:SAR|ر\\.?\\s?س|ريال)';
const PRICE_LINE = new RegExp(`${CUR}\\s*${DIGITS}+|${DIGITS}+\\s*${CUR}`, 'i');

// Lines that are never a merchant: review counts, ratings, distance, shipping and stock badges.
const NOISE_LINE = [
  /^\(?\d[\d.,]*\s*(k\+?)?\)?$/i,              // "(759)", "(3k+)", "(4)"
  /^\d+(\.\d+)?\s*\(/,                          // "4.7(4.5K)"
  /^(nearby|free|used|refurbished|sponsored|in stock|out of stock)\b/i,
  /^(مجان[اًي]|قريب|مستعمل|مجدد|برعاية|متوفر)\b/,
  /^(SAR|ر\.?\s?س|ريال)\b/i,
  /^\+?\s*\d+\s*(more|أخرى)\b/i,
];
const isNoise = s => NOISE_LINE.some(re => re.test(s));

/** Parse a SAR amount out of a line, Arabic-Indic digits included. */
function amount(s) {
  const m = String(s || '')
    .replace(/[,٬]/g, '')
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/**
 * One block of text lines → a listing, or null when the block is not a product result.
 * Deliberately strict: a block that does not yield a title, a price AND a merchant is discarded.
 * A half-parsed listing is worse than a missing one, because it still gets a verdict.
 */
function fromLines(lines, url) {
  const L = (lines || []).map(x => String(x || '').trim()).filter(Boolean);
  if (L.length < 3) return null;                       // title + price + merchant is the minimum

  // a price RANGE ("SAR 4,000 - SAR 5,000") is a filter chip, not a product
  const pi = L.findIndex(x => PRICE_LINE.test(x));
  if (pi < 0) return null;
  if (/[-–]\s*(?:SAR|ر\.?\s?س|ريال)/i.test(L[pi])) return null;

  const price = amount(L[pi]);
  if (!(price > 0)) return null;

  // title: the last substantial non-price line BEFORE the price
  const title = L.slice(0, pi).reverse().find(x => x.length > 10 && !PRICE_LINE.test(x));
  if (!title) return null;

  // merchant: the line immediately after the price, skipping badge lines
  const merchant = L.slice(pi + 1).find(x => !isNoise(x) && x.length <= 45);
  if (!merchant) return null;

  const blob = L.join(' ');
  return {
    title: title.slice(0, 160),
    price,
    merchant: merchant.replace(/\s*[·•|].*$/, '').trim().slice(0, 45),
    url: url || null,
    condition: /\b(used|pre-?owned|refurb\w*|renewed)\b|مستعمل|مجدد/i.test(blob) ? 'used' : null,
  };
}

/** Many blocks → deduplicated listings. Nested DOM means a parent block repeats its children's
 *  text, so the same product arrives several times with progressively longer titles; keep the
 *  shortest title for each (price, merchant) pair — that is the innermost, correctly scoped one. */
function fromBlocks(blocks, limit = 25) {
  const best = new Map();
  for (const b of blocks || []) {
    const l = fromLines(b.lines, b.url);
    if (!l) continue;
    const k = l.price + '|' + l.merchant.toLowerCase();
    const prev = best.get(k);
    if (!prev || l.title.length < prev.title.length) best.set(k, l);
  }
  return [...best.values()].slice(0, limit);
}

module.exports = { fromLines, fromBlocks, amount, isNoise, PRICE_LINE };
