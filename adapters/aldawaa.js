// aldawaa.js — runs on https://www.al-dawaa.com (any /ar page). SAP Commerce (Spartacus) storefront;
// the page itself reads the public OCC API whose base URL it publishes in <meta name="occ-backend-base-url">.
// Search:  {base}/occ/v2/aldawaa/products/search?query=<q>&pageSize=100&currentPage=N&lang=ar&curr=SAR&fields=FULL
// Product: {base}/occ/v2/aldawaa/products/<code>?lang=ar&curr=SAR&fields=FULL
// Price model (verified 2026-09-22 on 40 products): `price.value` is the store's own «before»,
// `simulatedDiscountPrice.value` is what the shopper pays now; equal when there is no offer.
(function(){
  const S = window.SAYDA;
  const base = () => { const m = document.querySelector('meta[name="occ-backend-base-url"]'); return (m && m.content) || 'https://stgprevapi.al-dawaa.com'; };
  const Q = 'lang=ar&curr=SAR&fields=FULL';
  const pick = p => ({ now: S.get(p, 'simulatedDiscountPrice.value') ?? S.get(p, 'price.value'), was: S.get(p, 'price.value'),
                       inS: /inStock|lowStock/i.test(S.get(p, 'stock.stockLevelStatus') || ''), hidden: !!p.hidePrice });
  S.adapters.aldawaa = {
    async collect(cfg, rules) {
      const B = base(), seen = new Set(), out = []; let pages = 0, total = null;
      for (const q of cfg.collect.queries || [':relevance']) {
        for (let pg = 0; pg < (cfg.collect.pages || 10); pg++) {
          const { json } = await S.fetchJson(`${B}/occ/v2/aldawaa/products/search?query=${encodeURIComponent(q)}&pageSize=${cfg.collect.pageSize || 100}&currentPage=${pg}&${Q}`);
          if (!json || !json.products || !json.products.length) break; pages++; total = S.get(json, 'pagination.totalResults');
          for (const p of json.products) {
            if (seen.has(p.code)) continue; seen.add(p.code);
            const x = pick(p); if (x.hidden || p.prescription) continue;       // prescription items are not deals
            if (!S.isCandidate(x.now, x.was, rules)) continue;
            // url is /Category/<top>/<sub>/…/p/<code>; the top level is the category slug (config/categories.json)
            const seg = String(p.url || '').split('/').filter(Boolean);
            const cat = seg[0] === 'Category' && seg[1] ? decodeURIComponent(seg[1]).toLowerCase() : 'aldawaa';
            out.push({ key: p.code, brand: S.get(p, 'brand.name') || '', name: String(p.name || '').slice(0, 90), price: x.now, was: x.was,
                       url: `https://www.al-dawaa.com/ar${p.url}`, inStock: x.inS, cat });
          }
          if (pages >= (cfg.collect.maxPages || 30)) break;
        }
      }
      out.sort((a, b) => (b.was - b.price) - (a.was - a.price));
      return { candidates: out, stats: { pages, total, seen: seen.size, passing: out.length } };
    },
    async check(rows) {
      const B = base();
      return S.pool(rows, 4, async r => {
        const code = String(r.id).split(':').pop();
        const { status, json } = await S.fetchJson(`${B}/occ/v2/aldawaa/products/${encodeURIComponent(code)}?${Q}`);
        if (!json || status >= 400) return { id: r.id, found: false, status };
        const x = pick(json);
        return { id: r.id, found: true, live: x.now, was: x.was, buyable: x.inS && !json.addToCartDisabled, stock: x.inS ? 99 : 0 };
      });
    }
  };
})();
