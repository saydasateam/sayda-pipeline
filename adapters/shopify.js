// shopify.js — Ashley (Shopify): collection products.json for collect, /products/{handle}.js for check.
(function(){
  const S = window.SAYDA;
  S.adapters.ashley = {
    async collect(cfg, rules) {
      const out = []; for (let p = 1; p <= 4; p++) { const { json } = await S.fetchJson(`/collections/${cfg.collect.collection}/products.json?limit=${cfg.collect.limit}&page=${p}`); const ps = json && json.products || []; if (!ps.length) break;
        for (const pr of ps) { if ((pr.tags || []).some(t => (cfg.collect.skipTags || []).includes(String(t).toLowerCase()))) continue; const vs = (pr.variants || []).filter(v => v.available).sort((a, b) => +a.price - +b.price); const v = vs[0]; if (!v) continue;
          const price = +v.price, was = +(v.compare_at_price || 0); if (!S.isCandidate(price, was, rules, 300)) continue;
          out.push({ key: pr.handle, name: pr.title.slice(0, 80), price: S.round(price), was: S.round(was), url: `https://store.ashley.sa/products/${pr.handle}`, sku: v.sku, series: (pr.title.split(' ')[0] || '') }); } }
      out.sort((a, b) => (b.was - b.price) - (a.was - a.price)); return { candidates: out, stats: {} };
    },
    async check(rows) {
      return S.pool(rows, 3, async r => { const h = (r.url.match(/\/products\/([^/?]+)/) || [])[1]; const { status, json } = await S.fetchJson(`/products/${h}.js`); if (!json) return { id: r.id, found: false, status };
        const vs = (json.variants || []).filter(v => v.available).sort((a, b) => a.price - b.price); const v = vs[0];
        return { id: r.id, found: true, live: v ? Math.round(v.price / 100) : null, compareAt: v && v.compare_at_price ? Math.round(v.compare_at_price / 100) : null, buyable: !!v, stock: v ? 99 : 0 }; });
    },
    async coupons() { const { text } = await S.fetchText('/'); const t = S.text(S.dom(text).body); return { hits: [...t.matchAll(/.{0,50}(كود|كوبون|code|coupon|خصم إضافي|EXTRA\d+).{0,80}/gi)].map(m => m[0]).slice(0, 8) }; }
  };
})();
