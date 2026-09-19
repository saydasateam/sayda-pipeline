#!/usr/bin/env node
// apply.js — merges work/check/*.json (live observations) into data/state.json using rules/verdict.js,
// and writes work/report.json (what changed) for the summary. Also sets meta.checkedAt/updated.
//   node apply.js check            # apply availability observations
//   node apply.js new work/new-rows.json   # append model-approved new rows (array of row objects)
const fs = require('fs'), path = require('path'); const ROOT = __dirname;
const R = require('./rules/verdict'); const H = require('./lib/history'); const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/rules.json')));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/stores.json'))); const label = Object.fromEntries(cfg.stores.map(s => [s.id, s.label]));
const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/state.json')));
const now = new Date(); const riy = new Date(now.getTime() + 3 * 3600e3); const today = riy.toISOString().slice(0, 10);
const mode = process.argv[2] || 'check';
const report = { date: today, newlyUnavailable: [], restocked: [], priceChanged: [], fixedLinks: [], unchecked: [], added: [] };

let hist = null;
if (mode === 'check') {
  hist = H.load(ROOT);
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
    // record what we saw, for rows no public tracker covers (fashion, beauty, baby, furniture)
    if (!isUn) H.record(hist, r.id, r.price, today);
    // rows with no external reference: re-judge them against OUR OWN accumulated history
    if (r.verdict === 'na' && !isUn) {
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
  // page cap: drop oldest unavailable rows beyond maxRows
  const un = state.rows.filter(r => ['oos', 'ended', 'gone'].includes(r.avail)); while (state.rows.length > rules.page.maxRows && un.length) { const d = un.shift(); state.rows.splice(state.rows.indexOf(d), 1); report.dropped = (report.dropped || []).concat(d.id); }
  state.meta.checkedAt = riy.toISOString().replace('Z', '+03:00'); state.meta.updated = today;
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
  const fresh = add.filter(r => !ids.has(r.id));
  fresh.sort((a, b) => (verified(b) - verified(a)) || (saved(b) - saved(a)));
  if (fresh.length > capN) report.deferred = fresh.length - capN;
  for (const r of fresh.slice(0, capN)) {
    if (ids.has(r.id)) continue;
    if (!chipIds.has(r.cat)) {
      const slug = r.slug || r.cat;
      const m = catMap[slug];
      if (m) r.cat = m; else { report.uncategorised.push(`${r.id} (${slug || '—'})`); r.cat = fallback; }
    }
    delete r.slug;
    r.firstSeen = today; r.lastChecked = today; state.rows.push(r); report.added.push(r.id);
  }
  state.meta.updated = today;
}
fs.writeFileSync(path.join(ROOT, 'data/state.json'), JSON.stringify(state, null, 1));
if (hist) H.save(ROOT, hist);
fs.mkdirSync(path.join(ROOT, 'work'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'work/report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ rows: state.rows.length, ...Object.fromEntries(Object.entries(report).filter(([k, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])) }));
