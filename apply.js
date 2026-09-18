#!/usr/bin/env node
// apply.js — merges work/check/*.json (live observations) into data/state.json using rules/verdict.js,
// and writes work/report.json (what changed) for the summary. Also sets meta.checkedAt/updated.
//   node apply.js check            # apply availability observations
//   node apply.js new work/new-rows.json   # append model-approved new rows (array of row objects)
const fs = require('fs'), path = require('path'); const ROOT = __dirname;
const R = require('./rules/verdict'); const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/rules.json')));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/stores.json'))); const label = Object.fromEntries(cfg.stores.map(s => [s.id, s.label]));
const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/state.json')));
const now = new Date(); const riy = new Date(now.getTime() + 3 * 3600e3); const today = riy.toISOString().slice(0, 10);
const mode = process.argv[2] || 'check';
const report = { date: today, newlyUnavailable: [], restocked: [], priceChanged: [], fixedLinks: [], unchecked: [], added: [] };

if (mode === 'check') {
  const dir = path.join(ROOT, 'work/check'); const obs = {};
  for (const f of fs.readdirSync(dir)) { const j = JSON.parse(fs.readFileSync(path.join(dir, f))); if (Array.isArray(j)) for (const o of j) obs[o.id] = o; }
  for (const r of state.rows) {
    const o = obs[r.id]; const st = label[r.store];
    if (!o) { report.unchecked.push(r.id); continue; }
    const wasUn = ['oos', 'ended', 'gone'].includes(r.avail);
    const a = R.availability(o, r, rules, st);
    if (a.unchecked) { report.unchecked.push(r.id); r.availNote = a.note; continue; }
    if (o.url && o.url !== r.url && /^https?:/.test(o.url) && !/\/error|404/.test(o.url)) { report.fixedLinks.push([r.id, r.url, o.url]); r.url = o.url; }
    if (a.priceChanged) { report.priceChanged.push([r.id, r.price, a.price]); r.price = a.price; }
    const isUn = ['oos', 'ended', 'gone'].includes(a.avail);
    if (isUn && !wasUn) report.newlyUnavailable.push([r.id, a.avail]); if (!isUn && wasUn) report.restocked.push([r.id, a.avail]);
    r.avail = a.avail; r.availNote = a.note; r.lastChecked = today;
  }
  // page cap: drop oldest unavailable rows beyond maxRows
  const un = state.rows.filter(r => ['oos', 'ended', 'gone'].includes(r.avail)); while (state.rows.length > rules.page.maxRows && un.length) { const d = un.shift(); state.rows.splice(state.rows.indexOf(d), 1); report.dropped = (report.dropped || []).concat(d.id); }
  state.meta.checkedAt = riy.toISOString().replace('Z', '+03:00'); state.meta.updated = today;
} else if (mode === 'new') {
  const add = JSON.parse(fs.readFileSync(process.argv[3])); const ids = new Set(state.rows.map(r => r.id));
  for (const r of add) { if (ids.has(r.id)) continue; r.firstSeen = today; r.lastChecked = today; state.rows.push(r); report.added.push(r.id); }
  state.meta.updated = today;
}
fs.writeFileSync(path.join(ROOT, 'data/state.json'), JSON.stringify(state, null, 1));
fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'work/report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ rows: state.rows.length, ...Object.fromEntries(Object.entries(report).filter(([k, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])) }));
