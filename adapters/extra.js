// extra.js — collect via KanBkam listing (see kanbkam.js, seller=13); check runs on https://www.extra.com.
// /ar-sa/p/{id} redirects to the canonical URL; stock and price come from the SSR JSON (escaped quotes).
(function(){
  const S = window.SAYDA;
  const idOf = u => (String(u).match(/\/p\/(\d+)/) || [])[1];
  S.adapters.extra = {
    collect: null, // handled by the kanbkam adapter (cfg.collect.via === 'kanbkam')
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
          obs = { id: r.id, found: true, url, live: pm ? +pm[1] : null, stockStatus: m ? m[2] : null, stock: m ? +m[3] : null, buyable: !!(m && m[1] === 'true' && m[2] !== 'outOfStock') };
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
