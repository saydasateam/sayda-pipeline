#!/usr/bin/env node
// market-apply.js — turn a comparator sweep into verdicts.
//
//   node scripts/market-apply.js --plan                    # what would be looked up, and why
//   node scripts/market-apply.js work/market/<store>.json  # SHADOW: compare, change nothing
//   node scripts/market-apply.js work/market/<store>.json --apply    # write the rows
//
// SHADOW IS THE DEFAULT AND THAT IS THE POINT. The hand-probed market path has a measured 8% yield
// across 62 real queries. This one has been tested against 4 probes and a unit-test suite. Until a
// full cycle has been run both ways and the verdicts compared, nothing here writes to a state shard.
//
// `ref` is whatever rules/verdict.js returns from the evidence. This script never picks a number,
// never substitutes a listing price for a verdict, and never writes a row whose evidence was
// rejected by rules/match.js — a rejected comparison leaves the row exactly as it was.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const S = require('../lib/state.js');
const M = require('../lib/market.js');
const R = require('../rules/verdict.js');
const { marketEvidence } = require('../rules/match.js');
const { fromBlocks } = require('../rules/listing.js');

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/stores.json'), 'utf8'));
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/rules.json'), 'utf8'));
const state = S.load(ROOT, cfg);
const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const MARKET_STORES = cfg.stores.filter(s => s.verify === 'market').map(s => s.id);
// BLD-36 (23 Nov 2026): a noon, Amazon or Extra product that KanBkam does not track, added with `untracked: true` and the
// maker's model number its own page states (`row.model`), is compared like a market store's row. It stays off the page
// (build.js) until then: a match makes it an ordinary market row; no usable comparator, or no link to the other store's own
// page, and --apply removes it, because nothing verified it. rules/match.js and rules/verdict.js are unchanged.
const isUntracked = r => !!r.untracked;

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const plan = args.includes('--plan');
const file = args.find(a => !a.startsWith('--'));

const cache = M.load(ROOT);

// ── --plan: the work list, with the reason each row is in or out ─────────────────────────────────
if (plan || !file) {
  const rows = state.rows.filter(r => MARKET_STORES.includes(r.store) || isUntracked(r));
  const jobs = [], skipped = [], fresh = [];
  for (const r of rows) {
    if (M.isFresh(cache[r.id], r, today)) { fresh.push(r.id); continue; }
    const q = M.queryFor(r);
    if (!q) { skipped.push(`${r.store}  ${r.name.slice(0, 48)}  — no brand+model token`); continue; }
    jobs.push({ id: r.id, q: q.q, store: r.store });
  }
  console.log(`market stores: ${MARKET_STORES.join(', ')}${rows.some(isUntracked) ? ` · untracked rows (BLD-36): ${rows.filter(isUntracked).length}` : ''}`);
  console.log(`rows ${rows.length} · to look up ${jobs.length} · cached and fresh ${fresh.length} · not enrichable ${skipped.length}`);
  console.log(`\nestimated sweep: ~${Math.ceil(jobs.length * 3 / 60)} min at one query per 3 s\n`);
  if (skipped.length) { console.log('NOT ENRICHABLE — these stay as they are, which is the honest answer:'); for (const s of skipped) console.log('  ' + s); console.log(); }
  fs.mkdirSync(path.join(ROOT, 'work/market'), { recursive: true });
  for (const st of [...new Set([...MARKET_STORES, ...jobs.map(j => j.store)])]) {
    const mine = jobs.filter(j => j.store === st).map(({ id, q }) => ({ id, q }));
    if (!mine.length) continue;
    fs.writeFileSync(path.join(ROOT, `work/market/${st}.jobs.json`), JSON.stringify(mine, null, 1));
    console.log(`work/market/${st}.jobs.json  ${mine.length} queries`);
  }
  process.exit(0);
}

// ── apply a sweep result ─────────────────────────────────────────────────────────────────────────
const sweep = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = Object.fromEntries(state.rows.map(r => [r.id, r]));
const changes = [], unchanged = [], noEvidence = [], noLink = [], dropUntracked = [];
const touched = new Set();

