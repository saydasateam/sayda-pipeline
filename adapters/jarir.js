// jarir.js — runs on https://www.jarir.com. Offers category API for collect; product JSON-LD for check.
(function(){
  const S = window.SAYDA;
  S.adapters.jarir = {
    async collect(cfg, rules) {
      const out = [], seen = new Set(); let all = 0;
      for (let n = 0; n < cfg.collect.maxFrom; n += cfg.collect.pageSize) {
        const { json } = await S.fetchJson(`/api/catalogv2/product/store/sa-ar/category_codes/${cfg.collect.category}/aggregation/false/size/${cfg.collect.pageSize}/from/${n}/sort-priority/asc`);
        const hits = S.get(json, 'data.hits.hits') || []; if (!hits.length) break; all += hits.length;
        for (const h of hits) { const s = h._source || {}; const kids = (s.configurable_children && s.configurable_children.length) ? s.configurable_children : [s];
          for (const k of kids) { const price = k.jarir_final_price ?? s.jarir_final_price, was = k.price ?? s.price; const nm = String(k.klevu_search_keywords || s.klevu_search_keywords || k.name || s.name || '');
            if (/renew|refurb|مجدد/i.test(nm) || !S.isCandidate(price, was, rules)) continue; const uk = k.url_key || s.url_key; if (seen.has(uk)) continue; seen.add(uk);
            out.push({ key: uk, brand: k.brand || s.brand || '', name: nm.slice(0, 80), price, was, url: `https://www.jarir.com/${uk}.html`, inStock: (k.is_stock_available ?? s.is_stock_available) == 1 }); } }
      }
      out.sort((a, b) => (b.was - b.price) - (a.was - a.price)); return { candidates: out, stats: { listed: all } };
    },
    // row-by-row (never the shared pool): four concurrent product fetches hang on jarir.com.
    async check(rows) {
      return S.eachRow(rows, async (r, signal) => { const { status, text } = await S.fetchText(r.url.replace('https://www.jarir.com', ''), { signal });
        const m = text.match(/"price"\s*:\s*"([\d.]+)"[\s\S]{0,80}?"availability"\s*:\s*"([^"]+)"/);
        return { id: r.id, found: status === 200 && !!m, live: m ? +m[1] : null, buyable: !!m && /InStock/.test(m[2]), stock: m && /InStock/.test(m[2]) ? 99 : 0 }; }, S.rowTimeout);
    },
    async coupons() { const { text } = await S.fetchText('/sa-ar/'); return { hits: [...text.matchAll(/.{0,50}(كود خصم|كوبون|قسيمة|بطاقات (?:الراجحي|الأهلي|الإنماء|البلاد|ساب)|خصم إضافي).{0,80}/g)].map(m => m[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).slice(0, 12) }; }
  };
})();
