#!/usr/bin/env node
// inject.js — prints the code to run in a browser tab (Claude-in-Chrome javascript_tool or DevTools).
//
// TWO MODES, AND THE DEFAULT IS THE EXPENSIVE ONE — use `boot` unless the store forbids it.
//   node scripts/inject.js extra boot check   # 4 short lines; adapter AND rows fetched in-browser
//   node scripts/inject.js extra check        # the old self-contained bundle: ~11 KB pasted
//   node scripts/inject.js extra              # core + adapter, no call
//   node scripts/inject.js kanbkam history extra
//
// The driver is a language model and everything pasted into a tab stays in its context for every
// later call of the run. Measured in the Phase 4 doc: the adapter JavaScript is ~1M tokens per run
// once it rides through the ~50 calls that follow, and the inlined rows another ~0.5M. `boot` moves
// both inside the browser, so the driver pays for two lines and never sees a row.
//
// `boot` needs the tab to be able to fetch raw.githubusercontent.com. jarir, ikea and midas have a
// Content-Security-Policy that blocks it — those three keep the paste bundle, and that is the only
// reason the old mode still exists.
// It also reads the COMMITTED files, so anything not yet pushed to `main` will not be there; pass a
// branch as the 4th argument while testing: `node scripts/inject.js extra boot check my-branch`.
const fs = require('fs'), path = require('path'); const ROOT = path.join(__dirname, '..');
const [name, action, arg, ref] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/stores.json'))), rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/rules.json'))), state = require('../lib/state.js').load(ROOT, cfg);
const store = cfg.stores.find(s => s.id === (arg || name)) || {};

// ── boot mode: print the fetch-based bootstrap instead of a bundle ───────────────────────────────
const CSP_BLOCKED = ['jarir', 'ikea', 'midas'];   // these tabs cannot fetch raw.githubusercontent.com
if (action === 'boot') {
  const act = arg && ['check', 'collect', 'coupons'].includes(arg) ? arg : 'check';
  const branch = ref || 'main';
  if (CSP_BLOCKED.includes(name)) {
    process.stderr.write(`# ${name} blocks raw.githubusercontent.com (CSP). Use: node scripts/inject.js ${name} ${act}\n`);
    process.exit(2);
  }
  const s = cfg.stores.find(x => x.id === name) || {};
  const adapter = s.adapter || name;
  const call = act === 'check'   ? `SAYDA.adapters['${name}'].check(SAYDA.ctx.rows, SAYDA.ctx.store, SAYDA.ctx.rules)`
             : act === 'collect' ? `SAYDA.adapters['${name}'].collect(SAYDA.ctx.store, SAYDA.ctx.rules)`
             :                     `SAYDA.adapters['${name}'].coupons(SAYDA.ctx.store)`;
  process.stdout.write(
`const RAW='https://raw.githubusercontent.com/saydasateam/sayda-pipeline/${branch}';
(0,eval)(await fetch(RAW+'/adapters/_core.js').then(r=>r.text()));
(0,eval)(await fetch(RAW+'/adapters/${adapter}.js').then(r=>r.text()));
await SAYDA.boot('${name}'${branch === 'main' ? '' : `,'${branch}'`});
SAYDA.start('${act}:${name}', () => ${call});
`);
  process.exit(0);
}
let code = fs.readFileSync(path.join(ROOT, 'adapters/_core.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'adapters', (name === 'kanbkam' ? 'kanbkam' : store.adapter || name) + '.js'), 'utf8') + '\n';
const rows = state.rows.filter(r => r.store === store.id).map(r => ({ id: r.id, url: r.url, price: r.price }));
if (action === 'check') code += `SAYDA.start('check:${store.id}', () => SAYDA.adapters['${store.id}'].check(${JSON.stringify(rows)}, ${JSON.stringify(store)}, ${JSON.stringify(rules)}));`;
if (action === 'collect') code += `SAYDA.start('collect:${store.id}', () => SAYDA.adapters['${store.id}'].collect(${JSON.stringify(store)}, ${JSON.stringify(rules)}));`;
if (action === 'coupons') code += `SAYDA.start('coupons:${store.id}', () => SAYDA.adapters['${store.id}'].coupons(${JSON.stringify(store)}));`;
if (name === 'kanbkam' && action === 'history') { const ids = rows.map(r => (store.kanbkamPrefix || '') + (r.url.match(/saudi-ar\/([^/]+)\/p|\/dp\/([A-Z0-9]{10})|\/p\/(\d+)/) || []).slice(1).find(Boolean)); code += `SAYDA.start('history:${store.id}', () => SAYDA.kanbkam.history(${JSON.stringify(ids)}, ${store.kanbkamMid}));`; }
process.stdout.write(code);
