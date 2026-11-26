#!/usr/bin/env node
// test-count.js — the page's own count of visits and store clicks by ad source (BLD-55, 25 Nov 2026).
//
// Why: Google Analytics sees only visitors who press OK on the measurement bar, so on 25 Nov it showed 16 visits for
// Snapchat's 2,064 ad clicks. Mahmoud approved (18:41, «1yes») a count of our own on saydadeals.com that needs no cookie
// and no consent: one beacon on landing and one per click that opens a store's product page, each carrying only
// {e, s, l, st}. The Pages Function functions/api/count.js in sayda-deals keeps one number per Riyadh day for them.
// This test keeps the page side to exactly that.
//
// What it does, offline and without touching data/:
//   1. builds both pages in a temp copy (the committed data, Tag Manager configured as on the live site)
//   2. runs each page's own script in a stand-in for the browser, with a chosen address, and records every
//      navigator.sendBeacon and fetch call, every localStorage write and every cookie write
//   3. checks: exactly one land beacon on load with the right fields; one store beacon per click on a card's button,
//      name or picture (and the price-evidence dialog's button), with the row's store id; none for any other click;
//      the source read again at click time; nothing off saydadeals.com or from an automated browser; the same with or
//      without the measurement bar's OK; nothing stored in the browser; the privacy line in both languages
//
//   node scripts/test-count.js          # exit 1 on any failure
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (why, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${why}${detail !== undefined ? '\n      ' + String(detail).slice(0, 400) : ''}`); } };

// ── 1. build both pages in a temp copy ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sayda-count-'));
fs.cpSync(ROOT, tmp, { recursive: true, filter: s => !/[\\/](\.git|dist|node_modules)([\\/]|$)/.test('/' + path.relative(ROOT, s)) });
const r = spawnSync(process.execPath, ['build.js'], { cwd: tmp, encoding: 'utf8' });
const read = f => { try { return fs.readFileSync(path.join(tmp, f), 'utf8'); } catch (_) { return ''; } };
const pages = { ar: read('dist/index.html'), en: read('dist/en/index.html') };
fs.rmSync(tmp, { recursive: true, force: true });
ok('build runs', r.status === 0 && pages.ar && pages.en, (r.stderr || '') + (r.stdout || '').slice(-300));

// the page's own script is the last <script> (the first one, in <head>, is the consent loader)
const mainScript = html => { const s0 = html.lastIndexOf('<script>'), s1 = html.lastIndexOf('</script>'); return s0 < 0 || s1 < s0 ? '' : html.slice(s0 + 8, s1); };

// ── 2. a stand-in browser ──
// el(): an element that answers every DOM call harmlessly; its closest() answers from a map, so a click can be aimed.
function el(props = {}) {
  const state = { children: [], dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, value: '', textContent: '', hidden: false, ...props };
  const api = {
    querySelector: () => el(), querySelectorAll: () => [], getElementById: () => el(), createElement: () => el(), closest: s => (props._closest || {})[s] || null,
    matches: s => s.split(',').some(x => (props._classes || []).includes(x.trim().replace(/^[a-z]*\./, ''))),
    appendChild: c => c, append() {}, insertAdjacentHTML() {}, addEventListener() {}, removeEventListener() {}, hasAttribute: () => false, setAttribute() {}, removeAttribute() {},
    scrollIntoView() {}, focus() {}, remove() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  };
  return new Proxy(state, {
    get: (t, k) => k in api ? api[k] : k in t ? t[k] : typeof k === 'symbol' ? undefined : () => undefined,
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
function run(lang, { host = 'saydadeals.com', search = '', webdriver = false, beacon = true, beaconFull = false, measuring = undefined, cards = [] } = {}) {
  const sent = [], stored = [], cookies = [], docClicks = [];
  const location = { search, origin: 'https://' + host, pathname: lang === 'en' ? '/en/' : '/', hostname: host, href: 'https://' + host + (lang === 'en' ? '/en/' : '/') + search };
  const navigator = { webdriver };
  if (beacon) navigator.sendBeacon = (url, body) => { sent.push({ via: 'beacon', url, body: String(body) }); return !beaconFull; };
  const fetch = (url, opt = {}) => { sent.push({ via: 'fetch', url: String(url), body: String(opt.body || ''), opt }); return Promise.resolve({ ok: true, json: async () => ({}) }); };
  const docTarget = el(), root = el({ lang });
  const document = new Proxy(docTarget, { get: (t, k) => {
    if (k === 'documentElement') return root; if (k === 'body') return el();
    if (k === 'addEventListener') return (type, fn) => { if (type === 'click') docClicks.push(fn); };
    if (k === 'querySelectorAll') return s => s === 'article.card' ? cards : [];
    if (k === 'cookie') return '';
    return t[k]; },
    set: (t, k, v) => { if (k === 'cookie') cookies.push(v); else t[k] = v; return true; } });
  const sandbox = { document, navigator, location, fetch, URL, URLSearchParams, console, Promise, JSON,
    localStorage: { getItem: () => null, setItem: (k, v) => stored.push([k, v]), removeItem() {} }, sessionStorage: { getItem: () => null, setItem: (k, v) => stored.push([k, v]) },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, scrollY: 0, innerWidth: 390, requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }), matchMedia: () => ({ matches: false, addEventListener() {} }), history: { replaceState() {} } };
  if (measuring !== undefined) sandbox.saydaMeasuring = () => measuring;
  sandbox.window = sandbox;
  let error = null;
  try { vm.runInNewContext(mainScript(pages[lang]), sandbox, { timeout: 20000 }); } catch (e) { error = e; }
  const click = target => { for (const fn of docClicks) { try { fn({ target, preventDefault() {}, stopPropagation() {} }); } catch (_) { /* another handler's own fault is not this test's */ } } };
  return { sent, stored, cookies, click, location, error };
}
const body = x => { try { return JSON.parse(x.body); } catch (_) { return null; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// aimable click targets
const cardOf = id => el({ dataset: { id } });
const link = (classes, card, href = 'https://www.noon.com/saudi-ar/p/N1/') => {
  const a = el({ href, target: '_blank', _classes: classes });
  return el({ _closest: { 'a[target="_blank"]': a, 'article.card': card || null } });
};
const dialogLink = href => { const a = el({ href, target: '_blank', _classes: ['buy'] }); return el({ _closest: { 'a[target="_blank"]': a, '#evdlg': el() } }); };

// ── 3. the checks, on both pages ──
for (const lang of ['ar', 'en']) {
  const L = lang === 'ar' ? 'Arabic' : 'English';
  const script = mainScript(pages[lang]);
  ok(`${L}: the page script holds the count block once`, (script.match(/\/api\/count/g) || []).length === 2 && (script.match(/sendBeacon/g) || []).length === 2, (script.match(/\/api\/count/g) || []).length);
  ok(`${L}: no cookie written and no beacon anywhere else in the file`, !/document\.cookie\s*=/.test(pages[lang]) && (pages[lang].match(/sendBeacon/g) || []).length === 2);

  // load
  const a = run(lang, { search: '?utm_source=snapchat&utm_medium=paid&utm_campaign=wf2026' });
  ok(`${L}: the page script runs in the stand-in`, !a.error, a.error && a.error.stack);
  ok(`${L}: exactly one beacon on load`, a.sent.length === 1, JSON.stringify(a.sent));
  ok(`${L}: it goes to /api/count by sendBeacon`, a.sent[0] && a.sent[0].via === 'beacon' && a.sent[0].url === '/api/count', JSON.stringify(a.sent[0]));
  ok(`${L}: it carries exactly {e:land, s:snapchat, l:${lang}}`, a.sent[0] && same(body(a.sent[0]), { e: 'land', s: 'snapchat', l: lang }), a.sent[0] && a.sent[0].body);

  for (const [search, want] of [['', 'direct'], ['?utm_source=', 'direct'], ['?d=noon:N1', 'direct'], ['?utm_source=Instagram', 'instagram'], ['?utm_source=%20google%20', 'google'],
    ['?utm_source=youtube', 'youtube'], ['?utm_source=whatsapp', 'whatsapp'], ['?utm_source=x', 'x'], ['?utm_source=chatgpt', 'chatgpt'], ['?utm_source=tiktok', 'other'],
    ['?utm_source=' + 'a'.repeat(300), 'other'], ['?utm_source=%3Cscript%3E', 'other']]) {
    const b = run(lang, { search });
    ok(`${L}: address «${search.slice(0, 30)}» → s=${want}`, b.sent.length === 1 && body(b.sent[0]).s === want, b.sent.map(x => x.body).join(' '));
  }

  // store clicks
  const c = run(lang, { search: '?utm_source=snapchat' });
  const card = cardOf('noon:N70133422V');
  for (const cls of ['buy', 'cname', 'cimg']) {
    const n = c.sent.length; c.click(link([cls], card));
    ok(`${L}: a click on the card's .${cls} sends one store beacon`, c.sent.length === n + 1 && same(body(c.sent[n]), { e: 'store', s: 'snapchat', l: lang, st: 'noon' }), JSON.stringify(c.sent.slice(n)));
  }
  { const n = c.sent.length; c.click(link(['buy'], cardOf('jarir:samsung-qn70h-smart-tv-690756')));
    ok(`${L}: the store id is the row id's part before the first colon`, c.sent.length === n + 1 && body(c.sent[n]).st === 'jarir', JSON.stringify(c.sent.slice(n))); }
  { const n = c.sent.length;
    c.click(link(['go'], null, 'https://www.alrajhibank.com.sa/offer'));                 // an offer card's official page
    c.click(link([], card, 'https://www.amazon.sa/dp/B0X'));                             // the compared listing on a card
    c.click(link(['buy'], cardOf('no-colon-id')));                                       // a row id with no store part
    c.click(link(['buy'], cardOf('Bad Store:x')));                                       // a store part that is not an id
    c.click(link(['buy'], null));                                                         // a product link with no card
    c.click(el({ _closest: { 'article.card': card } }));                                  // a click on the card, not a link
    c.click(el({ _closest: { 'a[data-ch]': el() } }));                                   // the WhatsApp follow link
    c.click(null); c.click({});
    ok(`${L}: no beacon for any other click`, c.sent.length === n, JSON.stringify(c.sent.slice(n))); }
  { // the dialog's button finds its card by the same store address, as the page's outbound_store_click does
    const ca = el({ dataset: { id: 'extra:100449373' } }), buy = el({ href: 'https://www.extra.com/ar-sa/p/100449373' });
    const cardWithBuy = new Proxy(ca, { get: (t, k) => k === 'querySelector' ? (s => s === 'a.buy' ? buy : null) : t[k] });
    const d = run(lang, { cards: [cardWithBuy] }), n = d.sent.length;
    d.click(dialogLink('https://www.extra.com/ar-sa/p/100449373'));
    ok(`${L}: the price-evidence dialog's store button sends one store beacon with its card's store`, d.sent.length === n + 1 && same(body(d.sent[n]), { e: 'store', s: 'direct', l: lang, st: 'extra' }), JSON.stringify(d.sent.slice(n))); }

  // the source is read again at click time, from the address as it is then
  { const e = run(lang, { search: '?utm_source=instagram' }); e.location.search = '?d=noon:N1'; const n = e.sent.length;
    e.click(link(['buy'], card));
    ok(`${L}: the store beacon reads utm_source again (tag gone → direct)`, body(e.sent[n]) && body(e.sent[n]).s === 'direct', e.sent.map(x => x.body).join(' ')); }

  // consent: the same beacons whatever the bar says, and no more
  for (const measuring of [undefined, false, true]) {
    const f = run(lang, { search: '?utm_source=google', measuring }); f.click(link(['buy'], card));
    ok(`${L}: measurement bar ${measuring === undefined ? 'unanswered' : measuring ? 'OK' : 'no'} → one land and one store beacon`, f.sent.length === 2 && body(f.sent[0]).e === 'land' && body(f.sent[1]).e === 'store', f.sent.map(x => x.body).join(' '));
  }

  // where nothing is sent
  for (const host of ['claude.ai', 'localhost', 'sayda-deals.pages.dev', 'saydadeals.com.evil.example', 'notsaydadeals.com']) {
    const g = run(lang, { host, search: '?utm_source=snapchat' }); g.click(link(['buy'], card));
    ok(`${L}: nothing sent on ${host}`, g.sent.length === 0, JSON.stringify(g.sent));
  }
  { const g = run(lang, { host: 'www.saydadeals.com' }); ok(`${L}: www.saydadeals.com counts too`, g.sent.length === 1); }
  { const g = run(lang, { webdriver: true }); g.click(link(['buy'], card)); ok(`${L}: nothing sent from an automated browser`, g.sent.length === 0); }

  // fallbacks
  { const h = run(lang, { beacon: false, search: '?utm_source=x' });
    ok(`${L}: no sendBeacon → one fetch, keepalive, no credentials`, h.sent.length === 1 && h.sent[0].via === 'fetch' && h.sent[0].url === '/api/count' && h.sent[0].opt.method === 'POST' && h.sent[0].opt.keepalive === true && h.sent[0].opt.credentials === 'omit' && same(body(h.sent[0]), { e: 'land', s: 'x', l: lang }), JSON.stringify(h.sent)); }
  { const h = run(lang, { beaconFull: true });
    ok(`${L}: a refused beacon falls back to one fetch, not two beacons`, h.sent.length === 2 && h.sent[0].via === 'beacon' && h.sent[1].via === 'fetch' && h.sent[1].body === h.sent[0].body, JSON.stringify(h.sent)); }

  // nothing kept in the browser, every body small
  { const k = run(lang, { search: '?utm_source=snapchat' }); k.click(link(['buy'], card));
    ok(`${L}: nothing written to localStorage, sessionStorage or a cookie`, k.stored.length === 0 && k.cookies.length === 0, JSON.stringify(k.stored));
    ok(`${L}: every body is under 200 bytes`, k.sent.every(x => Buffer.byteLength(x.body) < 200), k.sent.map(x => x.body).join(' ')); }
}

// the two pages carry the same block, apart from nothing
{ const block = s => { const i = s.indexOf("(()=>{if(!/(^|\\.)saydadeals\\.com$/.test(location.hostname)||navigator.webdriver)return;"); return i < 0 ? '' : s.slice(i, s.indexOf('})();', s.indexOf("send({e:'store'", i)) + 5); };
  const ba = block(mainScript(pages.ar)), be = block(mainScript(pages.en));
  ok('both pages carry the same count block', ba && ba === be, ba.length + ' / ' + be.length); }

// the policy and the privacy line
for (const [lang, line] of [['ar', 'نعدّ الزيارات والنقرات على المتاجر حسب الإعلان أو الرابط الذي جاءت منه، دون ملفات تعريف ارتباط ودون أي معلومة عنك: نحفظ عدداً لكل يوم فقط.'],
  ['en', 'We count visits and store clicks by the ad or link they came from, with no cookie and nothing about you: we keep only a number for each day.']]) {
  ok(`${lang}: the page policy allows the same origin for connections`, /<meta http-equiv="Content-Security-Policy" content="[^"]*connect-src 'self'/.test(pages[lang]));
  ok(`${lang}: the privacy paragraph says what is counted`, pages[lang].split(line).length === 2);
}

console.log(`count: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
