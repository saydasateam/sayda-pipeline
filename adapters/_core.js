// _core.js — shared helpers for browser-context adapters. Injected first, then one adapter file.
// Every adapter registers: window.SAYDA.adapters[id] = { collect(cfg, rules), check(rows, cfg, rules), coupons(cfg) }
// All functions are async and return plain JSON (no DOM nodes). Keep outputs compact.
(function(){
  if (window.SAYDA && window.SAYDA.v) return;
  const S = window.SAYDA = { v: 1, adapters: {}, jobs: {} };

  S.sleep = ms => new Promise(r => setTimeout(r, ms));
  S.num = s => { const m = String(s ?? '').replace(/[,٬]/g,'').replace(/[٠-٩]/g, d => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(d)]).match(/\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
  S.round = n => n == null ? null : Math.round(n);

  // bounded parallel worker pool over a job list
  S.pool = async (jobs, n, fn) => { const q = jobs.slice(); const out = []; const w = async () => { while (q.length) { const j = q.shift(); try { out.push(await fn(j)); } catch (e) { out.push({ error: String(e && e.message || e).slice(0, 80), job: j }); } } }; await Promise.all(Array.from({ length: n }, w)); return out; };

  S.fetchText = async (url, opt) => { const r = await fetch(url, opt); return { status: r.status, url: r.url, text: await r.text() }; };
  S.fetchJson = async (url, opt) => { const r = await fetch(url, opt); const t = await r.text(); try { return { status: r.status, url: r.url, json: JSON.parse(t) }; } catch (e) { return { status: r.status, url: r.url, json: null, text: t.slice(0, 200) }; } };
  S.dom = html => new DOMParser().parseFromString(html, 'text/html');
  S.text = el => (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();
  S.nextData = html => { const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); if (!m) return null; try { return JSON.parse(m[1]); } catch (e) { return null; } };
  S.get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  S.ldProduct = doc => { for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) { try { const j = JSON.parse(s.textContent); const arr = j['@graph'] || [j]; const p = arr.find(x => x && x['@type'] === 'Product'); if (p) return p; } catch (e) {} } return null; };

  // candidate filter shared by collectors: real saving and a meaningful claimed discount
  // tiered candidate gate — mirrors rules/verdict.js candidateGate(); tier chosen by the LIVE price
  S.tierFor = (tiers, price) => (Array.isArray(tiers) && tiers.length)
    ? (tiers.find(t => t.maxPrice == null || price <= t.maxPrice) || tiers[tiers.length - 1]) : null;
  S.gate = (price, rules) => { const C = rules.candidate, t = S.tierFor(C.tiers, price);
    return { minSaving: t ? t.minSaving : C.minSaving, minClaimedPct: t ? t.minClaimedPct : C.minClaimedPct }; };
  S.isCandidate = (price, was, rules, minSaving) => { if (!(price > 0 && was > price)) return false;
    const g = S.gate(price, rules);
    return (was - price) >= (minSaving ?? g.minSaving) && (1 - price / was) >= g.minClaimedPct; };

  // ── boot: fetch the run's inputs instead of having them pasted in ──────────────────────────────
  // WHY THIS EXISTS — it is a cost control, not a convenience.
  // The driver is a language model, and everything pasted into a tab stays in its context for every
  // later call in the run. Measured: ~81 KB of adapter JavaScript ≈ 1M tokens per run once it rides
  // through the ~50 calls that follow, and the inlined rows ≈ another 0.5M. Fetching both inside the
  // browser costs the driver two short lines instead, and the numbers never enter its context at all.
  //
  // Pair it with the raw-GitHub adapter bootstrap in RUNBOOK §1 and a store's whole injection is:
  //   (0,eval)(await fetch(RAW+'/adapters/_core.js').then(r=>r.text()));
  //   (0,eval)(await fetch(RAW+'/adapters/<adapter>.js').then(r=>r.text()));
  //   await SAYDA.boot('<store>');
  //   SAYDA.start('check:<store>', () => SAYDA.adapters['<store>'].check(SAYDA.ctx.rows, SAYDA.ctx.store, SAYDA.ctx.rules));
  //
  // Per-store state shards are what make the rows half affordable: this fetches one store's file,
  // not a 253-row state.json, so the browser pulls a few KB rather than the whole page's data.
  S.RAW = 'https://raw.githubusercontent.com/saydasateam/sayda-pipeline';
  S.boot = async (storeId, ref) => {
    const base = `${S.RAW}/${ref || 'main'}`;
    const grab = async p => { const r = await fetch(`${base}/${p}`, { cache: 'no-store' }); if (!r.ok) throw new Error(`boot: ${p} -> HTTP ${r.status}`); return r.json(); };
    const [cfg, rules] = await Promise.all([grab('config/stores.json'), grab('config/rules.json')]);
    const store = cfg.stores.find(s => s.id === storeId);
    if (!store) throw new Error(`boot: no store "${storeId}" in config/stores.json`);
    // a collect-only or coupons-only run has no shard yet; that is not an error
    // During the gradual migration a store with no shard yet is still served from data/state.json.
    // Falling back to an empty list here would make the check a silent no-op that looks healthy.
    let rows = [], source = 'none';
    const pick = list => (list || []).filter(r => r.store === storeId).map(r => ({ id: r.id, url: r.url, price: r.price }));
    try { const shard = await grab(`data/state/${storeId}.json`); rows = pick(shard.rows); source = 'shard'; }
    catch (e) { try { const legacy = await grab('data/state.json'); rows = pick(legacy.rows); source = 'legacy'; } catch (e2) { rows = []; } }
    S.ctx = { store, rules, rows, ref: ref || 'main', at: new Date().toISOString() };
    // returned small on purpose — this is what the driver sees, and it should be a receipt, not data
    return { store: storeId, rows: rows.length, source, adapter: store.adapter || storeId, ref: S.ctx.ref };
  };

  // background job helpers: start(fn) stores a promise on window; status() is polled by the driver
  S.start = (name, fn) => { const j = S.jobs[name] = { done: false, result: null, error: null, t0: Date.now() }; fn().then(r => { j.result = r; j.done = true; }).catch(e => { j.error = String(e && e.stack || e).slice(0, 300); j.done = true; }); return name; };
  S.status = name => { const j = S.jobs[name]; return j ? { done: j.done, error: j.error, ms: Date.now() - j.t0, size: j.result ? JSON.stringify(j.result).length : 0 } : null; };
  // show(): replace the page body with a job's (compact) result so a driver can read it with one get_page_text call
  // (the Chrome extension truncates javascript results at ~1 KB; page text is not truncated). fn maps result → string.
  S.show = (name, fn) => { const j = S.jobs[name]; const r = j ? j.result : null; const txt = fn ? fn(r) : JSON.stringify(r); document.body.innerHTML = '<pre id="sayda-out" style="white-space:pre-wrap;font:12px monospace"></pre>'; document.getElementById('sayda-out').textContent = 'SAYDA:' + name + '\n' + txt; return txt.length; };
  S.result = (name, from, len) => { const j = S.jobs[name]; if (!j || !j.done) return null; const s = JSON.stringify(j.result); return from == null ? s : s.slice(from, from + (len || 30000)); };
})();
