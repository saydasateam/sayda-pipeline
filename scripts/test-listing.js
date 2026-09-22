#!/usr/bin/env node
// test-listing.js — parser tests against blocks captured live from the shopping index on
// 2026-09-20 (gl=sa, hl=en). These are verbatim, not invented: if the page structure changes,
// this is the file that should fail first, offline, instead of a wrong price reaching a verdict.
const { fromLines, fromBlocks } = require('../rules/listing.js');

let pass = 0, fail = 0;
const eq = (why, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL  ${why}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
};

// ── real blocks ────────────────────────────────────────────────────────────────────────────────
eq('eXtra: merchant is the line after the price, not the review count',
  (l => l && [l.title.slice(0, 20), l.price, l.merchant])(
    fromLines(['Samsung, 100 inch 4K Smart TV, NeoQLED', 'SAR 12,999.00', 'eXtra Stores', '(759)'])),
  ['Samsung, 100 inch 4K', 12999, 'eXtra Stores']);

eq('Alkhunaizan: "Nearby, 4 km" and "4.7(4.5K)" are badges, not merchants',
  (l => l && l.merchant)(
    fromLines(['Samsung 4K Smart Neo QLED TV', 'SAR 6,499.00', 'Alkhunaizan Co.', 'Nearby, 4 km', '4.7(4.5K)'])),
  'Alkhunaizan Co.');

eq('Samsung KSA: "(4)" is a review count',
  (l => l && [l.price, l.merchant])(
    fromLines(['100" Mini LED M90H 4K Samsung Vision AI Smart TV (2026)', 'SAR 9,999.00', 'Samsung KSA', '(4)'])),
  [9999, 'Samsung KSA']);

eq('Almanea: "Free" is a shipping badge — this is the block that produced «أرخص من مجانًا»',
  (l => l && l.merchant)(
    fromLines(['Samsung, TV, 100 Inch, Mini LED, Smart TV, UA100M90HUXSA', 'SAR 9,999.00', 'Almanea SA', 'Free'])),
  'Almanea SA');

// ── things that must NOT parse ─────────────────────────────────────────────────────────────────
eq('price-range filter chip is not a product', fromLines(['SAR 4,000 - SAR 5,000', 'SAR 4,000 - SAR 5,000', 'x']), null);
eq('no merchant line → discarded rather than half-parsed', fromLines(['Samsung 100 inch QN80F', 'SAR 7,998.00']), null);
eq('no price → discarded', fromLines(['Samsung 100 inch QN80F', 'eXtra Stores', '(12)']), null);
eq('title too short to be a product name → discarded', fromLines(['TV', 'SAR 7,998.00', 'noon']), null);

// ── condition and Arabic digits ────────────────────────────────────────────────────────────────
eq('used is flagged for rules/match.js to reject',
  (l => l && l.condition)(fromLines(['DeLonghi Magnifica ECAM12.121 Coffee Machine', 'SAR 900.00', 'OLX', 'Used - Good'])), 'used');
eq('Arabic-Indic digits parse',
  (l => l && l.price)(fromLines(['شاشة سامسونج QN80F 100 بوصة', '٧٬٩٩٨ ر.س', 'نون'])), 7998);

// ── dedup: nested DOM repeats a product with a longer, outer title ─────────────────────────────
const blocks = [
  { lines: ['Samsung 100-inch Neo QLED 4K UHD Smart TV QN80F (2025 Model) plus more outer text here', 'SAR 8,456.00', 'Amazon.sa', '(3k+)'] },
  { lines: ['Samsung 100-inch Neo QLED QN80F', 'SAR 8,456.00', 'Amazon.sa', '(3k+)'] },
  { lines: ['Samsung 100 inch 4K Smart TV NeoQLED', 'SAR 12,999.00', 'eXtra Stores', '(759)'] },
];
eq('dedup keeps the innermost (shortest) title per price+merchant',
  fromBlocks(blocks).map(l => [l.price, l.merchant, l.title.length]),
  [[8456, 'Amazon.sa', 31], [12999, 'eXtra Stores', 36]]);

console.log(`\nlisting parser: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
