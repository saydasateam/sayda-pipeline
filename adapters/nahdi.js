// nahdi.js — runs on https://www.nahdionline.com (any /ar-sa page). Next.js App Router.
// Deal listing pages (/ar-sa/plp/<slug>) are server-rendered with the search hits the page shows, as
// JSON: {sku, name, manufacturer, url, price:{SAR:{default, default_original_formated}}}. We read those
// hits — the store's own sale price (`default`) and its own «before» (`default_original_formated`).
// Only page 1 of each listing is server-rendered (20 hits); the rest pages in client-side through a
// search service whose key we do not use. So breadth comes from listing MORE deal pages, not deeper ones.
// Product pages carry {"price":<before>, "price_after_discount":<now>, "availability":"…InStock"}.
// Verified live 2026-09-22.
(function(){
  const S = window.SAYDA;
  const unesc = h => h.replace(/\\"/g, '"');
  const grab = (s, from) => { let d = 0, st = -1, q = false, e = false;
    for (let i = from; i < s.length; i++) { const c = s[i];
      if (q) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') q = false; continue; }
      if (c === '"') { q = true; continue; }
      if (c === '[' || c === '{') { if (d === 0) st = i; d++; }
      else if (c === ']' || c === '}') { d--; if (d === 0) return s.slice(st, i + 1); } }
    return null; };
  const hitsIn = html => { const h = unesc(html), out = []; let k = 0;
    while ((k = h.indexOf('"hits":[', k)) >= 0) { try { out.push(...JSON.parse(grab(h, k + 7))); } catch (e) {} k += 7; }
    return out; };
  const slugOf = u => String(u || '').split('?')[0].split('/').filter(Boolean).pop();
  S.adapters.nahdi = {
    async collect(cfg, rules) {
      const seen = new Set(), out = [], stats = {};
      await S.pool(cfg.collect.paths, 3, async p => {
        const { status, text } = await S.fetchText(`/ar-sa/plp/${p}`); if (status !== 200) { stats[p] = 'HTTP ' + status; return; }
        const hits = hitsIn(text); stats[p] = hits.length;
        for (const h of hits) {
          if (!h || !h.sku || seen.has(h.sku)) continue; seen.add(h.sku);
          const sar = S.get(h, 'price.SAR') || {}; const price = S.num(sar.default), was = S.num(sar.default_original_formated);
          if (!S.isCandidate(price, was, rules)) continue;
          const name = typeof h.name === 'string' ? h.name : (h.name && h.name.value) || '';
          out.push({ key: String(h.sku), brand: h.manufacturer || '', name: name.slice(0, 90), price, was,
                     url: `https://www.nahdionline.com/ar-sa/${slugOf(h.url)}/pdp/${h.sku}`, cat: p });
        }
      });
      out.sort((a, b) => (b.was - b.price) - (a.was - a.price));
      return { candidates: out, stats: { perPath: stats, seen: seen.size, passing: out.length } };
    },
    async check(rows) {
      return S.pool(rows, 3, async r => {
        const { status, text } = await S.fetchText(r.url.replace('https://www.nahdionline.com', ''));
        if (status === 404) return { id: r.id, found: false, status };
        const h = unesc(text);
        const now = S.num((h.match(/"price_after_discount":([\d.]+)/) || [])[1]), before = S.num((h.match(/"price":([\d.]+)/) || [])[1]);
        const av = (h.match(/"availability":"([^"]+)"/) || [])[1] || '';
        if (now == null && before == null) return { id: r.id, found: false, status };
        const inS = /InStock|LimitedAvailability/.test(av);
        return { id: r.id, found: true, live: now ?? before, was: before, buyable: inS, stock: inS ? 99 : 0 };
      });
    }
  };
})();
