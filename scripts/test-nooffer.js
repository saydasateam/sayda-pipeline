#!/usr/bin/env node
// test-nooffer.js — the «no offer» travel and car cards print the day the company was checked, never today (BLD-33).
//
// Why: until 23 Nov 2026 both pages printed «فُحص <today>» / «checked <today>» on every no-offer card, worked out in the
// visitor's browser, so a company nobody had read for days still looked checked that morning. Now each entry in
// travelNone / carsNone carries `checked` (RUNBOOK §3, §3a) and build.js passes it to the card.
//
// What it does, offline and without touching data/:
//   1. copies the repo (no .git, no dist) into a temp folder and writes a small _travel.json and _cars.json there
//   2. runs build.js and reads the no-offer data each page received
//   3. checks: a valid date passes through; a missing, malformed or future date becomes ''; a travel entry with no date
//      takes its company's source-read day from `scanned` only when exactly one source host matches; cars never do
//   4. checks the templates no longer print today's date on a no-offer card
//
//   node scripts/test-nooffer.js          # exit 1 on any failure
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (why, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${why}${detail !== undefined ? '\n      ' + String(detail).slice(0, 400) : ''}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sayda-nooffer-'));
fs.cpSync(ROOT, tmp, { recursive: true, filter: s => !/[\\/](\.git|dist|node_modules)([\\/]|$)/.test(path.relative(ROOT, s) ? '/' + path.relative(ROOT, s) : '') });
const W = (f, o) => fs.writeFileSync(path.join(tmp, f), JSON.stringify(o, null, 1));
const future = new Date(Date.now() + 3 * 3600e3 + 5 * 864e5).toISOString().slice(0, 10);
W('data/state/_travel.json', {
  travel: [], travelNone_text: '', travelNone_text_en: '',
  travelNone: [
    { company: 'أ', type: 'طيران', company_en: 'Dated Air', type_en: 'Airline', checked: '2026-11-20' },
    { company: 'ب', type: 'طيران', company_en: 'flynas', type_en: 'Airline' },                       // falls back to scanned
    { company: 'ج', type: 'طيران', company_en: 'Future Air', type_en: 'Airline', checked: future },
    { company: 'د', type: 'طيران', company_en: 'Bad Air', type_en: 'Airline', checked: '20 Nov' },
    { company: 'ه', type: 'منصة', company_en: 'Twin', type_en: 'Platform' },                         // two hosts match: no date
    { company: 'و', type: 'منصة', company_en: 'Nobody Travel', type_en: 'Platform' },
  ],
  scanned: { 'https://www.flynas.com/ar': '2026-11-22', 'https://twin.com/a': '2026-11-21', 'https://www.twin.sa/b': '2026-11-21' },
});
W('data/state/_cars.json', { cars: [], carsNone: [
  { company: 'ز', type: 'وكيل', company_en: 'Dated Dealer', type_en: 'Dealer', checked: '2026-11-19' },
  { company: 'ح', type: 'وكيل', company_en: 'flynas', type_en: 'Dealer' },                            // cars never fall back
], scanned: {} });

const r = spawnSync(process.execPath, ['build.js'], { cwd: tmp, encoding: 'utf8' });
ok('build.js runs', r.status === 0, (r.stderr || '') + (r.stdout || '').slice(-400));
const out = r.stdout || '';
ok('build prints the no-offer line', /no-offer cards: 3 of 8 carry their check date · no date printed for /.test(out), out.split('\n').find(l => l.startsWith('no-offer')));
const ar = fs.readFileSync(path.join(tmp, 'dist/index.html'), 'utf8'), en = fs.readFileSync(path.join(tmp, 'dist/en/index.html'), 'utf8');
const grab = (html, re) => { const m = html.match(re); try { return m ? JSON.parse(m[1]) : null; } catch (_) { return null; } };
const TNO = grab(ar, /const TNO=(\[.*?\]\]|\[\]);/), CRNO = grab(ar, /const CRNO=(\[.*?\]\]|\[\]);/);
const TRNO = grab(en, /TRNO=(\[.*?\]\]|\[\]),/), CRNOEN = grab(en, /CRNO=(\[.*?\]\]|\[\]),/);
ok('Arabic page received the travel no-offer list', Array.isArray(TNO) && TNO.length === 6, JSON.stringify(TNO));
ok('Arabic page received the car no-offer list', Array.isArray(CRNO) && CRNO.length === 2, JSON.stringify(CRNO));
ok('English page received both lists', Array.isArray(TRNO) && TRNO.length === 6 && Array.isArray(CRNOEN) && CRNOEN.length === 2);
if (TNO && TRNO && CRNO && CRNOEN) {
  const want = ['2026-11-20', '2026-11-22', '', '', '', ''];
  want.forEach((d, i) => { ok(`travel entry ${i + 1}: Arabic date «${d}»`, TNO[i][2] === d, TNO[i][2]); ok(`travel entry ${i + 1}: English date «${d}»`, TRNO[i][2] === d, TRNO[i][2]); });
  ok('car entry with a date keeps it, both pages', CRNO[0][2] === '2026-11-19' && CRNOEN[0][2] === '2026-11-19');
  ok('car entry with no date gets none, even when a travel host would match', CRNO[1][2] === '' && CRNOEN[1][2] === '');
}
const tAr = fs.readFileSync(path.join(ROOT, 'template/index.html'), 'utf8'), tEn = fs.readFileSync(path.join(ROOT, 'template/en.html'), 'utf8');
const arNone = tAr.split('\n').filter(l => l.includes('tcard nooffer') && l.includes('لا يوجد عرض'));
ok('Arabic template: two no-offer card lines', arNone.length === 2, arNone.length);
ok('Arabic no-offer cards print the stored day, not today', arNone.every(l => !/arD\(now\)/.test(l) && /\[2\]\?' · فُحص '\+arD\(\w\[2\]\):''/.test(l)), arNone.join('\n'));
const enNone = tEn.split('\n').filter(l => l.includes('const none='));
ok('English no-offer card prints the stored day, not today', enNone.length === 1 && !/enD\(today\)/.test(enNone[0]) && /o\[2\]\?' · checked '\+enD\(o\[2\]\):''/.test(enNone[0]), enNone[0]);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nno-offer dates: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
