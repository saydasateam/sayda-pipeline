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
  // App subscription offers (BLD-27, RUNBOOK §3c). The rule takes only an offer that the app's or the bank's own page states
  // with an end date, and the card prints its terms and the day we read them. So besides a clean https link, an offer with
  // no app name, headline, terms, check date or end date is held back and named here. Nothing here fails the build.
  st.subs = offers(st.subs, 'subscription');
  { const day = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')), has = v => !!String(v || '').trim();
    const why = o => !has(o.company) ? 'no app name' : !has(o.headline) ? 'no headline' : !has(o.terms) ? 'no terms' : !day(o.checked) ? 'no check date'
      : !day(o.bookEnd) ? 'no end date' : (has(o.bookStart) && !day(o.bookStart)) ? 'a start date that is not YYYY-MM-DD' : '';
    const bad = st.subs.filter(why);
    if (bad.length) { console.log(`held back ${bad.length} subscription offer(s): ${bad.map(o => `${String(o.company || '?').slice(0, 30)} (${why(o)})`).join(', ')}`); st.subs = st.subs.filter(o => !why(o)); } }
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
// BLD-28 (D25, 23 Nov 2026): a market row's link opens the model on the other store's own page. Rows compared before that
// may still hold the comparator's page as refUrl, which pubUrl hides, so their card had no link. Where that page is a
// KanBkam Amazon address the card now links Amazon's own /dp/ page and names Amazon (lib/market.js → ownListingUrl, the
// same rule scripts/market-apply.js writes by). Build-time only: the stored row is corrected at its next comparison (§3b).
{ const { ownListingUrl } = require('./lib/market');
  const mk = st.rows.filter(r => r.refKind === 'market');
  let fixed = 0; for (const r of mk) { if (!TRACKER.test(String(r.refUrl || ''))) continue; const o = ownListingUrl({ url: r.refUrl }, cfg.stores, r.store); if (o) { r.refUrl = o.url; if (!r.refStore) r.refStore = o.store; fixed++; } }
  const own = mk.filter(r => pubUrl(r.refUrl) && cleanHttps(r.refUrl)).length;
  console.log(`market links: ${own} of ${mk.length} market rows link the other store's own page${fixed ? ` (${fixed} read from a comparator Amazon address)` : ''}${mk.length - own ? ` · ${mk.length - own} show no link until their next comparison` : ''}`); }
const pubText = t => typeof t === 'string' ? t.replace(TRACKER_AR, 'سجل الأسعار').replace(/kanbkam/gi, 'سجل الأسعار') : t;
// (23 Nov 2026, Mahmoud: «yes for both») A store's own Arabic title can be a word-for-word machine translation of a brand's
// product name: Amazon's «جوجل - زجاج اكسبلورر 2.0» for Google Glass, where «زجاج» is the material. For the row ids listed in
// config/names.json → arShowsStoreEnglish the Arabic page shows the store's own English title (name_en) instead. Still the
// store's words, never ours: nothing is translated. A row joins the list only on Mahmoud's word; a run never edits it.
const namesPath = path.join(ROOT, 'config/names.json');
const namesCfg = fs.existsSync(namesPath) ? JSON.parse(fs.readFileSync(namesPath, 'utf8')) : {};
const AR_EN = new Set(Object.keys(namesCfg.arShowsStoreEnglish || {}).filter(k => !k.startsWith('_')));
const arName = r => (AR_EN.has(r.id) && String(r.name_en || '').trim()) ? r.name_en : pubText(r.name);
if (AR_EN.size) { const on = st.rows.filter(r => AR_EN.has(r.id) && String(r.name_en || '').trim()).map(r => r.id); console.log(`names: ${on.length} of ${AR_EN.size} listed rows show the store's English title on the Arabic page${on.length ? ' (' + on.join(', ') + ')' : ''}`); }
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
  const a = [label(r.store), r.cat, arName(r), r.price, r.was, r.ref ?? null, r.verdict, findingAr(r), r.url];
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
// «No offer» cards (BLD-33): each entry in travelNone / carsNone carries `checked`, the Riyadh day its company's own page was
// last read and showed no offer (RUNBOOK §3, §3a). The card prints that day. An entry with no valid day, or a day after today,
// prints no date at all: the page never states a check that did not happen. Named below so the next full run fills it in.
const RIYADH_TODAY = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const noneDay = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && String(d) <= RIYADH_TODAY ? String(d) : '';
// A travel entry with no `checked` of its own falls back to the day its company's own site was last read as a travel source
// (`_travel.json → scanned`). The source is the one whose host holds the company's English name, spaces removed (flynas →
// www.flynas.com); none matches, or two do, and the card prints no date. Cars have no such fallback: their no-offer
// companies are not in carSources.
const travelSrcDay = t => { const key = String(t.company_en || '').toLowerCase().replace(/[^a-z0-9]/g, ''); if (key.length < 4) return '';
  const hits = Object.keys(st.travelScanned || {}).filter(u => { try { return new URL(u).hostname.toLowerCase().replace(/[^a-z0-9.]/g, '').split('.').includes(key); } catch (_) { return false; } });
  return hits.length === 1 ? noneDay(st.travelScanned[hits[0]]) : ''; };
st.travelNone.forEach(t => { if (!noneDay(t.checked) && travelSrcDay(t)) t.checked = travelSrcDay(t); });
{ const und = [...st.travelNone.map(t => ['travel', t]), ...(st.carsNone || []).map(c => ['cars', c])].filter(([, o]) => !noneDay(o.checked));
  const n = st.travelNone.length + (st.carsNone || []).length;
  console.log(`no-offer cards: ${n - und.length} of ${n} carry their check date${und.length ? ` · no date printed for ${und.map(([k, o]) => `${k}: ${String(o.company_en || o.company || '?').slice(0, 40)}`).join(', ')}` : ''}`); }
