#!/usr/bin/env node
// test-guards.js — BLD-37: the state and freshness guards (Codex audit of 22 Nov 2026, findings 03, 04, 05 and 07).
//
//   node scripts/test-guards.js
//
// Runs in a scratch copy of the repo (os.tmpdir), so nothing here touches data/state. It checks:
//   07  a state file that is there but damaged stops the build or the check and names the file; a missing one does not;
//   05  a failed check (an error object, or a file that is not JSON) leaves the store as it was; a check that read
//       under half of a store's rows keeps the store's «last checked» time (Mahmoud's rule D39); half or more moves it;
//   04  a store id that is not in config/stores.json never becomes a file: not from a check file, a new row, or saveStores;
//   03  a buy link must be on its own store's site: lib/safe.js onStoreSite, apply.js refuses it, build.js holds it back.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL ' + msg); } };

// ── 03: onStoreSite ────────────────────────────────────────────────────────────────────────────────────────────────────────
const { onStoreSite } = require('../lib/safe');
ok(onStoreSite('https://www.noon.com/saudi-ar/x/p/', 'https://www.noon.com'), 'noon link on noon');
ok(onStoreSite('https://noon.com/x', 'https://www.noon.com'), 'bare host accepted for a www origin');
ok(onStoreSite('https://m.noon.com/x', 'https://www.noon.com'), 'subdomain accepted');
ok(onStoreSite('https://dabdoob.com/ar/x', 'https://dabdoob.com'), 'origin without www');
ok(!onStoreSite('https://www.amazon.sa/dp/B0', 'https://www.noon.com'), 'another store refused');
ok(!onStoreSite('https://noon.com.evil.sa/x', 'https://www.noon.com'), 'look-alike suffix refused');
ok(!onStoreSite('https://evilnoon.com/x', 'https://www.noon.com'), 'look-alike prefix refused');
ok(!onStoreSite('not a url', 'https://www.noon.com') && !onStoreSite('https://www.noon.com/x', undefined), 'bad link or no origin refused');

