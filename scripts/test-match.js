#!/usr/bin/env node
// test-match.js — regression tests for rules/match.js.
//
// Every REJECT case below is a real match the 2026-09-19 sweep accepted. If this file passes and
// the sweep still produces one of them, the bug is in the caller, not the filter.
//
//   node scripts/test-match.js       # exit 1 on any failure
const { sameModel, marketEvidence } = require('../rules/match.js');

const cases = [
  // ── the five 2026-09-19 false positives ──────────────────────────────────────────────────────
  { want: false, why: 'accessory: screen protector sold as the watch',
    row: { name: 'ساعة هواوي GT 5', brand: 'huawei', model: 'gt 5', price: 675 },
    listing: { title: 'Screen Protector for Huawei Watch GT 5 46mm', price: 29, merchant: 'noon', country: 'sa' } },
  { want: false, why: 'accessory: nylon strap sold as the band',
    row: { name: 'شاومي مي باند 10', brand: 'xiaomi', model: 'band 10', price: 189 },
    listing: { title: 'Nylon Strap Band for Xiaomi Mi Band 10', price: 25, merchant: 'amazon.sa', country: 'sa' } },
  { want: false, why: 'accessory: charging cable sold as the watch',
    row: { name: 'أمازفيت GTR 4', brand: 'amazfit', model: 'gtr 4', price: 549 },
    listing: { title: 'Charger for Amazfit GTR 4 Charging Cable', price: 19, merchant: 'noon', country: 'sa' } },
  { want: false, why: 'accessory: replacement headband sold as the headphones',
    row: { name: 'جي بي إل Tune 770NC', brand: 'jbl', model: 'tune 770nc', price: 399 },
    listing: { title: 'Replacement Headband Cushion for JBL Tune 770NC', price: 35, merchant: 'amazon.sa', country: 'sa' } },
  { want: false, why: 'brand: "black" must not match "Koolen ... black"',
    row: { name: 'بلاك آند ديكر مقلاة هوائية', brand: 'black decker', model: 'af300', price: 349 },
    listing: { title: 'Koolen Air Fryer 4L Digital Black', price: 179, merchant: 'extra', country: 'sa' } },

  // ── name matching and cross-border merchants, added 2026-09-22 with the toy stores ──────────
  { want: true, why: 'name match: the same LeapTop Touch, no model code anywhere',
    row: { name: 'ليبفروق - لابتوب تاتش 2 في 1 - أخضر', brand: 'leapfrog', enName: '2 in 1 leaptop touch green', price: 214 },
    listing: { title: 'Leapfrog 2-in-1 LeapTop Touch, Green - 600903', price: 199, merchant: 'Amazon.sa', country: 'sa' } },
  { want: false, why: 'name match must not accept a different LeapFrog laptop',
    row: { name: 'ليبفروق - لابتوب تاتش 2 في 1 - أخضر', brand: 'leapfrog', enName: '2 in 1 leaptop touch green', price: 214 },
    listing: { title: 'Leapfrog My Own Leaptop, Pink, New', price: 190, merchant: 'Amazon.sa', country: 'sa' } },
  { want: false, why: 'name match must not accept the 1000-piece puzzle for the 2000-piece row',
    row: { name: 'كلمنتوني - بازل نيويورك 2000 قطعة', brand: 'clementoni', enName: 'new york puzzle 2000 pcs', price: 45.54 },
    listing: { title: 'Clementoni 39646 Collection New York City 1000 Pieces', price: 70.07, merchant: 'Amazon.sa', country: 'sa' } },
  { want: false, why: 'name match must not accept a generic wooden garage for a Hape Park & Go',
    row: { name: 'هايب - جراج بارك آند جو الخشبي', brand: 'hape', enName: 'park and go garage', price: 246 },
    listing: { title: 'Balinco Wooden Car Park, Parking Garage Toy Wood for Children', price: 223.59, merchant: 'Amazon.sa', country: 'sa' } },
  { want: false, why: 'brand-only: a single distinctive word is not an identity',
    row: { name: 'تيمسترز - شاحنة', brand: 'teamsterz', enName: 'truck', price: 124 },
    listing: { title: 'Teamsterz Fire Engine Truck Light and Sound', price: 99, merchant: 'noon', country: 'sa' } },
  { want: false, why: 'cross-border marketplace: a converted eBay price is not a Saudi reference',
    row: { name: 'كلمنتوني - بازل نيويورك 2000 قطعة', brand: 'clementoni', enName: 'new york puzzle 2000 pcs', price: 45.54 },
    listing: { title: 'Clementoni 2000-Piece Puzzle New York 32544', price: 257.99, merchant: 'eBay', country: 'sa' } },

  { want: false, why: 'self-reference: the row\'s own store is not evidence about the row',
    row: { name: 'أيفو - سكوتر', store: 'dabdoob', brand: 'evo', enName: 'light up move n groove scooter', price: 142.11 },
    listing: { title: 'Evo Light Up Move N Groove Scooter - Pink', price: 142.11, merchant: 'Dabdoob', country: 'sa' } },
  { want: false, why: 'product class: a 1:21 diecast is not the 28-inch RC truck',
    row: { name: 'مايستو - سيارة فورد رابتر F-150 SVT بريموت', store: 'firstcry', brand: 'maisto', model: 'f 150', price: 322.9 },
    listing: { title: 'Maisto 1:21 Scale Ford SVT F-150 Lightning Diecast Truck Vehicle', price: 139.23, merchant: 'Amazon.sa', country: 'sa' } },
  { want: false, why: 'importer: Ubuy ships in, it is not a Saudi shelf price',
    row: { name: 'ليبفروق', store: 'firstcry', brand: 'leapfrog', enName: '2 in 1 leaptop touch pink', price: 187.01 },
    listing: { title: 'LeapFrog 2-in-1 LeapTop Touch Frustration Free Packaging, Pink', price: 157.72, merchant: 'Ubuy', country: 'sa' } },

  // ── country and condition, added 2026-09-20 with the shopping index ─────────────────────────
  { want: false, why: 'used unit is a different product',
    row: { name: 'ديلونجي Magnifica ECAM12.121', brand: 'delonghi', model: 'ecam12 121', price: 1999 },
    listing: { title: 'DeLonghi Magnifica ECAM12.121 Used - Good Condition', price: 900, merchant: 'olx', country: 'sa' } },
  { want: false, why: 'merchant outside KSA',
    row: { name: 'ديلونجي Magnifica ECAM12.121', brand: 'delonghi', model: 'ecam12 121', price: 1999 },
    listing: { title: 'DeLonghi Magnifica ECAM12.121', price: 1100, merchant: 'Jumia Egypt', country: 'eg' } },
  { want: false, why: 'merchant looks non-KSA even with no country field',
    row: { name: 'ديلونجي Magnifica ECAM12.121', brand: 'delonghi', model: 'ecam12 121', price: 1999 },
    listing: { title: 'DeLonghi Magnifica ECAM12.121', price: 1050, merchant: 'Noon Egypt' } },

  // ── model discipline ────────────────────────────────────────────────────────────────────────
  { want: false, why: 'band 10 must not match Band 9',
    row: { name: 'شاومي مي باند 10', brand: 'xiaomi', model: 'band 10', price: 189 },
    listing: { title: 'Xiaomi Smart Band 9 Fitness Tracker', price: 149, merchant: 'noon', country: 'sa' } },
  { want: false, why: 'brand-only match with no model token is rejected outright',
    row: { name: 'سامسونج تلفزيون', brand: 'samsung', model: '', price: 3399 },
    listing: { title: 'Samsung 55 inch Crystal UHD TV', price: 1899, merchant: 'extra', country: 'sa' } },
  { want: true, why: 'run-together model: dlc 36362 matches dlc36362',
    row: { name: 'ديلونجي DLC 36362', brand: 'delonghi', model: 'dlc 36362', price: 899 },
    listing: { title: 'DeLonghi DLC36362 Kitchen Machine', price: 799, merchant: 'saco', country: 'sa' } },

  { want: false, why: 'near-miss: QN80FX must not match QN80F (a substring test would accept it)',
    row: { name: 'سامسونج QN80F', brand: 'samsung', model: 'qn80f', price: 10896 },
    listing: { title: 'Samsung Neo QLED QN80FX 100 inch', price: 8500, merchant: 'noon', country: 'sa' } },
  { want: false, why: 'near-miss: Band 100 must not match Band 10',
    row: { name: 'شاومي مي باند 10', brand: 'xiaomi', model: 'band 10', price: 189 },
    listing: { title: 'Xiaomi Smart Band 100 Pro', price: 210, merchant: 'noon', country: 'sa' } },
  { want: false, why: 'brand-only: a 55-inch must never reference a 100-inch',
    row: { name: 'سامسونج 100 بوصة QN80F', brand: 'samsung', model: 'qn80f', price: 10896 },
    listing: { title: 'Samsung 55 inch Neo QLED Smart TV', price: 4199, merchant: 'extra', country: 'sa' } },

  // ── variant discipline ──────────────────────────────────────────────────────────────────────
  { want: false, why: 'base model must not be priced against the Pro',
    row: { name: 'ساعة Huawei Watch Fit 4', brand: 'huawei', model: 'fit 4', price: 449 },
    listing: { title: 'Huawei Watch Fit 4 Pro Smartwatch', price: 799, merchant: 'jarir', country: 'sa' } },
  { want: false, why: 'Pro row must not be priced against the base model',
    row: { name: 'ساعة Huawei Watch Fit 4 Pro', brand: 'huawei', model: 'fit 4', variant: 'pro', price: 799 },
    listing: { title: 'Huawei Watch Fit 4 Smartwatch', price: 449, merchant: 'noon', country: 'sa' } },
  { want: true, why: 'Pro row against a Pro listing is the correct comparison',
    row: { name: 'ساعة Huawei Watch Fit 4 Pro', brand: 'huawei', model: 'fit 4', variant: 'pro', price: 799 },
    listing: { title: 'Huawei Watch Fit 4 Pro 46mm', price: 749, merchant: 'noon', country: 'sa' } },

  // ── size discipline: the gap the sanity band does NOT close ─────────────────────────────────
  { want: false, why: '75" must not be priced against an 85" carrying the same model code',
    row: { name: 'سامسونج 75 بوصة Mini LED M70H', brand: 'samsung', model: 'm70h', size: '75', price: 4999 },
    listing: { title: 'Samsung 85 inch Mini LED M70H Smart TV', price: 6999, merchant: 'noon', country: 'sa' } },
  { want: true, why: 'same model at the same size is the correct comparison',
    row: { name: 'سامسونج 75 بوصة Mini LED M70H', brand: 'samsung', model: 'm70h', size: '75', price: 4999 },
    listing: { title: 'Samsung 75 inch Mini LED M70H Smart TV', price: 4599, merchant: 'noon', country: 'sa' } },

  // ── sanity band ─────────────────────────────────────────────────────────────────────────────
  { want: false, why: 'listing at 0.1× the row price is not the same item',
    row: { name: 'سامسونج QN80F 100 بوصة', brand: 'samsung', model: 'qn80f', price: 10896 },
    listing: { title: 'Samsung QN80F Wall Bracket', price: 900, merchant: 'noon', country: 'sa' } },

  // ── the ones that SHOULD pass, from the 20 Sep Google Shopping probes ───────────────────────
  { want: true, why: 'Samsung QN80F: exact model, KSA merchant, inside the band',
    row: { name: 'سامسونج 100 بوصة Neo QLED QN80F', brand: 'samsung', model: 'qn80f', price: 10896 },
    listing: { title: 'Samsung 100" Neo QLED 4K QN80F Smart TV', price: 7998, merchant: 'Amazon.sa', country: 'sa' } },
  { want: true, why: 'DeLonghi Magnifica: cheaper elsewhere, which is a valid and useful verdict',
    row: { name: 'ديلونجي Magnifica ECAM12.121', brand: 'delonghi', model: 'ecam12 121', price: 1999 },
    listing: { title: 'DeLonghi Magnifica Start ECAM12.121.B Coffee Machine', price: 1624, merchant: 'Trendyol', country: 'sa' } },
  { want: true, why: 'Ashley Havalance: exact match at the same price',
    row: { name: 'أشلي: تسريحة هافالانس', brand: 'ashley', model: 'havalance b814', price: 1900 },
    listing: { title: 'Ashley Havalance B814-31 Dresser', price: 1900, merchant: 'Al Rugaib Furniture', country: 'sa' } },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const got = sameModel(c.row, c.listing);
  const ok = got.ok === c.want;
  if (ok) pass++; else { fail++; console.log(`FAIL  expected ${c.want ? 'ACCEPT' : 'REJECT'} — ${c.why}\n      title: ${c.listing.title}\n      filter said: ${got.ok ? 'ACCEPT' : 'REJECT'} (${got.reason})`); }
}