const TNO = st.travelNone.map(t => [t.company,t.type,noneDay(t.checked)]);
// car offers (22 Sep): same card shape as travel, one extra field (brand) after type.
// [company, type, brand, headline, code, bookStart, bookEnd, window, verdict, terms, url, checked]
const CR  = (st.cars || []).map(c => [c.company,c.type,c.brand||'',c.headline,c.code||'',c.bookStart||'',c.bookEnd||'',c.window||'',c.verdict,c.terms,c.url,c.checked]);
const CRNO = (st.carsNone || []).map(c => [c.company,c.type,noneDay(c.checked)]);
// app subscription offers (BLD-27): the travel card with named fields. Nothing here is measured against a price record, so
// the card never carries a percentage of ours. `wallet` ids (config/wallet.json) become the card's tags here, at build time,
// in the page's language; an id that is not in that file is left off. English needs headline_en and terms_en, as travel does.
const subTags = (o, key) => (o.wallet || []).filter(id => walletById[id] && walletById[id][key]).map(id => walletById[id][key]);
const SB = st.subs.map(o => ({ co: o.company, ty: o.type || '', h: o.headline, c: o.code || '', bs: o.bookStart || '', be: o.bookEnd, win: o.window || '', v: o.verdict || '', t: o.terms, u: o.url, ck: o.checked, w: subTags(o, 'label') }));
const subsEn = st.subs.filter(o => o.headline_en && o.terms_en);
// one row per line, like the hand-written page, so git diffs stay readable
// J (lib/safe.js) is JSON.stringify made safe for an inline <script>: every value the page's script receives goes through it.
const arr = rows => '[\n' + rows.map(r => J(r)).join(',\n') + '\n]';

// ---- chips from config ----
const liveCats = cats.filter(c => !st.rows.length || st.rows.some(r => r.cat === c.id));
const catChips = liveCats.map(c => `        <button data-g="c" data-f="${c.id}" class="kc${cats.indexOf(c)}">${c.label}</button>`).join('\n');
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
const subsOn = st.subs.length > 0;   // no «checked, nothing found» cards here: the panel and the section exist only while there is an offer
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
  TRAVEL_HIDDEN: travelOn ? '' : ' hidden', CARS_HIDDEN: carsOn ? '' : ' hidden', SUBS_HIDDEN: subsOn ? '' : ' hidden',
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
  sb: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.2h2"/><path d="M10.4 8.2l3.6 2.3-3.6 2.3z"/></svg>',
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
// (BLD-27) a fourth panel, app subscriptions, only while there is an offer behind it: the names of up to three apps, then «وغيرها».
const sbApps = (list, key) => [...new Set(list.map(o => H(String(o[key] || o.company || '').replace(/\s*\(.*\)$/, ''))))];
const sbAr = sbApps(st.subs, 'company'), sbEnApps = sbApps(subsEn, 'company_en');
const panelsAr = `<nav class="panels${subsOn ? ' p4' : ''}" aria-label="القسائم وعروض السفر والسيارات${subsOn ? ' واشتراكات التطبيقات' : ''}">`
  + panel(cpSave.length > 0, '#coupons', PIC.cp, 'القسائم والأكواد', cpSave.length ? `${arCount(cpSave.length, 'عرض واحد', 'عرضان', 'أكواد وعروض بطاقات', 'كوداً وعرض بطاقة')} · ${andAr(cpStores.map(label))}` : `لا أكواد مؤكدة ${forShort} بعد`)
  + panel(trOn + trChecked > 0, '#travel', PIC.tr, 'عروض السفر', trOn ? `${arCount(trOn, 'عرض واحد', 'عرضان', 'عروض', 'عرضاً')} من شركات الطيران والحجز` : trChecked ? `فحصنا ${arCount(trChecked, 'شركة واحدة', 'شركتين', 'شركات', 'شركة')}: لا عرض ${forShort} بعد` : 'تُفحص في التحديث القادم')
  + panel(crChecked > 0, '#cars', PIC.cr, 'عروض السيارات', crOn ? `${arCount(crOn, 'عرض واحد', 'عرضان', 'عروض', 'عرضاً')} (${andAr(st.cars.map(c => H(String(c.company || '').replace(/\s*\(.*\)$/, ''))))})${(st.carsNone || []).length ? ` · فحصنا ${arCount(st.carsNone.length, 'جهة أخرى', 'جهتين أخريين', 'جهات أخرى', 'جهة أخرى')}` : ''}` : crChecked ? `فحصنا ${arCount(crChecked, 'جهة واحدة', 'جهتين', 'جهات', 'جهة')}: لا عرض ${forShort} بعد` : 'تُفحص في التحديث القادم')
  + (!subsOn ? '' : panel(true, '#subs', PIC.sb, 'اشتراكات التطبيقات', `${arCount(st.subs.length, 'عرض واحد', 'عرضان', 'عروض', 'عرضاً')} (${sbAr.length > 3 ? sbAr.slice(0, 3).join('، ') + ' وغيرها' : andAr(sbAr)})`))
  + `</nav>`;