// ── scratch copy ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sayda-guards-'));
for (const d of ['config', 'rules', 'lib', 'scripts', 'template', 'adapters']) fs.cpSync(path.join(ROOT, d), path.join(TMP, d), { recursive: true });
for (const f of ['apply.js', 'build.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
fs.cpSync(path.join(ROOT, 'data/state'), path.join(TMP, 'data/state'), { recursive: true });
const ST = f => path.join(TMP, 'data/state', f);
const run = (args) => { const r = cp.spawnSync(process.execPath, args, { cwd: TMP, encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const save = f => fs.readFileSync(ST(f));
const put = (f, buf) => fs.writeFileSync(ST(f), buf);
const S = require(path.join(TMP, 'lib/state'));

// ── 07: readState ─────────────────────────────────────────────────────────────────────────────────────────────────────────
ok(S.readState(ST('_nosuch.json'), 'fb') === 'fb', 'missing file gives the fallback');
{
  const p = path.join(TMP, 'x.json');
  fs.writeFileSync(p, '{"rows": [1,'); let e = null; try { S.readState(p, {}); } catch (x) { e = x; } ok(e && /not valid JSON/.test(e.message), 'cut-short file throws');
  fs.writeFileSync(p, '[1,2]'); e = null; try { S.readState(p, {}); } catch (x) { e = x; } ok(e && /JSON object/.test(e.message), 'a list instead of an object throws');
  fs.writeFileSync(p, '{"rows": {"a": 1}}'); e = null; try { S.readState(p, {}); } catch (x) { e = x; } ok(e && /«rows»/.test(e.message), 'rows that is not a list throws');
}

// ── 07: the build stops on a damaged shard or shared file, and names it ───────────────────────────────────────────────────
{
  const base = run(['build.js']);
  ok(base.code === 0, 'scratch build works before any damage: ' + base.out.split('\n').slice(-3).join(' | '));
  const rowsLine = (base.out.match(/rows (\d+) \(/) || [])[1];

  const noon = save('noon.json');
  put('noon.json', noon.slice(0, Math.floor(noon.length / 2)));
  fs.rmSync(path.join(TMP, 'dist'), { recursive: true, force: true });
  let r = run(['build.js']);
  ok(r.code !== 0 && /data\/state\/noon\.json/.test(r.out) && /not valid JSON/.test(r.out), 'cut-short noon shard stops the build and names it');
  ok(!fs.existsSync(path.join(TMP, 'dist/index.html')) && !fs.existsSync(path.join(TMP, 'dist/en/index.html')), 'no page written when a shard is damaged');
  r = run(['scripts/replay.js']);
  ok(r.code !== 0 && /noon\.json/.test(r.out), 'replay also stops on the damaged shard instead of agreeing with fewer rows');
  put('noon.json', noon);

  const cps = save('_coupons.json');
  put('_coupons.json', cps.slice(0, 40));
  r = run(['build.js']);
  ok(r.code !== 0 && /_coupons\.json/.test(r.out), 'cut-short _coupons.json stops the build and names it');
  put('_coupons.json', cps);

  const subs = fs.existsSync(ST('_subs.json')) ? save('_subs.json') : null;
  if (subs) fs.rmSync(ST('_subs.json'));
  r = run(['build.js']);
  ok(r.code === 0 && (r.out.match(/rows (\d+) \(/) || [])[1] === rowsLine, 'a missing shared file still builds, same rows');
  if (subs) put('_subs.json', subs);
}

// ── 05: a failed or thin check does not move a store's clock ──────────────────────────────────────────────────────────────
const W = path.join(TMP, 'work/check');
const resetWork = () => { fs.rmSync(path.join(TMP, 'work'), { recursive: true, force: true }); fs.mkdirSync(W, { recursive: true }); };
const report = () => JSON.parse(fs.readFileSync(path.join(TMP, 'work/report.json'), 'utf8'));
const STORE = 'aldawaa';
const shard0 = save(STORE + '.json'), hist0 = save(STORE + '.history.json');
const rows = JSON.parse(shard0).rows, at0 = JSON.parse(shard0).checkedAt;
const obsFor = list => list.map(x => ({ id: x.id, found: true, live: x.price, buyable: true }));
const restore = () => { put(STORE + '.json', shard0); put(STORE + '.history.json', hist0); };
{
  resetWork(); fs.writeFileSync(path.join(W, STORE + '.json'), JSON.stringify({ error: 'Access Denied' }));
  let r = run(['apply.js', 'check']);
  ok(r.code === 0, 'error object: apply.js still finishes');
  ok(save(STORE + '.json').equals(shard0) && save(STORE + '.history.json').equals(hist0), 'error object: shard and history left byte for byte');
  ok(report().failedCheck.some(([id]) => id === STORE) && !report().upload.some(u => u.includes(STORE)), 'error object: named as a failed check, nothing to upload');

  resetWork(); fs.writeFileSync(path.join(W, STORE + '.json'), '{"oops":');
  r = run(['apply.js', 'check']);
  ok(r.code === 0 && save(STORE + '.json').equals(shard0) && report().failedCheck.some(([id, why]) => id === STORE && /JSON/.test(why)), 'check file that is not JSON: store left as it was');

  resetWork(); fs.writeFileSync(path.join(W, STORE + '.json'), '[]');
  r = run(['apply.js', 'check']);
  ok(JSON.parse(save(STORE + '.json')).checkedAt === at0, 'empty list: clock kept');
  ok(report().clockHeld.some(([id, k, n]) => id === STORE && k === 0 && n === rows.length), 'empty list: named with 0 of n');
  ok(/last-checked time kept/.test(r.out), 'empty list: said on the console');
  ok(report().recheck.length === 0, 'empty list: not taken for a recheck');
  restore();

  const half = Math.ceil(rows.length / 2), under = half - 1;
  // the committed rows may already carry today's lastChecked (a run earlier today), so date them back first
  { const s = JSON.parse(shard0); s.rows.forEach(x => { x.lastChecked = '2000-01-01'; }); put(STORE + '.json', JSON.stringify(s)); }
  resetWork(); fs.writeFileSync(path.join(W, STORE + '.json'), JSON.stringify(obsFor(rows.slice(0, under))));
  run(['apply.js', 'check']);
  const afterUnder = JSON.parse(save(STORE + '.json'));
  ok(afterUnder.checkedAt === at0, `${under} of ${rows.length} read: clock kept`);
  ok(afterUnder.rows.filter(x => x.lastChecked === report().date).length === under, `${under} of ${rows.length} read: those rows are still updated`);
  restore();

  resetWork(); fs.writeFileSync(path.join(W, STORE + '.json'), JSON.stringify(obsFor(rows.slice(0, half))));
  run(['apply.js', 'check']);
  const afterHalf = JSON.parse(save(STORE + '.json'));
  ok(afterHalf.checkedAt !== at0 && report().clockHeld.length === 0, `${half} of ${rows.length} read: clock moves`);
  restore();

  resetWork(); fs.writeFileSync(path.join(W, STORE + '.json'), JSON.stringify(obsFor(rows)));
  run(['apply.js', 'check']);
  ok(JSON.parse(save(STORE + '.json')).checkedAt !== at0, 'all rows read: clock moves');
  restore();

  // a history shard that is damaged stops the check before anything is written
  resetWork(); fs.writeFileSync(path.join(W, STORE + '.json'), JSON.stringify(obsFor(rows)));
  put(STORE + '.history.json', hist0.slice(0, 20));
  r = run(['apply.js', 'check']);
  ok(r.code !== 0 && /aldawaa\.history\.json/.test(r.out) && save(STORE + '.json').equals(shard0), 'damaged history shard: check stops, names it, writes nothing');
  restore();
}

// ── 05 and RUNBOOK §2b: full check, new rows, then the recheck of the new rows only ──────────────────────────────────────
// The sequence of every run that adds rows (Finding 24 Nov 2026 0315 Riyadh reproduced «noon 7 of 277» on it).
{
  const NOON = 'noon';
  const noon0 = save(NOON + '.json'), nhist0 = save(NOON + '.history.json');
  const nrows = JSON.parse(noon0).rows;
  const noonRestore = () => { put(NOON + '.json', noon0); put(NOON + '.history.json', nhist0); };
  // 1. full check of noon and aldawaa: both clocks move, nothing held
  resetWork();
  fs.writeFileSync(path.join(W, NOON + '.json'), JSON.stringify(obsFor(nrows)));
  fs.writeFileSync(path.join(W, STORE + '.json'), JSON.stringify(obsFor(rows)));
  let r = run(['apply.js', 'check']);
  const at1 = JSON.parse(save(NOON + '.json')).checkedAt;
  ok(r.code === 0 && at1 !== JSON.parse(noon0).checkedAt && report().clockHeld.length === 0 && report().recheck.length === 0, '§2b step 1: full check moves the clock, nothing held');
  // 2. seven new noon rows
  const add = path.join(TMP, 'work/new.json');
  const mk = i => ({ id: `noon:RECHK${i}`, store: NOON, name: 'اختبار ' + i, name_en: 'Test ' + i, price: 100 + i, was: 150 + i, ref: null, verdict: 'na', finding: 'x', url: `https://www.noon.com/saudi-ar/recheck-${i}/p/`, cat: 'إلكترونيات' });
  const seven = [1, 2, 3, 4, 5, 6, 7].map(mk);
  fs.writeFileSync(add, JSON.stringify(seven));
  r = run(['apply.js', 'new', add]);
  const afterNew = JSON.parse(save(NOON + '.json'));
  ok(r.code === 0 && seven.every(x => afterNew.rows.some(y => y.id === x.id && y.needsCheck)), '§2b step 2: seven new noon rows added, all needsCheck');
  // 3. the recheck file holds only those seven rows (what `inject.js noon recheck` writes)
  fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(W, { recursive: true });
  fs.writeFileSync(path.join(W, NOON + '.json'), JSON.stringify(obsFor(seven)));
  r = run(['apply.js', 'check']);
  const afterRe = JSON.parse(save(NOON + '.json'));
  ok(r.code === 0 && report().clockHeld.length === 0, '§2b step 3: recheck is not a kept clock (no «noon 7 of n»)');
  ok(!/last-checked time kept/.test(r.out), '§2b step 3: no false alarm on the console');
  ok(report().recheck.some(([id, k, n]) => id === NOON && k === 7 && n === 7), '§2b step 3: listed as a recheck, 7 of 7 new rows read');
  ok(/recheck of new rows only/.test(r.out), '§2b step 3: said as a recheck on the console');
  ok(afterRe.checkedAt === at1, '§2b step 3: the clock stays at the full check\'s time');
  ok(seven.every(x => afterRe.rows.some(y => y.id === x.id && !y.needsCheck && y.lastChecked === report().date)), '§2b step 3: the new rows are confirmed and lose needsCheck');
  ok(report().upload.includes('data/state/noon.json'), '§2b step 3: noon shard is in the upload list');
  // 4. a recheck after a full check that was HELD keeps the held clock: a recheck never moves it
  noonRestore(); restore();
  resetWork();
  fs.writeFileSync(path.join(W, NOON + '.json'), '[]');
  run(['apply.js', 'check']);
  ok(JSON.parse(save(NOON + '.json')).checkedAt === JSON.parse(noon0).checkedAt && report().clockHeld.some(([id]) => id === NOON), '§2b held: an empty noon check keeps the old clock and is named');
  fs.writeFileSync(add, JSON.stringify(seven)); run(['apply.js', 'new', add]);
  fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(W, { recursive: true });
  fs.writeFileSync(path.join(W, NOON + '.json'), JSON.stringify(obsFor(seven)));
  run(['apply.js', 'check']);
  ok(JSON.parse(save(NOON + '.json')).checkedAt === JSON.parse(noon0).checkedAt, '§2b held: the recheck after it does not make noon look fresh');
  // 5. a check file that names one old row with the new ones is a store check again, and the half rule applies
  fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(W, { recursive: true });
  const stillNew = JSON.parse(save(NOON + '.json')).rows.filter(x => x.needsCheck);
  fs.writeFileSync(add, JSON.stringify([8, 9].map(mk))); run(['apply.js', 'new', add]);
  fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(W, { recursive: true });
  fs.writeFileSync(path.join(W, NOON + '.json'), JSON.stringify(obsFor([...[8, 9].map(mk), nrows[0]])));
  run(['apply.js', 'check']);
  ok(stillNew.length === 0 && report().recheck.length === 0 && report().clockHeld.some(([id]) => id === NOON), '§2b mixed: new rows plus an old row is a thin store check, clock kept and named');
  noonRestore(); restore();
}

// ── 04: a store id that is not configured never becomes a file ───────────────────────────────────────────────────────────
{
  const rulesBefore = fs.readFileSync(path.join(TMP, 'config/rules.json'));
  resetWork(); fs.writeFileSync(path.join(W, 'nosuchstore.json'), JSON.stringify([{ id: 'nosuchstore:1', found: true, live: 1, buyable: true }]));
  let r = run(['apply.js', 'check']);
  ok(r.code === 0 && !fs.existsSync(ST('nosuchstore.json')) && report().unknownStore.includes('nosuchstore'), 'check file for an unknown store: no shard created, named');

  const newRow = (id, store, url) => ({ id, store, name: 'اختبار', name_en: 'Test', price: 100, was: 150, ref: null, verdict: 'na', finding: 'x', url, cat: 'إلكترونيات' });
  resetWork();
  const add = path.join(TMP, 'work/new.json');
  fs.writeFileSync(add, JSON.stringify([
    newRow('x:1', '../../config/rules', 'https://www.noon.com/a'),
    newRow('x:2', 'nosuchstore', 'https://www.noon.com/b'),
    newRow('noon:GUARD1', 'noon', 'https://www.amazon.sa/dp/B0GUARD'),
    newRow('noon:GUARD2', 'noon', 'https://www.noon.com/saudi-ar/guard/p/'),
  ]));
  r = run(['apply.js', 'new', add]);
  ok(r.code === 0, 'apply.js new finishes: ' + r.out.split('\n').slice(-2).join(' | '));
  ok(fs.readFileSync(path.join(TMP, 'config/rules.json')).equals(rulesBefore), 'store «../../config/rules» did not overwrite config/rules.json');
  ok(!fs.existsSync(ST('nosuchstore.json')), 'store «nosuchstore» created no shard');
  ok(report().unknownStore.length === 2, 'both unknown stores named');
  ok(!report().upload.some(u => /\.\.|nosuchstore|config/.test(u)), 'upload list holds no path outside data/state');
  ok(report().badLinks.some(([id, f]) => id === 'noon:GUARD1' && /store's site/.test(f)), 'noon row linking to Amazon refused');
  ok(report().added.includes('noon:GUARD2') && !report().added.includes('noon:GUARD1'), 'noon row linking to noon added, the other not');

  let e = null; try { S.saveStores(TMP, { '../../config/rules': [] }, { updated: 'x' }); } catch (x) { e = x; }
  ok(e && /not a store in config\/stores\.json/.test(e.message), 'saveStores refuses an unknown id');
  ok(fs.readFileSync(path.join(TMP, 'config/rules.json')).equals(rulesBefore), 'config/rules.json still unchanged');
}

// ── 04 in the history writer (BLD-43): lib/history.js save writes only configured stores ────────────────────────────────
{
  const Hs = require(path.join(TMP, 'lib/history'));
  const rulesBefore = fs.readFileSync(path.join(TMP, 'config/rules.json'));
  const h = { 'noon:BLD43': [['2026-11-24', 10, '2026-11-24']], '../../config/rules:x': [['2026-11-24', 1, '2026-11-24']], 'nosuchstore:1': [['2026-11-24', 1, '2026-11-24']] };
  const wrote = Hs.save(TMP, h);
  ok(wrote.length === 1 && wrote[0] === 'noon', 'history save returns only the configured store');
  ok(fs.readFileSync(path.join(TMP, 'config/rules.json')).equals(rulesBefore), 'history save: «../../config/rules» did not overwrite config/rules.json');
  ok(!fs.existsSync(ST('nosuchstore.history.json')), 'history save: no shard for an unknown store');
  ok(JSON.parse(save('noon.history.json'))['noon:BLD43'], 'history save: the configured store\'s shard is written');
}

// ── 03: the build holds back a row whose link is on another site ─────────────────────────────────────────────────────────
{
  const noon = JSON.parse(save('noon.json'));
  const victim = noon.rows.find(r => r.verdict === 'ok' && !r.needsCheck && !r.untracked && r.name && r.name_en);
  const was = victim.url; victim.url = 'https://www.amazon.sa/dp/B0OFFSITE';
  put('noon.json', JSON.stringify(noon));
  const r = run(['build.js']);
  const page = fs.readFileSync(path.join(TMP, 'dist/index.html'), 'utf8'), en = fs.readFileSync(path.join(TMP, 'dist/en/index.html'), 'utf8');
  ok(r.code === 0 && /held back 1 rows whose link is not on their store's own site: noon 1/.test(r.out), 'build names the off-site row');
  ok(!page.includes('B0OFFSITE') && !en.includes('B0OFFSITE'), 'off-site link on neither page');
  victim.url = was;
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`guards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