for (const res of sweep) {
  const row = byId[res.id];
  if (!row) continue;
  const q = M.queryFor(row);
  if (!q) continue;
  // nameEn (BLD-49): the store's own English title, read by rules/match.js condition 3e only (trim words such as «Absolute»)
  const probe = { name: row.name, store: row.store, brand: q.brand, model: q.model, enName: q.enName || '', nameEn: row.name_en || '', variant: q.variant, size: q.size, price: row.price };
  // the adapter hands back raw blocks; rules/listing.js turns them into listings, rules/match.js
  // decides which may be used. `res.listings` is accepted too, for a hand-assembled sweep.
  const listings = res.blocks ? fromBlocks(res.blocks) : (res.listings || []);
  const ev = marketEvidence(probe, listings);
  M.put(cache, row, res.q, ev, today);
  touched.add(row.store);

  if (!ev.market) {
    noEvidence.push([res.id, res.q, (ev.rejected || []).length, (ev.rejected[0] || {}).why || 'nothing returned']);
    if (isUntracked(row)) dropUntracked.push(res.id);
    continue;
  }
  // BLD-21 and BLD-28 (D16, D25): the comparison is used only when it can link the other store's own product page.
  // Without one it is refused, and the row stays exactly as it was (lib/market.js → ownListingUrl).
  const own = M.ownListingUrl(ev.market, cfg.stores, row.store);
  if (!own) { noLink.push([res.id, row.store, `${ev.market.store} ${ev.market.price}`, String(ev.market.url || 'no link').slice(0, 90)]); if (isUntracked(row)) dropUntracked.push(res.id); continue; }
  // the verdict comes from rules/verdict.js, from the evidence. Never from this file.
  const v = R.verdict(row.price, row.was, { market: { store: ev.market.store, price: ev.market.price } }, rules, { marketIsRef: true });
  const same = !isUntracked(row) && v.verdict === row.verdict && Math.abs((v.ref ?? 0) - (row.ref ?? 0)) < 1 && row.refUrl === own.url;
  (same ? unchanged : changes).push({
    id: res.id, store: row.store, name: row.name.slice(0, 44),
    from: `${row.verdict} ref ${row.ref ?? '—'}`, to: `${v.verdict} ref ${v.ref}`,
    via: `${ev.market.store} ${ev.market.price} (${ev.merchantCount} merchant${ev.merchantCount === 1 ? '' : 's'})`,
    finding: v.finding, _v: v, _ev: ev, _own: own,
  });
}

const tally = changes.reduce((m, c) => { const k = `${c.from.split(' ')[0]} → ${c.to.split(' ')[0]}`; m[k] = (m[k] || 0) + 1; return m; }, {});
console.log(`\n${apply ? 'APPLYING' : 'SHADOW — nothing written'} · ${sweep.length} swept`);
console.log(`  verdict changes ${changes.length} · unchanged ${unchanged.length} · no usable comparator ${noEvidence.length} · refused, no link to the other store's own page ${noLink.length}`);
console.log('  ' + (Object.entries(tally).map(([k, n]) => `${k}: ${n}`).join(' · ') || 'none'));

if (changes.length) {
  console.log('\nCHANGES');
  for (const c of changes) console.log(`  ${c.store.padEnd(9)} ${c.name.padEnd(44)} ${c.from}  →  ${c.to}\n      ${c.via} · ${c.finding}`);
}
if (noEvidence.length) {
  console.log('\nNO USABLE COMPARATOR — these stay exactly as they are');
  for (const [id, q, n, why] of noEvidence) console.log(`  ${id.padEnd(28)} "${q}"  ${n} rejected · ${why}`);
}

if (dropUntracked.length) console.log(`\nUNTRACKED, NOT VERIFIED (BLD-36) — ${apply ? 'removed' : 'would be removed with --apply'}: ${dropUntracked.join(', ')}`);

if (noLink.length) {
  console.log("\nREFUSED: NO LINK TO THE OTHER STORE'S OWN PRODUCT PAGE (BLD-21) — these stay exactly as they are");
  for (const [id, st, via, u] of noLink) console.log(`  ${id.padEnd(28)} ${st} · ${via} · ${u}`);
}

if (!apply) {
  console.log('\nRe-run with --apply once these verdicts have been compared against a hand-probed cycle.');
  process.exit(0);
}

for (const c of changes) {
  const row = byId[c.id];
  row.verdict = c._v.verdict;
  row.ref = c._v.ref;                      // whatever verdict() returned — never a hand-picked number
  row.refKind = 'market';
  // BLD-28 (D25): refUrl is the other store's own product page, so «دليل السعر» opens the model where the price is stated,
  // and refStore names that store on the card. Only a clean https address on an enabled store's own host gets here
  // (ownListingUrl); a comparison without one was refused above (BLD-21, D16), so no market row is written without a link.
  row.refUrl = c._own.url;
  row.refStore = c._own.store;
  row.finding = c._v.finding;
  row.ev = { market: { store: c._ev.market.store, price: c._ev.market.price, url: c._own.url }, min: c._ev.min, max: c._ev.max, n: c._ev.merchantCount, src: 'market', on: today, url: c._own.url };
  if (c._v.kind) row.bk = c._v.kind;
  delete row.untracked;                    // BLD-36: verified against the same model in another store, so it may show
}
// BLD-36: an untracked row that no comparison verified leaves the state; it was never on the page
if (dropUntracked.length) { const gone = new Set(dropUntracked); state.rows = state.rows.filter(r => !(gone.has(r.id) && isUntracked(r))); }
const all = S.byStore(state.rows);
const wrote = S.saveStores(ROOT, Object.fromEntries([...touched].map(id => [id, all[id] || []])), { updated: today, checkedAt: null });
M.save(ROOT, cache, [...touched]);
console.log(`\nwritten: ${changes.length} rows in ${wrote.join(', ')} · comparator cache updated`);
if (noLink.length) console.log(`refused, no link to the other store's own page (rows left as they were): ${noLink.map(x => x[0]).join(', ')}`);
console.log('Now run `node scripts/replay.js` before building — a conflict means fix the row, not publish over it.');
