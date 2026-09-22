#!/usr/bin/env node
// build.js — renders dist/index.html (public site) and dist/artifact.html (claude.ai page)
// from data/state.json + config/*.json + template/index.html. Deterministic; no network.
const fs = require('fs'), path = require('path');
const { arNum, longDate, shortDate, time12, countWord } = require('./lib/ar');
const ROOT = __dirname;
const cfg  = JSON.parse(fs.readFileSync(path.join(ROOT,'config/stores.json'),'utf8'));
const catsCfg = JSON.parse(fs.readFileSync(path.join(ROOT,'config/categories.json'),'utf8'));
// categories.json may be a plain array (old shape) or { chips, map, fallback } (new shape)
const cats = Array.isArray(catsCfg) ? catsCfg : catsCfg.chips;
// state is sharded per store (data/state/<id>.json) so overlapping cycles never write the same
// file; lib/state.js merges the shards back into the single shape this file has always consumed.
const st    = require('./lib/state.js').load(ROOT, cfg);
const rules = JSON.parse(fs.readFileSync(path.join(ROOT,'config/rules.json'),'utf8'));

// Page cap, applied at RENDER time rather than when observations are applied. apply.js used to
// delete rows here, which meant one store's slot could delete another store's rows — exactly the
// cross-slot write the sharding exists to prevent. Capping on read is deterministic, reversible,
// and drops the least useful rows first: unavailable ones, oldest seen first.
if (st.rows.length > rules.page.maxRows) {
  const dead = r => ['oos','ended','gone'].includes(r.avail);
  const drop = new Set(st.rows.filter(dead)
    .sort((a,b) => String(a.firstSeen||'').localeCompare(String(b.firstSeen||'')))
    .slice(0, st.rows.length - rules.page.maxRows).map(r => r.id));
  if (drop.size) { st.rows = st.rows.filter(r => !drop.has(r.id)); console.log(`page cap: hid ${drop.size} unavailable rows over maxRows ${rules.page.maxRows}`); }
}
// Per-chip cap (rules.page.maxPerChip, 22 Sep), also at render time and also deleting nothing.
// Furniture had 44 rows, 37 of them `na` and 3 verified-good: it filled the page without adding
// proven deals. Keep the rows the page can stand behind first — verified and available — and hide
// the rest of that chip beyond the cap: unavailable first, then na, then the smallest saving.
{
  const cap = rules.page.maxPerChip || {};
  const dead = r => ['oos','ended','gone'].includes(r.avail);
  const score = r => (dead(r) ? 0 : 4) + (r.verdict === 'ok' ? 3 : r.verdict === 'warn' ? 2 : r.verdict === 'bad' ? 1 : 0);
  const saving = r => (r.ref != null && r.ref > r.price) ? r.ref - r.price : 0;
  for (const [chip, n] of Object.entries(cap)) {
    const inChip = st.rows.filter(r => r.cat === chip);
    if (inChip.length <= n) continue;
    const keep = new Set(inChip.slice().sort((a, b) => (score(b) - score(a)) || (saving(b) - saving(a))).slice(0, n).map(r => r.id));
    const before = st.rows.length;
    st.rows = st.rows.filter(r => r.cat !== chip || keep.has(r.id));
    console.log(`chip cap: showing ${n} of ${inChip.length} «${chip}» rows (hid ${before - st.rows.length})`);
  }
}
// Rows whose availability no store check has confirmed yet (apply.js new sets needsCheck; the
// first apply.js check clears it) are not published: the page never says «متاح» on a price
// tracker's or a listing's word. See RUNBOOK §2 «re-check new rows».
{
  const pending = st.rows.filter(r => r.needsCheck);
  if (pending.length) { st.rows = st.rows.filter(r => !r.needsCheck); console.log(`held back ${pending.length} new rows not yet checked by their store: ${[...new Set(pending.map(r=>r.store))].join(', ')}`); }
}
let tpl    = fs.readFileSync(path.join(ROOT,'template/index.html'),'utf8');

const storeById = Object.fromEntries(cfg.stores.map(s=>[s.id,s]));
const label = id => (storeById[id]||{}).label || id;