// English plural (22 Nov 2026, BLD-15): «6 companys» was printed on the travel panel. A word ending in a consonant and «y»
// takes «ies»; the words this is called with today are «offer» and «company».
const enPlural = w => /[^aeiou]y$/i.test(w) ? w.slice(0, -1) + 'ies' : /(s|x|z|ch|sh)$/i.test(w) ? w + 'es' : w + 's';
const enCount = (n, w) => `${n} ${n === 1 ? w : enPlural(w)}`;
const cpSaveEn = cpSave.filter(c => c.text_en), campShortEn = M.campaignShort_en || M.campaign_en || 'sale';
const panelsEn = `<nav class="panels${subsEn.length ? ' p4' : ''}" aria-label="${subsEn.length ? 'Coupons, travel, car and app subscription offers' : 'Coupons, travel and car offers'}">`
  + panel(cpSaveEn.length > 0, '#coupons', PIC.cp, 'Coupons and codes', cpSaveEn.length ? `${cpSaveEn.length} codes and card offers · ${andEn([...new Set(cpSaveEn.flatMap(c => c.stores || []))].map(id => (storeById[id] || {}).label_en || id))}` : `No confirmed ${campShortEn} codes yet`)
  + panel(trOn + trChecked > 0, '#travel', PIC.tr, 'Travel offers', trOn ? `${enCount(trOn, 'offer')} from airlines and booking sites` : trChecked ? `Checked ${enCount(trChecked, 'company')}: no ${campShortEn} offer yet` : 'Checked in the next update')
  + panel(crChecked > 0, '#cars', PIC.cr, 'Car offers', crOn ? `${enCount(crOn, 'offer')} (${andEn(st.cars.map(c => H(String(c.company_en || c.company || '').replace(/\s*\(.*\)$/, ''))))})${(st.carsNone || []).length ? ` · ${st.carsNone.length} more checked` : ''}` : crChecked ? `Checked ${enCount(crChecked, 'company')}: no ${campShortEn} offer yet` : 'Checked in the next update')
  + (!subsEn.length ? '' : panel(true, '#subs', PIC.sb, 'App subscriptions', `${enCount(subsEn.length, 'offer')} (${sbEnApps.length > 3 ? sbEnApps.slice(0, 3).join(', ') + ' and more' : andEn(sbEnApps)})`))
  + `</nav>`;

// ---- category cards, the ticker strip and the header inside a category (BLD-15, 22 Nov 2026) ----
// Mahmoud's direction A. Everything here is computed from the rows of this build, in both languages by the
// same code, and written as static HTML: no timers, no rotation, nothing fetched. Every value a store wrote
// (names, picture addresses) goes through H() and cleanHttps(); scripts/test-escape.js covers these parts.
//   · «confirmed» is a row whose verdict is ok, that was available at its last check, with a positive measured discount.
//     The percentage on a card is the highest of those, never a store's claim; a category with none prints words instead.
//   · the order is the page's own «best value» order: valRow, tierRow and diversifyRows mirror VAL, TIER and diversify in
//     both templates. Change one and change the others; the Playwright proof compares the ticker with the page's first cards.
const KAT_MIN = (rules.page || {}).categoryCardMinRows ?? 8, TICK_N = (rules.page || {}).tickerItems ?? 12;
const deadRow = r => ['oos', 'ended', 'gone'].includes(r.avail);
const realPct = r => (r.ref && Number.isFinite(r.price)) ? Math.round(100 * (1 - r.price / r.ref)) : null;
const lowRow = r => r.refKind !== 'market' && r.ev && r.ev.min != null && r.price <= r.ev.min * 1.01;
const valRow = r => { const real = realPct(r); if (real == null || real <= 0 || r.verdict === 'bad') return -1e9 + (Math.round(100 * (1 - r.price / (r.was ?? null))) || 0);
  return (r.verdict === 'ok' ? 1 : 0.55) * real * Math.log10(10 + (r.ref - r.price)) * (lowRow(r) ? 1.15 : 1); };
const tierRow = r => (deadRow(r) ? 2 : 0) + (valRow(r) <= -1e8 ? 1 : 0);
const diversifyRows = l => { const out = [], pool = l.slice(); while (pool.length) { let i = 0; const n = out.length;
  if (n >= 2) { const a = out[n - 1], b = out[n - 2], t = tierRow(pool[0]); const j = pool.findIndex(r => tierRow(r) === t && !(r.store === a.store && r.store === b.store) && !(r.cat === a.cat && r.cat === b.cat)); if (j > 0) i = j; }
  out.push(pool.splice(i, 1)[0]); } return out; };
