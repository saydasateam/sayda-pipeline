#!/usr/bin/env node
// apply-images.js — write product pictures into the rows.
//
//   node scripts/apply-images.js <file>      file: JSON [{id, img}] from SAYDA.images(), or lines «id|img»
//
// A picture is the store's own image for that product, read from its product page in the browser
// (adapters/_core.js → SAYDA.images). It is never a search result and never another store's photo:
// a wrong picture on a verified price is its own kind of false claim. A row without one keeps the
// neutral tile. Only the shards of stores that received a picture are written; `checkedAt` is left
// alone, because nothing about price or stock was re-checked here.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const S = require('../lib/state');
const file = process.argv[2];
if (!file) { console.error('usage: node scripts/apply-images.js <file>'); process.exit(2); }
const raw = fs.readFileSync(file, 'utf8').trim();
const items = raw.startsWith('[') ? JSON.parse(raw) : raw.split('\n').filter(Boolean).map(l => { const i = l.indexOf('|'); return { id: l.slice(0, i), img: l.slice(i + 1) }; });
// one normaliser per CDN: a card needs ~400px, not the 1500px original
const norm = (store, v) => {
  if (!v) return null;
  if (store === 'noon' && !/^https?:/.test(v)) v = `https://f.nooncdn.com/p/${v}.jpg?width=400`;   // catalog API gives an image key
  if (/m\.media-amazon\.com/.test(v)) v = v.replace(/\._[A-Z0-9_,]+_\.(jpg|png|webp)$/i, '._AC_SL500_.$1');
  return /^https:\/\/[^\s"'<>]+$/.test(v) ? v : null;
};
const D = S.DIRS(ROOT), touched = {}, known = S.knownStores(ROOT);   // BLD-37: only a configured store's shard is opened
let set = 0, skipped = 0;
for (const { id, img } of items) {
  const store = String(id).split(':')[0], p = path.join(D.state, store + '.json');
  if (!known.has(store)) { skipped++; continue; }
  const shard = touched[store] || S.readState(p, null); if (!shard) { skipped++; continue; }
  const row = (shard.rows || []).find(r => r.id === id), url = norm(store, img);
  if (!row || !url) { skipped++; continue; }
  if (row.img !== url) { row.img = url; set++; touched[store] = shard; }
}
for (const [store, shard] of Object.entries(touched)) S.writeJson(path.join(D.state, store + '.json'), shard);
const wrote = Object.keys(touched).map(s => `data/state/${s}.json`);
// keep the run's upload list honest: these shards changed and must ride in the state commit
try { const up = path.join(ROOT, 'work/upload.json'); const cur = fs.existsSync(up) ? JSON.parse(fs.readFileSync(up, 'utf8')) : []; fs.mkdirSync(path.dirname(up), { recursive: true }); fs.writeFileSync(up, JSON.stringify([...new Set([...cur, ...wrote])], null, 1)); } catch {}
const all = S.load(ROOT, JSON.parse(fs.readFileSync(path.join(ROOT, 'config/stores.json'), 'utf8'))).rows;
console.log(`pictures: set ${set}, skipped ${skipped} · rows with a picture ${all.filter(r => r.img).length} of ${all.length} · wrote ${wrote.join(', ') || 'nothing'}`);
