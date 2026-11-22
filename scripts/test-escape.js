#!/usr/bin/env node
// test-escape.js — builds both pages from hostile rows and proves that nothing a store, a seller or
// a search listing wrote can become markup, script or a link that is not https.
//
// Why (security audit of 22 Nov 2026, SEC-F1 to SEC-F4): product titles, merchant names, coupon
// wording and offer terms come from outside. The Arabic page wrote them into the page unescaped, a
// title holding a closing script tag ended the page's script on both pages, and a link that was not
// an https address became clickable. This test is the guard against any of that coming back: add a
// field to a card without esc() and it fails here, offline, before a refresh can publish it.
//
// What it does, with no network and without touching data/:
//   1. copies the code, templates and config into a temp folder and writes a small hostile state
//      there: every outside text field carries markup with the marker SAYDAXSS, and some rows,
//      one travel offer and one car offer carry links that are not clean https addresses
//   2. runs build.js there and checks its output lines and both built files
//   3. runs each page's own script against a stand-in for the browser's document, collects every
//      piece of HTML the script writes (cards, the price-evidence dialog, coupons, travel, cars),
//      and checks that no tag in any of it carries the marker and no link is anything but https
//   4. runs `apply.js new` and `scripts/market-apply.js --apply` there with bad links
//
//   node scripts/test-escape.js              # exit 1 on any failure
//   KEEP=1 node scripts/test-escape.js       # also keep the temp folder and print its path, to open the hostile pages in a browser
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { cleanHttps, jsonForScript, escHtml, boldOnly } = require('../lib/safe.js');

