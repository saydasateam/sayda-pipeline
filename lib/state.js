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
//   data/state/_travel.json     { travel, travelNone, travelNone_text, travelNone_text_en }     — one writer: the 20:30 slot
//   data/state/_coupons.json    { coupons }                                 — one writer: the 20:30 slot
//   data/state/_notes.json      { notes }                                   — one writer: the 20:30 slot
//   data/state/_cars.json       { cars, carsNone }                          — same single writer as _travel.json
//   data/state/_subs.json       { subs }  app subscription offers (BLD-27)  — same single writer as _travel.json; absent = none
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

// BLD-37 (Codex audit 07, 24 Nov 2026). readJson above turns a damaged file into the fallback without a word, which is
// right for a file that is simply not there yet and wrong for one that is there and broken: a Noon shard cut short built
// a page with no Noon at all (560 rows instead of 830, exit 0, replay content), and a damaged _coupons.json brought back
// September's codes from the old data/state.json. readState keeps the fallback for a MISSING file and stops the run,
// naming the file, for one that is present but unreadable or not a JSON object. A refresh that stops here publishes
// nothing, so the live page keeps the last good build. Fix: restore the file from git (git show HEAD~1:<path>).
const shortPath = p => String(p).replace(/\\/g, '/').replace(/^.*?\/((?:data|config)\/)/, '$1');
const readState = (p, fallback) => {
  let txt;
  try { txt = fs.readFileSync(p, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error(`state: ${shortPath(p)} cannot be read (${e.code || e.message}); nothing was built or written`); }
  let v;
  try { v = JSON.parse(txt); }
  catch (e) { throw new Error(`state: ${shortPath(p)} is not valid JSON (${e.message}); restore it from git before running again, nothing was built or written`); }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error(`state: ${shortPath(p)} does not hold a JSON object; nothing was built or written`);
  for (const k of ['rows', 'coupons', 'travel', 'travelNone', 'cars', 'carsNone', 'subs'])
    if (v[k] != null && !Array.isArray(v[k])) throw new Error(`state: ${shortPath(p)} has «${k}» that is not a list; nothing was built or written`);
  return v;
};

// BLD-37 (Codex audit 04): a shard's file name is its store id. Only a store in config/stores.json may have one, so a
// store id that came from a run's own output («../../config/rules», a typo) can never become a path or a new shard.
const STORE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const knownStores = root => new Set((readState(path.join(root, 'config/stores.json'), { stores: [] }).stores || []).map(s => s.id).filter(id => STORE_ID.test(id)));
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
    let legacyRows = 0;
    for (const r of legacy.rows || []) if (!sharded.has(r.store)) { rows.push(r); legacyRows++; }
    if (legacy.meta && legacy.meta.updated) updated = legacy.meta.updated;
    // Only count the legacy file's single meta.checkedAt while it is still SUPPLYING rows. Once every
    // store has a shard it supplies none, and folding its old timestamp in pinned oldestCheckedAt to
    // the migration date for ever — making the honest-staleness figure permanently and falsely alarming.
    if (legacyRows && legacy.meta && legacy.meta.checkedAt) checked.push(legacy.meta.checkedAt);
  }
  for (const id of ids) {
    const s = readState(path.join(D.state, id + '.json'), null);
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
  const campaign = { ...(legacy && legacy.meta ? { campaign: legacy.meta.campaign, campaignEnd: legacy.meta.campaignEnd } : {}), ...readState(D.campaign, {}) };
  const travel = readState(path.join(D.shared, '_travel.json'), legacy ? { travel: legacy.travel, travelNone: legacy.travelNone, travelNone_text: legacy.travelNone_text } : {});
  const coupons = readState(path.join(D.shared, '_coupons.json'), legacy ? { coupons: legacy.coupons } : {});
  const notes = readState(path.join(D.shared, '_notes.json'), legacy ? { notes: legacy.notes } : {});
  const cars = readState(path.join(D.shared, '_cars.json'), {});
  const subs = readState(path.join(D.shared, '_subs.json'), {});
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
    travelNone_text_en: travel.travelNone_text_en || '',   // BLD-19: the English page's sentence under the travel no-offer cards
    travelScanned: travel.scanned || {},   // { <source url>: 'YYYY-MM-DD' }: the day each travel source was last read (BLD-33)
    coupons: coupons.coupons || [],
    notes: notes.notes || {},
    cars: cars.cars || [],
    carsNone: cars.carsNone || [],
    subs: subs.subs || [],
  };
}

/** Write back ONLY the stores this run touched. Every other shard is left untouched on disk,
 *  which is the whole point: a concurrent slot's commit cannot be reverted by this one. */
function saveStores(root, rowsByStore, { updated, checkedAt }) {
  const D = DIRS(root);
  const written = [];
  const known = knownStores(root);
  for (const store of Object.keys(rowsByStore))
    if (!known.has(store)) throw new Error(`state: refusing to write a shard for «${String(store).slice(0, 60)}»: not a store in config/stores.json (BLD-37)`);
  for (const [store, rows] of Object.entries(rowsByStore)) {
    const p = path.join(D.state, store + '.json');
    const prev = readState(p, {});
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

module.exports = { load, saveStores, saveShared, shards, byStore, DIRS, readJson, readState, knownStores, writeJson };
