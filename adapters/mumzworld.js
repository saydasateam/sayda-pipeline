// mumzworld.js — runs on https://www.mumzworld.com (any /sa-ar page). Next.js App Router, no __NEXT_DATA__.
// The listing HTML carries the Magento product objects the page renders from (react-query dehydrated
// state inside the RSC flight data): {"products":{"items":[{name, brand, sku, url_key, stock_status,
// price_range.minimum_price.{regular_price,final_price}}]}}. We read those objects — never DOM price text.
// Paging is ?page=N (24 per page). Product pages carry schema.org Product JSON-LD, which check() reads.
// Verified live 2026-09-22 on /sa-ar/c/collections/saudi-national-day (1,489 products).
(function(){
  const S = window.SAYDA;
  const unesc = h => h.replace(/\\"/g, '"');
  // bracket-match a JSON array/object starting at or after `from`, string-aware
  const grab = (s, from) => { let d = 0, st = -1, q = false, e = false;
    for (let i = from; i < s.length; i++) { const c = s[i];
      if (q) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') q = false; continue; }
      if (c === '"') { q = true; continue; }
      if (c === '[' || c === '{') { if (d === 0) st = i; d++; }
      else if (c === ']' || c === '}') { d--; if (d === 0) return s.slice(st, i + 1); } }
    return null; };
  const itemsIn = html => { const h = unesc(html), out = []; let k = 0;
    while ((k = h.indexOf('"products":{"items":[', k)) >= 0) {
      try { out.push(...JSON.parse(grab(h, k + 20))); } catch (e) {}
      k += 20; }
    return out; };
  S.adapters.mumzworld = {
    async collect(cfg, rules) {
      const seen = new Set(), out = []; let pages = 0;
      for (const p of cfg.collect.paths) {
        for (let pg = 1; pg <= (cfg.collect.pages || 20); pg++) {
          const { status, text } = await S.fetchText(`${p}${pg > 1 ? `?page=${pg}` : ''}`); if (status !== 200) break;
          const items = itemsIn(text); pages++; if (!items.length) break;
          let fresh = 0;
          for (const it of items) {
            if (!it || !it.url_key || seen.has(it.url_key)) continue; seen.add(it.url_key); fresh++;
            const mp = S.get(it, 'price_range.minimum_price') || {};
            const price = S.get(mp, 'final_price.value'), was = S.get(mp, 'regular_price.value');
            if (S.get(mp, 'final_price.currency') && S.get(mp, 'final_price.currency') !== 'SAR') continue;
            if (!S.isCandidate(price, was, rules)) continue;
            out.push({ key: it.url_key, brand: it.brand || '', sku: it.sku || '', name: String(it.name || '').slice(0, 90), price, was,
                       url: `https://www.mumzworld.com/sa-ar/${it.url_key}`, inStock: it.stock_status === 'IN_STOCK',
                       cat: cfg.collect.cat || 'mumzworld', path: (it.categories_without_path_base || []).slice(2, 4).join('/') });
          }
          if (!fresh) break;                 // page param ignored or past the end
          await S.sleep(300);
        }
      }
      out.sort((a, b) => (b.was - b.price) - (a.was - a.price));
      return { candidates: out.slice(0, cfg.collect.cap || 400), stats: { pages, seen: seen.size, passing: out.length } };
    },
    async check(rows) {
      return S.pool(rows, 3, async r => {
        const { status, text } = await S.fetchText(r.url.replace('https://www.mumzworld.com', ''));
        if (status === 404) return { id: r.id, found: false, status };
        const p = S.ldProduct(S.dom(text)); const o = p && (Array.isArray(p.offers) ? p.offers[0] : p.offers);
        if (!o) return { id: r.id, found: false, status };
        const inS = /InStock|LimitedAvailability/.test(o.availability || '');
        return { id: r.id, found: true, live: S.num(o.price), buyable: inS, stock: inS ? 99 : 0 };
      });
    }
  };
})();