// ---- rows → positional D array (page JS is unchanged) ----
// positions 0..8 are fixed: store · cat · name · price · was · ref · verdict · finding · url
// position 9 is an optional extras object, so new fields never renumber the ones before them:
//   a availability · an note · rk refKind(h|m) · bk badKind(c|r|n) · lc lastChecked · ru compared-product url
// The price tracker we read history from is not named or linked anywhere on the public page
// (decided 2026-09-22, after it began blocking our requests). Its data stays in state for the
// pipeline; the page describes it generically. build fails if the name leaks back in.
const TRACKER = /kanbkam/i, TRACKER_AR = /كان ?بكام/g;
const pubUrl = u => (u && !TRACKER.test(u)) ? u : null;
const pubText = t => typeof t === 'string' ? t.replace(TRACKER_AR, 'سجل الأسعار').replace(/kanbkam/gi, 'سجل الأسعار') : t;
const RK = { history: 'h', market: 'm' }, BK = { cheaper: 'c', rose: 'r', nosaving: 'n' };
const D = st.rows.map(r => {
  const a = [label(r.store), r.cat, pubText(r.name), r.price, r.was, r.ref ?? null, r.verdict, pubText(r.finding), r.url];
  const x = {};
  if (r.avail && r.avail !== 'in') x.a = r.avail;
  if (r.availNote) x.an = pubText(r.availNote);
  if (RK[r.refKind]) x.rk = RK[r.refKind];
  if (BK[r.bk]) x.bk = BK[r.bk];
  if (r.lastChecked) x.lc = r.lastChecked;
  if (pubUrl(r.refUrl)) x.ru = r.refUrl;
  // the evidence behind the comparison, so the page can show the recorded range and link to the source
  if (r.ev) { const e = {}; if (r.ev.prev != null) e.p = r.ev.prev; if (r.ev.min != null) e.mn = r.ev.min;
    if (r.ev.max != null) e.mx = r.ev.max; if (pubUrl(r.ev.url)) e.u = r.ev.url; if (r.ev.src && !TRACKER.test(r.ev.src)) e.s = r.ev.src;
    if (Object.keys(e).length) x.ev = e; }
  if (Object.keys(x).length) a.push(x);
  return a;
});

const T   = st.travel.map(t => [t.company,t.type,t.headline,t.code||'',t.bookStart||'',t.bookEnd||'',t.travelWindow,t.verdict,t.terms,t.url,t.checked]);
const TNO = st.travelNone.map(t => [t.company,t.type]);
// car offers (22 Sep): same card shape as travel, one extra field (brand) after type.
// [company, type, brand, headline, code, bookStart, bookEnd, window, verdict, terms, url, checked]
const CR  = (st.cars || []).map(c => [c.company,c.type,c.brand||'',c.headline,c.code||'',c.bookStart||'',c.bookEnd||'',c.window||'',c.verdict,c.terms,c.url,c.checked]);
const CRNO = (st.carsNone || []).map(c => [c.company,c.type]);
// one row per line, like the hand-written page, so git diffs stay readable
const arr = rows => '[\n' + rows.map(r => JSON.stringify(r)).join(',\n') + '\n]';

// ---- chips from config ----
const catChips = cats.map(c => `        <button data-g="c" data-f="${c.id}">${c.label}</button>`).join('\n');
const storeChips = cfg.groups.map(g => {
  const btns = cfg.stores.filter(s=>s.group===g.id && s.enabled!==false).map(s=>`        <button data-g="s" data-f="${s.label}">${s.label}</button>`);
  const sub  = `<span class="fsub${g.cssClass?' '+g.cssClass:''}">${g.label}</span>`;
  return btns.length ? `        <div class="sgrp">${sub}\n${btns.join('\n')}</div>` : '';
}).join('\n');

// ---- note cards ----
const b = t => `<b style="display:inline">${t}</b>`;
const inl = t => t.replace(/<b>/g,'<b style="display:inline">');
// Each coupon gets its own anchor so a product row can point straight at it (🎟️ beside the store).
const couponLis = st.coupons.map((c, i) => {
  const code = c.code ? ` — كود ${b(c.code)}: ` : ' — ';
  return `<li id="coupon-${i}">${b(c.label)}${code}${inl(c.text)}</li>`;
}).join('');
// Top of page: a one-line pointer, same shape as the travel one. The list itself lives below the table.
const couponsNote = `<a class="note notelink" href="#coupons"><b>🎟️ قسائم وأكواد إضافية</b>خصومات فوق سعر الجدول: أكواد المتاجر وعروض البطاقات البنكية، وما تشترطه فعلاً.<span class="cta">اضغط هنا لعرض القسائم ↓</span></a>`;
const couponsSection = `<section class="couponsec" id="coupons" aria-labelledby="cp-h"><h2 id="cp-h">🎟️ قسائم وأكواد إضافية</h2><ul class="cplist">${couponLis}</ul><p class="cpfoot">أسعار الجدول ${b('قبل')} هذه الخصومات الإضافية.</p></section>`;
// store label -> index of the first coupon that applies, so the table can link to it
const couponBy = {};
// only real savings earn the 🎟️ — a 'none' entry ('we found no code') or the Trendyol
// 'note' caveat would send a shopper to something that saves them nothing.
const SAVES = new Set(['code', 'voucher', 'bank', 'auto']);
st.coupons.forEach((c, i) => { if (!SAVES.has(c.kind)) return; (c.stores || []).forEach(id => { if (couponBy[label(id)] == null) couponBy[label(id)] = i; }); });

