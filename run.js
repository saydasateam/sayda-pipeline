#!/usr/bin/env node
// run.js — headless driver (Playwright). Phases: collect | check | coupons | all.
//   node run.js check            # re-verify every row in data/state.json (fast, ~8 min)
//   node run.js collect          # discover candidates per store  → work/collect/<store>.json
//   node run.js coupons          # scan landing pages for codes    → work/coupons/<store>.json
//   node run.js check --store extra,noon   # subset
// Each store gets its own tab on its own origin; adapters run inside the page. Nothing is parsed by the model.
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/stores.json'), 'utf8'));
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/rules.json'), 'utf8'));
const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/state.json'), 'utf8'));
const args = process.argv.slice(2); const phase = args[0] || 'check';
const only = (args.includes('--store') ? args[args.indexOf('--store') + 1].split(',') : null);
// `enabled: false` parks an adapter that has not been probed live yet — a normal run skips it,
// but `--store <id>` still selects it so it can be tested on purpose.
const stores = cfg.stores.filter(s => only ? only.includes(s.id) : s.enabled !== false);
const CORE = fs.readFileSync(path.join(ROOT, 'adapters/_core.js'), 'utf8');
const adapterCode = name => CORE + '\n' + fs.readFileSync(path.join(ROOT, 'adapters', name + '.js'), 'utf8');
const out = (dir, id, data) => { fs.mkdirSync(path.join(ROOT, 'work', dir), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'work', dir, id + '.json'), JSON.stringify(data, null, 1)); };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: 'ar-SA', timezoneId: 'Asia/Riyadh', viewport: { width: 1280, height: 900 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' });
  const openOn = async (url) => { const p = await ctx.newPage(); await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => log('goto', url, e.message)); await p.waitForTimeout(2500); return p; };
  const inject = async (p, name) => { await p.evaluate(adapterCode(name)); };
  const rowsOf = id => state.rows.filter(r => r.store === id);
  const t0 = Date.now();

  // KanBkam-backed collectors (extra, amazon) and history run on one kanbkam tab
  const needKanbkam = phase !== 'coupons' && stores.some(s => s.collect && s.collect.via === 'kanbkam');
  let kb = null; if (needKanbkam) { kb = await openOn(cfg.verifyHosts.kanbkam.home); await inject(kb, 'kanbkam'); }

  const tasks = stores.map(s => async () => {
    try {
      const adapterName = s.adapter; const rows = rowsOf(s.id);
      if (phase === 'collect' && s.collect && s.collect.via === 'kanbkam') { const r = await kb.evaluate(([storeKey, cats, rules, opts]) => SAYDA.kanbkam.listing(storeKey, cats, rules, opts), [s.kanbkamStoreKey, s.collect.cats, rules, { perCat: s.collect.perCat || 25 }]); out('collect', s.id, { candidates: r, via: 'kanbkam' }); return log(s.id, 'collect via kanbkam', r.length); }
      const page = await openOn(phase === 'collect' && s.adapter === 'saco' ? s.landing : s.home); await inject(page, adapterName);
      if (phase === 'collect') {
        if (s.adapter === 'trendyol') { const all = []; for (const term of s.collect.terms) for (let pi = 1; pi <= s.collect.pages; pi++) { await page.goto(`${s.origin}/sr?q=${encodeURIComponent(term)}&sst=BEST_SELLER&pi=${pi}`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000); await inject(page, adapterName); const r = await page.evaluate(([c, ru]) => SAYDA.adapters.trendyol.collectCurrent(c, ru), [s, rules]); all.push(...r.candidates.map(x => ({ ...x, term }))); } out('collect', s.id, { candidates: all }); }
        else if (s.adapter === 'midas') { const ash = fs.existsSync(path.join(ROOT, 'work/collect/ashley.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'work/collect/ashley.json'))) : { candidates: [] }; const series = [...new Set([...ash.candidates.map(c => c.series), ...rowsOf('ashley').map(r => r.name.replace(/^أشلي: /, '').split(' ').pop())])].filter(Boolean); out('collect', s.id, await page.evaluate(([c, ru, ctx]) => SAYDA.adapters.midas.collect(c, ru, ctx), [s, rules, { series }])); }
        else out('collect', s.id, await page.evaluate(([c, ru, id]) => SAYDA.adapters[id].collect(c, ru), [s, rules, s.id]));
        log(s.id, 'collect done');
      } else if (phase === 'check') {
        const ad = await page.evaluate(id => ({ render: !!SAYDA.adapters[id].render, hasCheck: !!SAYDA.adapters[id].check }), s.id);
        let obs = [];
        if (ad.hasCheck) obs = await page.evaluate(([rows, c, ru, id]) => SAYDA.adapters[id].check(rows, c, ru), [rows, s, rules, s.id]);
        if (ad.render) { // navigate to each product and read what a shopper sees
          const need = ad.hasCheck ? rows.filter(r => (obs.find(o => o.id === r.id) || {}).needsRender !== false) : rows; const byId = Object.fromEntries(obs.map(o => [o.id, o]));
          for (const r of need) { await page.goto(r.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}); await page.waitForTimeout(3500); await inject(page, adapterName); const o = await page.evaluate(([row, id]) => SAYDA.adapters[id].checkCurrent(row), [r, s.id]); byId[r.id] = { ...(byId[r.id] || {}), ...o }; }
          obs = Object.values(byId);
        }
        out('check', s.id, obs); log(s.id, 'check', obs.length, 'rows');
      } else if (phase === 'coupons') { out('coupons', s.id, await page.evaluate(([c, id]) => SAYDA.adapters[id].coupons(c), [s, s.id])); log(s.id, 'coupons'); }
      await page.close();
    } catch (e) { log(s.id, 'FAILED', e.message); out(phase, s.id, { error: e.message }); }
  });
  // run 4 stores at a time
  const q = tasks.slice(); await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) await q.shift()(); }));
  await browser.close(); log('done in', Math.round((Date.now() - t0) / 1000), 's');
}
main().catch(e => { console.error(e); process.exit(1); });
