#!/usr/bin/env node
// unshard.js — the rollback. Merge the per-store shards back into a single data/state.json and
// data/history.json, the exact shape the pre-sharding code reads.
//
//   node scripts/unshard.js --dry    # show what would be written
//   node scripts/unshard.js          # write data/state.json and data/history.json
//
// WHY THIS EXISTS
// Reverting the code is not a rollback on its own. `git revert` restores data/state.json as it was
// on the day of the change, so every row collected since would silently disappear — a rollback that
// loses four days of work is not a rollback. Run this FIRST, against the live shards, and the
// restored single file carries everything up to this minute.
//
// ROLLBACK, IN ORDER:
//   1. node scripts/unshard.js          — rebuild state.json + history.json from the live shards
//   2. upload both files to data/ on GitHub (the pre-change upload step)
//   3. revert the code commit (the Revert button on the merged pull request)
//   4. node build.js && node scripts/replay.js   — confirm the page still builds and agrees
// Step 1 before step 3, always: after the revert, this script is gone with the rest of the change.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const S = require('../lib/state.js');
const H = require('../lib/history.js');
const dry = process.argv.includes('--dry');

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/stores.json'), 'utf8'));
if (!fs.existsSync(path.join(ROOT, 'data/state'))) {
  console.error('no data/state/ — nothing to unshard. You are already on the single-file layout.');
  process.exit(1);
}

// --check: is the gradual migration finished? data/state.json can only be deleted once every
// store has run at least once and written its own shard. Until then it is still supplying rows.
if (process.argv.includes('--check')) {
  const legacy = S.readJson(path.join(ROOT, 'data/state.json'), null);
  if (!legacy) { console.log('data/state.json is already gone — migration complete.'); process.exit(0); }
  const have = new Set(S.shards(ROOT, cfg));
  const stillLegacy = [...new Set(legacy.rows.map(r => r.store))].filter(s => !have.has(s));
  const counts = stillLegacy.map(s => `${s} (${legacy.rows.filter(r => r.store === s).length} rows)`);
  if (!stillLegacy.length) {
    console.log('Every store now has a shard. data/state.json is no longer supplying any row —');
    console.log('safe to delete it and data/history.json in the next commit.');
  } else {
    console.log(`Still served from data/state.json — do NOT delete it yet (${stillLegacy.length} stores):`);
    for (const c of counts) console.log('  ' + c);
    console.log('\nEach one moves to its shard the first time its slot runs.');
  }
  process.exit(0);
}

const st = S.load(ROOT, cfg);
const hist = H.load(ROOT);

// The pre-change state.json carried campaign facts inside meta; they now live in config/campaign.json.
// Put them back, or the reverted build.js renders a page with no campaign name and no end date.
const campaign = S.readJson(path.join(ROOT, 'config/campaign.json'), {});
const out = {
  meta: {
    campaign: campaign.campaign ?? st.meta.campaign ?? null,
    campaignEnd: campaign.campaignEnd ?? st.meta.campaignEnd ?? null,
    updated: st.meta.updated,
    // the old file stored checkedAt; the sharded layout derives it. Write the derived value back.
    checkedAt: st.meta.checkedAt,
  },
  rows: st.rows,
  travel: st.travel,
  travelNone: st.travelNone,
  travelNone_text: st.travelNone_text,
  coupons: st.coupons,
  notes: st.notes,
};
if (campaign.artifactTitle) out.meta.artifactTitle = campaign.artifactTitle;

const nHist = Object.keys(hist).length;
console.log(`data/state.json   ${out.rows.length} rows from ${new Set(out.rows.map(r => r.store)).size} shards`);
console.log(`                  travel ${out.travel.length}+${out.travelNone.length} · coupons ${out.coupons.length} · notes ${Object.keys(out.notes || {}).length}`);
console.log(`                  meta.checkedAt ${out.meta.checkedAt} (derived from the newest shard)`);
console.log(`data/history.json ${nHist} tracked ids`);

if (dry) { console.log('\n--dry: nothing written'); process.exit(0); }

fs.writeFileSync(path.join(ROOT, 'data/state.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(ROOT, 'data/history.json'), JSON.stringify(hist));
console.log('\nwritten. Upload BOTH files to data/ in one commit, then revert the code change.');
console.log('The shards are left in place — delete data/state/ only');
console.log('once the reverted page has built and replayed clean.');