const fs_ = st.notes.furnitureShare || {};
const shareList = Object.entries(fs_).sort((a,b)=>b[1].pct-a[1].pct)
  .map(([id,v]) => `${label(id)} ${arNum(v.pct)}٪${v.detail?` (${v.detail})`:''}`).join('، ');
const furnitureNote = `<div class="note"><b>متاجر الأثاث: «الخصم» على كل شيء تقريباً</b>نسبة المنتجات التي عليها سعر «قبل» مشطوب، محسوبة من كتالوج كل متجر: ${shareList}. عندما يكون كل شيء «مخفّضاً» فالسعر «قبل» لا يعني شيئاً — قارن الأسعار الفعلية.</div>`;

// ---- fill ----
const fill = {
  UPDATED_AR: longDate(st.meta.updated),
  UPDATED_AR_SHORT: shortDate(st.meta.updated),
  CHECKED_AR: `${time12(st.meta.checkedAt)} (الرياض)`,
  STORE_COUNT_AR: countWord(cfg.stores.length) + ' عشر'.replace(/.*/, m => cfg.stores.length>=11 && cfg.stores.length<=19 ? '' : '') , // placeholder, fixed below
  COUPONS_NOTE: couponsNote,
  COUPONS_SECTION: couponsSection,
  FURNITURE_NOTE: furnitureNote,
  RULE_JSON: JSON.stringify({ okMin: rules.verdict.okMin, warnMin: rules.verdict.warnMin, okSavingTiers: rules.verdict.okSavingTiers || [] }),
  CATEGORY_CHIPS: catChips,
  STORE_CHIPS: storeChips,
  CBY_JSON: JSON.stringify(couponBy), D_JSON: arr(D), T_JSON: arr(T), TNO_JSON: JSON.stringify(TNO), TNONE_JSON: JSON.stringify(st.travelNone_text||''),
  CR_JSON: arr(CR), CRNO_JSON: JSON.stringify(CRNO),
};
fill.STORE_COUNT_AR = countWord(cfg.stores.filter(s=>s.enabled!==false).length); // disabled stores (no working storefront) are not counted // "الستة عشر" etc. — the template keeps the word order "المتاجر {{n}}"
let out = tpl;
for (const [k,v] of Object.entries(fill)) out = out.split(`{{${k}}}`).join(v);
const left = out.match(/{{[A-Z_]+}}/g); if (left) throw new Error('unfilled: '+left.join(','));
if (TRACKER.test(out) || /كان ?بكام/.test(out)) throw new Error('build: the price tracker is named on the public page — scrub it (see TRACKER above)');

fs.mkdirSync(path.join(ROOT,'dist'), {recursive:true});
fs.writeFileSync(path.join(ROOT,'dist/index.html'), out);

// artifact variant: no doctype/html/head/body, starts at <title>, no brand header/about section
let art = out.slice(out.indexOf('<title>')).replace(/^<title>[^<]*<\/title>/, '<title>'+(st.meta.artifactTitle||'صيدات اليوم الوطني ٩٦')+'</title>');
art = art.replace(/<header class="brand"[\s\S]*?<\/header>\n/, '')
         .replace(/<section class="about"[\s\S]*?<\/section>\n/, '')
         .replace(/<\/body>\s*<\/html>\s*$/, '');
// strip the site-only <meta>/<link>/<style> that build_site added after the artifact's own head parts
art = art.replace(/<meta name="description"[\s\S]*?<meta name="twitter:image"[^>]*>\n/, '').replace(/<style>\n\.brand[\s\S]*?<\/style>\n<\/head>\n<body>\n/, '');
fs.writeFileSync(path.join(ROOT,'dist/artifact.html'), art);

const un = st.rows.filter(r=>['oos','ended','gone'].includes(r.avail)).length;
console.log(`built dist/index.html (${out.length} chars) · rows ${st.rows.length} (${st.rows.length-un} available) · travel ${T.length}+${TNO.length} · cars ${CR.length}+${CRNO.length} · coupons ${st.coupons.length}`);
