#!/usr/bin/env node
// apply.js — merges work/check/*.json (live observations) into the per-store state shards using
// rules/verdict.js, and writes work/report.json (what changed) for the summary.
//   node apply.js check            # apply availability observations
//   node apply.js new work/new-rows.json   # append model-approved new rows (array of row objects)
//
// A run writes back ONLY the stores it actually touched (`touched` below). That is the whole point
// of the sharding: a slot that checked Amazon and Noon must not rewrite Jarir's file, or a
// concurrent slot's commit disappears — the failure that cost four runs on 2026-09-19.
const fs = require('fs'), path = require('path'); const ROOT = __dirname;
const R = require('./rules/verdict'); const H = require('./lib/history'); const S = require('./lib/state'); const { cleanHttps, cleanOrAbsent, onStoreSite } = require('./lib/safe'); const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/rules.json')));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/stores.json'))); const label = Object.fromEntries(cfg.stores.map(s => [s.id, s.label]));
const origin = Object.fromEntries(cfg.stores.map(s => [s.id, s.origin])); const known = S.knownStores(ROOT);   // BLD-37
const state = S.load(ROOT, cfg);
const now = new Date(); const riy = new Date(now.getTime() + 3 * 3600e3); const today = riy.toISOString().slice(0, 10);
const mode = process.argv[2] || 'check';
const report = { date: today, newlyUnavailable: [], restocked: [], priceChanged: [], fixedLinks: [], unchecked: [], added: [], badLinks: [], unknownStore: [], failedCheck: [], clockHeld: [], recheck: [] };
const touched = new Set();

