// history.js — our OWN price history, built from every run, sharded per store.
//
// KanBkam only tracks Noon / Amazon / Extra electronics. Fashion, beauty, baby and furniture have no
// public price history in KSA, so a claimed "was" there is unverifiable on day one. Recording what we
// observe on each run turns that into a real reference over time — and unlike a store's own "before"
// price, it is a number we measured ourselves.
//
// HONEST LIMIT (ruled 2026-09-20): inside a campaign window this compares a campaign price to a
// campaign price. It proves the sale has not moved; it is NOT a before-price and must never be
// presented as one. Its real value starts after the campaign ends, and mid-campaign it catches a
// price moving under us. apply.js gates on rules.verdict.ownHistoryMinDays accordingly.
//
// SHARDED, for the same reason data/state is: data/state/<store>.history.json has exactly one writer —
// the slot that owns that store. A single data/history.json had every slot rewriting it whole, so a
// staggered schedule would drop observations exactly as it dropped rows.
const fs = require('fs'), path = require('path');
const DIR = root => path.join(root, 'data/state');   // <store>.history.json, beside the store's state shard
const SUFFIX = '.history.json';
const LEGACY = root => path.join(root, 'data/history.json');
const MAX_POINTS = 60;               // ~2 weeks at 4 runs/day, then oldest points drop off

/** Store id is the prefix of a row id: "amazon:B0CP31L73X" → "amazon". */
const storeOf = id => String(id).split(':')[0];

const readJson = (p, f) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return f; } };

/** Merge the shards into one { rowId: points[] } map.
 *  Same gradual migration as lib/state.js: the legacy file and the shards coexist, and a shard
 *  WINS for its own store. A store keeps its history from history.json until its slot runs once. */
function load(root) {
  const d = DIR(root);
  const legacy = readJson(LEGACY(root), null);
  if (!fs.existsSync(d)) return legacy || {};
  const files = fs.readdirSync(d).filter(n => n.endsWith(SUFFIX));
  const sharded = new Set(files.map(f => f.slice(0, -SUFFIX.length)));
  const out = {};
  if (legacy) for (const id of Object.keys(legacy)) if (!sharded.has(storeOf(id))) out[id] = legacy[id];
  for (const f of files) Object.assign(out, readJson(path.join(d, f), {}));
  return out;
}

/** Write back only the stores named in `touched`. Everything else stays as it is on disk.
 *  Passing no list writes every store present in the map — correct for a migration or a full run,
 *  wrong for one slot of a staggered schedule, so callers in the run path always pass the list. */
function save(root, h, touched) {
  const d = DIR(root);
  fs.mkdirSync(d, { recursive: true });
  const groups = {};
  for (const id of Object.keys(h)) {
    const s = storeOf(id);
    if (touched && !touched.includes(s)) continue;
    (groups[s] = groups[s] || {})[id] = h[id];
  }
  for (const [s, m] of Object.entries(groups)) fs.writeFileSync(path.join(d, s + SUFFIX), JSON.stringify(m));
  return Object.keys(groups);
}

/** Append today's observation. Consecutive identical prices collapse into one point. */
function record(h, id, price, day) {
  if (!(price > 0)) return;
  const a = (h[id] = h[id] || []);
  const last = a[a.length - 1];
  // a point is [firstDaySeen, price, lastDaySeen] — an unchanged price extends the point's end date
  // rather than overwriting its start, so "we've tracked this since X" stays truthful.
  if (last && last[1] === price) { last[2] = day; return; }
  a.push([day, price, day]);
  if (a.length > MAX_POINTS) a.splice(0, a.length - MAX_POINTS);
}

/** Evidence from our own record, in the shape rules/verdict.js expects.
 *  prev = the most recent price observed on an EARLIER day (never today's own price). */
function evidence(h, id, day) {
  const a = h[id] || [];
  const earlier = a.filter(p => p[0] < day);          // points that STARTED before today
  if (!earlier.length) return null;
  const prices = earlier.map(p => p[1]);
  const since = earlier[0][0];
  const days = Math.round((Date.parse(day) - Date.parse(since)) / 86400e3);
  return {
    prev: prices[prices.length - 1],
    min: Math.min(...prices),
    max: Math.max(...prices),
    since, days,
    tracked: true, own: true
  };
}

module.exports = { load, save, record, evidence, storeOf, DIR, LEGACY, MAX_POINTS };