let pass = 0, fail = 0;
const ok = (why, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${why}${detail ? '\n      ' + String(detail).slice(0, 400) : ''}`); } };

// ── the helpers themselves ───────────────────────────────────────────────────────────────────────
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
{
  const nasty = { a: '</script><script>x()</script>', b: '<!-- & -->', c: 'line' + LS + 'para' + PS, d: '{{D_JSON}} {{T_JSON}}' };
  const j = jsonForScript(nasty);
  ok('jsonForScript: no <, > or & left', !/[<>&]/.test(j), j);
  ok('jsonForScript: no raw U+2028 or U+2029 left', !j.includes(LS) && !j.includes(PS));
  ok('jsonForScript: no {{ left for the template filler', !j.includes('{{'), j);
  ok('jsonForScript: the page reads back exactly the same value', JSON.stringify(vm.runInNewContext('(' + j + ')')) === JSON.stringify(nasty));
  ok('escHtml: the five HTML characters and { are escaped', escHtml(`<a href="x" title='y'>&{`) === '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&#123;');
  ok('escHtml: null, undefined and numbers are accepted', escHtml(null) === '' && escHtml(undefined) === '' && escHtml(12) === '12');
  ok('boldOnly: <b> comes back, nothing else does', boldOnly('<b>x</b><i>y</i><b onclick=z>') === '<b>x</b>&lt;i&gt;y&lt;/i&gt;&lt;b onclick=z&gt;');
  for (const u of ['https://www.noon.com/saudi-ar/x/p/', 'https://f.nooncdn.com/p/a.jpg?format=webp&width=800'])
    ok(`cleanHttps accepts ${u}`, cleanHttps(u));
  for (const u of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'http://www.noon.com/x', 'data:text/html,x', '//www.noon.com/x', '/saudi-ar/x', ' https://www.noon.com/x',
    'https://www.noon.com/x y', 'https://www.noon.com/x"onmouseover="y', "https://www.noon.com/x'y", 'https://www.noon.com/<x>', 'https://', '', null, undefined, 5, {}])
    ok(`cleanHttps refuses ${JSON.stringify(u)}`, !cleanHttps(u));
}

// ── a hostile state in a temp copy ───────────────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sayda-escape-'));
const done = () => { if (process.env.KEEP) { console.log(`kept: ${TMP}`); return; } try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} };
for (const d of ['config', 'lib', 'rules', 'template', 'scripts']) fs.cpSync(path.join(ROOT, d), path.join(TMP, d), { recursive: true });
for (const f of ['build.js', 'apply.js']) fs.copyFileSync(path.join(ROOT, f), path.join(TMP, f));
const W = (rel, v) => { const p = path.join(TMP, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 1)); };
// the hostile build runs with measurement off: with a container id, Google's head snippet is a second script block by design
W('config/site.json', { gtmId: '' });
// (BLD-15) every category with a row gets its card, whatever the threshold on main is
{ const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/rules.json'), 'utf8')); r.page.categoryCardMinRows = 1; W('config/rules.json', r); }

const M = 'SAYDAXSS';                                   // every hostile value carries this marker
const img = n => `<img src=x onerror=${M}(${n})>`;
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/stores.json'), 'utf8'));
const chip = (c => (Array.isArray(c) ? c : c.chips)[0].id)(JSON.parse(fs.readFileSync(path.join(ROOT, 'config/categories.json'), 'utf8')));
const market = cfg.stores.find(s => s.verify === 'market' && s.enabled !== false);
const plain = cfg.stores.find(s => s.verify !== 'market' && s.enabled !== false);
const base = (key, over) => ({ id: `${plain.id}:${key}`, store: plain.id, cat: chip, name: 'حقيبة يد للاختبار', name_en: 'Test tote bag', price: 301, was: 768, ref: 470, refKind: 'history',
  verdict: 'ok', finding: 'كان ٤٧٠', url: `${plain.origin}/p/${key}/`, avail: 'in', availNote: '', ev: { prev: 470, min: 301, max: 470, src: 'test', on: '2026-11-20' },
  firstSeen: '2026-11-20', lastChecked: '2026-11-22', img: 'https://images.example.com/a.jpg?w=400&h=400', ...over });
const rows = [
  base('t-clean', { name: 'حقيبة "ميريديان" & شركاه', name_en: `Tom's 1.3" bag & strap` }),
  base('t-name', { name: img(1), name_en: `</script><script>${M}(2)</script>`, verdict: 'warn', finding: `<svg onload=${M}(3)> & ' "`, finding_en: `<svg onload=${M}(4)>`,
    avail: 'low', availNote: `متبقي 3: "><img src=x onerror=${M}(5)>`, availNote_en: `"><img src=x onerror=${M}(6)>` }),
  base('t-attrs', { name: `it's "quoted" & {{T_JSON}} {{D_JSON}} ${LS}${PS} <!-- ${M}(60)`, name_en: `{{E_JSON}} <!--${M}(61)`, avail: `in" onmouseover="${M}(7)`, verdict: `ok" onclick="${M}(8)`,
    lastChecked: `"><img src=x onerror=${M}(9)>` }),
  base('t-price', { price: img(10), was: img(17), ref: 470 }),
  base('t-img', { img: `javascript:${M}(14)` }),
  // (BLD-15) two more confirmed rows, so the ticker strip is drawn (it needs four) and the category card has a second picture:
  // a hostile name in both languages, a hostile row id, a picture address that tries to break out of its attribute
  base('t-tick', { name: img(110), name_en: img(111), price: 200, ref: 470, img: 'https://images.example.com/b.jpg?w=400&h=400' }),
  base('t-tick2', { id: `${plain.id}:t-tick2"><img src=x onerror=${M}(112)>`, name: `"><script>${M}(113)</script>`, name_en: `' onfocus='${M}(114)`, price: 250, ref: 470, img: `https://images.example.com/c.jpg"onerror="${M}(115)` }),
  base('t-market', { refKind: 'market', ref: 400, verdict: 'ok', finding: `أرخص من ${img(16)} (٤٠٠)`, refUrl: 'https://www.example.com/p?a=1&b=2', ev: { market: { store: img(18), price: 400 }, min: 400, max: 400, src: 'market', on: '2026-11-22', url: 'https://www.example.com/p?a=1&b=2' } }),
  // links that are not clean https addresses: each of these four rows must be held back from both pages
  base('t-jsurl', { url: `javascript:${M}(11)` }),
  base('t-refurl', { refKind: 'market', refUrl: `javascript:${M}(12)` }),
  base('t-evurl', { ev: { prev: 470, min: 301, max: 470, src: 'test', url: `data:text/html,<script>${M}(13)</script>` } }),
  base('t-quoteurl', { url: `${plain.origin}/x"onmouseover="${M}(15)` }),
];
W(`data/state/${plain.id}.json`, { store: plain.id, updated: '2026-11-22', checkedAt: '2026-11-22T12:00:00.000+03:00', rows });
W(`data/state/${market.id}.json`, { store: market.id, updated: '2026-11-22', checkedAt: '2026-11-22T12:00:00.000+03:00', rows: [
  { id: `${market.id}:t-mk`, store: market.id, cat: chip, name: 'سامسونج تلفزيون ذكي 65 بوصة QN70H', name_en: 'Samsung QN70H 65" Neo QLED Smart TV', price: 3000, was: 4500, ref: null, verdict: 'na',
    finding: 'بلا سجل', url: `${market.origin}/samsung-qn70h-smart-tv-1.html`, avail: 'in', availNote: '', firstSeen: '2026-11-22', lastChecked: '2026-11-22' }] });
W('data/state/_coupons.json', { coupons: [{ stores: [plain.id], label: img(20), kind: 'code', code: `X"><script>${M}(21)</script>`, perk: `<i onmouseover=${M}(23)>perk</i>`,
  text: `<b>bold stays</b> </noscript>${img(22)} «نص الكود»`, label_en: img(25), perk_en: `<i onmouseover=${M}(26)>perk</i>`, text_en: `<b>x</b><svg onload=${M}(24)> “the code”` }] });
const offer = (n, over) => ({ company: img(n), type: img(n + 1), brand: img(n + 2), headline: img(n + 3), code: `C"><script>${M}(${n + 4})</script>`, bookStart: '', bookEnd: '', travelWindow: img(n + 5), window: img(n + 5),
  verdict: `clear" onmouseover="${M}(${n + 6})`, terms: img(n + 7), url: 'https://www.example.com/offer?a=1&b=2', checked: '2026-11-22',
  company_en: img(n + 8), type_en: img(n + 8), brand_en: img(n + 8), headline_en: img(n + 8), terms_en: img(n + 8), travelWindow_en: img(n + 8), window_en: img(n + 8), ...over });
W('data/state/_travel.json', { travel: [offer(30), offer(40, { company: 'bad link travel', url: `javascript:${M}(49)` })], travelNone: [{ company: img(50), type: img(51), company_en: img(52), type_en: img(53) }],
  travelNone_text: img(54), travelNone_text_en: img(55) });
W('data/state/_cars.json', { cars: [offer(70), offer(80, { company: 'bad link car', url: `http://insecure.example.com/${M}89` })], carsNone: [{ company: img(90), type: img(91), company_en: img(92), type_en: img(93) }] });
W('data/state/_notes.json', { notes: {} });

// ── build ────────────────────────────────────────────────────────────────────────────────────────
const b = spawnSync(process.execPath, ['build.js'], { cwd: TMP, encoding: 'utf8' });
ok('build.js builds the hostile state', b.status === 0, b.stderr || b.stdout);
ok('build names the four rows it held back for a bad link', /held back 4 rows with a link that is not a clean https address/.test(b.stdout) && ['t-jsurl', 't-refurl', 't-evurl', 't-quoteurl'].every(k => b.stdout.includes(k)), b.stdout);
ok('build names the travel offer it held back', /held back 1 travel offer\(s\) with a link that is not a clean https address: bad link travel/.test(b.stdout), b.stdout);
ok('build names the car offer it held back', /held back 1 car offer\(s\) with a link that is not a clean https address: bad link car/.test(b.stdout), b.stdout);
if (b.status !== 0) { console.log(`\nescape: ${pass} passed, ${fail} failed`); done(); process.exit(1); }

// Read HTML the way a browser's tokenizer does: a tag starts at «<» followed by a letter or «/», then
// attributes follow as name, name=value, name="value" or name='value' until «>». Text that was escaped
// (&lt;img …&gt;) is not a tag and never shows up here; text that was not escaped does.
function tags(html) {
  const out = []; let i = 0;
  while ((i = html.indexOf('<', i)) >= 0) {
    const m = /^<\/?([a-zA-Z][^\s\/>]*)/.exec(html.slice(i, i + 80));
    if (!m) { i++; continue; }
    const tag = { name: m[1].toLowerCase(), attrs: [] }; i += m[0].length;
    for (;;) {
      while (i < html.length && /[\s\/]/.test(html[i])) i++;
      if (i >= html.length || html[i] === '>') { i++; break; }
      let n = ''; while (i < html.length && !/[\s\/>=]/.test(html[i])) n += html[i++];
      while (i < html.length && /\s/.test(html[i])) i++;
      let v = '';
      if (html[i] === '=') { i++; while (i < html.length && /\s/.test(html[i])) i++;
        if (html[i] === '"' || html[i] === "'") { const q = html[i++]; const e = html.indexOf(q, i); v = html.slice(i, e < 0 ? html.length : e); i = e < 0 ? html.length : e + 1; }
        else { while (i < html.length && !/[\s>]/.test(html[i])) v += html[i++]; } }
      if (n) tag.attrs.push([n.toLowerCase(), v]); else i++;
    }
    out.push(tag);
  }
  return out;
}
const decode = t => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#123;/g, '{').replace(/&amp;/g, '&');
// the only inline handlers the two templates carry themselves
const OWN_HANDLER = v => /^setF\('a','all'\)$/.test(v) || v === "document.getElementById('evdlg').close()";
/** Everything wrong with a piece of HTML, as a list of sentences (empty = clean). `linkOk` says which links are allowed. */
function faults(html, linkOk, allowScript) {
  const bad = [];
  for (const t of tags(html)) {
    if (t.name.includes(M.toLowerCase())) bad.push(`tag named from outside text: <${t.name}>`);
    if (t.name === 'script' && !allowScript) bad.push('a <script> tag');
    if (['iframe', 'object', 'embed', 'base', 'meta', 'link', 'style'].includes(t.name) && !allowScript) bad.push(`a <${t.name}> tag`);
    for (const [n, v] of t.attrs) {
      if (n.includes(M.toLowerCase())) bad.push(`attribute named from outside text on <${t.name}>: ${n}`);
      if (/^on/.test(n) && !OWN_HANDLER(decode(v))) bad.push(`event handler on <${t.name}>: ${n}="${v.slice(0, 60)}"`);
      if ((n === 'href' || n === 'src' || n === 'action' || n === 'formaction' || n === 'srcset') && !linkOk(decode(v))) bad.push(`link on <${t.name}>: ${n}="${v.slice(0, 80)}"`);
      if (n === 'style' && v.includes(M)) bad.push(`style from outside text on <${t.name}>`);
    }
  }
  return [...new Set(bad)];
}
const pageLink = u => u.startsWith('#') || cleanHttps(u);                                   // what the page's script may write
const staticLink = u => pageLink(u) || /^(\/|mailto:|data:image\/svg\+xml,)/.test(u);       // plus the template's own
{
  // the checker must itself catch the three shapes of the fault, or a pass below means nothing
  ok('checker: catches an unescaped tag with a handler', faults(`<p>${img(0)}</p>`, pageLink).length >= 2);
  ok('checker: catches an attribute broken out of', faults(`<span class="cstock in" onmouseover="${M}(7)">x</span>`, pageLink).length === 1);
  ok('checker: catches a javascript: link', faults(`<a href="javascript:${M}(11)">x</a>`, pageLink).length === 1);
  ok('checker: catches an injected script tag', faults(`<p></p><script>${M}(2)</script>`, pageLink).length === 1);
  ok('checker: accepts the same text when escaped', faults(`<p class="in&quot; onmouseover=&quot;${M}(7)">${escHtml(img(0))}</p><a href="https://www.example.com/p?a=1&amp;b=2">x</a>`, pageLink).length === 0);
}

/** Run a built page's script against a stand-in document and return every HTML string it wrote. */
function drawn(script) {
  const sinks = [], evButtons = [];
  const el = (sel) => {
    const state = { children: [], dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, value: '', textContent: '', hidden: false };
    const api = {
      querySelector: s => el(s), querySelectorAll: () => [], getElementById: () => el('#'), createElement: () => el('new'), closest: () => null,
      appendChild: c => { state.children.push(c); return c; }, insertAdjacentHTML: (pos, html) => { sinks.push(String(html)); },
      addEventListener: (type, fn) => { if (type === 'click' && sel === '.ev') evButtons.push(fn); }, hasAttribute: () => false,
    };
    return new Proxy(state, {
      get: (t, k) => k in api ? api[k] : k in t ? t[k] : typeof k === 'symbol' ? undefined : () => undefined,
      set: (t, k, v) => { if (k === 'innerHTML' && v !== '') sinks.push(String(v)); t[k] = v; return true; },
    });
  };
  const document = el('document'); const body = el('body'), root = el('html');
  const sandbox = { document: new Proxy(document, { get: (t, k) => k === 'body' ? body : k === 'documentElement' ? root : t[k] }),
    localStorage: { getItem: () => null, setItem() {} }, navigator: {}, location: { search: '', origin: 'https://saydadeals.com', pathname: '/', hostname: 'saydadeals.com' },
    addEventListener() {}, scrollTo() {}, scrollY: 0, requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }), history: { replaceState() {} }, URLSearchParams, console };
  sandbox.window = sandbox;
  vm.runInNewContext(script, sandbox, { timeout: 20000 });
  for (const open of evButtons) open();                  // open every card's price-evidence dialog
  return { sinks, dialogs: evButtons.length };
}

