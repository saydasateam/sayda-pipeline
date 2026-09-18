// ikea.js — runs on https://www.ikea.com. Offer listing cards carry price/was/valid-until; product pages carry the cart button.
(function(){
  const S = window.SAYDA;
  S.adapters.ikea = {
    async collect(cfg, rules) {
      const out = [], seen = new Set(); let end = '';
      await S.pool(cfg.collect.pages, 3, async u => { const { text } = await S.fetchText(u); const d = S.dom(text);
        d.querySelectorAll('[data-testid="plp-product-card"]').forEach(c => { const a = c.querySelector('a[href]'); const url = a && a.href; if (!url || seen.has(url)) return;
          const t = S.text(c); const price = S.num(c.getAttribute('data-price')); const sv = S.num((t.match(/وفر ﷼([\d,]+)/) || [])[1]); if (!price || !sv) return;
          const dm = t.match(/السعر صالح من (.+?) إلى (.+?) أو/); if (dm) end = dm[2].trim(); const nm = c.getAttribute('data-product-name') || ''; const desc = (t.match(new RegExp(nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^﷼]*)')) || [])[1] || '';
          if (!S.isCandidate(price, price + sv, rules)) return; seen.add(url);
          out.push({ key: (url.match(/-(\d{8})\/?$/) || [])[1], name: (nm + desc).slice(0, 70), price, was: price + sv, url, lastChance: /آخر فرصة/.test(t) }); }); });
      out.sort((a, b) => (b.was - b.price) - (a.was - a.price)); return { candidates: out, stats: { validUntil: end } };
    },
    async check(rows) {
      return S.pool(rows, 3, async r => { const { status, text } = await S.fetchText(r.url.replace('https://www.ikea.com', '')); const d = S.dom(text); const t = S.text(d.body);
        const pm = text.match(/"price"\s*:\s*"?([\d.]+)/); const valid = (t.match(/السعر صالح من .+? إلى (.+?) أو/) || [])[1] || '';
        return { id: r.id, found: status === 200, live: pm ? +pm[1] : null, buyable: /أضف إلى سلة التسوق|أضف الى سلة التسوق/.test(text), stock: 99, validUntil: valid.trim() }; });
    },
    async coupons(cfg) { const { text } = await S.fetchText(cfg.collect.campaign); const t = S.text(S.dom(text).body); return { hits: [...t.matchAll(/.{0,50}(كود|بطاقة|IKEA Family|فاميلي|خصم إضافي).{0,80}/g)].map(m => m[0]).slice(0, 8) }; }
  };
})();
