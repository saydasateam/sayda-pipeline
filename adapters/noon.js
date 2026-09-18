// noon.js — runs on https://www.noon.com (any page). Catalog API + product API, header x-locale ar-sa.
(function(){
  const S = window.SAYDA, H = { headers: { 'x-locale': 'ar-sa' } };
  const skuOf = u => (String(u).match(/saudi-ar\/([^/]+)\/p/) || [])[1];
  // cheapest in-stock offer across variants
  const bestOffer = prod => { let best = null; for (const v of (prod.variants || [prod])) for (const o of (v.offers || [])) { if (!(o.stock > 0)) continue; const e = (o.sale_price ?? o.price); if (!best || e < best.price) best = { price: e, stock: o.stock, was: o.price }; } return best; };
  S.adapters.noon = {
    async collect(cfg, rules) {
      const jobs = []; for (const p of cfg.collect.paths) for (let pg = 1; pg <= cfg.collect.pages; pg++) jobs.push([p, pg]);
      const seen = new Set(), out = [];
      await S.pool(jobs, 6, async ([p, pg]) => {
        const { json } = await S.fetchJson(`/_svc/catalog/api/v3/u/${p}/?limit=${cfg.collect.limit}&page=${pg}`, H); if (!json) return;
        for (const h of (json.hits || [])) {
          const price = h.sale_price ?? h.price, was = h.price; if (!S.isCandidate(price, was, rules)) continue;
          const key = (h.brand || '') + '|' + (h.name || '').replace(/[^؀-ۿA-Za-z0-9]/g, '').slice(0, 35); if (seen.has(key)) continue; seen.add(key);
          out.push({ key: h.sku, brand: h.brand || '', name: (h.name || '').slice(0, 90), price, was, url: `https://www.noon.com/saudi-ar/${h.sku}/p/`, rating: h.product_rating && h.product_rating.value || 0, reviews: h.product_rating && h.product_rating.count || 0, cat: p.split('/').pop() });
        }
      });
      // per-category quota: a global top-N by absolute saving would be all electronics and
      // would starve fashion / baby / sports, where a real deal is worth far fewer riyals.
      const perCat = cfg.collect.perCat || 40, cap = cfg.collect.cap || 600;
      const byCat = {}; for (const c of out) (byCat[c.cat] = byCat[c.cat] || []).push(c);
      const picked = [], empties = [];
      for (const k of Object.keys(byCat)) {
        byCat[k].sort((a, b) => (b.was - b.price) - (a.was - a.price));
        picked.push(...byCat[k].slice(0, perCat));
      }
      for (const p of cfg.collect.paths) if (!byCat[p.split('/').pop()]) empties.push(p);
      picked.sort((a, b) => (b.was - b.price) - (a.was - a.price));
      return { candidates: picked.slice(0, cap), stats: { fetched: jobs.length, raw: out.length, cats: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, v.length])), emptyPaths: empties } };
    },
    async check(rows) {
      return S.pool(rows, 5, async r => {
        const sku = skuOf(r.url); const { status, json } = await S.fetchJson(`/_svc/catalog/api/v3/u/${sku}/p/`, H);
        if (status === 404 || !json) return { id: r.id, found: false, status };
        const b = bestOffer(json.product || json);
        return { id: r.id, found: true, live: b ? b.price : null, stock: b ? Math.min(b.stock, 99) : 0, buyable: !!b, was: b ? b.was : null };
      });
    },
    async coupons(cfg) {
      const { text } = await S.fetchText('/saudi-ar/');
      const banners = [...text.matchAll(/font-size:\d+px\\?">([^<]{6,140})<\/h2>/g)].map(m => m[1]);
      const hits = [...text.matchAll(/.{0,60}(كود|كوبون|بطاقات (?:ميم|الراجحي|الأهلي|الإنماء|البلاد|ساب)|خصم إضافي).{0,100}/g)].map(m => m[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).slice(0, 15);
      return { banners, hits };
    }
  };
})();
