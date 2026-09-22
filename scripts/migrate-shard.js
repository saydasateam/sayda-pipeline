#!/usr/bin/env node
// migrate-shard.js — one-off: split data/state.json and data/history.json into per-store shards.
//
//   node scripts/migrate-shard.js --dry     # report what would be written, touch nothing
//   node scripts/migrate-shard.js           # write the shards (leaves the originals in place)
//
// The originals are NOT deleted here. Verify with `node build.js` first — the rendered page must be
// byte-identical to the one built before the split — then remove them in the same commit that
// updates RUNBOOK.md, so a rollback is one `git revert`.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const S = require('../lib/state.js');
const H = require('../lib/history.js');
const dry = process.argv.includes('--dry');

const LEGACY = path.join(ROOT, 'data/state.json');
if (!fs.existsSync(LEGACY)) {
  console.log('data/state.json is gone — this migration has already run. Shards are the source of truth:');
  console.log('  data/state/<store>.json · data/state/<store>.history.json · data/state/_{travel,coupons,notes}.json');
  process.exit(0);
}
const state = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/stores.json'), 'utf8'));
const known = new Set(cfg.stores.map(s => s.id));

const groups = S.byStore(state.rows);
const unknown = Object.keys(groups).filter(id => !known.has(id));
if (unknown.length) { console.error('rows reference stores not in stores.json:', unknown.join(', ')); process.exit(1); }

console.log(`state.json → ${Object.keys(groups).length} shards, ${state.rows.length} rows`);
for (const [id, rows] of Object.entries(groups)) console.log(`   data/state/${id}.json  ${rows.length} rows`);

// campaign facts move to config — static, never written by a run, so no slot can clobber them
const campaign = { campaign: state.meta.campaign, campaignEnd: state.meta.campaignEnd };
if (state.meta.artifactTitle) campaign.artifactTitle = state.meta.artifactTitle;
console.log(`config/campaign.json  ${JSON.stringify(campaign)}`);
console.log(`data/state/_travel.json  ${state.travel.length} + ${state.travelNone.length} none`);
console.log(`data/state/_coupons.json  ${state.coupons.length}`);
console.log(`data/state/_notes.json  ${Object.keys(state.notes || {}).length} keys`);

const hist = H.load(ROOT);
const hByStore = {};
for (const id of Object.keys(hist)) (hByStore[H.storeOf(id)] = hByStore[H.storeOf(id)] || []).push(id);
console.log(`history.json → ${Object.keys(hByStore).length} shards, ${Object.keys(hist).length} tracked ids`);

if (dry) { console.log('\n--dry: nothing written'); process.exit(0); }

// every store carries the same checkedAt/updated it had as one file; from here each slot
// advances only its own stores' timestamps and build.js derives the page's from the set
S.saveStores(ROOT, groups, { updated: state.meta.updated, checkedAt: state.meta.checkedAt });
S.writeJson(path.join(ROOT, 'config/campaign.json'), campaign);
S.saveShared(ROOT, 'travel', { travel: state.travel, travelNone: state.travelNone, travelNone_text: state.travelNone_text || '' });
S.saveShared(ROOT, 'coupons', { coupons: state.coupons });
S.saveShared(ROOT, 'notes', { notes: state.notes });
H.save(ROOT, hist);

console.log('\nwritten. Now run `node build.js` and diff dist/index.html against the pre-split build.');