for (const [file, lang, nameMark] of [['dist/index.html', 'arabic', `&lt;img src=x onerror=${M}(1)&gt;`], ['dist/en/index.html', 'english', `&lt;/script&gt;&lt;script&gt;${M}(2)`]]) {
  const html = fs.readFileSync(path.join(TMP, file), 'utf8');
  const s0 = html.indexOf('<script>'), s1 = html.lastIndexOf('</script>');
  const script = html.slice(s0 + 8, s1), stat = html.slice(0, s0) + html.slice(s1 + 9);
  ok(`${lang}: exactly one <script> and one </script>`, (html.match(/<script\b/gi) || []).length === 1 && (html.match(/<\/script/gi) || []).length === 1);
  ok(`${lang}: no javascript: or data:text link anywhere in the file`, !/javascript:|data:text/i.test(html));
  ok(`${lang}: the four rows with a bad link are not in the file`, !['t-jsurl', 't-refurl', 't-evurl', 't-quoteurl'].some(k => html.includes(k)));
  ok(`${lang}: the offers with a bad link are not in the file`, !html.includes('bad link travel') && !html.includes('bad link car') && !html.includes('insecure.example.com'));
  ok(`${lang}: the hostile rows that should be on the page are in the file`, ['t-clean', 't-name', 't-attrs', 't-price', 't-img', 't-market', 't-tick', 't-tick2'].every(k => html.includes(k)));
  // (BLD-15) the ticker strip, the category card and the header inside a category are static HTML written by build.js
  ok(`${lang}: the ticker strip, a category card and a category header are in the static HTML`, stat.includes('class="tick"') && /<button type="button" class="kcard big kc\d+"/.test(stat) && /<div class="khead kc\d+"/.test(stat));
  ok(`${lang}: the ticker carries the hostile product name as text, twice (the strip and its hidden copy)`, stat.split(`<span class="tn">${escHtml(lang === 'arabic' ? img(110) : img(111))}</span>`).length - 1 === 2);
  ok(`${lang}: the hostile row id is an escaped attribute value on its ticker item`, stat.includes(`data-d="${escHtml(`${plain.id}:t-tick2"><img src=x onerror=${M}(112)>`)}"`));
  ok(`${lang}: the category card shows the store pictures with the hostile name as escaped alt text`, stat.includes(`<img src="https://images.example.com/b.jpg?w=400&amp;h=400" alt="${escHtml(lang === 'arabic' ? img(110) : img(111))}"`));
  ok(`${lang}: a picture address that is not a clean https address is on no category card`, !stat.includes("images.example.com/c.jpg") && (stat.match(/<span class="kim /g) || []).length === 2, (stat.match(/<span class="kim /g) || []).length);
  ok(`${lang}: the ticker holds only confirmed rows (not the warn row, not the row whose verdict or price is not ours)`, (stat.match(/class="ti"/g) || []).length === 10 && !/class="ti" data-d="[^"]*t-(name|attrs|price)"/.test(stat), (stat.match(/class="ti"/g) || []).length);
  ok(`${lang}: static HTML holds no tag, attribute, handler or link made from outside text`, faults(stat, staticLink, true).length === 0, faults(stat, staticLink, true).join(' | '));
  ok(`${lang}: no data line in the script holds a raw < beside the marker`, !script.split('\n').some(l => l.includes(M) && l.includes('<')));
  ok(`${lang}: no {{…}} left for a later fill`, !/{{[A-Z_]+}}/.test(html));
  if (lang === 'arabic') ok('arabic: <b> in coupon text is still bold in the static list, and nothing else in it is live', stat.includes('<b style="display:inline">bold stays</b>') && stat.includes('&lt;/noscript&gt;'));

  let out = null, err = null;
  try { out = drawn(script); } catch (e) { err = e; }
  ok(`${lang}: the page script runs to the end on hostile data`, !err, err && (err.stack || err));
  if (!out) continue;
  const all = out.sinks.join('\n');
  ok(`${lang}: the script drew the nine cards and opened their evidence dialogs`, out.dialogs === 9 && out.sinks.length > 12, `dialogs ${out.dialogs}, pieces of HTML ${out.sinks.length}`);
  const f = out.sinks.flatMap(h => faults(h, pageLink, false));
  ok(`${lang}: nothing the script wrote holds a tag, attribute, handler or link made from outside text`, f.length === 0, [...new Set(f)].slice(0, 6).join(' | '));
  ok(`${lang}: the script wrote links, and every one is a clean https address or in-page`, out.sinks.flatMap(h => tags(h)).filter(t => t.attrs.some(([n]) => n === 'href')).length >= 20);
  ok(`${lang}: the hostile product name is on a card, as text`, all.includes(nameMark), nameMark);
  ok(`${lang}: the marker reached the page as text at least 20 times (cards, dialogs, coupons, travel, cars)`, all.split(M).length - 1 >= 20, `seen ${all.split(M).length - 1}`);
  ok(`${lang}: the clean row's quotes and ampersand are written as entities`, lang === 'arabic' ? all.includes('حقيبة &quot;ميريديان&quot; &amp; شركاه') : all.includes('Tom&#39;s 1.3&quot; bag &amp; strap'));
  ok(`${lang}: the row with a bad picture is drawn without it`, !all.includes(`${M}(14)`));
}

// ── a row with a bad link is not added, and a corrected link is taken only when clean ───────────────
{
  W('work/new.json', [base('t-new-ok', {}), base('t-new-js', { url: `javascript:${M}(100)` }), base('t-new-ref', { refUrl: 'http://www.example.com/p' }), base('t-new-ev', { ev: { prev: 470, url: 'ftp://x/y' } })]);
  const a = spawnSync(process.execPath, ['apply.js', 'new', 'work/new.json'], { cwd: TMP, encoding: 'utf8' });
  const sum = (() => { try { return JSON.parse(a.stdout.trim().split('\n').pop()); } catch (e) { return {}; } })();
  const shard = JSON.parse(fs.readFileSync(path.join(TMP, `data/state/${plain.id}.json`), 'utf8')).rows.map(r => r.id);
  ok('apply.js new: adds the clean row and refuses the three with a bad link', a.status === 0 && sum.added === 1 && sum.badLinks === 3, a.stdout + a.stderr);
  ok('apply.js new: the refused rows are not in the shard, and are named', shard.includes(`${plain.id}:t-new-ok`) && !shard.some(id => /t-new-(js|ref|ev)$/.test(id)) && /links refused/.test(a.stderr) && a.stderr.includes('t-new-js url') && a.stderr.includes('t-new-ref refUrl') && a.stderr.includes('t-new-ev ev.url'), a.stderr);

  W(`work/check/${plain.id}.json`, [{ id: `${plain.id}:t-clean`, found: true, live: 301, buyable: true, stock: 5, url: `javascript:${M}(101)` }, { id: `${plain.id}:t-img`, found: true, live: 301, buyable: true, stock: 5, url: `${plain.origin}/p/moved/` }]);
  const c = spawnSync(process.execPath, ['apply.js', 'check'], { cwd: TMP, encoding: 'utf8' });
  const after = JSON.parse(fs.readFileSync(path.join(TMP, `data/state/${plain.id}.json`), 'utf8')).rows;
  const urlOf = k => (after.find(r => r.id === `${plain.id}:${k}`) || {}).url;
  ok('apply.js check: a corrected link that is not clean https is refused, a clean one is taken', c.status === 0 && urlOf('t-clean') === `${plain.origin}/p/t-clean/` && urlOf('t-img') === `${plain.origin}/p/moved/`, c.stdout + c.stderr + ' ' + urlOf('t-clean') + ' ' + urlOf('t-img'));
}

// ── the comparator sweep: a matched listing with a bad link is written without the link ──────────────
{
  const id = `${market.id}:t-mk`;
  const sweep = good => [{ id, q: 'samsung qn70h 65', listings: [{ title: 'Samsung 65 inch QN70H Neo QLED Smart TV', price: 3600, merchant: 'eXtra Stores', country: 'sa', url: good ? 'https://www.example.com/tv?a=1' : `javascript:${M}(110)` }] }];
  const run = good => { W('work/market/t.json', sweep(good)); return spawnSync(process.execPath, ['scripts/market-apply.js', 'work/market/t.json', '--apply'], { cwd: TMP, encoding: 'utf8' }); };
  const rowNow = () => JSON.parse(fs.readFileSync(path.join(TMP, `data/state/${market.id}.json`), 'utf8')).rows.find(r => r.id === id);
  const before = JSON.stringify(rowNow());
  const m = run(false), r1 = rowNow();
  if (m.status === 0 && JSON.stringify(r1) === before) console.log('NOTE  market-apply: the test listing was not accepted by rules/match.js, so the link rule was not exercised — update the fixture');
  ok('market-apply: a comparison whose link is not clean https is written with no link, and named', m.status === 0 && r1.refKind === 'market' && r1.ref === 3600 && r1.refUrl === null && r1.ev.url === null && r1.ev.market.url === null && /comparator link not kept/.test(m.stdout) && !JSON.stringify(r1).includes(M), m.stdout + m.stderr + JSON.stringify(r1));
  fs.writeFileSync(path.join(TMP, `data/state/${market.id}.json`), JSON.stringify({ store: market.id, updated: '2026-11-22', checkedAt: '2026-11-22T12:00:00.000+03:00', rows: [JSON.parse(before)] }));
  fs.rmSync(path.join(TMP, `data/state/_market-${market.id}.json`), { force: true });
  const g = run(true), r2 = rowNow();
  ok('market-apply: a clean link is kept exactly as before', g.status === 0 && r2.refUrl === 'https://www.example.com/tv?a=1' && r2.ev.url === r2.refUrl && r2.ev.market.url === r2.refUrl && !/comparator link not kept/.test(g.stdout), g.stdout + g.stderr + JSON.stringify(r2));
}

done();
console.log(`\nescape: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
