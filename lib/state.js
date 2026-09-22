// state.js — the page's state, sharded so two overlapping cycles never write the same file.
//
// WHY THIS EXISTS
// Every run used to clone main, edit the single data/state.json, and commit it whole. That is safe
// at four runs a day, six hours apart. At twelve runs a day, thirty minutes apart, it is not: a slot
// that cloned before an earlier slot committed silently reverts everything that slot wrote, and the
// run looks perfectly healthy while doing it. That failure cost four runs on 2026-09-19.
//
// LAYOUT
//   config/campaign.json        static campaign facts. Never written by a run.
//   data/state/<store>.json     { store, updated, checkedAt, rows: [...] }  — one writer: that store's slot
//   data/state/<store>.history.json  own price history for that store     — same single writer (lib/history.js)
//   data/state/_travel.json     { travel, travelNone, travelNone_text }     — one writer: the 20:30 slot
//   data/state/_coupons.json    { coupons }                                 — one writer: the 20:30 slot
//   data/state/_notes.json      { notes }                                   — one writer: the 20:30 slot
//
// ONE DIRECTORY, ON PURPOSE (22 Sep): everything a slot writes lives in data/state/, because the
// only write path is GitHub's upload form, and one form = one target directory = one commit. With
// state, history and shared files in three folders, "state and history in the same commit" could
// not be done through the form at all.
//
// No file has two writers, so no two cycles can clobber each other. meta.checkedAt is no longer
// stored anywhere: build.js derives it from the per-store checkedAt values, which means the
// timestamp on the page is computed, not written, and a staggered schedule cannot corrupt it.
//
// load() returns the same { meta, rows, travel, travelNone, coupons, notes } object the rest of the
// pipeline has always consumed, so build.js, apply.js and the template are unchanged in shape.
const fs = require('fs'), path = require('path');

const DIRS = root => ({
  state: path.join(root, 'data/state'),
  shared: path.join(root, 'data/state'),   // shared files are data/state/_<key>.json
  legacy: path.join(root, 'data/state.json'),
  campaign: path.join(root, 'config/campaign.json'),
});

const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 1)); };

/** Store ids that currently have a shard, in stores.json order when a config is supplied. */
function shards(root, cfg) {
  const d = DIRS(root).state;
  if (!fs.existsSync(d)) return [];
  const ids = fs.readdirSync(d).filter(f => f.endsWith('.json') && !f.startsWith('_') && !f.endsWith('.history.json')).map(f => f.slice(0, -5));
  if (!cfg) return ids.sort();
  const order = cfg.stores.map(s => s.id);
  return ids.sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
}

/** Merge the shards into the single in-memory shape the pipeline has always used.
 *
 *  GRADUAL MIGRATION, NOT A FLAG DAY.
 *  data/state.json and the shards coexist, and a shard WINS for its own store. That means the
 *  switch does not have to happen all at once: land the code with the legacy file still in place,
 *  and each store moves to its shard the first time its slot runs. Until then its rows keep coming
 *  from state.json, so nothing is missing at any point in between.
 *
 *  This matters because the alternative is an atomic upload of 35 data files plus two deletions
 *  through a web form, and a half-completed one loses every row belonging to a store whose shard
 *  did not make it. A migration that can stop halfway and still be correct is worth more than a
 *  tidy one. Once all 16 stores have run at least once, `node scripts/unshard.js --check` says so
 *  and data/state.json can be deleted.
 */
function load(root, cfg) {
  const D = DIRS(root);
  const legacy = readJson(D.legacy, null);
  const ids = shards(root, cfg);
  if (!legacy && !ids.length) throw new Error('no data/state/ shards and no data/state.json — nothing to build from');

  const rows = [];
  const checked = [];
  let updated = null;
  const sharded = new Set(ids);

  // legacy rows first, but only for stores that have no shard yet
  if (legacy) {
    for (const r of legacy.rows || []) if (!sharded.has(r.store)) rows.push(r);
    if (legacy.meta && legacy.meta.updated) updated = legacy.meta.updated;
    if (legacy.meta && legacy.meta.checkedAt) checked.push(legacy.meta.checkedAt);
  }
  for (const id of ids) {
    const s = readJson(path.join(D.state, id + '.json'), null);
    if (!s) continue;
    for (const r of s.rows || []) rows.push(r);
    if (s.checkedAt) checked.push(s.checkedAt);
    if (s.updated && (!updated || s.updated > updated)) updated = s.updated;
  }
  // rows keep stores.json order even while the two sources are mixed, so the page's default
  // ordering does not lurch around mid-migration
  if (legacy && ids.length) {
    const order = cfg ? cfg.stores.map(s => s.id) : [];
    rows.sort((a, b) => (order.indexOf(a.store) + 1 || 999) - (order.indexOf(b.store) + 1 || 999));
  }
  const campaign = { ...(legacy && legacy.meta ? { campaign: legacy.meta.campaign, campaignEnd: legacy.meta.campaignEnd } : {}), ...readJson(D.campaign, {}) };
  const travel = readJson(path.join(D.shared, '_travel.json'), legacy ? { travel: legacy.travel, travelNone: legacy.travelNone, travelNone_text: legacy.travelNone_text } : {});
  const coupons = readJson(path.join(D.shared, '_coupons.json'), legacy ? { coupons: legacy.coupons } : {});
  const notes = readJson(path.join(D.shared, '_notes.json'), legacy ? { notes: legacy.notes } : {});
  checked.sort();
  return {
    meta: {
      ...campaign,
      updated: updated || (checked.length ? checked[checked.length - 1].slice(0, 10) : null),
      // newest slot to finish — what «آخر فحص» on the page means
      checkedAt: checked[checked.length - 1] || null,
      // oldest slot to finish — the honest staleness guarantee across all stores
      oldestCheckedAt: checked[0] || null,
    },
    rows,
    travel: travel.travel || [],
    travelNone: travel.travelNone || [],
    travelNone_text: travel.travelNone_text || '',
    coupons: coupons.coupons || [],
    notes: notes.notes || {},
  };
}

/** Write back ONLY the stores this run touched. Every other shard is left untouched on disk,
 *  which is the whole point: a concurrent slot's commit cannot be reverted by this one. */
function saveStores(root, rowsByStore, { updated, checkedAt }) {
  const D = DIRS(root);
  const written = [];
  for (const [store, rows] of Object.entries(rowsByStore)) {
    const p = path.join(D.state, store + '.json');
    const prev = readJson(p, {});
    writeJson(p, {
      store,
      updated: updated || prev.updated || null,
      checkedAt: checkedAt || prev.checkedAt || null,
      rows,
    });
    written.push(store);
  }
  return written;
}

/** Shared, non-per-store material. One writer each — see the header. */
function saveShared(root, key, value) { writeJson(path.join(DIRS(root).shared, '_' + key + '.json'), value); }

/** Group a flat row list by store id. */
const byStore = rows => rows.reduce((m, r) => ((m[r.store] = m[r.store] || []).push(r), m), {});

module.exports = { load, saveStores, saveShared, shards, byStore, DIRS, readJson, writeJson };
