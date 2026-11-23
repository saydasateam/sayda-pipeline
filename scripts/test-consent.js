#!/usr/bin/env node
// test-consent.js — Google Tag Manager loads only after the visitor's OK on the measurement bar (BLD-24).
//
// Why: from 22 Nov 2026 both pages loaded Tag Manager for every visitor. The PDPL research of that evening («Finding
// 22 Nov 2026 2005 Riyadh») found consent the safe basis for analytics cookies and a must for advertising, and Mahmoud
// approved a consent banner with Consent Mode. This test keeps it that way: no request to Google before an OK, every
// advertising signal denied, the choice stored and changeable, and no click queued before an OK.
//
// What it does, offline and without touching data/:
//   1. builds both pages in a temp copy with a container id set, and once with none
//   2. runs the page's head script in a stand-in for the browser (no network) for: no stored choice, an OK, a stored
//      «yes», a stored «no», and a withdrawal; and checks the Consent Mode calls and whether gtm.js is requested
//   3. checks the bar, its two buttons, the «change your choice» button and the gated click events on both pages
//
//   node scripts/test-consent.js          # exit 1 on any failure
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (why, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${why}${detail !== undefined ? '\n      ' + String(detail).slice(0, 400) : ''}`); } };

const build = gtmId => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sayda-consent-'));
  fs.cpSync(ROOT, tmp, { recursive: true, filter: s => !/[\\/](\.git|dist|node_modules)([\\/]|$)/.test('/' + path.relative(ROOT, s)) });
  const site = JSON.parse(fs.readFileSync(path.join(tmp, 'config/site.json'), 'utf8'));
  fs.writeFileSync(path.join(tmp, 'config/site.json'), JSON.stringify({ ...site, gtmId }, null, 1));
  const r = spawnSync(process.execPath, ['build.js'], { cwd: tmp, encoding: 'utf8' });
  const read = f => { try { return fs.readFileSync(path.join(tmp, f), 'utf8'); } catch (_) { return ''; } };
  const out = { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', ar: read('dist/index.html'), en: read('dist/en/index.html') };
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
};

const on = build('GTM-TEST123');
ok('build with a container id runs', on.status === 0, on.stderr + on.stdout.slice(-300));
ok('build says Tag Manager waits for the OK', /measurement: Google Tag Manager GTM-TEST123 on both pages, loaded only after the visitor's OK/.test(on.stdout));

// ── the head script, run in a stand-in browser ──
const headOf = html => { const m = html.match(/<head>[\s\S]*?<script>([\s\S]*?)<\/script>/); return m ? m[1] : ''; };
const sim = (code, stored) => {
  const store = new Map(stored == null ? [] : [['sayda.consent', stored]]), added = [];
  const w = { localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) } };
  const d = { createElement: () => ({}), head: { appendChild: el => added.push(el.src) } };
  w.window = w; vm.runInNewContext(code, { window: w, document: d, Date });
  const calls = () => (w.dataLayer || []).map(x => (x && typeof x.length === 'number' && !Array.isArray(x)) ? Array.from(x) : x);
  return { w, added, store, calls };
};
for (const [lang, html] of [['Arabic', on.ar], ['English', on.en]]) {
  const code = headOf(html);
  ok(`${lang}: the head script is the consent loader`, /saydaConsent/.test(code) && /'consent','default'/.test(code), code.slice(0, 200));
  ok(`${lang}: no Tag Manager address outside the loader, and no no-JavaScript iframe`, (html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '').match(/googletagmanager\.com/g) || []).length === 1 && !/ns\.html/.test(html));
  if (!code) continue;
  const a = sim(code, null), def = a.calls().find(c => Array.isArray(c) && c[0] === 'consent' && c[1] === 'default');
  ok(`${lang}: no stored choice → nothing requested from Google`, a.added.length === 0 && !a.w.saydaMeasuring(), a.added.join(' '));
  ok(`${lang}: Consent Mode default denies analytics and every advertising signal`, def && def[2].analytics_storage === 'denied' && def[2].ad_storage === 'denied' && def[2].ad_user_data === 'denied' && def[2].ad_personalization === 'denied', JSON.stringify(def));
  a.w.saydaConsent('yes');
  const upd = a.calls().filter(c => Array.isArray(c) && c[1] === 'update').pop();
  ok(`${lang}: OK → choice stored, analytics granted, gtm.js requested once`, a.store.get('sayda.consent') === 'yes' && upd && upd[2].analytics_storage === 'granted' && !('ad_storage' in upd[2]) && a.added.length === 1 && a.added[0] === 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST123' && a.w.saydaMeasuring(), JSON.stringify([upd, a.added]));
  a.w.saydaConsent('yes');
  ok(`${lang}: a second OK does not load it again`, a.added.length === 1);
  a.w.saydaConsent('no');
  const wd = a.calls().filter(c => Array.isArray(c) && c[1] === 'update').pop();
  ok(`${lang}: withdrawing → stored «no», analytics denied, page events stop`, a.store.get('sayda.consent') === 'no' && wd[2].analytics_storage === 'denied' && !a.w.saydaMeasuring());
  const y = sim(code, 'yes'), yd = y.calls().find(c => Array.isArray(c) && c[1] === 'default');
  ok(`${lang}: a stored «yes» → granted from the start and loaded`, yd && yd[2].analytics_storage === 'granted' && yd[2].ad_storage === 'denied' && y.added.length === 1 && y.w.saydaMeasuring());
  const n = sim(code, 'no');
  ok(`${lang}: a stored «no» → nothing loaded`, n.added.length === 0 && !n.w.saydaMeasuring());
  const junk = sim(code, '<script>');
  ok(`${lang}: anything else stored counts as no choice`, junk.added.length === 0);
  junk.w.saydaConsent('maybe');
  ok(`${lang}: a value other than «yes» is recorded as «no»`, junk.store.get('sayda.consent') === 'no' && junk.added.length === 0);
}

// ── the bar and the page's script ──
for (const [lang, html] of [['Arabic', on.ar], ['English', on.en]]) {
  const bar = (html.match(/<aside class="cbar" id="cbar"[^>]*>[\s\S]*?<\/aside>/) || [''])[0];
  ok(`${lang}: the bar is on the page, hidden until the script shows it`, / hidden>/.test(bar.slice(0, 160)), bar.slice(0, 160));
  ok(`${lang}: the bar has exactly an OK and a no button`, (bar.match(/data-cv="yes"/g) || []).length === 1 && (bar.match(/data-cv="no"/g) || []).length === 1);
  ok(`${lang}: the bar names Google Analytics, cookies and Google`, /Google Analytics/.test(bar) && /(cookies|ملفات تعريف ارتباط)/.test(bar));
  ok(`${lang}: About has the «change your choice» button`, /<button type="button" class="clink" data-consent-open>/.test(html));
  ok(`${lang}: the page's click events are not queued before an OK`, /const push=\(event,p\)=>\{if\(!\(typeof window\.saydaMeasuring==='function'&&window\.saydaMeasuring\(\)\)\)return;/.test(html));
  ok(`${lang}: the privacy sentence says nothing loads without the OK and no advertising tool runs`, lang === 'Arabic' ? /دون موافقتك لا نحمّل شيئاً منها/.test(html) && /ولا تعمل على الصفحة أي أداة إعلانية/.test(html) : /Without your OK we load none of it/.test(html) && /no advertising tool runs on the page/.test(html));
}

const off = build('');
ok('build with no container id runs', off.status === 0, off.stderr);
ok('no container id → no bar, no loader, no Google address on either page (the page script only checks for the loader)', !/<aside class="cbar"/.test(off.ar + off.en) && !/w\.saydaConsent=function/.test(off.ar + off.en) && !/googletagmanager/.test(off.ar + off.en) && !/<button type="button" class="clink" data-consent-open>/.test(off.ar + off.en));

console.log(`\nconsent: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
