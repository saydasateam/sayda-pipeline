#!/usr/bin/env node
// inject.js — prints the code bundle to paste into a browser tab (Claude-in-Chrome javascript_tool or DevTools):
//   node scripts/inject.js extra            # core + extra adapter
//   node scripts/inject.js extra check      # …plus a call that starts the check for that store's rows and stores the job
//   node scripts/inject.js kanbkam history extra   # history job for a store's ids
const fs = require('fs'), path = require('path'); const ROOT = path.join(__dirname, '..');
const [name, action, arg] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/stores.json'))), rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/rules.json'))), state = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/state.json')));
const store = cfg.stores.find(s => s.id === (arg || name)) || {};
let code = fs.readFileSync(path.join(ROOT, 'adapters/_core.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'adapters', (name === 'kanbkam' ? 'kanbkam' : store.adapter || name) + '.js'), 'utf8') + '\n';
const rows = state.rows.filter(r => r.store === store.id).map(r => ({ id: r.id, url: r.url, price: r.price }));
if (action === 'check') code += `SAYDA.start('check:${store.id}', () => SAYDA.adapters['${store.id}'].check(${JSON.stringify(rows)}, ${JSON.stringify(store)}, ${JSON.stringify(rules)}));`;
if (action === 'collect') code += `SAYDA.start('collect:${store.id}', () => SAYDA.adapters['${store.id}'].collect(${JSON.stringify(store)}, ${JSON.stringify(rules)}));`;
if (action === 'coupons') code += `SAYDA.start('coupons:${store.id}', () => SAYDA.adapters['${store.id}'].coupons(${JSON.stringify(store)}));`;
if (name === 'kanbkam' && action === 'history') { const ids = rows.map(r => (store.kanbkamPrefix || '') + (r.url.match(/saudi-ar\/([^/]+)\/p|\/dp\/([A-Z0-9]{10})|\/p\/(\d+)/) || []).slice(1).find(Boolean)); code += `SAYDA.start('history:${store.id}', () => SAYDA.kanbkam.history(${JSON.stringify(ids)}, ${store.kanbkamMid}));`; }
process.stdout.write(code);
