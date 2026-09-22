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
    // ── Rendered collection: the store's OWN pagination, driven in the page ──────────────────────────
    // Both stores paginate client-side: Almanea's pager calls an authenticated API (a plain fetch gets 401,
    // and we never read or use tokens) and Blackbox loads by infinite scroll, so ?page=N returns page 1
    // forever. Measured 22 Sep: the fetch collector saw 32 of 1,009 Almanea and 30 of 898 Blackbox
    // National Day offers. Here the tab is ON the campaign page; we press the store's own "Next page" (or
    // scroll) and read each product card's React props — the same structured object __NEXT_DATA__ carries
    // (prices_with_tax, stock, rewrite_url). No DOM text is parsed for prices, so an instalment figure
    // can never be read as a price. The hand-listed category paths still run through collect() and are merged.
    harvest(cfg) {
      const out = new Map();
      for (const a of document.querySelectorAll(`a[href*="${cfg.productPath}"]`)) {
        const fk = Object.keys(a).find(k => k.startsWith('__reactFiber')); let f = fk && a[fk], d = 0;
        while (f && d < 14) { const pr = f.memoizedProps || {};
          const v = pr.product && (pr.product.prices_with_tax ? pr.product : (pr.product._source && pr.product._source.prices_with_tax ? pr.product._source : null));
          if (v) { if (v.rewrite_url) out.set(v.rewrite_url, v); break; }
          f = f.return; d++; }
      }
      return [...out.values()];
    },
    async collectRender(cfg, rules, opts = {}) {
      const mode = cfg.collect.render, maxSteps = opts.maxSteps || cfg.collect.renderMaxSteps || 40;
      const all = new Map(); const add = () => { for (const p of this.harvest(cfg)) all.set(p.rewrite_url, p); };
      const firstHref = () => { const a = document.querySelector(`a[href*="${cfg.productPath}"]`); return a ? a.getAttribute('href') : ''; };
      const waitFor = async (ok, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (ok()) return true; await S.sleep(250); } return false; };
      await waitFor(() => this.harvest(cfg).length > 0, 10000); add();
      let steps = 0, stall = 0, stop = 'maxSteps';
      for (; steps < maxSteps; steps++) {
        const before = all.size;
        if (mode === 'pager') {
          const next = document.querySelector('button[aria-label="Next page"]');
          if (!next || next.disabled || next.getAttribute('aria-disabled') === 'true') { stop = 'lastPage'; break; }
          const f0 = firstHref(); next.click();
          if (!(await waitFor(() => firstHref() && firstHref() !== f0, 10000))) { stop = 'pageDidNotChange'; break; }
          await S.sleep(400);
        } else {
          window.scrollTo(0, document.body.scrollHeight); await S.sleep(1600);
        }
        add();
        if (all.size === before) { if (++stall >= 3) { stop = 'noNewProducts'; break; } } else stall = 0;
      }
      const seen = new Set(), out = [];
      for (const p of all.values()) { const pw = p.prices_with_tax || {}; const price = pw.price, was = pw.original_price;
        if (!S.isCandidate(price, was, rules) || seen.has(p.rewrite_url)) continue; seen.add(p.rewrite_url);
        out.push({ key: p.rewrite_url, name: (p.name && p.name[0] || '').slice(0, 90), price: S.round(price), was: S.round(was), url: cfg.productUrl.replace('{slug}', p.rewrite_url), inStock: !!(p.stock && p.stock.is_in_stock), qty: p.stock && p.stock.qty, src: 'render' }); }
      // the hand-listed category paths, fetched as before, merged in
      let fetched = { candidates: [], stats: {} };
      if (opts.withPaths !== false) { try { fetched = await this.collect(cfg, rules); } catch (e) { fetched.stats.error = String(e.message || e).slice(0, 80); } }
      for (const c of fetched.candidates) if (!seen.has(c.key)) { seen.add(c.key); out.push(c); }
      out.sort((a, b) => (b.was - b.price) - (a.was - a.price));
      return { candidates: out, stats: { mode, steps, stop, reachable: all.size, fromRender: out.filter(c => c.src === 'render').length, fromPaths: fetched.candidates.length, pathStats: fetched.stats } };
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
