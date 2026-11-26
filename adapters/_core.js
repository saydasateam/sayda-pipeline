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
  // ── model numbers (BLD-36, 23 Nov 2026) ───────────────────────────────────────────────────────
  // The maker's model number as the store's own product page states it (Extra: JSON-LD `mpn`; noon: the
  // `model_number` specification; Amazon: «رقم موديل السلعة» / «رقم الموديل» in the product details). It lets a
  // product KanBkam does not track be compared with the same model in another Saudi store (lib/market.js →
  // queryFor reads `row.model`). A store's own SKU is never a model number. Only a token with a letter AND a
  // digit, 3 to 40 characters, is kept; anything else is null, and a row without one is simply not compared.
  S.modelOf = v => { const s = String(v || '').replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim();
    return /^[A-Za-z0-9][A-Za-z0-9.\-\/ ]{1,38}[A-Za-z0-9]$/.test(s) && /[A-Za-z]/.test(s) && /\d/.test(s) ? s : null; };
  S.gtinOf = v => { const s = String(v || '').trim(); return /^\d{8}$|^\d{12,14}$/.test(s) ? s : null; };
  // ── pictures (20 Nov 2026) ─────────────────────────────────────────────────────────────────────
  // One reader for every store. From a tab on the store's own origin, fetch each row's product page
  // and take the picture the store itself declares for it. Returns [{id, img}] for
  // `node scripts/apply-images.js`. A row with no confident picture gets img:null and keeps the
  // neutral tile: never fill the gap from a search engine or another store.
  //   SAYDA.start('img:<store>', () => SAYDA.images(SAYDA.ctx.rows.filter(r => !r.img)));
  S.imageOf = html => {
    const pick = [/"hiRes":"(https:[^"]+)"/, /id="landingImage"[^>]+src="(https:[^"]+)"/, /data-old-hires="(https:[^"]+)"/,
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i];
    for (const re of pick) { const m = html.match(re); if (m && /^https:\/\//.test(m[1])) return m[1].replace(/&amp;/g, '&'); }
    return null;
  };
  S.images = async (rows, workers) => {
    const out = []; let i = 0;
    const noon = /(^|\.)noon\.com$/.test(location.hostname);   // product pages are a JS shell to fetch; the catalog API carries image keys
    // al-dawaa (BLD-12, 23 Nov 2026): its product pages answer 403 to fetch, so the picture comes from the store's own OCC API
    // (the one adapters/aldawaa.js reads): the PRIMARY image, 515 px «zoom» format, served from the store's media host.
    const dawaa = /(^|\.)al-dawaa\.com$/.test(location.hostname);
    const one = async r => {
      try {
        if (noon) { const sku = (r.url.match(/\/([A-Z0-9]+)\/p\/?/) || [])[1]; const t = await (await fetch(`/_svc/catalog/api/v3/u/${sku}/p/`, { headers: { 'x-locale': 'ar-sa' } })).text();
          const m = t.match(/"image_keys?":\s*\[?\s*"([^"]+)"/); return { id: r.id, img: m ? m[1] : null }; }
        if (dawaa) { const code = (decodeURIComponent(r.url).match(/\/p\/([^/?#]+)/) || [])[1]; if (!code) return { id: r.id, img: null };
          const mb = document.querySelector('meta[name="occ-backend-base-url"]'), B = (mb && mb.content) || 'https://stgprevapi.al-dawaa.com';
          const j = await (await fetch(`${B}/occ/v2/aldawaa/products/${encodeURIComponent(code)}?lang=ar&curr=SAR&fields=FULL`)).json();
          const im = (j.images || []).filter(x => x.imageType === 'PRIMARY'), p = im.find(x => x.format === 'zoom') || im.find(x => x.format === 'product') || im[0];
          return { id: r.id, img: p && p.url ? new URL(p.url, B).href : null }; }
        const u = new URL(r.url, location.href); const res = await fetch(u.origin === location.origin ? u.pathname + u.search : r.url, { credentials: 'omit' });
        return { id: r.id, img: res.status === 200 ? S.imageOf(await res.text()) : null, status: res.status };
      } catch (e) { return { id: r.id, img: null, error: String(e).slice(0, 80) }; }
    };
    const work = async () => { while (i < rows.length) out.push(await one(rows[i++])); };
    await Promise.all(Array.from({ length: workers || 3 }, work));
    return out;
  };
  // ── English names (20 Nov 2026) ────────────────────────────────────────────────────────────────
  // The English page is not a translation of the Arabic one: each product's English name is the
  // store's OWN English title, read from the English version of its product page. `store.en` in
  // config/stores.json says how to reach that version: {api:'noon'} or {try:[[from,to],…]} — URL
  // rewrites tried in order. A title is accepted only when the page answers 200 and the title is in
  // Latin script, so a wrong rewrite yields null, never a wrong name. Returns [{id, name_en}] for
  // `node scripts/apply-names.js`.
  //   SAYDA.start('en:<store>', () => SAYDA.names(SAYDA.ctx.rows.filter(r => !r.name_en), SAYDA.ctx.store));
  // The site's own wrapper around the product name is removed; the name itself is never touched.
  // Seen 20 Nov 2026: «Buy <name> in KSA | Mumzworld», «<name> | Mothercare Saudi Arabia»,
  // «<name> | Nahdi», «<name> | Best Price KSA» (Namshi), «<name> | BlackBox».
  // A tail after «|» goes when it starts with the site's own name (the host label) or is one of the
  // stock phrases. A tail after a dash keeps the older, narrower test, because product names end in
  // « - Black» and « - White» and Blackbox's host starts with «black».
  S.siteTail = (x, host) => {
    if (/\.(com|sa)|extra|noon|amazon|jarir|store|shop|online/i.test(x)) return true;
    if (!/^\s*\|/.test(x)) return false;
    const s = x.replace(/^[\s|]+/, '').toLowerCase(), w = (s.split(/\s+/)[0] || '').replace(/[^a-z0-9]/g, '');
    // BLD-48 (25 Nov 2026): a tail word that IS the whole host label counts at any length, so « | SACO» on saco.sa goes;
    // the 5-letter floor still holds for a word that only starts the host.
    const h = String(host || '');
    return (w.length >= 5 && h.startsWith(w)) || (w.length >= 2 && w === h) || /^best price\b|saudi arabia$|\bksa$/.test(s);
  };
  S.hostLabel = () => location.hostname.replace(/^www\./, '').split('.')[0].toLowerCase();
  // BLD-48: a stored English name that cleanTitle would still shorten (it was read before a wrapper rule existed) is read
  // again by §2d. Only the store's page gives the new name; nothing here rewrites a stored name.
  S.wrapped = (name, host) => { const n = String(name || '').replace(/\s+/g, ' ').trim();
    return !!n && S.cleanTitle(n, host == null ? S.hostLabel() : host) !== n; };
  S.cleanTitle = (raw, host) => {
    let t = String(raw || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/\s*[|–-]\s*[^|–-]{0,30}$/, x => S.siteTail(x, host) ? '' : x).trim();
    const buy = t.match(/^Buy\s+(.+?)\s+in\s+(?:KSA|Saudi Arabia)$/i); if (buy) t = buy[1].trim();
    return t;
  };
  S.titleOf = html => {
    const pick = [/id="productTitle"[^>]*>([^<]+)</, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i, /<h1[^>]*>([^<]{4,200})<\/h1>/i, /<title>([^<]+)</i];
    const host = S.hostLabel();
    for (const re of pick) { const m = html.match(re); if (!m) continue; const d = document.createElement('textarea'); d.innerHTML = m[1];
      const t = S.cleanTitle(d.value, host);
      if (t && !/[؀-ۿ]/.test(t)) return t; }
    return null;
  };
  S.names = async (rows, cfg, workers) => {
    const rule = (cfg && cfg.en) || {}, out = []; let i = 0;
    const one = async r => {
      try {
        if (rule.api === 'noon') { const sku = (r.url.match(/\/([A-Z0-9]+)\/p\/?/) || [])[1]; const j = await (await fetch(`/_svc/catalog/api/v3/u/${sku}/p/`, { headers: { 'x-locale': 'en-sa' } })).json();
          const p = (j && j.product) || j || {}, t = (p.product_title || '').trim(), b = (p.brand || '').trim();
          return { id: r.id, name_en: t ? (b && !t.toLowerCase().includes(b.toLowerCase()) ? b + ' ' + t : t) : null }; }
        for (const [from, to] of (rule.try || [])) {
          const u = from ? r.url.replace(from, to) : r.url; if (from && u === r.url) continue;
          const x = new URL(u, location.href); if (x.origin !== location.origin) continue;
          const res = await fetch(x.pathname + x.search, { credentials: 'omit' }); if (res.status !== 200) continue;
          const t = S.titleOf(await res.text()); if (t) return { id: r.id, name_en: t, via: to };
        }
        return { id: r.id, name_en: null };
      } catch (e) { return { id: r.id, name_en: null, error: String(e).slice(0, 80) }; }
    };
    const work = async () => { while (i < rows.length) out.push(await one(rows[i++])); };
    await Promise.all(Array.from({ length: workers || 3 }, work));
    return out;
  };
  S.result = (name, from, len) => { const j = S.jobs[name]; if (!j || !j.done) return null; const s = JSON.stringify(j.result); return from == null ? s : s.slice(from, from + (len || 30000)); };
})();
