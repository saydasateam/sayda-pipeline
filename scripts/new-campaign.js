#!/usr/bin/env node
// new-campaign.js — close the previous campaign's data and start the next one clean.
//
//   node scripts/new-campaign.js <archive-id>            # dry run: prints what it would do
//   node scripts/new-campaign.js <archive-id> --apply    # does it
//
// Why this exists (19 Nov 2026, White Friday): every row in data/state/ carries evidence dated
// inside the campaign it was collected for — `ev.on`, the tracker's previousPrice, the compared
// store's price. Republishing a September row under a November headline would present two-month-old
// evidence as today's, which is the one claim this site exists not to make. So a new campaign
// starts with no rows, and every row on its page is collected and judged inside it.
//
// What it does, in this order:
//   1. moves every row shard, the shared _*.json files and the legacy single files into
//      data/archive/<archive-id>/ — moved, not deleted; `git mv` keeps them one command away
//   2. writes an EMPTY shard for every store in config/stores.json, enabled or not. Empty rather
//      than absent on purpose: lib/state.js throws when there are no shards at all, and an absent
//      shard would let a leftover legacy data/state.json supply that store's rows again
//   3. resets coupons / travel / cars / subscriptions / notes to empty. Notes included: on 28 Sep all three
//      `kind: "note"` entries were worded as that day's finding («لا يوجد كود مؤكّد اليوم»), so
//      carrying them over would publish a dated check as a current one. The first run re-derives them
//   4. KEEPS data/state/<store>.history.json for enabled stores. That file is our own price record;
//      it is the only thing here that gets more valuable across campaigns. History of stores that
//      are disabled in the new campaign moves to the archive with their rows.
//
// It never touches config/. Edit config/campaign.json and config/stores.json first, then run this.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const S = require('../lib/state');
const id = process.argv[2], apply = process.argv.includes('--apply');
if (!id || id.startsWith('--') || !/^[a-z0-9-]+$/.test(id)) { console.error('usage: node scripts/new-campaign.js <archive-id> [--apply]   e.g. national-day-96'); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/stores.json'), 'utf8'));
const D = S.DIRS(ROOT);
const dest = path.join(ROOT, 'data/archive', id);
if (fs.existsSync(dest)) { console.error(`data/archive/${id} already exists — refusing to archive twice into the same place`); process.exit(2); }

const enabled = new Set(cfg.stores.filter(s => s.enabled !== false).map(s => s.id));
const files = fs.existsSync(D.state) ? fs.readdirSync(D.state).filter(f => f.endsWith('.json')) : [];
const moves = [];
for (const f of files) {
  const isHist = f.endsWith('.history.json');
  const store = isHist ? f.slice(0, -'.history.json'.length) : f.slice(0, -5);
  if (isHist && enabled.has(store)) continue;                    // (4) our price record carries over
  moves.push([path.join(D.state, f), path.join(dest, 'state', f)]);
}
for (const legacy of ['data/state.json', 'data/history.json']) {
  const p = path.join(ROOT, legacy);
  if (fs.existsSync(p)) moves.push([p, path.join(dest, path.basename(legacy))]);
}
const coupons = S.readJson(path.join(D.state, '_coupons.json'), { coupons: [] }).coupons || [];
const rowsBefore = S.load(ROOT, cfg).rows.length;

console.log(`${apply ? 'APPLY' : 'DRY RUN'} — archive id: ${id}`);
console.log(`  rows on the page now: ${rowsBefore}`);
console.log(`  move ${moves.length} files → data/archive/${id}/`);
console.log(`  write ${cfg.stores.length} empty shards (${enabled.size} enabled stores, ${cfg.stores.length - enabled.size} disabled)`);
console.log(`  keep ${files.filter(f => f.endsWith('.history.json') && enabled.has(f.slice(0, -13))).length} history shards in place`);
console.log(`  coupons: drop ${coupons.length}; travel, cars, subscriptions, notes reset`);
if (!apply) { console.log('nothing changed. Re-run with --apply.'); process.exit(0); }

for (const [from, to] of moves) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to); }
for (const s of cfg.stores) S.writeJson(path.join(D.state, s.id + '.json'), { store: s.id, updated: null, checkedAt: null, rows: [] });
S.writeJson(path.join(D.state, '_coupons.json'), { coupons: [] });
S.writeJson(path.join(D.state, '_travel.json'), { travel: [], travelNone: [], travelNone_text: '' });
S.writeJson(path.join(D.state, '_cars.json'), { cars: [], carsNone: [] });
S.writeJson(path.join(D.state, '_subs.json'), { subs: [] });
S.writeJson(path.join(D.state, '_notes.json'), { notes: {} });
const after = S.load(ROOT, cfg);
if (after.rows.length) { console.error(`expected 0 rows after the reset, found ${after.rows.length}`); process.exit(1); }
console.log('done. 0 rows. Next: node build.js && node scripts/replay.js, then the first run of the new campaign.');
