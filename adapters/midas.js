// midas.js — Midas (Magento, official Ashley retailer). collect = search by Ashley series names; check = product JSON-LD + .box-tocart.
// Product URLs change (…-midas.html → …-midas-saudi-arabia.html): check() falls back to catalog search by url_key words.
(function(){
  const S = window.SAYDA;
  const gql = async (q, store) => (await S.fetchJson('/graphql?query=' + encodeURIComponent(q), { headers: { Store: store || 'ksa_ar' } })).json;
  S.adapters.midas = {
    async collect(cfg, rules, ctx) { // ctx.series: series names from Ashley candidates (e.g. Bolanburg, Skempton)
      const series = (ctx && ctx.series) || []; const out = [], seen = new Set();
      await S.pool(series, 3, async s => { const j = await gql(`{products(search:"${s}",pageSize:20){items{name url_key stock_status price_range{minimum_price{regular_price{value} final_price{value}}}}}}`, 'ksa_en');
        for (const it of (S.get(j, 'data.products.items') || [])) { const mp = it.price_range.minimum_price; const price = mp.final_price.value, was = mp.regular_price.value; if (seen.has(it.url_key)) continue; seen.add(it.url_key);
          out.push({ key: it.url_key, series: s, name: it.name.slice(0, 80), price: S.round(price), was: S.round(was), url: cfg.productUrl.replace('{url_key}', it.url_key), inStock: it.stock_status === 'IN_STOCK' }); } });
      return { candidates: out, stats: { series: series.length } };
    },
    async check(rows) {
      const out = []; for (const r of rows) { let { status, url, text } = await S.fetchText(r.url.replace('https://midasfurniture.com', '')); let d = S.dom(text); let p = S.ldProduct(d); let fixed = null;
        if (!p) { // moved? search by the first two words of the url_key
          const words = (r.url.match(/ksa_ar\/(.+)\.html/) || ['', ''])[1].split('-').slice(0, 2).join(' '); const s = await S.fetchText('/ksa_ar/catalogsearch/result/?q=' + encodeURIComponent(words)); const sd = S.dom(s.text);
          const link = [...sd.querySelectorAll('a.product-item-link')].find(a => a.getAttribute('href') && a.getAttribute('href').includes(words.replace(' ', '-')));
          if (link) { fixed = link.getAttribute('href'); const t2 = await S.fetchText(fixed.replace('https://midasfurniture.com', '')); d = S.dom(t2.text); p = S.ldProduct(d); } }
        const off = p && p.offers || {}; const cart = S.text(d.querySelector('.box-tocart'));
        out.push({ id: r.id, found: !!p, live: S.num(off.price), buyable: /InStock/.test(off.availability || '') && /اضف الى السلة|أضف إلى السلة/.test(cart) && !/نفذت الكمية/.test(cart), stock: /InStock/.test(off.availability || '') ? 99 : 0, url: fixed || undefined }); await S.sleep(300); }
      return out;
    },
    async coupons() { const { text } = await S.fetchText('/ksa_ar/'); const t = S.text(S.dom(text).body); return { hits: [...t.matchAll(/.{0,50}(كود|كوبون|بطاقة|خصم إضافي|اخر فرصة).{0,80}/g)].map(m => m[0]).slice(0, 8) }; }
  };
})();
