#!/usr/bin/env node
// apply-names.js — write each product's English name into its row.
//
//   node scripts/apply-names.js <file>      file: JSON [{id, name_en}] from SAYDA.names(), or lines «id|name»
//
// The English page is a required half of every publish (Mahmoud, 20 Nov 2026), and its product names
// are the stores' own English titles, read from the English version of each product page. They are
// not translated here or anywhere else: a name we wrote ourselves could describe a different variant
// from the one the price was checked on. A row whose store offers no English title keeps name_en
// unset, and the English page shows its Arabic name until a later run finds one.
// Like apply-images.js this writes only the shards it changed and leaves `checkedAt` alone.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const S = require('../lib/state');
const file = process.argv[2];
if (!file) { console.error('usage: node scripts/apply-names.js <file>'); process.exit(2); }
const raw = fs.readFileSync(file, 'utf8').trim();
const items = raw.startsWith('[') ? JSON.parse(raw) : raw.split('\n').filter(Boolean).map(l => { const i = l.indexOf('|'); return { id: l.slice(0, i), name_en: l.slice(i + 1) }; });
// tidy, never rewrite: drop a doubled brand («Nishane Nishane …»), stray Arabic marks, loose commas,
// and cut an over-long SEO title at a separator
const tidy = t => {
  if (!t) return null;
  t = String(t).replace(/[ً-ٰٟ]/g, '').replace(/\s+/g, ' ').replace(/\s+,/g, ',').replace(/,(?=\S)/g, ', ').trim();
  t = t.replace(/^(\S+(?: \S+)?) \1(?= )/i, '$1').replace(/[\s,.|–-]+$/, '');
  if (t.length > 110) { const c = t.slice(0, 110), k = Math.max(c.lastIndexOf(','), c.lastIndexOf(' - '), c.lastIndexOf(' | ')); t = (k > 50 ? c.slice(0, k) : c.slice(0, c.lastIndexOf(' '))).trim(); }
  return t.length >= 4 && !/[؀-ۿ]/.test(t) ? t : null;
};
const D = S.DIRS(ROOT), touched = {}, known = S.knownStores(ROOT);   // BLD-37: only a configured store's shard is opened
let set = 0, skipped = 0;
for (const { id, name_en } of items) {
  const store = String(id).split(':')[0], p = path.join(D.state, store + '.json');
  if (!known.has(store)) { skipped++; continue; }
  const shard = touched[store] || S.readState(p, null); if (!shard) { skipped++; continue; }
  const row = (shard.rows || []).find(r => r.id === id), name = tidy(name_en);
  if (!row || !name) { skipped++; continue; }
  if (row.name_en !== name) { row.name_en = name; set++; touched[store] = shard; }
}
for (const [store, shard] of Object.entries(touched)) S.writeJson(path.join(D.state, store + '.json'), shard);
const wrote = Object.keys(touched).map(s => `data/state/${s}.json`);
try { const up = path.join(ROOT, 'work/upload.json'); const cur = fs.existsSync(up) ? JSON.parse(fs.readFileSync(up, 'utf8')) : []; fs.mkdirSync(path.dirname(up), { recursive: true }); fs.writeFileSync(up, JSON.stringify([...new Set([...cur, ...wrote])], null, 1)); } catch {}
const all = S.load(ROOT, JSON.parse(fs.readFileSync(path.join(ROOT, 'config/stores.json'), 'utf8'))).rows;
console.log(`english names: set ${set}, skipped ${skipped} · rows with one ${all.filter(r => r.name_en).length} of ${all.length} · wrote ${wrote.join(', ') || 'nothing'}`);
