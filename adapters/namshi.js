// namshi.js — runs on https://www.namshi.com. Namshi is a Next.js App-Router site with NO __NEXT_DATA__
// and no public catalog JSON, so both collect and check parse the server-rendered product markup.
// Class names are CSS-module hashed (ProductBox_container__wiajf) — we match on the STABLE prefix with
// [class*="..."] so a Namshi deploy that only rehashes the suffix does not break us.
(function(){
  const S = window.SAYDA;
  const BOX  = 'div[class*="ProductBox_container"]';
  const PRICE = '[class*="ProductPrice_value"]';
  const WAS   = '[class*="ProductPrice_preReductionPrice"]';
  const BRAND = '[class*="ProductBox_brand"]';

  const txt = (e, sel) => { const n = e.querySelector(sel); return n ? n.textContent.trim() : ''; };
  const parseBox = e => {
    const a = e.querySelector('a[href]'); if (!a) return null;
    const price = S.num(txt(e, PRICE)), was = S.num(txt(e, WAS));
    if (!(price > 0 && was > price)) return null;
    const brand = txt(e, BRAND);
    const img = e.querySelector('img');
    const name = ((img && img.alt) || S.text(e).slice(0, 90) || '').replace(/^إعلان/, '').trim();
    const href = a.getAttribute('href') || '';
    return { brand, name: (brand && !name.startsWith(brand) ? brand + ' ' : '') + name.slice(0, 80),
             price, was, href, sponsored: /إعلان|Sponsored/.test(S.text(e).slice(0, 12)) };
  };
  const boxesIn = doc => [...doc.querySelectorAll(BOX)].map(parseBox).filter(Boolean);

  S.adapters.namshi = {
    async collect(cfg, rules) {
      const seen = new Set(), out = [];
      for (const p of cfg.collect.paths) {
        for (let pg = 1; pg <= (cfg.collect.pages || 3); pg++) {
          const { text, status } = await S.fetchText(`/${cfg.collect.locale || 'saudi-ar'}/${p}/${pg > 1 ? `?page=${pg}` : ''}`);
          if (status !== 200) break;
          const rows = boxesIn(S.dom(text));
          if (!rows.length) break;                       // past the last page, or markup drifted
          for (const r of rows) {
            if (r.sponsored) continue;                   // paid placements are not deals
            if (!S.isCandidate(r.price, r.was, rules)) continue;
            const key = (r.brand || '') + '|' + r.name.replace(/[^؀-ۿA-Za-z0-9]/g, '').slice(0, 35);
            if (seen.has(key)) continue; seen.add(key);
            out.push({ key: r.href.split('/').filter(Boolean).pop(), brand: r.brand, name: r.name,
                       price: r.price, was: r.was, url: 'https://www.namshi.com' + r.href, cat: p });
          }
          await S.sleep(400);
        }
      }
      // per-category quota so one big category cannot crowd out the rest
      const perCat = cfg.collect.perCat || 30, byCat = {};
      for (const c of out) (byCat[c.cat] = byCat[c.cat] || []).push(c);
      const picked = [];
      for (const k of Object.keys(byCat)) { byCat[k].sort((a,b)=>(b.was-b.price)-(a.was-a.price)); picked.push(...byCat[k].slice(0, perCat)); }
      picked.sort((a, b) => (b.was - b.price) - (a.was - a.price));
      return { candidates: picked.slice(0, cfg.collect.cap || 200),
               stats: { cats: Object.fromEntries(Object.entries(byCat).map(([k,v])=>[k,v.length])) } };
    },

    async check(rows) {
      const out = [];
      for (const r of rows) {
        const { status, text } = await S.fetchText(r.url.replace('https://www.namshi.com', ''));
        if (status === 404) { out.push({ id: r.id, found: false, status }); await S.sleep(500); continue; }
        const d = S.dom(text);
        // product page reuses the same price classes; sold-out pages drop the add-to-bag control
        const price = S.num(txt(d, PRICE)), was = S.num(txt(d, WAS));
        const soldOut = /نفدت الكمية|Sold Out|out of stock/i.test(S.text(d.querySelector('main') || d.body).slice(0, 4000));
        const buyable = !soldOut && !!(d.querySelector('[class*="AddToCart"], [data-testid*="add-to"], button[class*="addToBag"]'));
        out.push({ id: r.id, found: status === 200, live: price || null, was: was || null,
                   buyable: buyable || (!soldOut && price > 0), stock: soldOut ? 0 : 99 });
        await S.sleep(600);
      }
      return out;
    }
  };
})();
