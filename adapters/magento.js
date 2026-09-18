// magento.js — Pan Home and Baytonia (Magento GraphQL over GET). Pan Home product pages must be rendered for
// stock («أعلمني» vs «أضف إلى السلة»: GraphQL says IN_STOCK while the page says notify-me). Baytonia GraphQL is trusted.
(function(){
  const S = window.SAYDA;
  const gql = async (q, store) => (await S.fetchJson('/graphql?query=' + encodeURIComponent(q), store ? { headers: { Store: store } } : undefined)).json;
  const make = id => ({
    async collect(cfg, rules) {
      const c = cfg.collect; const extra = c.extraFields ? ' ' + c.extraFields : ''; const out = [], seen = new Set(); let total = 0, disc = 0;
      const pages = Array.from({ length: c.pages }, (_, i) => i + 1);
      await S.pool(pages, 5, async p => { const q = `{products(filter:{category_id:{eq:"${c.categoryId}"}},pageSize:${c.pageSize},currentPage:${p}){items{sku name url_key stock_status${extra} price_range{minimum_price{regular_price{value} final_price{value}}}}}}`;
        const j = await gql(q); for (const it of (S.get(j, 'data.products.items') || [])) { total++; const mp = it.price_range.minimum_price; const was = mp.regular_price.value, price = mp.final_price.value; if (was > price + 0.5) disc++;
          if (!S.isCandidate(price, was, rules, cfg.minSaving) || seen.has(it.url_key)) continue; seen.add(it.url_key);
          out.push({ key: it.url_key, name: it.name.slice(0, 70), price: S.round(price), was: S.round(was), url: cfg.productUrl.replace('{url_key}', it.url_key).replace('{url_suffix}', it.url_suffix || ''), inStock: it.stock_status === 'IN_STOCK', rating: it.rating_summary, reviews: it.review_count }); } });
      let share = total ? Math.round(100 * disc / total) : null;
      if (c.allCategoryId && c.catalogCategoryId) { const a = await gql(`{products(filter:{category_id:{eq:"${c.allCategoryId}"}},pageSize:1){total_count}}`), b = await gql(`{products(filter:{category_id:{eq:"${c.catalogCategoryId}"}},pageSize:1){total_count}}`); const sa = S.get(a, 'data.products.total_count'), sb = S.get(b, 'data.products.total_count'); if (sa && sb) share = Math.round(100 * sa / sb); }
      out.sort((a, b) => (b.was - b.price) - (a.was - a.price)); return { candidates: out, stats: { total, discounted: disc, sharePct: share } };
    },
    async check(rows, cfg) { // GraphQL pass; Pan Home rows are re-checked by checkCurrent after render
      const keys = rows.map(r => decodeURIComponent(r.url.replace(/^.*\/(ksa_ar\/)?/, '').replace(/\.html$/, '')));
      const j = await gql(`{products(filter:{url_key:{in:${JSON.stringify(keys)}}},pageSize:${keys.length + 5}){items{url_key stock_status price_range{minimum_price{final_price{value}}}}}}`);
      const by = {}; for (const it of (S.get(j, 'data.products.items') || [])) by[it.url_key] = it;
      return rows.map((r, i) => { const it = by[keys[i]]; return it ? { id: r.id, found: true, live: S.round(it.price_range.minimum_price.final_price.value), buyable: it.stock_status === 'IN_STOCK', stock: it.stock_status === 'IN_STOCK' ? 99 : 0, needsRender: !!cfg.check && cfg.check.render } : { id: r.id, found: false }; });
    },
    render: id === 'panhome',
    checkCurrent(row) { const t = document.body.innerText.replace(/\s+/g, ' '); const cart = /أضف إلى السلة|أضف الى السلة/.test(t), notify = /أعلمني/.test(t);
      return { id: row.id, found: !/404|غير موجودة/.test(document.title), buyable: cart && !notify, stock: cart && !notify ? 99 : 0, url: location.href }; },
    async coupons(cfg) { const { text } = await S.fetchText(cfg.landing.replace(cfg.origin, '')); const t = S.text(S.dom(text).body); return { hits: [...t.matchAll(/.{0,50}(كود|كوبون|بطاقة|بطاقات|خصم إضافي|خصم \d+%).{0,80}/g)].map(m => m[0]).slice(0, 8) }; }
  });
  S.adapters.panhome = make('panhome'); S.adapters.baytonia = make('baytonia');
})();