// marketEvidence: the IKEA case — own-label, nothing comparable exists, `na` is the right answer
const ikea = marketEvidence(
  { name: 'إيكيا IDANÄS سرير', brand: 'ikea', model: 'idanas 180x200', price: 2295 },
  [ { title: 'Baytonia Wooden Bed 180x200', price: 1899, merchant: 'baytonia', country: 'sa' },
    { title: 'Home Centre Upholstered Bed King', price: 2100, merchant: 'homecentre', country: 'sa' } ]);
if (ikea.market === null) pass++; else { fail++; console.log('FAIL  IKEA own-label should yield no market reference, got', ikea.market); }

// marketEvidence: picks the cheapest surviving listing and counts distinct merchants
const ev = marketEvidence(
  { name: 'سامسونج QN80F', brand: 'samsung', model: 'qn80f', price: 10896 },
  [ { title: 'Samsung 100" Neo QLED QN80F', price: 7998, merchant: 'Amazon.sa', country: 'sa', url: 'a' },
    { title: 'Samsung Neo QLED QN80F 100 inch', price: 7999, merchant: 'noon', country: 'sa', url: 'b' },
    { title: 'Samsung QN80F Screen Protector', price: 99, merchant: 'noon', country: 'sa', url: 'c' },
    { title: 'Samsung Neo QLED QN80F', price: 9500, merchant: 'Jumia Egypt', country: 'eg', url: 'd' } ]);
const evOk = ev.market.price === 7998 && ev.merchantCount === 2 && ev.rejected.length === 2;
if (evOk) pass++; else { fail++; console.log('FAIL  marketEvidence:', JSON.stringify({ market: ev.market, merchantCount: ev.merchantCount, rejected: ev.rejected.length })); }

console.log(`\nmatch filter: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
