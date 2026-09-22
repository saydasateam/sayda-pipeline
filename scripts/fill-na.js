#!/usr/bin/env node
// fill-na.js — top up a store that has `intake.fillTo` in config/stores.json (Mumzworld, Mothercare,
// Toys R Us — decided 2026-09-22) to that many AVAILABLE rows, using candidates the run collected but
// could not verify. Every row it writes is `na`: ref null, the store's naFinding, no percentage we
// derived. `na` claims nothing and stays out of the page's default «verified» filter, so the store shows
// its top N without the page asserting a single discount it cannot back.
//
//   node scripts/fill-na.js <store> work/collect/<store>.json   → writes work/fill-<store>.json
//   node apply.js new work/fill-<store>.json
//
// Run it AFTER the verified rows for that store have been applied, so verified rows fill the slots first.
// Selection is deterministic: available candidates, not already in state, one per model (brand + first
// 30 name characters), ranked by the store's own claimed saving — the only number we have for an `na`
// row, and one we never show as a verified discount.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { verdict } = require('../rules/verdict.js');
const S = require('../lib/state.js');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/stores.json'), 'utf8'));
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/rules.json'), 'utf8'));
const [storeId, file] = process.argv.slice(2);
const store = cfg.stores.find(s => s.id === storeId);
if (!store || !file) { console.error('usage: node scripts/fill-na.js <store> <candidates.json>'); process.exit(2); }
const fillTo = store.intake && store.intake.fillTo;
if (!fillTo || !(store.intake.allowNa)) { console.error(`${storeId}: no intake.fillTo/allowNa in config/stores.json — nothing to fill`); process.exit(2); }
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const cands = Array.isArray(raw) ? raw : (raw.candidates || []);
const st = S.load(ROOT, cfg);
const mine = st.rows.filter(r => r.store === storeId);
const alive = mine.filter(r => !['oos', 'ended', 'gone'].includes(r.avail)).length;
const need = Math.max(0, fillTo - alive);
const have = new Set(mine.map(r => r.id));
const modelKey = c => (String(c.brand || '') + '|' + String(c.name || '').replace(/[^؀-ۿA-Za-z0-9]/g, '').slice(0, 30)).toLowerCase();
const seen = new Set(mine.map(modelKey));
const out = [];
for (const c of cands.slice().sort((a, b) => (b.was - b.price) - (a.was - a.price))) {
  if (out.length >= need) break;
  const id = `${storeId}:${c.key}`;
  if (have.has(id) || c.inStock === false || !(c.price > 0)) continue;
  const mk = modelKey(c); if (seen.has(mk)) continue; seen.add(mk);
  const v = verdict(c.price, c.was, { prev: null, min: null, max: null, market: null }, rules, { naFinding: store.naFinding });
  if (v.verdict !== 'na') continue;             // defensive: with no evidence the rule must return na
  out.push({ id, store: storeId, slug: c.cat || store.collect && store.collect.cat || storeId, name: String(c.name || '').slice(0, 60),
             price: c.price, was: c.was, ref: v.ref, verdict: v.verdict, finding: v.finding, url: c.url,
             avail: c.inStock === true || c.inStock == null ? 'in' : 'oos', availNote: c.inStock == null ? 'التوفر من صفحة القائمة — يُفحص في الدورة القادمة' : '' });
}
const dest = path.join(ROOT, 'work', `fill-${storeId}.json`);
fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ store: storeId, fillTo, alive, need, wrote: out.length, file: path.relative(ROOT, dest) }));
