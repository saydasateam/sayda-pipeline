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
const st    = JSON.parse(fs.readFileSync(path.join(ROOT,'data/state.json'),'utf8'));
const rules = JSON.parse(fs.readFileSync(path.join(ROOT,'config/rules.json'),'utf8'));
let tpl    = fs.readFileSync(path.join(ROOT,'template/index.html'),'utf8');

const storeById = Object.fromEntries(cfg.stores.map(s=>[s.id,s]));
const label = id => (storeById[id]||{}).label || id;

// ---- rows → positional D array (page JS is unchanged) ----
const D = st.rows.map(r => {
  const a = [label(r.store), r.cat, r.name, r.price, r.was, r.ref ?? null, r.verdict, r.finding, r.url];
  if (r.avail && r.avail !== 'in' || r.availNote) { a.push(r.avail||'in'); a.push(r.availNote||''); }
  return a;
});
const T   = st.travel.map(t => [t.company,t.type,t.headline,t.code||'',t.bookStart||'',t.bookEnd||'',t.travelWindow,t.verdict,t.terms,t.url,t.checked]);
const TNO = st.travelNone.map(t => [t.company,t.type]);
// one row per line, like the hand-written page, so git diffs stay readable
const arr = rows => '[\n' + rows.map(r => JSON.stringify(r)).join(',\n') + '\n]';

// ---- chips from config ----
const catChips = cats.map(c => `        <button data-g="c" data-f="${c.id}">${c.label}</button>`).join('\n');
const storeChips = cfg.groups.map(g => {
  const btns = cfg.stores.filter(s=>s.group===g.id).map(s=>`        <button data-g="s" data-f="${s.label}">${s.label}</button>`);
  const sub  = `<span class="fsub${g.cssClass?' '+g.cssClass:''}">${g.label}</span>`;
  return `        <div class="sgrp">${sub}\n${btns.join('\n')}</div>`;
}).join('\n');

// ---- note cards ----
const b = t => `<b style="display:inline">${t}</b>`;
const inl = t => t.replace(/<b>/g,'<b style="display:inline">');
const couponLis = st.coupons.map(c => {
  const code = c.code ? ` — كود ${b(c.code)}: ` : ' — ';
  return `<li>${b(c.label)}${code}${inl(c.text)}</li>`;
}).join('');
const couponsNote = `<div class="note" id="coupons"><b>قسائم إضافية حقيقية</b><ul>${couponLis}<li>أسعار الجدول ${b('قبل')} هذه الخصومات الإضافية.</li></ul></div>`;

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
  FURNITURE_NOTE: furnitureNote,
  RULE_JSON: JSON.stringify({ okMin: rules.verdict.okMin, warnMin: rules.verdict.warnMin, okSavingTiers: rules.verdict.okSavingTiers || [] }),
  CATEGORY_CHIPS: catChips,
  STORE_CHIPS: storeChips,
  D_JSON: arr(D), T_JSON: arr(T), TNO_JSON: JSON.stringify(TNO), TNONE_JSON: JSON.stringify(st.travelNone_text||''),
};
fill.STORE_COUNT_AR = countWord(cfg.stores.length); // "الستة عشر" etc. — the template keeps the word order "المتاجر {{n}}"
let out = tpl;
for (const [k,v] of Object.entries(fill)) out = out.split(`{{${k}}}`).join(v);
const left = out.match(/{{[A-Z_]+}}/g); if (left) throw new Error('unfilled: '+left.join(','));

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
console.log(`built dist/index.html (${out.length} chars) · rows ${st.rows.length} (${st.rows.length-un} available) · travel ${T.length}+${TNO.length} · coupons ${st.coupons.length}`);
