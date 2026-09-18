// woo.js — CityW (WooCommerce Store API). Prices in minor units; on_sale=true count vs total gives the "discounted share".
(function(){
  const S = window.SAYDA;
  S.adapters.cityw = {
    async collect(cfg, rules) {
      const out = [], pages = Array.from({ length: cfg.collect.pages }, (_, i) => i + 1); let total = null, sale = null;
      await S.pool(pages, 4, async p => { const r = await fetch(`/wp-json/wc/store/v1/products?per_page=${cfg.collect.perPage}&page=${p}&on_sale=true`); if (p === 1) sale = +r.headers.get('x-wp-total'); const j = await r.json();
        for (const x of j) { const mu = Math.pow(10, x.prices.currency_minor_unit); const price = x.prices.price / mu, was = x.prices.regular_price / mu; if (!S.isCandidate(price, was, rules, cfg.minSaving)) continue;
          out.push({ key: x.slug, name: x.name.slice(0, 80), price: S.round(price), was: S.round(was), url: x.permalink, inStock: x.is_in_stock && x.is_purchasable }); } });
      const t = await fetch('/wp-json/wc/store/v1/products?per_page=1'); total = +t.headers.get('x-wp-total');
      out.sort((a, b) => (b.was - b.price) - (a.was - a.price)); return { candidates: out, stats: { total, discounted: sale, sharePct: total ? Math.round(100 * sale / total) : null } };
    },
    async check(rows) {
      return S.pool(rows, 4, async r => { const slug = (r.url.match(/\/product\/([^/]+)\/?/) || [])[1]; const { json } = await S.fetchJson('/wp-json/wc/store/v1/products?slug=' + slug); const p = Array.isArray(json) ? json[0] : null;
        if (!p) return { id: r.id, found: false }; const mu = Math.pow(10, p.prices.currency_minor_unit);
        return { id: r.id, found: true, live: S.round(p.prices.price / mu), buyable: p.is_in_stock && p.is_purchasable, stock: p.is_in_stock ? 99 : 0 }; });
    },
    async coupons() { const { text } = await S.fetchText('/'); const t = S.text(S.dom(text).body); return { hits: [...t.matchAll(/.{0,50}(كود|كوبون|coupon|code|خصم إضافي).{0,80}/gi)].map(m => m[0]).slice(0, 8) }; }
  };
})();
