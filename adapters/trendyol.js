// trendyol.js — marketplace. collect: navigate to /sr?q=…&sst=BEST_SELLER&pi=N (SSR) and read window['__single-search-result__PROPS'];
// so collect is a "current page" reader driven by the runner (collectCurrent). check: product page JSON-LD + rendered text
// (non-subscriber price is the larger of the two shown; Plus price is labelled «لمشتركي Trendyol Plus»).
(function(){
  const S = window.SAYDA;
  S.adapters.trendyol = {
    render: true,
    collectCurrent(cfg, rules) { const d = (window['__single-search-result__PROPS'] || {}).data || {}; const out = [];
      for (const p of (d.products || [])) { if (p.cardType === 'ADS' || (p.tagDetails || []).some(t => /sponsored/i.test(t.tag || t))) continue;
        const bp = p.binaryPrice || {}, sp = p.singlePrice || {}, rr = p.recommendedRetailPrice || {}; const price = bp.salePriceWihoutCurrency ?? sp.salePriceNumeric, was = bp.strikethroughPrice ?? sp.strikethroughPriceNumeric; if (!price || price < 50) continue;
        out.push({ key: String(p.id || p.contentId), brand: p.brand && (p.brand.name || p.brand) || '', name: (p.name || '').slice(0, 80), price, was: was || null, url: 'https://www.trendyol.sa' + String(p.url || '').split('?')[0],
          lowestRecent: S.get(p, 'choiceNNPrice.lowestRecentPriceWithoutCurrency') ?? null, suggested: rr.suggestedPriceNumerized ?? null, plusOnly: sp.componentType === 'TY_PLUS_PROMOTION', promos: (p.promotions || []).map(x => x.shortName).filter(Boolean).slice(0, 4), soldOut: !!(p.tagStockBar && p.tagStockBar.isSoldOut), rating: p.ratingScore && p.ratingScore.averageRating, merchant: p.merchantId }); }
      return { candidates: out, page: d.pageIndex, total: d.total }; },
    checkCurrent(row) { const t = document.body.innerText.replace(/[ \t]+/g, ' '); const prices = [...t.matchAll(/([\d.,]+) SAR/g)].map(m => S.num(m[1])).filter(Boolean).slice(0, 4);
      const p = S.ldProduct(document); const off = p && p.offers || {}; const plus = /لمشتركي Trendyol Plus/.test(t); const live = S.num(off.price) ?? (prices.length ? Math.max(...prices) : null);
      return { id: row.id, found: !!p || prices.length > 0, live, plusPrice: plus && prices.length ? Math.min(...prices) : null, buyable: /إضافة إلى السلة/.test(t) && !/نفد المخزون|نفدت الكمية/.test(t), stock: /إضافة إلى السلة/.test(t) ? 99 : 0, basketOnly: /سلة المشتريات|عند شراء \d/.test(t), url: location.href }; },
    async coupons() { const t = document.body.innerText.replace(/\s+/g, ' '); return { hits: [...t.matchAll(/.{0,50}(كود|كوبون|Plus|بلس|خصم إضافي).{0,80}/g)].map(m => m[0]).slice(0, 8) }; }
  };
})();