const confirmedRow = r => r.verdict === 'ok' && !deadRow(r) && realPct(r) > 0;
const valueOrder = diversifyRows(st.rows.filter(r => !deadRow(r)).sort((a, b) => valRow(b) - valRow(a)));
const tickRows = valueOrder.filter(r => confirmedRow(r) && r.id).slice(0, TICK_N);
const katIdx = Object.fromEntries(cats.map((c, i) => [c.id, i]));
const katStats = liveCats.map(c => {
  const inCat = st.rows.filter(r => r.cat === c.id && !deadRow(r)), conf = inCat.filter(confirmedRow);
  const by = {}; inCat.forEach(r => { by[r.store] = (by[r.store] || 0) + 1; });
  return { c, k: katIdx[c.id], n: inCat.length, ok: inCat.filter(r => r.verdict === 'ok').length, max: conf.length ? Math.max(...conf.map(realPct)) : null,
    allNa: inCat.every(r => r.ref == null), top: conf.slice().sort((a, b) => valRow(b) - valRow(a)), stores: Object.entries(by).sort((a, b) => b[1] - a[1]) };
});
const katCards = katStats.filter(s => s.n >= KAT_MIN);
const katBig = katCards.slice().sort((a, b) => b.n - a.n).slice(0, 3), katSmall = katCards.filter(s => !katBig.includes(s));
// Colours: each chip's tint and accent from config/categories.json, with a dark-scheme pair derived here.
// The accent must read at 4.5 to 1 or better on its tint in both schemes, or the build stops and names the pair.
const hex3 = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mixHex = (a, b, t) => '#' + hex3(a).map((v, i) => Math.round(v + (hex3(b)[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
const lumHex = h => { const [r, g, b] = hex3(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrastHex = (a, b) => { const x = lumHex(a), y = lumHex(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const katColours = cats.map((c, i) => {
  if (!c.tint && !c.accent) return null;
  if (!/^#[0-9A-Fa-f]{6}$/.test(c.tint || '') || !/^#[0-9A-Fa-f]{6}$/.test(c.accent || '')) throw new Error(`build: config/categories.json chip «${c.id}» needs tint and accent as #RRGGBB`);
  const darkSurface = thd.surface || '#17201B', tintD = mixHex(darkSurface, c.accent, 0.2), accD = mixHex(c.accent, '#FFFFFF', 0.62);
  for (const [what, fg, bg] of [['light', c.accent, c.tint], ['dark', accD, tintD]]) if (contrastHex(fg, bg) < 4.5)
    throw new Error(`build: category «${c.id}» colour ${fg} on ${bg} (${what}) reads at ${contrastHex(fg, bg).toFixed(2)} to 1, below 4.5`);
  // (23 Nov, the cards of demo A) three more tones per category, derived here: --kk the card's text, --ks its small labels,
  // --kp the count pill. Each is checked like the accent: 4.5 to 1 on the tint (and on the pill), in both schemes.
  const ink = '#0B0F19', kk = mixHex(c.accent, ink, 0.6), ks = mixHex(c.accent, ink, 0.4), kp = mixHex(c.tint, c.accent, 0.12);
  const kkD = mixHex(accD, '#FFFFFF', 0.55), ksD = mixHex(accD, '#FFFFFF', 0.3), kpD = mixHex(tintD, accD, 0.18);
  for (const [what, fg, bg] of [['card text', kk, c.tint], ['card label', ks, c.tint], ['count pill', kk, kp], ['button text', '#FFFFFF', c.accent],
    ['card text, dark', kkD, tintD], ['card label, dark', ksD, tintD], ['count pill, dark', kkD, kpD], ['button text, dark', ink, accD]]) if (contrastHex(fg, bg) < 4.5)
    throw new Error(`build: category «${c.id}» ${what} ${fg} on ${bg} reads at ${contrastHex(fg, bg).toFixed(2)} to 1, below 4.5`);
  return { i, light: `.kc${i}{--kt:${c.tint};--ka:${c.accent};--kk:${kk};--ks:${ks};--kp:${kp};--kb:#FFFFFF}`, dark: `.kc${i}{--kt:${tintD};--ka:${accD};--kk:${kkD};--ks:${ksD};--kp:${kpD};--kb:${ink}}` };
}).filter(Boolean);
const KAT_CSS = katColours.map(k => k.light).join('') + `\n@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) ${katColours.map(k => k.dark).join(' :root:not([data-theme="light"]) ')}}\n`
  + katColours.map(k => ':root[data-theme="dark"] ' + k.dark).join('');
const katParts = lang => {
  const ar = lang === 'ar', num = ar ? arN : (v => Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }));
  const lab = ar ? label : (id => (storeById[id] || {}).label_en || id);
  const cname = c => ar ? c.label : (c.label_en || c.id), rname = r => ar ? arName(r) : (r.name_en || pubText(r.name));
  const pct = n => ar ? `${num(n)}٪` : `${num(n)}%`, sar = n => ar ? `${num(n)} ر.س` : `${num(n)} SAR`;
  const maxL = ar ? 'أعلى خصم مؤكّد' : 'highest confirmed discount';
  const countList = s => [ar ? `المفحوصة ${num(s.n)}` : `${num(s.n)} checked`].concat(s.ok ? [ar ? `المؤكّدة ${num(s.ok)}` : `${num(s.ok)} confirmed`] : []);
  const counts = s => countList(s).join(' · ');
  // no confirmed row: say so in words. «No price record yet» only when no row of the category has a reference at all.
  const none = s => s.allNa ? (ar ? 'بلا سجل سعري بعد' : 'No price record yet') : (ar ? 'لا خصم مؤكّد بعد' : 'No confirmed discount yet');
  // The cards of demo A, «Blue and gold, soft tints» (Mahmoud, 23 Nov 2026: «the cards that you showed me in A»), made
  // static as he decided on 22 Nov: no rotating line and no timers. Where the demo had drawings and three deals taking turns,
  // a card shows the stores' own pictures of its top confirmed rows and its top confirmed deal, fixed.
  const arDeals = n => n === 1 ? 'عرض واحد' : n === 2 ? 'عرضان' : n <= 10 ? `${num(n)} عروض` : `${num(n)} عرضاً`;
  const arConf = n => n === 1 ? 'خصم مؤكّد واحد' : n === 2 ? 'خصمان مؤكّدان' : n <= 10 ? `${num(n)} خصومات مؤكّدة` : `${num(n)} خصماً مؤكّداً`;
  const dealsL = n => ar ? arDeals(n) : `${num(n)} ${n === 1 ? 'deal' : 'deals'}`;
  const confL = n => ar ? arConf(n) : `${num(n)} confirmed`;
  const topL = ar ? 'أعلى خصم قِسناه' : 'Highest discount we measured', upTo = n => ar ? `حتى ${pct(n)}` : `up to ${pct(n)}`;
  const browseL = ar ? 'تصفّح العروض' : 'Browse deals';
  const pic = (r, cls) => `<span class="${cls}"><img src="${H(r.img)}" alt="${H(rname(r))}" decoding="async" referrerpolicy="no-referrer"></span>`;
  const dealLine = r => !r ? '' : `<span class="kdeal"><span class="kdn">${H(rname(r))}</span><span class="kdm"><b>${ar ? 'خصم ' + pct(realPct(r)) : pct(realPct(r)) + ' off'}</b> · ${sar(r.price)} · ${H(lab(r.store))}</span></span>`;
  const card = (s, big) => {
    const seen = new Set(), withPic = s.top.filter(r => cleanHttps(r.img) && !seen.has(r.img) && seen.add(r.img));
    const top = s.top[0];
    if (big) {
      const pics = withPic.slice(0, 3);
      return `<button type="button" class="kcard big kc${s.k}" data-cat="${H(s.c.id)}" aria-pressed="false">`
        + `<span class="khd"><span class="kn">${H(cname(s.c))}</span><span class="kcount">${dealsL(s.n)}</span></span>`
        + `<span class="kmid"><span class="kmx">` + (s.max != null ? `<span class="kml">${topL}</span><b class="kpct">${pct(s.max)}</b>` : `<b class="knone">${none(s)}</b>`) + `</span>`
        + (pics.length ? `<span class="kstack">${pics.map((r, n) => pic(r, 'kim k' + (n === 0 ? 'front' : n === 1 ? 'back1' : 'back2'))).join('')}</span>` : '') + `</span>`
        + dealLine(top)
        + `<span class="kft"><span class="kconf">${s.ok ? `<i aria-hidden="true"></i>${confL(s.ok)}` : ''}</span><span class="kgo">${browseL}</span></span>`
        + `</button>`;
    }
    return `<button type="button" class="kcard kc${s.k}" data-cat="${H(s.c.id)}" aria-pressed="false">`
      + `<span class="khd"><span class="ktx"><span class="kn">${H(cname(s.c))}</span><span class="kcount">${dealsL(s.n)}</span></span>`
      + (withPic.length ? pic(withPic[0], 'ktile') : '') + `</span>`
      + (s.max != null ? `<b class="kpct">${upTo(s.max)}</b>` : `<b class="knone">${none(s)}</b>`)
      + dealLine(top)
      + `</button>`;
  };
  const cards = !katCards.length ? '' : `<section class="kats" id="kats" aria-labelledby="kats-h"><div class="kathd"><h2 id="kats-h">${ar ? 'تسوّق حسب الفئة' : 'Shop by category'}</h2>`
    + `<span>${ar ? 'الأرقام من قياسنا نحن، وتتجدّد مع كل فحص' : 'Every number is our own measurement, renewed with each check'}</span></div>`
    + `<div class="kbig">${katBig.map(s => card(s, true)).join('')}</div>`
    + (katSmall.length ? `<div class="ksmall">${katSmall.map(s => card(s, false)).join('')}</div>` : '') + `</section>`;
  const heads = katStats.map(s => `<div class="khead kc${s.k}" data-cat="${H(s.c.id)}" hidden><div class="khm"><h2 class="khn">${H(cname(s.c))}</h2><p class="khc">${counts(s)}`
    + (s.max != null ? ` · ${maxL} <b>${pct(s.max)}</b>` : ` · ${none(s)}`) + `</p><p class="khs">${s.stores.map(([id, n]) => `${H(lab(id))} ${num(n)}`).join(' · ')}</p></div>`
    + `<button type="button" class="khback">${ar ? 'كل الفئات' : 'All categories'}</button></div>`).join('\n  ');
  const item = (r, copy) => `<button type="button" class="ti" data-d="${H(r.id)}"${copy ? ' tabindex="-1"' : ''}><span class="tn">${H(rname(r))}</span><b class="tp">${ar ? 'خصم ' + pct(realPct(r)) : pct(realPct(r)) + ' off'}</b><span class="tpr">${sar(r.price)}</span><span class="ts">${H(lab(r.store))}</span></button>`;
  // The strip carries the last check time once, so no price stands without it. No «now», no «live», no stock or urgency wording.
  const when = ar ? time12(st.meta.checkedAt) : new Date(String(st.meta.checkedAt)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' });
  const ticker = tickRows.length < 4 ? '' : `<div class="tick" id="tick" dir="${ar ? 'rtl' : 'ltr'}" lang="${ar ? 'ar' : 'en'}" role="region" aria-label="${ar ? 'خصومات مؤكّدة بأسعار آخر فحص' : 'Confirmed discounts at the last check’s prices'}">`
    + `<p class="tickl"><b>${ar ? 'خصومات مؤكّدة' : 'Confirmed discounts'}</b><small>${ar ? 'الأسعار فُحصت ' + H(when) : 'Prices checked ' + H(when)}</small></p>`
    // (23 Nov 2026) a visible pause button: the strip moves for every visitor, whatever the device's motion setting, and
    // anyone can stop it. The two labels ride on the button so one script serves both languages.
    + `<button type="button" class="tickp" aria-pressed="false" aria-label="${ar ? 'إيقاف الشريط' : 'Pause the ticker'}" data-l-pause="${ar ? 'إيقاف الشريط' : 'Pause the ticker'}" data-l-play="${ar ? 'تشغيل الشريط' : 'Play the ticker'}">`
    + `<svg class="ip" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false"><rect x="1.5" y="1" width="2.5" height="8" rx=".6" fill="currentColor"/><rect x="6" y="1" width="2.5" height="8" rx=".6" fill="currentColor"/></svg>`
    + `<svg class="iy" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false"><path d="M2.2 1.2 8.8 5 2.2 8.8Z" fill="currentColor"/></svg></button>`
    + `<div class="tickv"><div class="tickt"><div class="tickg">${tickRows.map(r => item(r, false)).join('')}</div><div class="tickg" aria-hidden="true" inert>${tickRows.map(r => item(r, true)).join('')}</div></div></div></div>`;
  const json = J(Object.fromEntries(cats.map((c, i) => [c.id, { l: cname(c), k: i }])));
  return { cards, heads, ticker, json };
};
const katAr = katParts('ar'), katEn = katParts('en');

// ---- measurement: Google Tag Manager (22 Nov 2026) ----
// config/site.json holds the container id. An empty or missing gtmId builds both pages with no tag and
// the old privacy sentence; a set one writes Google's two snippets and the sentence that says so.
// The page's own events (outbound_store_click, copy_code, wallet_filter_used, and follow_channel_click when
// config/site.json has a whatsappChannel) are in both templates.
const sitePath = path.join(ROOT, 'config/site.json');
const siteCfg = fs.existsSync(sitePath) ? JSON.parse(fs.readFileSync(sitePath, 'utf8')) : {};
const GTM_ID = String(siteCfg.gtmId || '').trim();
if (GTM_ID && !/^GTM-[A-Z0-9]{4,12}$/.test(GTM_ID)) throw new Error(`build: config/site.json gtmId "${GTM_ID}" is not a GTM container id (GTM-XXXXXXX)`);
// ---- WhatsApp channel (BLD-18, with Mahmoud's banner of 23 Nov 2026) ----
// config/site.json whatsappChannel is the channel's own invite address. Set, both pages get: a green strip right under the
// top section, above the category cards and the first product, that a visitor can close (it stays closed in that browser);
// a header button from 1024 px wide; a block above the suggestion box; the About contact line; a line under a card opened
// from a shared link; and the channel link at the end of the share message. Empty, none of that is written.
// Only https://whatsapp.com/channel/<code> is accepted, so nothing else can reach the page through this field.
const WA = String(siteCfg.whatsappChannel || '').trim();
if (WA && !/^https:\/\/whatsapp\.com\/channel\/[A-Za-z0-9]{16,40}$/.test(WA)) throw new Error(`build: config/site.json whatsappChannel "${WA}" is not a WhatsApp channel address (https://whatsapp.com/channel/<code>)`);
const WA_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.5A8.4 8.4 0 1 1 21 11.5z"/><path d="M9 10.5h6M9 13.5h4"/></svg>';
const waA = (ch, cls, inner, label) => `<a${cls ? ` class="${cls}"` : ''} href="${WA}" target="_blank" rel="noopener" data-ch="${ch}"${label ? ` aria-label="${label}" title="${label}"` : ''}>${inner}</a>`;
// A browser that closed the strip before (localStorage sayda.wabar = "0") hides it from the first line of the page's script.
const waBar = (title, sub, btn, btnShort, close) => `<aside class="wabar" id="wabar" aria-label="${title}"><span class="wabic" aria-hidden="true">${WA_ICON}</span><p class="wabt"><b>${title}</b> <span>${sub}</span></p>${waA('banner', 'wabtn wabarbtn', '<span class="wl">' + btn + '</span><span class="ws">' + btnShort + '</span>')}<button type="button" class="wabx" id="wabx" aria-label="${close}" title="${close}">×</button></aside>\n  `;
const waFill = {
  WA_JSON: J(WA),
  WA_BAR_AR: !WA ? '' : waBar('تنبيهات الصيدات الجديدة على واتساب', 'تابع قناة صيدة وتوصلك أقوى الخصومات المفحوصة أول بأول.', 'تابع القناة', 'تابع القناة', 'إخفاء'),
  WA_BAR_EN: !WA ? '' : waBar('New-deal alerts on WhatsApp', 'Follow the Sayda channel to get the strongest checked discounts as they land.', 'Follow the channel', 'Follow', 'Hide'),
  WA_HEAD_AR: !WA ? '' : waA('header', 'hbtn wahd', WA_ICON + '<span class="hl">تابعنا على واتساب</span>', 'تابع قناة صيدة على واتساب'),
  WA_HEAD_EN: !WA ? '' : waA('header', 'hbtn wahd', WA_ICON + '<span class="hl">Follow on WhatsApp</span>', 'Follow the Sayda channel on WhatsApp'),
  WA_BLOCK_AR: !WA ? '' : `<section class="wafol" aria-labelledby="wa-h"><div class="wafolt"><h2 id="wa-h">تابع صيدة على واتساب</h2><p>نشارك في قناة صيدة الخصومات المؤكدة بعد الفحص، بالعربي والإنجليزي.</p></div>${waA('suggest', 'wabtn', WA_ICON + '<span>تابع القناة</span>')}</section>\n  `,
  WA_BLOCK_EN: !WA ? '' : `<section class="wafol" aria-labelledby="wa-h"><div class="wafolt"><h2 id="wa-h">Follow Sayda on WhatsApp</h2><p>We share confirmed discounts on the Sayda channel after they are checked, in Arabic and English.</p></div>${waA('suggest', 'wabtn', WA_ICON + '<span>Follow the channel</span>')}</section>\n  `,
  WA_ABOUT_AR: !WA ? '' : ' · ' + waA('about', '', 'قناتنا على واتساب'),
  WA_ABOUT_EN: !WA ? '' : ' · ' + waA('about', '', 'our WhatsApp channel'),
};
const plainText = (t, d) => { const s = String(t || d); if (/[<>&"]/.test(s)) throw new Error('build: config/site.json service names must be plain text'); return s; };
const measureFill = {
  // BLD-24 (consent, approved 22 Nov 2026 at 01:15): Tag Manager loads only after the visitor says OK on the measurement bar.
  // The head script sets Google's Consent Mode defaults first (every advertising signal denied, always; analytics granted only
  // with a stored OK), then loads gtm.js only for a visitor whose stored choice is «yes», or the moment they press OK. Nothing
  // is requested from Google before that, and the no-JavaScript iframe is gone because it cannot ask. window.saydaConsent(v)
  // records «yes» or «no» in this browser and updates Consent Mode; window.saydaMeasuring() tells the page's click events
  // whether to queue anything at all, so clicks made before an OK are never sent after it.
  GTM_HEAD: !GTM_ID ? '' : `\n<script>(function(w,d,i){w.dataLayer=w.dataLayer||[];function g(){w.dataLayer.push(arguments);}w.gtag=w.gtag||g;var k='sayda.consent',c=null;try{c=w.localStorage.getItem(k);}catch(_){}g('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:c==='yes'?'granted':'denied'});var on=false;w.saydaMeasuring=function(){return on;};w.saydaMeasure=function(){if(on)return;on=true;w.dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});var j=d.createElement('script');j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;d.head.appendChild(j);};w.saydaConsent=function(v){v=v==='yes'?'yes':'no';try{w.localStorage.setItem(k,v);}catch(_){}g('consent','update',{analytics_storage:v==='yes'?'granted':'denied'});if(v==='yes')w.saydaMeasure();else on=false;};if(c==='yes')w.saydaMeasure();})(window,document,'${GTM_ID}');</script>`,
  GTM_BODY: '',
  // The measurement bar (BLD-24). Shown by the page's script to a visitor with no stored choice; hidden again by either button.
  CONSENT_BAR_AR: !GTM_ID ? '' : `\n<aside class="cbar" id="cbar" role="region" aria-label="القياس بإذنك" hidden><p><b>القياس بإذنك</b> إذا وافقت، نقيس الزيارات والنقرات بأداة Google Analytics لنعرف أي الصيدات تفيدكم. تضع ملفات تعريف ارتباط وترسل بيانات الزيارة إلى Google. إن لم توافق لا نحمّلها، والصفحة تعمل كما هي. <a href="#about">التفاصيل</a></p><div class="cbtns"><button type="button" class="cyes" data-cv="yes">موافق</button><button type="button" class="cno" data-cv="no">لا، شكراً</button></div></aside>`,
  CONSENT_BAR_EN: !GTM_ID ? '' : `\n<aside class="cbar" id="cbar" role="region" aria-label="Measurement, only with your OK" hidden><p><b>Measurement, only with your OK.</b> With your OK, we measure visits and clicks with Google Analytics to learn which deals help. It sets cookies and sends visit data to Google. Without it, we don’t load it and the page works the same. <a href="#about">Details</a></p><div class="cbtns"><button type="button" class="cyes" data-cv="yes">OK</button><button type="button" class="cno" data-cv="no">No thanks</button></div></aside>`,
  PRIVACY_STATS_AR: !GTM_ID ? 'نستخدم إحصاءات Cloudflare التي لا تستخدم ملفات تعريف الارتباط ولا تجمع بيانات شخصية.'
    : `نستخدم إحصاءات Cloudflare التي لا تستخدم ملفات تعريف الارتباط. وإذا وافقت على شريط «القياس بإذنك» فقط، نحمّل Google Tag Manager لقياس الزيارات و${WA ? 'أربعة أنواع من النقرات: فتح صفحة متجر، نسخ كود، استخدام فلتر البطاقات (دون اسم البطاقة)، وفتح قناتنا على واتساب' : 'ثلاثة أنواع من النقرات: فتح صفحة متجر، نسخ كود، واستخدام فلتر البطاقات (دون اسم البطاقة)'}. خدمات القياس التي تعمل من خلاله (${plainText(siteCfg.services_ar, 'Google')}) تضع ملفات تعريف ارتباط وتستخدم معرّف جهازك، ولا تعمل على الصفحة أي أداة إعلانية. دون موافقتك لا نحمّل شيئاً منها. <button type="button" class="clink" data-consent-open>تغيير اختيار القياس</button>`,
  PRIVACY_STATS_EN: !GTM_ID ? 'we use Cloudflare analytics, which sets no cookies and collects no personal data.'
    : `we use Cloudflare analytics, which sets no cookies. Only if you say OK on the «Measurement, only with your OK» bar do we also load Google Tag Manager to measure visits and ${WA ? 'four kinds of click: opening a store page, copying a code, using the card filter (never which card), and opening our WhatsApp channel' : 'three kinds of click: opening a store page, copying a code, and using the card filter (never which card)'}. The measurement services that run through it (${plainText(siteCfg.services_en, 'Google')}) set cookies and use your device’s identifiers, and no advertising tool runs on the page. Without your OK we load none of it. <button type="button" class="clink" data-consent-open>Change your measurement choice</button>`,
};

// ---- fill ----
const fill = {
  ...campaignFill,
  GTM_HEAD: measureFill.GTM_HEAD, GTM_BODY: measureFill.GTM_BODY, CONSENT_BAR: measureFill.CONSENT_BAR_AR, PRIVACY_STATS_AR: measureFill.PRIVACY_STATS_AR,
  WA_JSON: waFill.WA_JSON, WA_BAR: waFill.WA_BAR_AR, WA_HEAD: waFill.WA_HEAD_AR, WA_BLOCK: waFill.WA_BLOCK_AR, WA_ABOUT: waFill.WA_ABOUT_AR,
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
  TICKER: katAr.ticker, KAT_CARDS: katAr.cards, KAT_HEADS: katAr.heads, KAT_JSON: katAr.json, KAT_CSS: KAT_CSS,
  WALLET_JSON: J(walletCfg.filter(w => st.coupons.some(c => SAVES.has(c.kind) && (c.wallet || []).includes(w.id))).map(w => ({ id: w.id, l: w.label }))),
  CAMPAIGN_END: String(M.campaignEnd || ''), D_JSON: arr(D), T_JSON: arr(T), TNO_JSON: J(TNO), TNONE_JSON: J(st.travelNone_text||''),
  CR_JSON: arr(CR), CRNO_JSON: J(CRNO), SB_JSON: arr(SB),
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
// (BLD-27) `sub` tells the shared card that this is a subscription offer; `w` are its wallet tags in English
const sbEn = subsEn.map(o => ({ ...offerEn(o), sub: 1, w: subTags(o, 'label_en') }));
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
  // (BLD-15) the ticker, the category cards, the header inside a category and the wallet under it are one design too:
  // each template must carry all of them, in the same order, or the build stops.
  const parts = ['{{TICKER}}', '{{KAT_CARDS}}', 'id="stats"', 'id="filters"', '{{KAT_HEADS}}', 'id="wallet"', 'id="rows"', '{{KAT_JSON}}'];
  const order = t => parts.map(p => t.indexOf(p));
  for (const [name, t] of [['template/index.html', arTpl], ['template/en.html', en]]) { const o = order(t);
    if (o.some((x, i) => x < 0 || (i && x < o[i - 1]))) throw new Error(`build: ${name} must carry, in this order: ${parts.join(' · ')} (found at ${o.join(', ')})`); }
}
const css = (out.match(/<style>[\s\S]*?<\/style>/g) || []).map(b => b.replace(/^<style>|<\/style>$/g, '')).join('\n');
const dEn = iso => new Date(String(iso).length === 10 ? iso + 'T12:00:00+03:00' : iso);
const enFill = {
  GTM_HEAD: measureFill.GTM_HEAD, GTM_BODY: measureFill.GTM_BODY, CONSENT_BAR: measureFill.CONSENT_BAR_EN, PRIVACY_STATS_EN: measureFill.PRIVACY_STATS_EN,
  WA_JSON: waFill.WA_JSON, WA_BAR: waFill.WA_BAR_EN, WA_HEAD: waFill.WA_HEAD_EN, WA_BLOCK: waFill.WA_BLOCK_EN, WA_ABOUT: waFill.WA_ABOUT_EN,
  CSS: css, CAMPAIGN_EN: M.campaign_en || 'Sale', CAMPAIGN_SHORT_EN: M.campaignShort_en || M.campaign_en || 'Sale',
  UPDATED_EN: dEn(st.meta.updated).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' }),
  CHECKED_EN: dEn(st.meta.checkedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' }),
  STORE_COUNT: String(cfg.stores.filter(s => s.enabled !== false).length), TH_ACCENT: campaignFill.TH_ACCENT, TH_ACCENT_HEX: campaignFill.TH_ACCENT_HEX,
  E_JSON: arr(E), CATS_JSON: J(cats.map(c => [c.id, c.label_en || c.id])), STORE_CHIPS_EN: storeChipsEn,
  COUPONS_JSON: J(cpEn.map(x => ({ label: x.c.label_en || labelEn((x.c.stores || [])[0]), code: x.c.code || '', text: enText(x.c.text_en), k: x.c.kind || '', s: (x.c.stores || []).map(labelEn), w: (x.c.wallet || []).filter(id => walletById[id]), nw: (x.c.walletNot || []).filter(id => walletById[id]), p: enText(x.c.perk_en || ''), h: enText(cpHead(x.c.perk_en, x.c.text_en)) }))),
  TRNO_JSON: J(st.travelNone.filter(t => t.company_en).map(t => [t.company_en, t.type_en || '', noneDay(t.checked)])), CRNO_JSON: J((st.carsNone || []).filter(c => c.company_en).map(c => [c.company_en, c.type_en || '', noneDay(c.checked)])),
  TNONE_EN_JSON: J(st.travelNone_text_en || ''), LOGO_SVG: LOGO, FAVICON: FAVICON, TOP_PANELS_EN: panelsEn,
  TICKER: katEn.ticker, KAT_CARDS: katEn.cards, KAT_HEADS: katEn.heads, KAT_JSON: katEn.json,
  WALLET_JSON: J(walletCfg.filter(w => w.label_en && cpEn.some(x => SAVES.has(x.c.kind) && (x.c.wallet || []).includes(w.id))).map(w => ({ id: w.id, l: w.label_en }))),
  CAMPAIGN_END: String(M.campaignEnd || ''),
  TRAVEL_JSON: J(trEn), CARS_JSON: J(crEn), SUBS_JSON: J(sbEn),
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
  + ` · coupons ${cpEn.length} of ${st.coupons.length} · travel ${trEn.length} of ${st.travel.length} · cars ${crEn.length} of ${(st.cars || []).length} · subscriptions ${sbEn.length} of ${st.subs.length}`);
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
console.log(GTM_ID ? `measurement: Google Tag Manager ${GTM_ID} on both pages, loaded only after the visitor's OK (consent bar, Consent Mode: advertising denied)` : 'measurement: off (config/site.json has no gtmId), no tag on either page');
console.log(WA ? 'whatsapp channel: on both pages (strip above the products, header, above the suggestion box, About, shared-link note; share message)' : 'whatsapp channel: none (config/site.json has no whatsappChannel)');
console.log(`built dist/index.html (${out.length} chars) · rows ${st.rows.length} (${st.rows.length-un} available) · travel ${T.length}+${TNO.length} · cars ${CR.length}+${CRNO.length} · coupons ${st.coupons.length} · subscriptions ${SB.length}`);