let hist = null;
if (mode === 'check') {
  hist = H.load(ROOT);
  const dir = path.join(ROOT, 'work/check'); const obs = {};
  // the observation files present name the stores this slot owns — nothing else is written back
  // BLD-37 (Codex audit 04 and 05, 24 Nov 2026). A check file names its store; only a store in config/stores.json is
  // taken. A file that is not valid JSON, or does not hold a list of observations (an adapter's error object), is a
  // FAILED check: the store is not touched at all, so its shard, its rows and its «last checked» time stay exactly as
  // they were, and the run's coverage gate shows it as stale. Before this, an error object marked the store as
  // checked now with every row unchecked.
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    if (!known.has(id)) { report.unknownStore.push(id.slice(0, 60)); continue; }
    let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { report.failedCheck.push([id, 'not valid JSON']); continue; }
    if (!Array.isArray(j)) { report.failedCheck.push([id, 'not a list of observations']); continue; }
    touched.add(id); for (const o of j) if (o && o.id) obs[o.id] = o;
  }
  const readBy = {}, rowsBy = {};   // per store: rows this check really read, and rows it had
  // BLD-37: per store, the rows its check file names, and whether every one of them is still needsCheck (a §2b recheck).
  // Taken BEFORE the loop below, which clears needsCheck on the rows it reads.
  const named = {}; for (const r of state.rows) if (touched.has(r.store) && obs[r.id]) (named[r.store] = named[r.store] || []).push(r);
  const recheckOnly = new Set(Object.entries(named).filter(([, rs]) => rs.every(r => r.needsCheck)).map(([id]) => id));
  const freshNamed = Object.fromEntries(Object.entries(named).map(([id, rs]) => [id, rs.length]));
  for (const r of state.rows) {
    // a row belonging to another slot's store is not "unchecked" — it simply is not this slot's
    // job. Counting it as unchecked made a healthy staggered run look like a 222-row failure.
    if (!touched.has(r.store)) continue;
    rowsBy[r.store] = (rowsBy[r.store] || 0) + 1;
    const o = obs[r.id]; const st = label[r.store];
    if (!o) { report.unchecked.push(r.id); continue; }
    const wasUn = ['oos', 'ended', 'gone'].includes(r.avail);
    const a = R.availability(o, r, rules, st);
    if (a.unchecked) { report.unchecked.push(r.id); r.availNote = a.note; continue; }
    readBy[r.store] = (readBy[r.store] || 0) + 1;
    // a corrected link is taken only as a clean https address (lib/safe.js, 22 Nov 2026 audit); anything else leaves the row's link as it was
    // BLD-37 (Codex 03): and only on the row's own store's site
    if (o.url && o.url !== r.url && !cleanHttps(o.url)) report.badLinks.push([r.id, 'url']);
    else if (o.url && o.url !== r.url && !onStoreSite(o.url, origin[r.store])) report.badLinks.push([r.id, 'url not on the store\'s site']);
    if (o.url && o.url !== r.url && cleanHttps(o.url) && onStoreSite(o.url, origin[r.store]) && !/\/error|404/.test(o.url)) { report.fixedLinks.push([r.id, r.url, o.url]); r.url = o.url; }
    if (a.priceChanged) { report.priceChanged.push([r.id, r.price, a.price]); r.price = a.price; }
    const isUn = ['oos', 'ended', 'gone'].includes(a.avail);
    if (isUn && !wasUn) report.newlyUnavailable.push([r.id, a.avail]); if (!isUn && wasUn) report.restocked.push([r.id, a.avail]);
    r.avail = a.avail; r.availNote = a.note; r.lastChecked = today;
    // BLD-36: the maker's model number and barcode as the store's own page states them, kept for the market comparison
    if (o.model && !r.model) r.model = String(o.model).slice(0, 40);
    if (o.gtin && !r.gtin) r.gtin = String(o.gtin);
    // BLD-11: a row with no Arabic name takes the store's own Arabic title its check read (Extra's ar-sa page)
    if (o.name && /[\u0600-\u06FF]/.test(o.name) && !/[\u0600-\u06FF]/.test(String(r.name || ''))) r.name = String(o.name).slice(0, 200);
    if (r.needsCheck) { delete r.needsCheck; (report.firstChecked = report.firstChecked || []).push([r.id, a.avail]); }
    // record what we saw, for rows no public tracker covers (fashion, beauty, baby, furniture)
    if (!isUn) H.record(hist, r.id, r.price, today);
    // rows with no external reference: re-judge them against OUR OWN accumulated history
    // NOT during the campaign (ruled 2026-09-20, re-confirmed 2026-09-22 when it fired on 22 rows):
    // inside the sale window our own record compares a sale price to a sale price, so it proves only
    // that the sale has not moved. It is not a before-price. Observations keep being recorded above;
    // the re-judging starts the day after config/campaign.json → campaignEnd.
    const inCampaign = state.meta.campaignEnd && today <= state.meta.campaignEnd;
    if (r.verdict === 'na' && !isUn && inCampaign) { report.selfVerifySkipped = (report.selfVerifySkipped || 0) + 1; }
    else if (r.verdict === 'na' && !isUn) {
      const ev = H.evidence(hist, r.id, today);
      if (ev && ev.days >= (rules.verdict.ownHistoryMinDays || 2)) {
        const v = R.verdict(r.price, r.was, ev, rules, {});
        if (v.verdict !== 'na') {
          r.verdict = v.verdict; r.ref = v.ref;
          r.finding = `${v.finding} · حسب تتبّعنا للسعر منذ ${ev.since}`;
          (report.selfVerified = report.selfVerified || []).push([r.id, v.verdict]);
        }
      }
    }
  }
  // BLD-37 (Codex audit 05, Mahmoud's rule D39 of 24 Nov 2026): a store's «last checked» time moves only when this check
  // read at least half of that store's rows. Otherwise the rows it did read are still updated, but the shard keeps its
  // old checkedAt, so the page's «some stores checked earlier» note and the coverage gate stay honest, and the store is
  // named in report.clockHeld for the run log. A store with no rows has nothing to read and moves as before.
  // A RECHECK (RUNBOOK §2b: `inject.js <store> recheck` writes a check file holding only this run's needsCheck rows) is
  // not a check of the store: it confirms the new rows after the store's own full check. When every row its file names
  // was needsCheck, the clock never moves (the full check before it already moved it, or held it) and it is no alarm:
  // report.recheck lists it. Found 24 Nov 03:15 (Finding 24 Nov 2026 0315 Riyadh): without this, the §2b step read
  // «noon 7 of 277» and raised a false «last-checked time kept» in every run that added rows.
  for (const id of touched) {
    const n = rowsBy[id] || 0, k = readBy[id] || 0;
    if (recheckOnly.has(id)) { report.recheck.push([id, k, freshNamed[id]]); continue; }
    if (n > 0 && 2 * k < n) report.clockHeld.push([id, k, n]);
  }
  // The page cap used to live here, deleting the oldest unavailable rows across ALL stores. That is
  // a cross-store write, so under a staggered schedule one slot would delete rows belonging to a
  // store it never checked. It now runs at render time in build.js, where it deletes nothing.
} else if (mode === 'new') {
  const add = JSON.parse(fs.readFileSync(process.argv[3])); const ids = new Set(state.rows.map(r => r.id));
  // categorise deterministically from the collect-path slug (config/categories.json → map),
  // so a new category never depends on per-run judgement. An explicit Arabic r.cat always wins.
  const catsCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/categories.json'), 'utf8'));
  const chipIds = new Set((Array.isArray(catsCfg) ? catsCfg : catsCfg.chips).map(c => c.id));
  const catMap = Array.isArray(catsCfg) ? {} : (catsCfg.map || {});
  const fallback = Array.isArray(catsCfg) ? 'إلكترونيات' : (catsCfg.fallback || 'إلكترونيات');
  report.uncategorised = [];
  // Intake cap: keep the biggest VERIFIED savings, leave the rest for the next run (protects run time).
  // This used to rank by (was - price) — the store's own claimed "before". On 2026-09-19 that number
  // was found inflated on 29 of 118 rows (one claimed 67% off an item whose price had not moved), so
  // ranking by it handed the intake slots to the loudest claims and pushed quiet genuine discounts to
  // the next run. Verified rows now outrank unverified ones outright; ties break on money saved.
  const capN = rules.page.maxNewPerRun || Infinity;
  const verified = r => r.ref != null && r.ref > r.price;
  const saved = r => verified(r) ? r.ref - r.price : Math.max(0, (r.was || 0) - r.price);
  // A new row is taken only when its links are clean https addresses (lib/safe.js, 22 Nov 2026 audit, SEC-F3): the link to
  // the store, and the compared-product and evidence links when it has them. A row that fails is not added; it is listed
  // in report.badLinks with the field that failed, so the run can read the link again from the store's page.
  const badField = r => !cleanHttps(r.url) ? 'url' : !onStoreSite(r.url, origin[r.store]) ? 'url not on the store\'s site' : !cleanOrAbsent(r.refUrl) ? 'refUrl' : !cleanOrAbsent(r.ev && r.ev.url) ? 'ev.url' : null;
  // BLD-37 (Codex audit 04): a new row's store must be a store in config/stores.json; its id becomes a file name
  for (const r of add) if (!known.has(r.store)) report.unknownStore.push(`${String(r.id || '?').slice(0, 60)} (${String(r.store).slice(0, 40)})`);
  // BLD-36: an untracked candidate (no KanBkam record) must carry the maker's model number, and one that was compared in the
  // last REFRESH_DAYS days without being verified is not added again: the comparison would only repeat its answer.
  const M = require('./lib/market'), mcache = M.load(ROOT);
  const recent = id => { const e = mcache[id]; return !!(e && e.sampledAt && (Date.parse(today) - Date.parse(e.sampledAt)) / 86400e3 < M.REFRESH_DAYS); };
  const untrackedOk = r => !r.untracked || (r.verdict === 'na' && !!String(r.model || '').trim() && !recent(r.id));
  report.untrackedSkipped = add.filter(r => r.untracked && !ids.has(r.id) && !untrackedOk(r)).map(r => r.id);
  const fresh = add.filter(r => known.has(r.store)).filter(r => !ids.has(r.id)).filter(untrackedOk).filter(r => { const f = badField(r); if (f) report.badLinks.push([r.id, f]); return !f; });
  // categorise BEFORE ranking, so the per-chip reservation below can see each row's chip
  for (const r of fresh) {
    if (!chipIds.has(r.cat)) {
      const slug = r.slug || r.cat;
      const m = catMap[slug];
      if (m) r.cat = m; else { report.uncategorised.push(`${r.id} (${slug || '—'})`); r.cat = fallback; }
    }
  }
  const rank = (a, b) => (verified(b) - verified(a)) || (saved(b) - saved(a));
  fresh.sort(rank);
  // Per-chip reservation (rules.page.reservedPerChip, 22 Sep): fill the under-represented chips
  // first — best verified saving WITHIN each chip — then rank everything left together as before.
  // Ranking only by money saved hands every slot to TVs and appliances, which is why the page read
  // as "electronics and furniture" even after fashion, kids and pharmacy stores were collected.
  const reserve = rules.page.reservedPerChip || {};
  const taken = new Set(), order = [];
  for (const [chip, n] of Object.entries(reserve)) {
    for (const r of fresh.filter(r => r.cat === chip).slice(0, n)) { if (order.length >= capN) break; taken.add(r.id); order.push(r); }
  }
  for (const r of fresh) { if (order.length >= capN) break; if (!taken.has(r.id)) { taken.add(r.id); order.push(r); } }
  if (fresh.length > order.length) report.deferred = fresh.length - order.length;
  for (const r of order) {
    if (ids.has(r.id)) continue;
    delete r.slug;
    // A new row's availability comes from wherever discovery saw it — a listing, a price tracker's
    // inventory flag — and that is not the store saying "in stock". On 22 Sep an Extra tablet went
    // up as available at 99 SAR on the tracker's word while Extra itself had it out of stock.
    // needsCheck keeps the row OFF the page (build.js) until the store's own check() has seen it:
    // `node scripts/inject.js <store> recheck` → work/check/<store>.json → `node apply.js check`.
    r.needsCheck = true;
    r.firstSeen = today; state.rows.push(r); report.added.push(r.id); touched.add(r.store);
  }
}
// write back only this slot's stores
const all = S.byStore(state.rows);
const mine = Object.fromEntries([...touched].map(id => [id, all[id] || []]));
// BLD-37: a store whose clock is held, or whose check was only a §2b recheck, keeps its old checkedAt; its rows are saved
const held = new Set([...report.clockHeld, ...report.recheck].map(x => x[0]));
const pick = keep => Object.fromEntries(Object.entries(mine).filter(([id]) => keep(held.has(id))));
report.wrote = [
  ...S.saveStores(ROOT, pick(h => !h), { updated: today, checkedAt: mode === 'check' ? riy.toISOString().replace('Z', '+03:00') : null }),
  ...S.saveStores(ROOT, pick(h => h), { updated: today, checkedAt: null }),   // BLD-37: rows saved, clock kept
];
const histWrote = hist ? H.save(ROOT, hist, [...touched]) : [];   // same rule: only this slot's history shards
// the exact files this slot must upload — one directory, so one upload form and one commit
const mineNow = [...report.wrote.map(s => `data/state/${s}.json`), ...histWrote.map(s => `data/state/${s}.history.json`)];
// A run calls apply.js more than once (check, then new), and each call rewrites work/report.json.
// The upload list must survive that: it is the UNION of every call in this run, kept in
// work/upload.json (work/ starts empty in every fresh clone). Uploading only the last call's list
// would drop the check phase's shards — found 22 Sep, before the first sharded run.
const UP = path.join(ROOT, 'work/upload.json');
let prevUp = []; try { prevUp = JSON.parse(fs.readFileSync(UP, 'utf8')); } catch (e) {}
report.upload = [...new Set([...prevUp, ...mineNow])].sort();
fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true }); fs.writeFileSync(UP, JSON.stringify(report.upload, null, 1));
fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'work/report.json'), JSON.stringify(report, null, 1));
if (report.unknownStore.length) console.error(`refused, store not in config/stores.json: ${report.unknownStore.join(', ')}`);
if (report.failedCheck.length) console.error(`check failed, store left as it was (clock not moved): ${report.failedCheck.map(([id, why]) => `${id} (${why})`).join(', ')}`);
if (report.clockHeld.length) console.error(`last-checked time kept, the check read under half the rows: ${report.clockHeld.map(([id, k, n]) => `${id} ${k} of ${n}`).join(', ')}`);
if (report.recheck.length) console.log(`recheck of new rows only, last-checked time left as it was: ${report.recheck.map(([id, k, n]) => `${id} ${k} of ${n} new rows read`).join(', ')}`);
if (report.badLinks.length) console.error(`links refused (not a clean https address): ${report.badLinks.map(([id, f]) => `${id} ${f}`).join(', ')}`);
console.log(JSON.stringify({ rows: state.rows.length, ...Object.fromEntries(Object.entries(report).filter(([k, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])) }));
