// dabdoob.js — runs on https://dabdoob.com (Next.js App Router, RSC flight data in the HTML).
// Listings live at /ar-SA/product?category_id=<id>&page=<n> — 20 products per page, SERVER-rendered:
// the flight payload carries the store's own product objects
//   {id, slug, name, brand, category, default_sku_id, skus:[{price:{price, old_price, raw_price}, buy_limit}]}
// so we read those objects, never DOM price text. `old_price` is Dabdoob's OWN «before» and is kept
// only as the claimed was — `ref` still comes from rules/verdict.js, never from here.
// Availability: a sku's `buy_limit` is how many the store will still sell (0 = not buyable).
// Their private API (api.primary.dabdoob.net) requires a signed x-hash header; we do not touch it.
// Verified live 2026-09-22.
(function(){
  const S = window.SAYDA;
  const ORIGIN = 'https://dabdoob.com';
  const unesc = h => h.replace(/\\"/g, '"');
  // bracket-match a JSON object starting at or after `from`, string-aware
  const grab = (s, from) => { let d = 0, st = -1, q = false, e = false;
    for (let i = from; i < s.length; i++) { const c = s[i];
      if (q) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') q = false; continue; }
      if (c === '"') { q = true; continue; }
      if (c === '{' || c === '[') { if (d === 0) st = i; d++; }
      else if (c === '}' || c === ']') { d--; if (d === 0) return s.slice(st, i + 1); } }
    return null; };
  // every product object in a page: anchor on "slug", walk back to the object's own '{"id":'
  const productsIn = html => { const h = unesc(html), out = [], seen = new Set(); let k = 0;
    while ((k = h.indexOf('"slug":"', k)) >= 0) {
      const st = h.lastIndexOf('{"id":', k);
      if (st >= 0) { const raw = grab(h, st);
        if (raw) { try { const o = JSON.parse(raw);
          if (o && o.slug && Array.isArray(o.skus) && o.skus.length && !seen.has(o.id)) { seen.add(o.id); out.push(o); }
        } catch (e) {} } }
      k += 8; }
    return out; };
  const skuOf = p => (p.skus || []).find(s => s.id === p.default_sku_id) || (p.skus || [])[0] || null;
  const priceOf = sku => { const pr = sku && sku.price || {};
    return { price: S.num(pr.price != null ? pr.price : pr.raw_price), was: S.num(pr.old_price), limit: S.num(sku && sku.buy_limit) }; };

  // Long product objects are split across several self.__next_f push chunks, so bracket-matching
  // one of them fails (observed on the big outdoor sets, 22 Sep). For a page we already know the
  // slug of, read the fields directly instead: drop the chunk seams, then scan the window after the
  // slug for that product's own price block and buy_limit.
  const clean = h => h.replace(/\\"/g, '"').replace(/"\]\)<\/script><script>self\.__next_f\.push\(\[1,"/g, '');
  const fieldsFor = (html, slug) => {
    const u = clean(html); const i = u.indexOf('"slug":"' + slug + '"'); if (i < 0) return null;
    const w = u.slice(i, i + 40000); const j = w.indexOf('"price":{'); if (j < 0) return null;
    const seg = w.slice(j, j + 400);
    const om = seg.match(/"old_price":(?:null|(\d+(?:\.\d+)?))/);
    const bl = w.match(/"buy_limit":(\d+)/);
    return { price: S.num((seg.match(/"price":(\d+(?:\.\d+)?)/) || [])[1]), was: om && om[1] != null ? S.num(om[1]) : null,
             limit: bl ? parseInt(bl[1], 10) : null }; };

  S.adapters.dabdoob = {
    async collect(cfg, rules) {
      const seen = new Set(), out = []; let pages = 0;
      for (const cat of (cfg.collect.categories || [])) {
        for (let pg = 1; pg <= (cfg.collect.pages || 2); pg++) {
          const { status, text } = await S.fetchText(`/ar-SA/product?category_id=${cat}${pg > 1 ? `&page=${pg}` : ''}`);
          if (status !== 200) break;
          const items = productsIn(text); pages++; if (!items.length) break;
          let fresh = 0;
          for (const p of items) {
            if (seen.has(p.slug)) continue; seen.add(p.slug); fresh++;
            const sku = skuOf(p); if (!sku) continue;
            const { price, was, limit } = priceOf(sku);
            if (!S.isCandidate(price, was, rules)) continue;
            out.push({ key: p.slug, brand: S.get(p, 'brand.name') || '', name: String(p.name || '').slice(0, 90),
                       price, was, url: `${ORIGIN}/ar-SA/product/${p.slug}`, inStock: !(limit === 0),
                       cat: cfg.collect.cat || 'dabdoob', path: [S.get(p, 'category.name'), S.get(p, 'subcategory.name')].filter(Boolean).join('/') });
          }
          if (!fresh) break;
          await S.sleep(300);
        }
      }
      out.sort((a, b) => (b.was - b.price) - (a.was - a.price));
      return { candidates: out.slice(0, cfg.collect.cap || 400), stats: { pages, seen: seen.size, passing: out.length } };
    },
    async check(rows) {
      return S.pool(rows, 3, async r => {
        const slug = r.url.split('/').filter(Boolean).pop();
        const { status, text } = await S.fetchText(r.url.replace(ORIGIN, ''));
        if (status === 404) return { id: r.id, found: false, status };
        const f = fieldsFor(text, slug);
        if (!f || !(f.price > 0)) return { id: r.id, found: false, status };
        const buyable = !(f.limit === 0);
        return { id: r.id, found: true, live: f.price, buyable, stock: buyable ? (f.limit == null ? 99 : f.limit) : 0 };
      });
    }
  };
})();
