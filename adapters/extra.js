// extra.js — collect via KanBkam listing (see kanbkam.js, seller=13); check runs on https://www.extra.com.
// /ar-sa/p/{id} redirects to the canonical URL; stock and price come from the SSR JSON (escaped quotes).
(function(){
  const S = window.SAYDA;
  const idOf = u => (String(u).match(/\/p\/(\d+)/) || [])[1];
  S.adapters.extra = {
    collect: null, // handled by the kanbkam adapter (cfg.collect.via === 'kanbkam')
    // (22 Nov 2026) Extra's OWN campaign page. The KanBkam listing surfaces clearance stock: 37 of 38
    // picks on 21-22 Nov were out of stock at Extra. The campaign page lists what Extra is selling in
    // the campaign today (111 products on 22 Nov). KanBkam history (seller 13, ids `e<id>`) still
    // supplies the evidence and the live check still sets the price: tile prices are not read here.
    // Run it IN a tab on cfg.campaignPage. It scrolls so every carousel loads, then reads each product
    // link outside the mega-menu. The slug is the store's English product slug: brand first.
    async collectPage() {
      for (let y = 0; y < document.body.scrollHeight; y += 900) { scrollTo(0, y); await S.sleep(350); }
      await S.sleep(1500);
      const seen = new Map();
      for (const a of document.querySelectorAll('a[href*="/p/"]')) {
        if (a.closest('[class*=mega-menu]')) continue;
        const id = idOf(a.href); if (!id || seen.has(id)) continue;
        const slug = (a.pathname.split('/').slice(-3, -2)[0] || '').replace(/-/g, ' ').trim();
        seen.set(id, { key: id, kid: 'e' + id, brand: slug.split(' ')[0] || '', slug, url: 'https://www.extra.com/ar-sa/p/' + id });
      }
      return { candidates: [...seen.values()], stats: { reachable: seen.size, page: location.pathname } };
    },
    async check(rows) {
      const out = [];
      for (const r of rows) { // sequential: parallel bursts get bounced to /ar-sa/error
        let obs = null;
        for (let a = 0; a < 3 && !obs; a++) {
          const { status, url, text } = await S.fetchText('/ar-sa/p/' + idOf(r.url));
          if (status === 404) { obs = { id: r.id, found: false, status }; break; }
          if (/\/ar-sa\/error/.test(url) || status !== 200) { await S.sleep(2500); continue; }
          const t = text.replace(/\\"/g, '"');
          const m = t.match(/"purchasable"\s*:\s*(true|false),"stock":\{"stockLevelStatus":\{"code":"(\w+)"[^}]*\},"stockLevel":(\d+)/);
          const pm = t.match(/"offers"\s*:\s*\{[\s\S]{0,300}?"price"\s*:\s*"?([\d.]+)/);
          // BLD-36: the maker's model number and barcode as Extra's own page states them (JSON-LD `mpn`, `gtin13`)
          const mpn = (t.match(/"mpn"\s*:\s*"([^"]{2,40})"/) || [])[1], gtin = (t.match(/"gtin13"\s*:\s*"(\d{8,14})"/) || [])[1];
          obs = { id: r.id, found: true, url, live: pm ? +pm[1] : null, stockStatus: m ? m[2] : null, stock: m ? +m[3] : null, buyable: !!(m && m[1] === 'true' && m[2] !== 'outOfStock'),
                  model: S.modelOf(mpn), gtin: S.gtinOf(gtin) };
        }
        out.push(obs || { id: r.id, found: false, status: 'blocked' }); await S.sleep(1200);
      }
      return out;
    },
    async coupons(cfg) {
      const { text } = await S.fetchText(cfg.landing.replace(cfg.origin, '')); const t = text.replace(/\\"/g, '"').replace(/\\u002F/g, '/');
      const body = t.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const faq = (body.match(/كود الخصم[^.]{0,200}|بطاقة ساب[^.]{0,200}/g) || []).slice(0, 6);
      const banners = [...new Set([...t.matchAll(/https:\/\/media\.extra\.com\/i\/aurora\/[A-Za-z0-9_\-\.]{4,90}/g)].map(m => m[0]))].filter(u => /ND9|nd9|national|bank|SAB|sab/i.test(u)).slice(0, 20);
      return { faq, banners };
    }
  };
})();
