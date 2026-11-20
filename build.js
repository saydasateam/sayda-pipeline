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

// A campaign that has just been reset (scripts/new-campaign.js) has no rows and no check time.
// That is not a page: publishing it would put an empty table under a campaign headline. Stop here
// with a sentence instead of a TypeError further down, and leave dist/ as it was.
if (!st.rows.length && !st.meta.checkedAt) {
  console.error(`build: 0 rows and no store checked yet for «${st.meta.campaign || ''}» — nothing to publish. Run the first collection, then build.`);
  process.exit(1);
}

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
  // product picture (20 Nov 2026): the store's own image URL, read from its product page. Shown by
  // hotlink with no referrer; a card without one falls back to a neutral tile.
  if (r.img && /^https:\/\//.test(r.img)) x.im = r.img;
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
const liveCats = cats.filter(c => !st.rows.length || st.rows.some(r => r.cat === c.id));
const catChips = liveCats.map(c => `        <button data-g="c" data-f="${c.id}">${c.label}</button>`).join('\n');
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

const on = id => storeById[id] && storeById[id].enabled !== false;
const fs_ = Object.fromEntries(Object.entries(st.notes.furnitureShare || {}).filter(([id]) => on(id)));
const shareList = Object.entries(fs_).sort((a,b)=>b[1].pct-a[1].pct)
  .map(([id,v]) => `${label(id)} ${arNum(v.pct)}٪${v.detail?` (${v.detail})`:''}`).join('، ');
const furnitureNote = !shareList ? '' : `<div class="note"><b>متاجر الأثاث: «الخصم» على كل شيء تقريباً</b>نسبة المنتجات التي عليها سعر «قبل» مشطوب، محسوبة من كتالوج كل متجر: ${shareList}. عندما يكون كل شيء «مخفّضاً» فالسعر «قبل» لا يعني شيئاً — قارن الأسعار الفعلية.</div>`;

// ---- campaign wording and colour: config/campaign.json, never the template ----
// (19 Nov 2026) The template used to say «اليوم الوطني ٩٦» in eight places and was green throughout.
// A new campaign is now a config edit. Defaults below are the National Day values, so an old
// campaign.json still builds the page it always built.
const M = st.meta;
const campAr    = M.campaign || 'اليوم الوطني ٩٦';
const campShort = M.campaignShort || campAr;
const forAr = t => t.startsWith('ال') ? 'لل' + t.slice(2) : 'ل' + t;   // لـ + الجمعة = للجمعة
const th = (M.theme && M.theme.light) || {}, thd = (M.theme && M.theme.dark) || {};
const hasFurn = cfg.stores.some(s => s.group === 'furniture' && s.enabled !== false);
const travelOn = st.travel.length + st.travelNone.length > 0;
const carsOn = (st.cars || []).length + (st.carsNone || []).length > 0;
const campaignFill = {
  CAMPAIGN_AR: campAr, CAMPAIGN_SHORT_AR: campShort,
  CAMPAIGN_FOR_AR: forAr(campAr), CAMPAIGN_FOR_SHORT_AR: forAr(campShort),
  SEARCH_PH: M.searchPlaceholder || 'ابحث: سامسونج، آيفون، كنبة، مكيف…',
  TH_ACCENT: th.accent || '#0B6E4F', TH_ACCENT_HEX: (th.accent || '#0B6E4F').slice(1), TH_ACCENT_SOFT: th.accentSoft || '#E1F0E8',
  TH_BG: th.bg || '#F4F6F2', TH_INK: th.ink || '#132019', TH_MUTED: th.muted || '#5B6B61', TH_LINE: th.line || '#DDE3DC', TH_CHIP: th.chip || '#EAEEE8',
  TH_ACCENT_DARK: thd.accent || '#4FC596', TH_ACCENT_SOFT_DARK: thd.accentSoft || '#173A2B',
  TH_BG_DARK: thd.bg || '#0F1512', TH_SURFACE_DARK: thd.surface || '#17201B', TH_INK_DARK: thd.ink || '#E6EDE8',
  TH_MUTED_DARK: thd.muted || '#9AABA0', TH_LINE_DARK: thd.line || '#2A362F', TH_CHIP_DARK: thd.chip || '#223029',
  // the two pointers and their sections exist only when there is something behind them
  TRAVEL_NOTE: !travelOn ? '' : `    <a class="note notelink" href="#travel"><b>✈️ عروض السفر</b>أكواد وحملات ${campShort} من شركات الطيران ومنصات الحجز، مع ما تقوله الشروط فعلاً.<span class="cta">اضغط هنا لعرض عروض السفر ↓</span></a>\n`,
  CARS_NOTE: !carsOn ? '' : `    <a class="note notelink" href="#cars"><b>🚗 عروض السيارات</b>عروض ${campShort} من وكلاء السيارات وجهات التمويل، مقروءة من صفحاتهم الرسمية، مع ما تقوله الشروط فعلاً.<span class="cta">اضغط هنا لعرض عروض السيارات ↓</span></a>\n`,
  TRAVEL_HIDDEN: travelOn ? '' : ' hidden', CARS_HIDDEN: carsOn ? '' : ' hidden',
  // furniture wording follows the enabled stores, so a campaign without them does not describe them
  HOW_FURNITURE: (on('ashley') && on('midas')) ? '، وأشلي مقابل ميداس في الأثاث' : '',
  METHOD_IKEA: !on('ikea') ? '' : `<li><b>إيكيا</b>: منتجاتها لا تُباع في متاجر أخرى ولا يوجد لها سجل أسعار عام، لذلك تظهر كـ «غير متحقق» مع مدة العرض الرسمية.</li>\n      `,
  METHOD_FURNITURE: !hasFurn ? '' : `      <li><b>متاجر الأثاث</b>: أشلي وميداس تبيعان نفس سلاسل أشلي (بولانبرغ، سكيمبتون، مودماكس…)، فقارنّا سعر القطعة نفسها بين المتجرين. هوم سنتر وهوم بوكس وبان هوم وسيتي دبليو وبيتونيا تبيع موديلات خاصة بها لا توجد في متاجر أخرى ولا يوجد لها سجل أسعار عام، فتظهر كـ «غير متحقق» مع نسبة المنتجات «المخفّضة» في المتجر.</li>\n`,
  ARCHIVE_LINKS: !(M.archive || []).length ? '' : ' · الأرشيف: ' + M.archive.map(a => `<a href="${a.href}">${a.label}</a>`).join(' · '),
};

// ---- fill ----
const fill = {
  ...campaignFill,
  UPDATED_AR: longDate(st.meta.updated),
  UPDATED_AR_SHORT: shortDate(st.meta.updated),
  // lib/state.js derives BOTH the newest and the oldest per-store checkedAt. Rendering only the
  // newest lets the page advertise a fresh check over rows that are days old, which is the exact
  // claim this site exists not to make. Show the floor too whenever the spread is over 6 hours.
  CHECKED_AR: (() => {
    const newest = st.meta.checkedAt, oldest = st.meta.oldestCheckedAt;
    const head = `${time12(newest)} (الرياض)`;
    if (!newest || !oldest) return head;
    const t = x => new Date(String(x).replace('+03:00', 'Z')).getTime();
    const spreadH = (t(newest) - t(oldest)) / 3600e3;
    if (!(spreadH > 6)) return head;
    const sameDay = String(newest).slice(0, 10) === String(oldest).slice(0, 10);
    const old = sameDay ? time12(oldest) : `${shortDate(oldest)} ${time12(oldest)}`;
    return `${head} · وأقدم صف فُحص في ${old}`;
  })(),
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

// ---- English page (20 Nov 2026): a required half of every build, not an extra ----
// Mahmoud, 20 Nov: «the english version become an essential part now … it needs to be there every
// refresh as essential as arabic». So this is not optional and not best-effort: if the English page
// cannot be built, the build fails and nothing is published in either language.
//   · product names are the stores' own English titles (row.name_en, scripts/apply-names.js);
//     a row without one shows its Arabic name and is counted below
//   · the finding is generated HERE from the same stored numbers the Arabic finding came from, so
//     the two pages cannot disagree; row.finding_en overrides it and is REQUIRED whenever the
//     Arabic finding states a condition (coupon, Plus, basket, checkout-only)
//   · coupons, travel and cars appear in English only when the run wrote their *_en fields;
//     one without them is left off the English page and counted, never shown in Arabic
const enN = v => Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const enText = t => typeof t === 'string' ? t.replace(/kanbkam/gi, 'the price record') : t;
const findingEn = r => {
  if (r.finding_en) return enText(r.finding_en);
  if (r.ref == null) return 'No price record and no same model at another store to compare with.';
  const parts = [];
  if (r.refKind === 'market') parts.push(`Same model at another store: ${enN(r.ref)} SAR`);
  else parts.push(`Sold at ${enN(r.ref)} SAR before the sale`);
  const mn = r.ev && r.ev.min;
  if (r.refKind !== 'market' && mn != null) parts.push(r.price <= mn * 1.01 ? 'lowest recorded price' : (mn < r.price ? `has been as low as ${enN(mn)} SAR` : ''));
  if (r.bk === 'cheaper') parts.push('cheaper elsewhere'); if (r.bk === 'rose') parts.push('the price went up'); if (r.bk === 'nosaving') parts.push('no real saving');
  if (r.refKind !== 'market' && r.was && r.was > r.ref * 1.05) parts.push(`the advertised “before” of ${enN(r.was)} SAR is not in the record`);
  return parts.filter(Boolean).join(' · ');
};
const availEn = r => { if (r.availNote_en) return r.availNote_en; const m = String(r.availNote || '').match(/متبقي\s*([\d٠-٩]+)/); return m ? `${m[1].replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))} left` : ''; };
const labelEn = id => (storeById[id] || {}).label_en || id;
const cpEn = st.coupons.map((c, i) => ({ c, i })).filter(x => x.c.text_en);
const cpIdx = {}; cpEn.forEach((x, k) => { if (SAVES.has(x.c.kind)) (x.c.stores || []).forEach(id => { if (cpIdx[id] == null) cpIdx[id] = k; }); });
const E = st.rows.map(r => {
  const o = { s: labelEn(r.store), c: r.cat, n: r.name_en || pubText(r.name), p: r.price, w: r.was, r: r.ref ?? null, v: r.verdict, f: findingEn(r), u: r.url, a: r.avail || 'in' };
  if (!r.name_en) o.ar = 1;
  const an = availEn(r); if (an) o.an = an;
  if (RK[r.refKind]) o.rk = RK[r.refKind]; if (BK[r.bk]) o.bk = BK[r.bk]; if (r.lastChecked) o.lc = r.lastChecked;
  if (pubUrl(r.refUrl)) o.ru = r.refUrl; if (r.img && /^https:\/\//.test(r.img)) o.im = r.img; if (cpIdx[r.store] != null) o.cp = cpIdx[r.store];
  if (r.ev) { const e = {}; if (r.ev.min != null) e.mn = r.ev.min; if (r.ev.max != null) e.mx = r.ev.max; if (pubUrl(r.ev.url)) e.u = r.ev.url; if (Object.keys(e).length) o.ev = e; }
  return o;
});
const offerEn = o => ({ company: o.company_en || o.company, type: o.type_en || '', headline: o.headline_en, terms: enText(o.terms_en), code: o.code || '', url: o.url });
const trEn = st.travel.filter(t => t.headline_en && t.terms_en).map(offerEn), crEn = (st.cars || []).filter(c => c.headline_en && c.terms_en).map(offerEn);
const enTplPath = path.join(ROOT, 'template/en.html');
if (!fs.existsSync(enTplPath)) throw new Error('build: template/en.html is missing — the English page is required');
let en = fs.readFileSync(enTplPath, 'utf8');
if (/[؀-ۿ]/.test(en.replace('>العربية<', '><'))) throw new Error('build: template/en.html contains Arabic text other than the language switch');
const css = (out.match(/<style>[\s\S]*?<\/style>/g) || []).map(b => b.replace(/^<style>|<\/style>$/g, '')).join('\n');
const dEn = iso => new Date(String(iso).length === 10 ? iso + 'T12:00:00+03:00' : iso);
const enFill = {
  CSS: css, CAMPAIGN_EN: M.campaign_en || 'Sale', CAMPAIGN_SHORT_EN: M.campaignShort_en || M.campaign_en || 'Sale',
  UPDATED_EN: dEn(st.meta.updated).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' }),
  CHECKED_EN: dEn(st.meta.checkedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' }),
  STORE_COUNT: String(cfg.stores.filter(s => s.enabled !== false).length), TH_ACCENT: campaignFill.TH_ACCENT, TH_ACCENT_HEX: campaignFill.TH_ACCENT_HEX,
  E_JSON: arr(E), CATS_JSON: JSON.stringify(cats.map(c => [c.id, c.label_en || c.id])),
  COUPONS_JSON: JSON.stringify(cpEn.map(x => ({ label: x.c.label_en || labelEn((x.c.stores || [])[0]), code: x.c.code || '', text: enText(x.c.text_en) }))),
  TRAVEL_JSON: JSON.stringify(trEn), CARS_JSON: JSON.stringify(crEn),
  RULE_JSON: fill.RULE_JSON,
  ARCHIVE_EN: !(M.archive || []).length ? '' : ' · Archive: ' + M.archive.map(a => `<a href="${a.href}">${a.label_en || a.href}</a>`).join(' · '),
};
for (const [k, v] of Object.entries(enFill)) en = en.split(`{{${k}}}`).join(v);
const enLeft = en.match(/{{[A-Z_]+}}/g); if (enLeft) throw new Error('build (english): unfilled ' + enLeft.join(','));
if (TRACKER.test(en)) throw new Error('build (english): the price tracker is named on the public page');
fs.mkdirSync(path.join(ROOT, 'dist/en'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/en/index.html'), en);
const noName = st.rows.filter(r => !r.name_en), warnNoEn = st.rows.filter(r => r.verdict === 'warn' && !r.finding_en && /كود|كوبون|قسيمة|Plus|بلس|السلة|عند الدفع|اشتراك/.test(r.finding || ''));
console.log(`english: dist/en/index.html (${en.length} chars) · store names ${st.rows.length - noName.length} of ${st.rows.length}`
  + (noName.length ? ` — ${noName.length} show the Arabic name: ${[...new Set(noName.map(r => r.store))].join(', ')}` : '')
  + ` · coupons ${cpEn.length} of ${st.coupons.length} · travel ${trEn.length} of ${st.travel.length} · cars ${crEn.length} of ${(st.cars || []).length}`);
if (warnNoEn.length) { console.error(`build (english): ${warnNoEn.length} row(s) state a condition in Arabic and have no finding_en — the English page would drop the condition: ${warnNoEn.slice(0, 8).map(r => r.id).join(', ')}`); process.exit(1); }

// artifact variant: no doctype/html/head/body, starts at <title>, no brand header/about section
let art = out.slice(out.indexOf('<title>')).replace(/^<title>[^<]*<\/title>/, '<title>'+(st.meta.artifactTitle||('صيدات '+campAr))+'</title>');
art = art.replace(/<header class="brand"[\s\S]*?<\/header>\n/, '')
         .replace(/<section class="about"[\s\S]*?<\/section>\n/, '')
         .replace(/<\/body>\s*<\/html>\s*$/, '');
// strip the site-only <meta>/<link>/<style> that build_site added after the artifact's own head parts
art = art.replace(/<meta name="description"[\s\S]*?<meta name="twitter:image"[^>]*>\n/, '').replace(/<style>\n\.brand[\s\S]*?<\/style>\n<\/head>\n<body>\n/, '');
fs.writeFileSync(path.join(ROOT,'dist/artifact.html'), art);

const un = st.rows.filter(r=>['oos','ended','gone'].includes(r.avail)).length;
console.log(`built dist/index.html (${out.length} chars) · rows ${st.rows.length} (${st.rows.length-un} available) · travel ${T.length}+${TNO.length} · cars ${CR.length}+${CRNO.length} · coupons ${st.coupons.length}`);
