#!/usr/bin/env node
// test-untracked.js — BLD-36: noon, Amazon and Extra products that KanBkam does not track, compared by the maker's model number.
//
//   node scripts/test-untracked.js
//
// Runs in a scratch copy of the repo (os.tmpdir), so nothing here touches data/state. It checks:
//   1. SAYDA.modelOf / SAYDA.gtinOf keep a real model number or barcode and refuse a store SKU, a word or a size;
//   2. the Extra page read finds JSON-LD `mpn` and `gtin13` in the escaped SSR text;
//   3. apply.js new takes an untracked row only with a model number, and not again after a recent failed comparison;
//   4. build.js keeps untracked rows off both pages;
//   5. market-apply.js: a match makes the row an ordinary market row with the other store's own link; no comparator,
//      or no own-store link, and --apply removes it. A tracked row is never removed.
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL ' + msg); } };

// ── 1. model and barcode cleaners, from adapters/_core.js ──────────────────────────────────────────────────────────────────
const win = { SAYDA: undefined, location: { hostname: 'x', origin: 'https://x', href: 'https://x/' }, document: {}, localStorage: { getItem: () => null, setItem() {} } };
win.window = win;
try { vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'adapters/_core.js'), 'utf8'), win); } catch (e) { /* core may touch DOM at load; the helpers are defined first */ }
const S = win.SAYDA || win.window.SAYDA;
ok(S && typeof S.modelOf === 'function', 'SAYDA.modelOf exists');
if (S && S.modelOf) {
  ok(S.modelOf('RT58K7050SLB') === 'RT58K7050SLB', 'Extra mpn kept');
  ok(S.modelOf('MF0J4AF/A') === 'MF0J4AF/A', 'noon model with a slash kept');
  ok(S.modelOf('‎21HM002DUS‏') === '21HM002DUS', 'Amazon model with direction marks cleaned');
  ok(S.modelOf('12345678') === null, 'digits only (a SKU) refused');
  ok(S.modelOf('Samsung') === null, 'a word refused');
  ok(S.modelOf('') === null && S.modelOf(null) === null, 'empty refused');
  ok(S.modelOf('A1') === null, 'too short refused');
  ok(S.modelOf('x'.repeat(30) + '1'.repeat(15)) === null, 'too long refused');
  ok(S.gtinOf('8806090574325') === '8806090574325', 'EAN-13 kept');
  ok(S.gtinOf('88060') === null && S.gtinOf('abc') === null, 'bad barcode refused');
}

