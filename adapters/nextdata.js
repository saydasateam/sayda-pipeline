// nextdata.js — BlackBox and Al-Manea (same platform): SSR pages carry __NEXT_DATA__ with products;
// product pages carry is_in_stock/qty/prices_with_tax. Registered for both ids.
(function(){
  const S = window.SAYDA;
  const make = id => ({
    async collect(cfg, rules) {
      const jobs = []; for (const p of cfg.collect.pages) for (let pg = 1; pg <= (cfg.collect.pagesPerCat || 1); pg++) jobs.push(p + (pg > 1 ? (cfg.collect.pageParam || '?page=') + pg : ''));
      const seen = new Set(), out = [];
      await S.pool(jobs, cfg.collect.concurrency || 3, async u => { const { text } = await S.fetchText(u); const j = S.nextData(text); const ps = S.get(j, 'props.' + cfg.collect.productsAt) || [];
        for (const p0 of ps) { const p = cfg.collect.hitSource ? (p0._source || {}) : p0; const pw = p.prices_with_tax || {}; const price = pw.price, was = pw.original_price;
          if (!S.isCandidate(price, was, rules) || seen.has(p.rewrite_url)) continue; seen.add(p.rewrite_url);
          out.push({ key: p.rewrite_url, name: (p.name && p.name[0] || '').slice(0, 90), price: S.round(price), was: S.round(was), url: cfg.productUrl.replace('{slug}', p.rewrite_url), inStock: !!(p.stock && p.stock.is_in_stock), qty: p.stock && p.stock.qty }); } });
      out.sort((a, b) => (b.was - b.price) - (a.was - a.price)); return { candidates: out, stats: { pages: jobs.length } };
    },
    async check(rows, cfg) {
      return S.pool(rows, 4, async r => { const path = r.url.replace(cfg.origin, ''); const { status, text } = await S.fetchText(path); const st = (text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/) || [])[1];
        if (!st) return { id: r.id, found: false, status };
        const isk = st.match(/"is_in_stock"\s*:\s*(true|false)/), qty = st.match(/"qty"\s*:\s*(\d+)/), pw = st.match(/"prices_with_tax"\s*:\s*\{[^}]*?"price"\s*:\s*([\d.]+)/);
        return { id: r.id, found: true, live: pw ? Math.round(+pw[1]) : null, buyable: !!(isk && isk[1] === 'true'), stock: qty ? +qty[1] : null }; });
    },
    async coupons(cfg) { const { text } = await S.fetchText(cfg.landing.replace(cfg.origin, '')); const t = S.text(S.dom(text).body);
      return { hits: [...t.matchAll(/.{0,50}(96 ريال|٩٦ ريال|خصم 96|كوبون|قسيمة|كود|بطاقات|الراجحي|تابي|تمارا).{0,70}/g)].map(m => m[0]).slice(0, 10), labels: [...text.matchAll(/"labels":\{[^}]*"5":"([^"]{6,80})"/g)].map(m => m[1]).slice(0, 10) }; }
  });
  S.adapters.blackbox = make('blackbox'); S.adapters.almanea = make('almanea');
})();
