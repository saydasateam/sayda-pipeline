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
        const p = productsIn(text).find(x => x.slug === slug);
        const sku = p && skuOf(p);
        if (!sku) return { id: r.id, found: false, status };
        const { price, limit } = priceOf(sku);
        const buyable = !(limit === 0);
        return { id: r.id, found: true, live: price, buyable, stock: buyable ? (limit == null ? 99 : limit) : 0 };
      });
    }
  };
})();
