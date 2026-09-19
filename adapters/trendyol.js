// trendyol.js — marketplace, Saudi storefront.
//
// Both collect and check used to be "current page" readers driven by navigation: 24 search terms x 3
// pages, plus one navigation per row. ~150 browser actions, which no scheduled run could afford — so
// Trendyol was never collected or checked in full. Both now read the SAME server-rendered state by
// fetch, from a single tab:
//   listing : window["__single-search-result__PROPS"]  -> .data.products
//   product : window["__envoy__SHARED_PROPS"]          -> .product.merchantListing.winnerVariant.price
// The product blob is what makes Trendyol judgeable at all. It carries, separately:
//   sellingPrice ......... what anyone pays today
//   tyPlusCouponApplicablePrice ... the subscriber-only price the card often shows as the headline
//   rrp .................. the "suggested" price the % badge is computed from — not a price it sold at
//   discountPercentage ... Trendyol's own view of the discount (frequently 0 behind a big badge)
// Reading those apart is the difference between repeating the badge and checking it.
(function(){
  const S = window.SAYDA;
  const OPEN = 123, CLOSE = 125, QUOTE = 34, BSL = 92;

  // Pull one window["<key>"]={...} blob out of SSR HTML by matching braces (string-aware).
  function ssr(html, key) {
    const at = html.indexOf(key); if (at < 0) return null;
    let start = at; while (start < html.length && html.charCodeAt(start) !== OPEN) start++;
    let i = start, depth = 0, inStr = false, esc = false;
    for (; i < html.length; i++) { const c = html.charCodeAt(i);
      if (inStr) { if (esc) esc = false; else if (c === BSL) esc = true; else if (c === QUOTE) inStr = false; continue; }
      if (c === QUOTE) { inStr = true; continue; }
      if (c === OPEN) depth++; else if (c === CLOSE) { depth--; if (depth === 0) { i++; break; } }
    }
    try { return JSON.parse(html.slice(start, i)); } catch (e) { return null; }
  }
  const val = o => (o && typeof o.value === 'number') ? o.value : null;
  const pathOf = u => String(u || '').split('?')[0];

  S.adapters.trendyol = {
    ssr,
    // ---- discovery: one fetch per (term, page), no navigation ----
    async collect(cfg, rules) {
      const terms = cfg.collect.terms || [], pages = cfg.collect.pages || 1;
      const jobs = []; for (const t of terms) for (let pi = 1; pi <= pages; pi++) jobs.push({ t, pi });
      const perTerm = {}, out = [], seen = new Set(); let listed = 0, pagesOk = 0;
      await S.pool(jobs, 3, async ({ t, pi }) => {
        const { status, text } = await S.fetchText('/sr?q=' + encodeURIComponent(t) + '&sst=BEST_SELLER&pi=' + pi);
        if (status !== 200) return; const j = ssr(text, '__single-search-result__PROPS');
        const d = j && j.data; if (!d || !d.products) return; pagesOk++;
        for (const p of d.products) {
          listed++;
          if (p.cardType === 'ADS' || (p.tagDetails || []).some(x => /sponsored/i.test(x.tag || x))) continue;
          const bp = p.binaryPrice || {}, sp = p.singlePrice || {}, rr = p.recommendedRetailPrice || {};
          const price = bp.salePriceWihoutCurrency ?? sp.salePriceNumeric;
          const was = bp.strikethroughPrice ?? sp.strikethroughPriceNumeric;
          if (!price || price < 50) continue;
          const key = String(p.id || p.contentId); if (seen.has(key)) continue;
          // a term that returns 300 hits must not crowd out the other 23
          perTerm[t] = (perTerm[t] || 0); if (perTerm[t] >= (cfg.collect.perTerm || 12)) continue;
          if (!S.isCandidate(price, was, rules)) continue;
          seen.add(key); perTerm[t]++;
          out.push({ key, term: t, brand: (p.brand && (p.brand.name || p.brand)) || '', name: (p.name || '').slice(0, 80),
            price, was: was || null, url: 'https://www.trendyol.sa' + pathOf(p.url),
            lowestRecent: S.get(p, 'choiceNNPrice.lowestRecentPriceWithoutCurrency') ?? null,
            suggested: rr.suggestedPriceNumerized ?? null,
            plusOnly: sp.componentType === 'TY_PLUS_PROMOTION',
            promos: (p.promotions || []).map(x => x.shortName).filter(Boolean).slice(0, 4),
            soldOut: !!(p.tagStockBar && p.tagStockBar.isSoldOut), merchant: p.merchantId });
        }
        await S.sleep(250);
      });
      out.sort((a, b) => ((b.was || b.price) - b.price) - ((a.was || a.price) - a.price));
      return { candidates: out, stats: { listed, pagesOk, pagesAsked: jobs.length, terms: Object.keys(perTerm).length } };
    },

    // ---- availability + price, from the product page's own state ----
    async check(rows) {
      return S.pool(rows, 3, async r => {
        const { status, text } = await S.fetchText(new URL(r.url).pathname);
        if (status !== 200) return { id: r.id, found: false, status };
        const sp = ssr(text, '__envoy__SHARED_PROPS');
        const prod = sp && sp.product;
        if (!prod) return { id: r.id, found: false, status, note: 'no product state' };
        const wv = (prod.merchantListing && prod.merchantListing.winnerVariant) || {};
        const pr = wv.price || {};
        const promos = ((prod.merchantListing && prod.merchantListing.promotions) || [])
          .map(x => x.shortName || x.name || '').filter(Boolean).slice(0, 4);
        const live = val(pr.sellingPrice) ?? val(pr.discountedPrice);
        await S.sleep(200);
        return { id: r.id, found: true, live,
          rrp: val(pr.rrp), plusPrice: val(pr.tyPlusCouponApplicablePrice),
          storeDiscountPct: pr.discountPercentage ?? null,
          buyable: !!(prod.inStock && wv.sellable !== false),
          stock: prod.inStock ? 99 : 0,
          // a discount that only exists once you add 2+ to the basket is not this item's price
          basketOnly: promos.some(t => /عند شراء|سلة/.test(t)), promos };
      });
    },

    // kept: the runner can still drive these from a rendered page if a fetch is ever blocked
    render: false,
    collectCurrent(cfg, rules) { const d = (window['__single-search-result__PROPS'] || {}).data || {}; const out = [];
      for (const p of (d.products || [])) { if (p.cardType === 'ADS') continue;
        const bp = p.binaryPrice || {}, sp = p.singlePrice || {}, rr = p.recommendedRetailPrice || {};
        const price = bp.salePriceWihoutCurrency ?? sp.salePriceNumeric, was = bp.strikethroughPrice ?? sp.strikethroughPriceNumeric;
        if (!price || price < 50) continue;
        out.push({ key: String(p.id || p.contentId), brand: (p.brand && (p.brand.name || p.brand)) || '', name: (p.name || '').slice(0, 80), price, was: was || null,
          url: 'https://www.trendyol.sa' + pathOf(p.url), lowestRecent: S.get(p, 'choiceNNPrice.lowestRecentPriceWithoutCurrency') ?? null,
          suggested: rr.suggestedPriceNumerized ?? null, plusOnly: sp.componentType === 'TY_PLUS_PROMOTION',
          promos: (p.promotions || []).map(x => x.shortName).filter(Boolean).slice(0, 4) }); }
      return { candidates: out, page: d.pageIndex, total: d.total }; },
    checkCurrent(row) { const t = document.body.innerText.replace(/[ \t]+/g, ' ');
      const prices = [...t.matchAll(/([\d.,]+) SAR/g)].map(m => S.num(m[1])).filter(Boolean).slice(0, 4);
      const p = S.ldProduct(document); const off = (p && p.offers) || {}; const plus = /لمشتركي Trendyol Plus/.test(t);
      const live = S.num(off.price) ?? (prices.length ? Math.max(...prices) : null);
      return { id: row.id, found: !!p || prices.length > 0, live, plusPrice: plus && prices.length ? Math.min(...prices) : null,
        buyable: /إضافة إلى السلة/.test(t) && !/نفد المخزون|نفدت الكمية/.test(t), stock: /إضافة إلى السلة/.test(t) ? 99 : 0,
        basketOnly: /سلة المشتريات|عند شراء \d/.test(t) }; },
    async coupons() { const t = document.body.innerText.replace(/\s+/g, ' ');
      return { hits: [...t.matchAll(/.{0,50}(كود|كوبون|Plus|بلس|خصم إضافي).{0,80}/g)].map(m => m[0]).slice(0, 8) }; }
  };
})();
