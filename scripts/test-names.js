#!/usr/bin/env node
// test-names.js — BLD-48: the site's own wrapper is cut from an English title, the product name never is.
//
//   node scripts/test-names.js
//
// Loads adapters/_core.js in a sandbox (as test-untracked.js does) and checks SAYDA.siteTail, SAYDA.cleanTitle and
// SAYDA.wrapped on titles seen on the stores' own pages. Reads nothing under data/ and writes nothing.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const eq = (why, got, want) => { if (got === want) pass++; else { fail++; console.log(`FAIL  ${why}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); } };

const win = { SAYDA: undefined, location: { hostname: 'www.saco.sa', origin: 'https://www.saco.sa', href: 'https://www.saco.sa/' }, document: {}, localStorage: { getItem: () => null, setItem() {} } };
win.window = win;
try { vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'adapters/_core.js'), 'utf8'), win); } catch (e) { /* core may touch DOM at load; the helpers are defined first */ }
const S = win.SAYDA || win.window.SAYDA;
if (!S || !S.cleanTitle || !S.wrapped) { console.log('FAIL  SAYDA.cleanTitle and SAYDA.wrapped exist'); console.log('names: 0 passed, 1 failed'); process.exit(1); }

// ── the SACO tail (BLD-48): a 4-letter host label ───────────────────────────────────────────────
eq('SACO: « | SACO» goes',
  S.cleanTitle('Dyson V15 Detect Extra Cordless Vacuum Cleaner Nickel Blue 476609-01 | SACO', 'saco'),
  'Dyson V15 Detect Extra Cordless Vacuum Cleaner Nickel Blue 476609-01');
eq('SACO: lower case tail goes too', S.cleanTitle('Panasonic Refrigerator NR-BS780MSSA | saco', 'saco'), 'Panasonic Refrigerator NR-BS780MSSA');
eq('SACO: host label read from the tab', S.hostLabel(), 'saco');
eq('SACO: wrapped name is flagged for a fresh read', S.wrapped('Black+Decker 12V Max Cordless Drill Driver LD12SP-B5 | SACO'), true);
eq('SACO: clean name is not flagged', S.wrapped('Black+Decker 12V Max Cordless Drill Driver LD12SP-B5'), false);

// ── what must stay: the 5-letter floor for a word that only STARTS the host, dash tails, real name parts ─
eq('a short word that only starts the host is kept («| Sac» on saco)', S.cleanTitle('Leather Bag | Sac', 'saco'), 'Leather Bag | Sac');
eq('a dash tail with the host word is kept (dash keeps the older test)', S.cleanTitle('Kettle 1.7L - Saco', 'saco'), 'Kettle 1.7L - Saco');
eq('Blackbox: « - Black» is part of the name', S.cleanTitle('Apple iPhone 17 Pro 256GB - Black', 'blackbox'), 'Apple iPhone 17 Pro 256GB - Black');
eq('Lenovo spec after «|» on amazon is kept', S.cleanTitle('Lenovo Idea Tab Pro Tablet | 12.7 Inch 3K Display | MediaTek Dimensity 8300 | 8GB RAM', 'amazon'),
  'Lenovo Idea Tab Pro Tablet | 12.7 Inch 3K Display | MediaTek Dimensity 8300 | 8GB RAM');
eq('a one-letter tail is never the host', S.cleanTitle('Lego Set 10 | X', 'x'), 'Lego Set 10 | X');
eq('ikea (4 letters) as the whole host label goes', S.cleanTitle('KALLAX Shelf unit, white | IKEA', 'ikea'), 'KALLAX Shelf unit, white');

// ── stock phrases and long host words, unchanged ─────────────────────────────────────────────────
eq('Namshi «| Best Price KSA»', S.cleanTitle('Slim Fit Shirt | Best Price KSA', 'namshi'), 'Slim Fit Shirt');
eq('Mothercare «| Mothercare Saudi Arabia»', S.cleanTitle('Baby Bodysuit 3 Pack | Mothercare Saudi Arabia', 'mothercare'), 'Baby Bodysuit 3 Pack');
eq('Nahdi «| Nahdi»', S.cleanTitle('Panadol Extra 24 Tablets | Nahdi', 'nahdionline'), 'Panadol Extra 24 Tablets');
eq('Mumzworld «Buy … in KSA | Mumzworld»', S.cleanTitle('Buy Chicco Stroller in KSA | Mumzworld', 'mumzworld'), 'Chicco Stroller');
eq('BlackBox «| BlackBox»', S.cleanTitle('Sony WH-1000XM6 | BlackBox', 'blackbox'), 'Sony WH-1000XM6');

console.log(`names: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
