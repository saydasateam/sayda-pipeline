// history.js — our OWN price history, built from every run.
// KanBkam only tracks Noon / Amazon / Extra electronics. Fashion, beauty, baby and furniture have no
// public price history in KSA, so a claimed "was" there is unverifiable on day one. Recording what we
// observe on each run (4×/day) turns that into a real reference within a few days — and unlike a
// store's own "before" price, it is a number we measured ourselves.
const fs = require('fs'), path = require('path');
const FILE = p => path.join(p, 'data/history.json');
const MAX_POINTS = 60;               // ~2 weeks at 4 runs/day, then oldest points drop off

const load = root => { try { return JSON.parse(fs.readFileSync(FILE(root), 'utf8')); } catch { return {}; } };
const save = (root, h) => fs.writeFileSync(FILE(root), JSON.stringify(h));

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

module.exports = { load, save, record, evidence, FILE, MAX_POINTS };
