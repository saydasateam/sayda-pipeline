// saco.js — runs on the SACO national-day category page (rendered DOM; SSR is App-Router flight data).
// collect() clicks «عرض المزيد» and parses cards; check() fetches product pages (JSON-LD + «أضف للسلة»).
(function(){
  const S = window.SAYDA;
  S.adapters.saco = {
    async collect(cfg, rules) {
      for (let i = 0; i < (cfg.collect.loadMoreClicks || 10); i++) { const b = [...document.querySelectorAll('button,a')].find(x => /عرض المزيد/.test(x.innerText || '')); if (!b) break; b.click(); await S.sleep(2200); }
      const out = [], seen = new Set();
      document.querySelectorAll('a[href*="-p-"]').forEach(a => { const h = a.getAttribute('href'); if (seen.has(h)) return;
        let el = a; for (let i = 0; i < 6; i++) { el = el.parentElement; if (!el) return; if (el.innerText && el.innerText.trim().length > 25) break; }
        const lines = (el.innerText || '').split('\n').map(x => x.trim()).filter(Boolean); const nums = lines.filter(x => /^[\d,]+(\.\d+)?$/.test(x)).map(S.num);
        if (nums.length < 2) return; const [price, was] = nums; if (!S.isCandidate(price, was, rules)) return; seen.add(h);
        out.push({ key: h.split('/').pop(), name: (lines.find(x => x.length > 15 && !/^[\d,]/.test(x)) || '').slice(0, 80), price, was, url: cfg.origin + h, inStock: /متوفر/.test(el.innerText) && /أضف للسلة/.test(el.innerText), bought: (el.innerText.match(/(\d+)\+? كمية تم شراؤها/) || [])[1] }); });
      out.sort((a, b) => (b.was - b.price) - (a.was - a.price)); return { candidates: out, stats: { cards: seen.size } };
    },
    async check(rows) {
      const out = []; for (const r of rows) { const { status, text } = await S.fetchText(r.url.replace('https://www.saco.sa', '')); const d = S.dom(text); const p = S.ldProduct(d); const off = p && p.offers || {};
        out.push({ id: r.id, found: status === 200 && !!p, live: S.num(off.price), buyable: /InStock/.test(off.availability || '') && /أضف للسلة/.test(text), stock: /InStock/.test(off.availability || '') ? 99 : 0 }); await S.sleep(400); }
      return out;
    },
    async coupons() { const t = document.body.innerText.replace(/\s+/g, ' '); return { hits: [...t.matchAll(/(كود|كوبون|رمز الخصم|بطاقات|خصم إضافي)[^.،]{0,70}/g)].map(m => m[0]).slice(0, 10) }; }
  };
})();