// ── 2. the Extra page read ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, 'adapters/extra.js'), 'utf8');
  ok(/"mpn"/.test(src) && /"gtin13"/.test(src) && /S\.modelOf\(mpn\)/.test(src), 'extra.js reads mpn and gtin13');
  const ssr = '{\\"@type\\":\\"Product\\",\\"mpn\\":\\"RT58K7050SLB\\",\\"gtin13\\":\\"8806090574325\\",\\"sku\\":\\"100054437\\"}';
  const t = ssr.replace(/\\"/g, '"');
  ok((t.match(/"mpn"\s*:\s*"([^"]{2,40})"/) || [])[1] === 'RT58K7050SLB', 'mpn found in escaped SSR text');
  ok((t.match(/"gtin13"\s*:\s*"(\d{8,14})"/) || [])[1] === '8806090574325', 'gtin13 found in escaped SSR text');
  ok(/model_number/.test(fs.readFileSync(path.join(ROOT, 'adapters/noon.js'), 'utf8')), 'noon.js reads model_number');
  ok(/رقم موديل السلعة/.test(fs.readFileSync(path.join(ROOT, 'adapters/amazon.js'), 'utf8')), 'amazon.js reads the item model number');
}

// ── 3 to 5 run in a scratch copy ───────────────────────────────────────────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sayda-untracked-'));
for (const d of ['config', 'rules', 'lib', 'scripts', 'template', 'adapters']) fs.cpSync(path.join(ROOT, d), path.join(TMP, d), { recursive: true });
for (const f of ['apply.js', 'build.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.cpSync(path.join(ROOT, 'data/state'), path.join(TMP, 'data/state'), { recursive: true });
const run = (args, opts = {}) => { try { return cp.execFileSync('node', args, { cwd: TMP, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }); } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } };
const shard = id => JSON.parse(fs.readFileSync(path.join(TMP, `data/state/${id}.json`), 'utf8'));
const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const base = { store: 'extra', verdict: 'na', ref: null, was: null, price: 1999, avail: 'in', cat: 'إلكترونيات', untracked: true,
  name: 'سامسونج ثلاجه 15 قدم، انفيرتر، استيل', name_en: 'Samsung Refrigerator 15 cu ft, Inverter, Steel', brand: 'samsung' };
const rows = [
  { ...base, id: 'extra:900000001', url: 'https://www.extra.com/ar-sa/p/900000001', model: 'RT58K7050SLB' },   // will match
  { ...base, id: 'extra:900000002', url: 'https://www.extra.com/ar-sa/p/900000002', model: 'RT38K5000S8' },    // nothing comparable
  { ...base, id: 'extra:900000003', url: 'https://www.extra.com/ar-sa/p/900000003' },                          // no model: refused
];
fs.mkdirSync(path.join(TMP, 'work/check'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'work/new.json'), JSON.stringify(rows));
run(['apply.js', 'new', 'work/new.json']);
let ex = shard('extra').rows;
ok(ex.some(r => r.id === 'extra:900000001' && r.untracked && r.needsCheck), 'untracked row with a model is added, needs its check');
ok(!ex.some(r => r.id === 'extra:900000003'), 'untracked row without a model is not added');
// the store's own check has seen both: clear needsCheck as apply.js check would
for (const r of ex) if (r.untracked) delete r.needsCheck;
const sh = shard('extra'); sh.rows = ex; fs.writeFileSync(path.join(TMP, 'data/state/extra.json'), JSON.stringify(sh));

// 4. build keeps them off both pages
{
  const out = run(['build.js']);
  ok(/held back 2 untracked rows awaiting a market comparison/.test(out), 'build names the held-back untracked rows');
  const ar = fs.readFileSync(path.join(TMP, 'dist/index.html'), 'utf8'), en = fs.readFileSync(path.join(TMP, 'dist/en/index.html'), 'utf8');
  ok(!ar.includes('900000001') && !en.includes('900000001'), 'untracked row is on neither page');
}

// 5. market-apply
{
  const plan = run(['scripts/market-apply.js', '--plan']);
  ok(/untracked rows \(BLD-36\): 2/.test(plan), 'the plan lists the untracked rows');
  const jobs = JSON.parse(fs.readFileSync(path.join(TMP, 'work/market/extra.jobs.json'), 'utf8'));
  const j1 = jobs.find(j => j.id === 'extra:900000001');
  ok(j1 && /RT58K7050SLB/.test(j1.q) && /samsung/i.test(j1.q), 'the query is brand plus the maker\'s model number');
  const sweep = [
    { id: 'extra:900000001', q: j1 ? j1.q : '', listings: [
      { title: 'Samsung RT58K7050SLB Refrigerator 15 cu ft Inverter Steel', price: 2299, merchant: 'Jarir', country: 'sa',
        url: 'https://kanbkam.com/sa/en/x', own: 'https://www.jarir.com/sa-en/samsung-refrigerator-rt58k7050slb-123456.html' } ] },
    { id: 'extra:900000002', q: 'samsung RT38K5000S8', listings: [
      { title: 'Samsung RT38K5000S8 cover only', price: 99, merchant: 'noon', country: 'sa', url: 'https://www.noon.com/saudi-en/x/p/' } ] },
  ];
  fs.writeFileSync(path.join(TMP, 'work/market/extra.json'), JSON.stringify(sweep));
  const shadow = run(['scripts/market-apply.js', 'work/market/extra.json']);
  ok(/would be removed with --apply: extra:900000002/.test(shadow), 'shadow names the row it would remove');
  ok(shard('extra').rows.some(r => r.id === 'extra:900000002'), 'shadow removes nothing');
  run(['scripts/market-apply.js', 'work/market/extra.json', '--apply']);
  ex = shard('extra').rows;
  const r1 = ex.find(r => r.id === 'extra:900000001');
  ok(r1 && !r1.untracked && r1.refKind === 'market', 'a match makes it an ordinary market row');
  ok(r1 && r1.refUrl === 'https://www.jarir.com/sa-en/samsung-refrigerator-rt58k7050slb-123456.html' && r1.refStore === 'jarir', 'refUrl is the other store\'s own page');
  ok(r1 && r1.verdict !== 'na' && r1.ref != null, 'the verdict and ref came from rules/verdict.js');
  ok(!ex.some(r => r.id === 'extra:900000002'), 'no comparator: --apply removes the untracked row');
  ok(ex.filter(r => !String(r.id).startsWith('extra:9000000')).length === JSON.parse(fs.readFileSync(path.join(ROOT, 'data/state/extra.json'), 'utf8')).rows.length, 'tracked Extra rows are untouched');
  // 3b. the removed row is not added again while its comparison is recent
  run(['apply.js', 'new', 'work/new.json']);
  ok(!shard('extra').rows.some(r => r.id === 'extra:900000002'), 'a recently compared, unverified row is not added again');
  const rb = run(['build.js']);
  ok(!/untracked rows awaiting/.test(rb), 'after the comparison nothing is held back');
  const ar = fs.readFileSync(path.join(TMP, 'dist/index.html'), 'utf8');
  ok(ar.includes('900000001'), 'the verified row is on the page');
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`untracked: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
