#!/usr/bin/env node
// build.js — renders dist/index.html (public site) and dist/artifact.html (claude.ai page)
// from data/state.json + config/*.json + template/index.html. Deterministic; no network.
const fs = require('fs'), path = require('path');
const { arNum, longDate, shortDate, time12, countWord } = require('./lib/ar');
// Every outside value goes through one of these on its way to the page (22 Nov 2026 audit, SEC-F1 to F4): see lib/safe.js.
const { cleanHttps, cleanOrAbsent, jsonForScript: J, escHtml: H, boldOnly } = require('./lib/safe');
const ROOT = __dirname;
const cfg  = JSON.parse(fs.readFileSync(path.join(ROOT,'config/stores.json'),'utf8'));
const catsCfg = JSON.parse(fs.readFileSync(path.join(ROOT,'config/categories.json'),'utf8'));
// categories.json may be a plain array (old shape) or { chips, map, fallback } (new shape)
const cats = Array.isArray(catsCfg) ? catsCfg : catsCfg.chips;
// Wallet vocabulary (20 Nov 2026): the cards and memberships a coupon may be tagged with. A wallet
// option reaches the page only when a published coupon carries its id, so an empty wallet shows nothing.
const walletPath = path.join(ROOT,'config/wallet.json');
const walletCfg = fs.existsSync(walletPath) ? JSON.parse(fs.readFileSync(walletPath,'utf8')).items : [];
const walletById = Object.fromEntries(walletCfg.map(w => [w.id, w]));
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
// A row is published only when it has a name in BOTH languages (Mahmoud, 20 Nov 2026). The Arabic
// name comes from the store's Arabic page and the English one from its English page; neither is
// ever translated, so a row with one of them missing would show the wrong language on one of the
// two pages. It is held back from both pages, stays in state so the next run reads its name again,
// and is counted here and in the `english:` line. See RUNBOOK §2d.
let heldNoName = [];
const heldByStore = () => { const by = {}; heldNoName.forEach(r => { by[r.store] = (by[r.store] || 0) + 1; }); return Object.entries(by).map(([s, n]) => `${s} ${n}`).join(', '); };
{
  heldNoName = st.rows.filter(r => !String(r.name || '').trim() || !String(r.name_en || '').trim());
  if (heldNoName.length) { st.rows = st.rows.filter(r => !heldNoName.includes(r)); console.log(`held back ${heldNoName.length} rows with no name in both languages: ${heldByStore()}`); }
}
// Links (22 Nov 2026 audit, SEC-F3). A row's link to the store, its compared-product link and its
// evidence link are published only as clean https addresses (lib/safe.js). A row with a link that
// fails is held back from both pages and named here: it stays in state, and the next check of its
// store can correct the link. A travel or car offer whose own link fails is held back the same way.
// A picture that fails is simply not shown, as before. Nothing here fails the build: one bad link
// from one store must not stop every other store's rows from being published.
let heldBadLink = [];
{
  const badLink = r => !cleanHttps(r.url) || !cleanOrAbsent(r.refUrl) || !cleanOrAbsent(r.ev && r.ev.url);
  heldBadLink = st.rows.filter(badLink);
  if (heldBadLink.length) {
    st.rows = st.rows.filter(r => !heldBadLink.includes(r));
    const by = {}; heldBadLink.forEach(r => { by[r.store] = (by[r.store] || 0) + 1; });
    console.log(`held back ${heldBadLink.length} rows with a link that is not a clean https address: ${Object.entries(by).map(([s, n]) => `${s} ${n}`).join(', ')} (${heldBadLink.slice(0, 8).map(r => r.id).join(', ')}${heldBadLink.length > 8 ? ', …' : ''})`);
  }
  const offers = (list, what) => { const bad = (list || []).filter(o => !cleanHttps(o.url)); if (bad.length) console.log(`held back ${bad.length} ${what} offer(s) with a link that is not a clean https address: ${bad.map(o => String(o.company || '').slice(0, 30)).join(', ')}`); return (list || []).filter(o => cleanHttps(o.url)); };
  st.travel = offers(st.travel, 'travel');
  if (st.cars) st.cars = offers(st.cars, 'car');
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
// Which store a cross-store reference came from, for «نفس الموديل لدى …» on the card. Read from the
// row's refStore if the pipeline wrote one, else from the host of its refUrl. Never guessed: with
// neither, the card says «في متجر آخر» and the finding carries the name.
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
const refStore = (r, lab) => {
  if (r.refKind !== 'market') return '';
  if (r.refStore && storeById[r.refStore]) return lab(r.refStore);
  const h = hostOf(pubUrl(r.refUrl) || ''); if (!h) return '';
  const s = cfg.stores.find(s => s.id !== r.store && s.origin && hostOf(s.origin) === h);
  return s ? lab(s.id) : '';
};
// The card's finding, for display. Where the record shows a lower price than today's, say how much
// lower in riyals (20 Nov review: «سبق ونزل ١٬٤٩٩» did not tell a shopper why the row is a caveat).
// Built from ev.min and the live price; the stored finding is left as written if its number is not ev.min.
const arN = v => Number(v).toLocaleString('ar-SA', { maximumFractionDigits: 0 });
const latin = t => String(t).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٬,]/g, '');
const findingAr = r => {
  const f = pubText(r.finding), mn = r.ev && r.ev.min;
  if (typeof f !== 'string' || r.refKind === 'market' || mn == null || !(mn < r.price)) return f;
  return f.replace(/سبق ونزل\s*([\d٠-٩][\d٠-٩٬,]*)(\s*ر\.س)?/, (m, n) => Number(latin(n)) === Math.round(mn)
    ? `سبق أن وصل إلى ${arN(mn)} ر.س، أي أقل من سعر اليوم بـ ${arN(Math.round(r.price - mn))} ر.س` : m);
};
const D = st.rows.map(r => {
  const a = [label(r.store), r.cat, pubText(r.name), r.price, r.was, r.ref ?? null, r.verdict, findingAr(r), r.url];
  const x = {};
  if (r.avail && r.avail !== 'in') x.a = r.avail;
  if (r.availNote) x.an = pubText(r.availNote);
  if (RK[r.refKind]) x.rk = RK[r.refKind];
  if (BK[r.bk]) x.bk = BK[r.bk];
  if (r.lastChecked) x.lc = r.lastChecked;
  if (pubUrl(r.refUrl)) x.ru = r.refUrl;
  { const rs = refStore(r, label); if (rs) x.rs = rs; }
  // product picture (20 Nov 2026): the store's own image URL, read from its product page. Shown by
  // hotlink with no referrer; a card without one falls back to a neutral tile.
  if (cleanHttps(r.img)) x.im = r.img;
  if (r.id) x.id = r.id;   // for the share link (?d=<id>) that opens the page on this card
  // q = the finding is the plain default («كان X», optionally «أقل سعر مسجل»): the card's strip already
  // says it, so the card does not repeat it. Anything else (a caveat, a condition) is always printed.
  if (r.verdict === 'ok' && r.refKind === 'history' && /^كان\s*[\d٠-٩٬,.]+(\s*·\s*أقل سعر مسجل)?$/.test(String(r.finding || '').trim())) x.q = 1;
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
// J (lib/safe.js) is JSON.stringify made safe for an inline <script>: every value the page's script receives goes through it.
const arr = rows => '[\n' + rows.map(r => J(r)).join(',\n') + '\n]';

// ---- chips from config ----
const liveCats = cats.filter(c => !st.rows.length || st.rows.some(r => r.cat === c.id));
const catChips = liveCats.map(c => `        <button data-g="c" data-f="${c.id}">${c.label}</button>`).join('\n');
const storeChips = cfg.groups.map(g => {
  const btns = cfg.stores.filter(s=>s.group===g.id && s.enabled!==false && (!st.rows.length || st.rows.some(r=>r.store===s.id))).map(s=>`        <button data-g="s" data-f="${s.label}">${s.label}</button>`);
  const sub  = `<span class="fsub${g.cssClass?' '+g.cssClass:''}">${g.label}</span>`;
  return btns.length ? `        <div class="sgrp">${sub}\n${btns.join('\n')}</div>` : '';
}).join('\n');
// The English page gets the same grouped store chips. data-f is the English store label, which is
// what its rows carry (E[].s).
const storeChipsEn = cfg.groups.map(g => {
  const btns = cfg.stores.filter(s=>s.group===g.id && s.enabled!==false && (!st.rows.length || st.rows.some(r=>r.store===s.id))).map(s=>`        <button type="button" data-g="s" data-f="${s.label_en || s.id}">${s.label_en || s.id}</button>`);
  const sub  = `<span class="fsub${g.cssClass?' '+g.cssClass:''}">${g.label_en || g.id}</span>`;
  return btns.length ? `        <div class="sgrp">${sub}\n${btns.join('\n')}</div>` : '';
}).join('\n');

// ---- note cards ----
const b = t => `<b style="display:inline">${t}</b>`;
const inl = t => t.replace(/<b>/g,'<b style="display:inline">');
// Each coupon gets its own anchor so a product row can point straight at it (🎟️ beside the store).
const couponLis = st.coupons.map((c, i) => {
  // store-written wording is escaped; only <b> in the coupon text stays live (SEC-F4)
  const code = c.code ? ` — كود ${b(H(c.code))} <button type="button" class="cpy" data-code="${H(c.code)}">نسخ الكود</button> ` : ' — ';
  return `<li id="coupon-${i}">${b(H(c.label))}${code}${inl(boldOnly(c.text))}</li>`;
}).join('');
// Top of page: a one-line pointer, same shape as the travel one. The list itself lives below the table.
const couponsNote = `<a class="note notelink" href="#coupons"><b>🎟️ قسائم وأكواد إضافية</b>خصومات فوق السعر المعروض: أكواد المتاجر وعروض البطاقات البنكية، وما تشترطه فعلاً.<span class="cta">اضغط هنا لعرض القسائم ↓</span></a>`;
// (21 Nov 2026) cards, drawn in the page from CPX like the travel cards; the list above stays for the artifact variant only
const couponsSection = `<section class="couponsec" id="coupons" aria-labelledby="cp-h"><h2 id="cp-h">قسائم وأكواد إضافية</h2><p class="lede">كل كود وعرض بطاقة هنا منقول من صفحة المتجر نفسه اليوم، مع ما يشترطه فعلاً. اضغط على الكود لنسخه.</p><div class="tcards cpcards" id="cpcards"></div><noscript><ul class="cplist">${couponLis}</ul></noscript><p class="cpfoot">أسعار المنتجات المعروضة ${b('قبل')} تطبيق هذه القسائم.</p></section>`;
// A coupon card's headline: the short perk, or the store's own quoted words without the «use code X» tail (the code has its own button).
const cpHead = (perk, text) => { if (perk) return String(perk).replace(/\s*·\s*(الرمز|الكود|code)\s+\S+\s*$/i, '').trim();
  const m = String(text || '').match(/[«“"]([^»”"]{3,160})[»”"]/); return m ? m[1].replace(/\s*\|\s*(?:(?:إ|ا)?ستخدم|use)[^|]*$/i, '').trim() : ''; };
// store label -> index of the first coupon that applies, so the table can link to it
const couponBy = {};
// only real savings earn the 🎟️ — a 'none' entry ('we found no code') or the Trendyol
// 'note' caveat would send a shopper to something that saves them nothing.
const SAVES = new Set(['code', 'voucher', 'bank', 'auto']);
// A coupon tied to a card, a wallet or a membership (it carries `wallet`) is NOT the store's own
// code: Amazon's ARB20 works only with an Al Rajhi credit card, and printing it on every Amazon
// card as «the store's code» would send everyone else to a code that does nothing. Those offers
// reach a product card through the wallet line, for the visitor who picked that card (20 Nov 2026).
const general = c => SAVES.has(c.kind) && !(c.wallet || []).length;
st.coupons.forEach((c, i) => { if (!general(c)) return; (c.stores || []).forEach(id => { if (couponBy[label(id)] == null) couponBy[label(id)] = i; }); });

const on = id => storeById[id] && storeById[id].enabled !== false;
const fs_ = Object.fromEntries(Object.entries(st.notes.furnitureShare || {}).filter(([id]) => on(id)));
const shareList = Object.entries(fs_).sort((a,b)=>b[1].pct-a[1].pct)
  .map(([id,v]) => `${label(id)} ${arNum(v.pct)}٪${v.detail?` (${H(v.detail)})`:''}`).join('، ');
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
  // quick links under the stamp: one short line instead of the three pointer cards that used to push the products down
  TOP_LINKS: '',
  // furniture wording follows the enabled stores, so a campaign without them does not describe them
  HOW_FURNITURE: (on('ashley') && on('midas')) ? '، وأشلي مقابل ميداس في الأثاث' : '',
  METHOD_IKEA: !on('ikea') ? '' : `<li><b>إيكيا</b>: منتجاتها لا تُباع في متاجر أخرى ولا يوجد لها سجل أسعار عام، لذلك تظهر كـ «غير متحقق» مع مدة العرض الرسمية.</li>\n      `,
  METHOD_FURNITURE: !hasFurn ? '' : `      <li><b>متاجر الأثاث</b>: أشلي وميداس تبيعان نفس سلاسل أشلي (بولانبرغ، سكيمبتون، مودماكس…)، فقارنّا سعر القطعة نفسها بين المتجرين. هوم سنتر وهوم بوكس وبان هوم وسيتي دبليو وبيتونيا تبيع موديلات خاصة بها لا توجد في متاجر أخرى ولا يوجد لها سجل أسعار عام، فتظهر كـ «غير متحقق» مع نسبة المنتجات «المخفّضة» في المتجر.</li>\n`,
  ARCHIVE_LINKS: !(M.archive || []).length ? '' : ' · الأرشيف: ' + M.archive.map(a => `<a href="${a.href}">${a.label}</a>`).join(' · '),
};

// ---- brand mark and the three hero panels (21 Nov 2026) ----
// template/logo.svg is the brand mark, the same in every campaign: the header shows it beside the name and the tab uses it as the icon.
const LOGO = fs.readFileSync(path.join(ROOT, 'template/logo.svg'), 'utf8').trim().replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(fs.readFileSync(path.join(ROOT, 'template/logo.svg'), 'utf8').trim());
// Coupons, travel and cars sit as three panels in the hero (Mahmoud, 21 Nov 2026: «why there's no panel for them at the
// beginning», as on the National Day page). A panel says what is behind it; one with nothing checked yet says so and links nowhere.
const PIC = {
  cp: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2.5a2.5 2.5 0 0 0 0 5V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4.5a2.5 2.5 0 0 0 0-5z"/><path d="M14 5v2M14 11v2M14 17v2"/></svg>',
  tr: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 13.5 3 11l1.5-1.5 7.5 1L16.5 6a2 2 0 0 1 3 3l-4.5 4.5 1 7.5-1.5 1.5-2.5-7.5-3 3V21l-1.5 1-1.5-3-3-1.5 1-1.5h2.5z"/></svg>',
  cr: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14v-4.5l-2-5A1.5 1.5 0 0 0 15.6 6.5H8.4A1.5 1.5 0 0 0 7 7.5l-2 5z"/><path d="M5 12.5h14"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/></svg>',
};
const panel = (on, href, icon, title, status) => on
  ? `<a class="panel" href="${href}"><span class="pic">${icon}</span><span class="ptx"><b>${title}</b><span>${status}</span></span><span class="parr" aria-hidden="true">↓</span></a>`
  : `<div class="panel off"><span class="pic">${icon}</span><span class="ptx"><b>${title}</b><span>${status}</span></span></div>`;
const arCount = (n, one, two, few, many) => n === 1 ? one : n === 2 ? two : n <= 10 ? `${arN(n)} ${few}` : `${arN(n)} ${many}`;
const andAr = xs => xs.length < 2 ? (xs[0] || '') : xs.slice(0, -1).join('، ') + ' و' + xs[xs.length - 1];
const andEn = xs => xs.length < 2 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
const cpSave = st.coupons.filter(c => SAVES.has(c.kind));
const cpStores = [...new Set(cpSave.flatMap(c => c.stores || []))];
const trOn = st.travel.length, trChecked = st.travelNone.length, crOn = (st.cars || []).length, crChecked = (st.cars || []).length + (st.carsNone || []).length;
const forShort = forAr(campShort);
const panelsAr = `<nav class="panels" aria-label="القسائم وعروض السفر والسيارات">`
  + panel(cpSave.length > 0, '#coupons', PIC.cp, 'القسائم والأكواد', cpSave.length ? `${arCount(cpSave.length, 'عرض واحد', 'عرضان', 'أكواد وعروض بطاقات', 'كوداً وعرض بطاقة')} · ${andAr(cpStores.map(label))}` : `لا أكواد مؤكدة ${forShort} بعد`)
  + panel(trOn + trChecked > 0, '#travel', PIC.tr, 'عروض السفر', trOn ? `${arCount(trOn, 'عرض واحد', 'عرضان', 'عروض', 'عرضاً')} من شركات الطيران والحجز` : trChecked ? `فحصنا ${arCount(trChecked, 'شركة واحدة', 'شركتين', 'شركات', 'شركة')}: لا عرض ${forShort} بعد` : 'تُفحص في التحديث القادم')
  + panel(crChecked > 0, '#cars', PIC.cr, 'عروض السيارات', crOn ? `${arCount(crOn, 'عرض واحد', 'عرضان', 'عروض', 'عرضاً')} (${andAr(st.cars.map(c => H(String(c.company || '').replace(/\s*\(.*\)$/, ''))))})${(st.carsNone || []).length ? ` · فحصنا ${arCount(st.carsNone.length, 'جهة أخرى', 'جهتين أخريين', 'جهات أخرى', 'جهة أخرى')}` : ''}` : crChecked ? `فحصنا ${arCount(crChecked, 'جهة واحدة', 'جهتين', 'جهات', 'جهة')}: لا عرض ${forShort} بعد` : 'تُفحص في التحديث القادم')
  + `</nav>`;
const enCount = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const cpSaveEn = cpSave.filter(c => c.text_en), campShortEn = M.campaignShort_en || M.campaign_en || 'sale';
const panelsEn = `<nav class="panels" aria-label="Coupons, travel and car offers">`
  + panel(cpSaveEn.length > 0, '#coupons', PIC.cp, 'Coupons and codes', cpSaveEn.length ? `${cpSaveEn.length} codes and card offers · ${andEn([...new Set(cpSaveEn.flatMap(c => c.stores || []))].map(id => (storeById[id] || {}).label_en || id))}` : `No confirmed ${campShortEn} codes yet`)
  + panel(trOn + trChecked > 0, '#travel', PIC.tr, 'Travel offers', trOn ? `${enCount(trOn, 'offer')} from airlines and booking sites` : trChecked ? `Checked ${enCount(trChecked, 'company')}: no ${campShortEn} offer yet` : 'Checked in the next update')
  + panel(crChecked > 0, '#cars', PIC.cr, 'Car offers', crOn ? `${enCount(crOn, 'offer')} (${andEn(st.cars.map(c => H(String(c.company_en || c.company || '').replace(/\s*\(.*\)$/, ''))))})${(st.carsNone || []).length ? ` · ${st.carsNone.length} more checked` : ''}` : crChecked ? `Checked ${enCount(crChecked, 'company')}: no ${campShortEn} offer yet` : 'Checked in the next update')
  + `</nav>`;

// ---- measurement: Google Tag Manager (22 Nov 2026) ----
// config/site.json holds the container id. An empty or missing gtmId builds both pages with no tag and
// the old privacy sentence; a set one writes Google's two snippets and the sentence that says so.
// The page's own events (outbound_store_click, copy_code, wallet_filter_used) are in both templates.
const sitePath = path.join(ROOT, 'config/site.json');
const siteCfg = fs.existsSync(sitePath) ? JSON.parse(fs.readFileSync(sitePath, 'utf8')) : {};
const GTM_ID = String(siteCfg.gtmId || '').trim();
if (GTM_ID && !/^GTM-[A-Z0-9]{4,12}$/.test(GTM_ID)) throw new Error(`build: config/site.json gtmId "${GTM_ID}" is not a GTM container id (GTM-XXXXXXX)`);
const plainText = (t, d) => { const s = String(t || d); if (/[<>&"]/.test(s)) throw new Error('build: config/site.json service names must be plain text'); return s; };
const measureFill = {
  GTM_HEAD: !GTM_ID ? '' : `\n<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');</script>`,
  GTM_BODY: !GTM_ID ? '' : `\n<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`,
  PRIVACY_STATS_AR: !GTM_ID ? 'نستخدم إحصاءات Cloudflare التي لا تستخدم ملفات تعريف الارتباط ولا تجمع بيانات شخصية.'
    : `نستخدم إحصاءات Cloudflare، ونستخدم Google Tag Manager لقياس الزيارات وثلاثة أنواع من النقرات: فتح صفحة متجر، نسخ كود، واستخدام فلتر البطاقات (دون اسم البطاقة). خدمات القياس والإعلان التي تعمل من خلاله (${plainText(siteCfg.services_ar, 'Google')}) قد تستخدم ملفات تعريف الارتباط ومعرّف جهازك لقياس الزيارات والإعلانات.`,
  PRIVACY_STATS_EN: !GTM_ID ? 'we use Cloudflare analytics, which sets no cookies and collects no personal data.'
    : `we use Cloudflare analytics, and Google Tag Manager to measure visits and three kinds of click: opening a store page, copying a code, and using the card filter (never which card). The measurement and advertising services that run through it (${plainText(siteCfg.services_en, 'Google')}) may set cookies and use your device’s identifiers to measure visits and ads.`,
};

// ---- fill ----
const fill = {
  ...campaignFill,
  GTM_HEAD: measureFill.GTM_HEAD, GTM_BODY: measureFill.GTM_BODY, PRIVACY_STATS_AR: measureFill.PRIVACY_STATS_AR,
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
  RULE_JSON: J({ okMin: rules.verdict.okMin, warnMin: rules.verdict.warnMin, okSavingTiers: rules.verdict.okSavingTiers || [] }),
  CATEGORY_CHIPS: catChips,
  STORE_CHIPS: storeChips,
  CBY_JSON: J(couponBy),
  CPX_JSON: J(st.coupons.map(c => ({ c: c.code || '', k: c.kind || '', s: (c.stores || []).map(label), w: (c.wallet || []).filter(id => walletById[id]), nw: (c.walletNot || []).filter(id => walletById[id]), p: pubText(c.perk || ''), l: pubText(c.label || ''), h: pubText(cpHead(c.perk, c.text)), t: pubText(c.text || '') }))),
  LOGO_SVG: LOGO, FAVICON: FAVICON, TOP_PANELS: panelsAr,
  WALLET_JSON: J(walletCfg.filter(w => st.coupons.some(c => SAVES.has(c.kind) && (c.wallet || []).includes(w.id))).map(w => ({ id: w.id, l: w.label }))),
  CAMPAIGN_END: String(M.campaignEnd || ''), D_JSON: arr(D), T_JSON: arr(T), TNO_JSON: J(TNO), TNONE_JSON: J(st.travelNone_text||''),
  CR_JSON: arr(CR), CRNO_JSON: J(CRNO),
};
fill.STORE_COUNT_AR = countWord(cfg.stores.filter(s=>s.enabled!==false).length); // disabled stores (no working storefront) are not counted // "الستة عشر" etc. — the template keeps the word order "المتاجر {{n}}"
let out = tpl;
for (const [k,v] of Object.entries(fill)) out = out.split(`{{${k}}}`).join(v);
const left = out.match(/{{[A-Z_]+}}/g); if (left) throw new Error('unfilled: '+left.join(','));
if (TRACKER.test(out) || /كان ?بكام/.test(out)) throw new Error('build: the price tracker is named on the public page — scrub it (see TRACKER above)');
// Each page has exactly one script block, the template's own (SEC-F2). A second opening or closing tag means text from a
// store reached the page as markup: stop, and publish nothing, rather than ship a page that runs it or shows no cards.
const oneScript = (html, page) => { const o = (html.match(/<script\b/gi) || []).length, c = (html.match(/<\/script/gi) || []).length;
  if (o !== 1 || c !== 1) throw new Error(`build${page}: the page must hold exactly one <script> and one </script>, found ${o} and ${c} — outside text has reached the page unescaped (see lib/safe.js)`); };
oneScript(out.replace(measureFill.GTM_HEAD, ''), '');   // Google's head snippet is written by this build from config/site.json, it is not outside text

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
  if (r.refKind !== 'market' && mn != null) parts.push(r.price <= mn * 1.01 ? 'lowest recorded price' : (mn < r.price ? `has been as low as ${enN(mn)} SAR, ${enN(Math.round(r.price - mn))} SAR below today’s price` : ''));
  if (r.bk === 'cheaper') parts.push('cheaper elsewhere'); if (r.bk === 'rose') parts.push('the price went up'); if (r.bk === 'nosaving') parts.push('no real saving');
  if (r.refKind !== 'market' && r.was && r.was > r.ref * 1.05) parts.push(`the advertised “before” of ${enN(r.was)} SAR is not in the record`);
  return parts.filter(Boolean).join(' · ');
};
const availEn = r => { if (r.availNote_en) return r.availNote_en; const m = String(r.availNote || '').match(/متبقي\s*([\d٠-٩]+)/); return m ? `${m[1].replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))} left` : ''; };
const labelEn = id => (storeById[id] || {}).label_en || id;
const cpEn = st.coupons.map((c, i) => ({ c, i })).filter(x => x.c.text_en);
const cpIdx = {}; cpEn.forEach((x, k) => { if (general(x.c)) (x.c.stores || []).forEach(id => { if (cpIdx[id] == null) cpIdx[id] = k; }); });
const E = st.rows.map(r => {
  const o = { s: labelEn(r.store), c: r.cat, n: r.name_en || pubText(r.name), p: r.price, w: r.was, r: r.ref ?? null, v: r.verdict, f: findingEn(r), u: r.url, a: r.avail || 'in' };
  if (!r.name_en) o.ar = 1;
  const an = availEn(r); if (an) o.an = an;
  if (RK[r.refKind]) o.rk = RK[r.refKind]; if (BK[r.bk]) o.bk = BK[r.bk]; if (r.lastChecked) o.lc = r.lastChecked;
  if (pubUrl(r.refUrl)) o.ru = r.refUrl; { const rs = refStore(r, labelEn); if (rs) o.rs = rs; } if (cleanHttps(r.img)) o.im = r.img; if (cpIdx[r.store] != null) o.cp = cpIdx[r.store]; if (r.id) o.id = r.id; if (!r.finding_en && r.verdict === 'ok' && r.refKind === 'history') o.q = 1;
  if (r.ev) { const e = {}; if (r.ev.min != null) e.mn = r.ev.min; if (r.ev.max != null) e.mx = r.ev.max; if (pubUrl(r.ev.url)) e.u = r.ev.url; if (Object.keys(e).length) o.ev = e; }
  return o;
});
const offerEn = o => ({ company: o.company_en || o.company, type: o.type_en || '', headline: o.headline_en, terms: enText(o.terms_en), code: o.code || '', url: o.url, v: o.verdict || '', bs: o.bookStart || '', be: o.bookEnd || '', ck: o.checked || '', win: o.travelWindow_en || o.window_en || '' });
const trEn = st.travel.filter(t => t.headline_en && t.terms_en).map(offerEn), crEn = (st.cars || []).filter(c => c.headline_en && c.terms_en).map(offerEn);
const enTplPath = path.join(ROOT, 'template/en.html');
if (!fs.existsSync(enTplPath)) throw new Error('build: template/en.html is missing — the English page is required');
let en = fs.readFileSync(enTplPath, 'utf8');
if (/[؀-ۿ]/.test(en.replace('>العربية<', '><'))) throw new Error('build: template/en.html contains Arabic text other than the language switch');
// The filter bar is ONE design in two languages (Mahmoud, 20 Nov 2026): the three lines under the
// campaign band (summary pills · «تصفية» / Filters with the sort and the count · category pills) and
// the folded panel behind them. The English template must carry the same controls as the Arabic
// one; a control added to one and not the other stops the build instead of shipping two layouts.
{
  const arTpl = fs.readFileSync(path.join(ROOT, 'template/index.html'), 'utf8');
  const ids = ['stats', 'sfact', 'filters', 'ftoggle', 'fthint', 'ftn', 'fsel', 'fbody', 'pmin', 'pmax', 'sortby', 'fcount', 'freset'];
  const chips = t => [...t.matchAll(/data-g="([av])" data-f="([a-z]+)"/g)].map(m => m[1] + ':' + m[2]).join(' ');
  const sorts = t => ((t.match(/<select id="sortby">[\s\S]*?<\/select>/) || [''])[0].match(/<option/g) || []).length;
  const miss = ids.filter(id => !en.includes(`id="${id}"`) || !arTpl.includes(`id="${id}"`));
  if (miss.length || chips(arTpl) !== chips(en) || sorts(arTpl) !== sorts(en) || !en.includes('{{STORE_CHIPS_EN}}'))
    throw new Error(`build: the filter bar differs between template/index.html and template/en.html — ids missing: ${miss.join(', ') || 'none'} · chips ar [${chips(arTpl)}] en [${chips(en)}] · sort options ar ${sorts(arTpl)} en ${sorts(en)}`);
}
const css = (out.match(/<style>[\s\S]*?<\/style>/g) || []).map(b => b.replace(/^<style>|<\/style>$/g, '')).join('\n');
const dEn = iso => new Date(String(iso).length === 10 ? iso + 'T12:00:00+03:00' : iso);
const enFill = {
  GTM_HEAD: measureFill.GTM_HEAD, GTM_BODY: measureFill.GTM_BODY, PRIVACY_STATS_EN: measureFill.PRIVACY_STATS_EN,
  CSS: css, CAMPAIGN_EN: M.campaign_en || 'Sale', CAMPAIGN_SHORT_EN: M.campaignShort_en || M.campaign_en || 'Sale',
  UPDATED_EN: dEn(st.meta.updated).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' }),
  CHECKED_EN: dEn(st.meta.checkedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' }),
  STORE_COUNT: String(cfg.stores.filter(s => s.enabled !== false).length), TH_ACCENT: campaignFill.TH_ACCENT, TH_ACCENT_HEX: campaignFill.TH_ACCENT_HEX,
  E_JSON: arr(E), CATS_JSON: J(cats.map(c => [c.id, c.label_en || c.id])), STORE_CHIPS_EN: storeChipsEn,
  COUPONS_JSON: J(cpEn.map(x => ({ label: x.c.label_en || labelEn((x.c.stores || [])[0]), code: x.c.code || '', text: enText(x.c.text_en), k: x.c.kind || '', s: (x.c.stores || []).map(labelEn), w: (x.c.wallet || []).filter(id => walletById[id]), nw: (x.c.walletNot || []).filter(id => walletById[id]), p: enText(x.c.perk_en || ''), h: enText(cpHead(x.c.perk_en, x.c.text_en)) }))),
  TRNO_JSON: J(st.travelNone.filter(t => t.company_en).map(t => [t.company_en, t.type_en || ''])), CRNO_JSON: J((st.carsNone || []).filter(c => c.company_en).map(c => [c.company_en, c.type_en || ''])),
  TNONE_EN_JSON: J(st.travelNone_text_en || ''), LOGO_SVG: LOGO, FAVICON: FAVICON, TOP_PANELS_EN: panelsEn,
  WALLET_JSON: J(walletCfg.filter(w => w.label_en && cpEn.some(x => SAVES.has(x.c.kind) && (x.c.wallet || []).includes(w.id))).map(w => ({ id: w.id, l: w.label_en }))),
  CAMPAIGN_END: String(M.campaignEnd || ''),
  TRAVEL_JSON: J(trEn), CARS_JSON: J(crEn),
  RULE_JSON: fill.RULE_JSON,
  ARCHIVE_EN: !(M.archive || []).length ? '' : ' · Archive: ' + M.archive.map(a => `<a href="${a.href}">${a.label_en || a.href}</a>`).join(' · '),
};
for (const [k, v] of Object.entries(enFill)) en = en.split(`{{${k}}}`).join(v);
const enLeft = en.match(/{{[A-Z_]+}}/g); if (enLeft) throw new Error('build (english): unfilled ' + enLeft.join(','));
if (TRACKER.test(en)) throw new Error('build (english): the price tracker is named on the public page');
oneScript(en.replace(measureFill.GTM_HEAD, ''), ' (english)');
fs.mkdirSync(path.join(ROOT, 'dist/en'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/en/index.html'), en);
const noName = st.rows.filter(r => !r.name_en), warnNoEn = st.rows.filter(r => r.verdict === 'warn' && !r.finding_en && /كود|كوبون|قسيمة|Plus|بلس|السلة|عند الدفع|اشتراك/.test(r.finding || ''));
console.log(`english: dist/en/index.html (${en.length} chars) · store names ${st.rows.length - noName.length} of ${st.rows.length}`
  + (noName.length ? ` — ${noName.length} show the Arabic name: ${[...new Set(noName.map(r => r.store))].join(', ')}` : '')
  + (heldNoName.length ? ` · held back, no name in both languages: ${heldNoName.length} (${heldByStore()})` : '')
  + ` · coupons ${cpEn.length} of ${st.coupons.length} · travel ${trEn.length} of ${st.travel.length} · cars ${crEn.length} of ${(st.cars || []).length}`);
if (warnNoEn.length) { console.error(`build (english): ${warnNoEn.length} row(s) state a condition in Arabic and have no finding_en — the English page would drop the condition: ${warnNoEn.slice(0, 8).map(r => r.id).join(', ')}`); process.exit(1); }

// artifact variant: no doctype/html/head/body, starts at <title>, no brand header/about section
let art = out.slice(out.indexOf('<title>')).replace(/^<title>[^<]*<\/title>/, '<title>'+(st.meta.artifactTitle||('صيدات '+campAr))+'</title>');
art = art.replace(/<header class="brand"[\s\S]*?<\/header>\n/, '')
         .replace(/<section class="about"[\s\S]*?<\/section>\n/, '')
         .replace(/<\/body>\s*<\/html>\s*$/, '');
// strip the site-only <meta>/<link>/<style> that build_site added after the artifact's own head parts
art = art.replace(/<meta name="description"[\s\S]*?<meta name="twitter:image"[^>]*>\n/, '').replace(/<style>\n\.brand[\s\S]*?<\/style>\n<\/head>\n<body>(?:\n<noscript><iframe src="https:\/\/www\.googletagmanager\.com[^\n]*<\/noscript>)?\n/, '');
fs.writeFileSync(path.join(ROOT,'dist/artifact.html'), art);

const un = st.rows.filter(r=>['oos','ended','gone'].includes(r.avail)).length;
console.log(GTM_ID ? `measurement: Google Tag Manager ${GTM_ID} on both pages` : 'measurement: off (config/site.json has no gtmId), no tag on either page');
console.log(`built dist/index.html (${out.length} chars) · rows ${st.rows.length} (${st.rows.length-un} available) · travel ${T.length}+${TNO.length} · cars ${CR.length}+${CRNO.length} · coupons ${st.coupons.length}`);
