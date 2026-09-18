// landmark.js — Home Centre & Homebox (Landmark Next.js). Category SSR carries base64 initialState with Algolia hits.
// Product pages must be RENDERED (navigate + wait); check() therefore reads the current DOM and expects the driver
// to navigate to each row URL first (driver loop: navigate → wait 3.5s → SAYDA.adapters.<id>.checkCurrent()).
(function(){
  const S = window.SAYDA;
  const decode = j => { let st = S.get(j, 'props.initialState'); if (typeof st === 'string') { const bin = Uint8Array.from(atob(st), x => x.charCodeAt(0)); st = JSON.parse(new TextDecoder('utf-8').decode(bin)); } return st; };
  const make = id => ({
    async collect(cfg, rules) {
      const jobs = []; for (const c of cfg.collect.cats) for (let p = 1; p <= (cfg.collect.pagesPerCat || 1); p++) jobs.push(`/sa/ar/c/${c}` + (p > 1 ? '?page=' + p : ''));
      let total = 0, disc = 0; const out = [], seen = new Set();
      await S.pool(jobs, 4, async u => { const { text } = await S.fetchText(u); const j = S.nextData(text); if (!j) return; const hits = S.get(decode(j), 'algoliaProductReducer.init.hits') || [];
        for (const h of hits) { total++; const was = Array.isArray(h.price_range) ? Math.max(...h.price_range) : S.get(h, 'price_range.max'); const price = h.sale_price; if (was && price && was > price) disc++;
          if (!S.isCandidate(price, was, rules, cfg.minSaving) || seen.has(h.pid)) continue; seen.add(h.pid);
          out.push({ key: h.pid, name: (h.title || '').slice(0, 80), price: S.round(price), was: S.round(was), url: cfg.home.replace(/\/$/, '') + h.url, brand: h.brand || '' }); } });
      out.sort((a, b) => (b.was - b.price) - (a.was - a.price)); return { candidates: out, stats: { total, discounted: disc, sharePct: total ? Math.round(100 * disc / total) : null } };
    },
    check: null, render: true,
    checkCurrent(row) { const b = document.querySelector('#addToCart_QA'); const d = S.text(document.querySelector('#root-prod-details-inner'));
      const nums = [...d.matchAll(/(\d[\d,]*)\s{2}/g)].map(m => S.num(m[1])); const low = d.match(/تبقى (\d+) فقط/);
      return { id: row.id, found: !!d, live: nums.length ? Math.min(...nums.filter(n => n > 10)) : null, buyable: !!b && !b.disabled && /اضف الى السلة|أضف إلى السلة/.test(b.innerText), stock: low ? +low[1] : (b ? 99 : 0), url: location.href }; },
    async coupons(cfg) { const { text } = await S.fetchText(cfg.landing.replace(cfg.origin, '')); const t = S.text(S.dom(text).body); return { hits: [...t.matchAll(/.{0,50}(كود|كوبون|بطاقة|بطاقات|خصم إضافي|شكرنز).{0,80}/g)].map(m => m[0]).slice(0, 8) }; }
  });
  S.adapters.homecentre = make('homecentre'); S.adapters.homebox = make('homebox');
})();
