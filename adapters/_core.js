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
  S.isCandidate = (price, was, rules, minSaving) => price > 0 && was > price && (was - price) >= (minSaving ?? rules.candidate.minSaving) && (1 - price / was) >= rules.candidate.minClaimedPct;

  // background job helpers: start(fn) stores a promise on window; status() is polled by the driver
  S.start = (name, fn) => { const j = S.jobs[name] = { done: false, result: null, error: null, t0: Date.now() }; fn().then(r => { j.result = r; j.done = true; }).catch(e => { j.error = String(e && e.stack || e).slice(0, 300); j.done = true; }); return name; };
  S.status = name => { const j = S.jobs[name]; return j ? { done: j.done, error: j.error, ms: Date.now() - j.t0, size: j.result ? JSON.stringify(j.result).length : 0 } : null; };
  S.result = (name, from, len) => { const j = S.jobs[name]; if (!j || !j.done) return null; const s = JSON.stringify(j.result); return from == null ? s : s.slice(from, from + (len || 30000)); };
})();
