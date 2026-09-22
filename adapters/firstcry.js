// firstcry.js — runs on https://www.firstcry.sa (FirstCry Arabia KSA storefront).
// Both listings and product pages are rendered CLIENT-side: the server HTML carries only promo
// template blocks (the `.prod-price` nodes in it hold campaign thresholds, not this product's price),
// so a fetch-based collector or check would read the wrong number. Everything here therefore runs
// against the RENDERED page, like mothercare/homecentre.
//   listing card  .list_block → .r1 price now · .r2 store's own «before» · img[alt] full name
//                 product link a[href*="/product-detail"]; the key is the hex id segment in that URL
//   product page  #prod_price .prod-price now · .original_mrp_main was · .sizeaddtocart = buyable
// Verified live 2026-09-22 on /toys/5/0/0.
(function(){
  const S = window.SAYDA;
  const ORIGIN = 'https://www.firstcry.sa';
  const abs = h => !h ? '' : (h.startsWith('//') ? 'https:' + h : new URL(h, ORIGIN).href);
  // /<brand>/<slug>/<hex id>/product-detail  → the hex id is the stable key
  const keyFrom = url => { const p = String(url || '').split('?')[0].split('/').filter(Boolean);
    const i = p.indexOf('product-detail'); return i > 0 ? p[i - 1] : (p.pop() || ''); };
  const cardsNow = () => [...document.querySelectorAll('.list_block')];
  const parseCard = c => {
    const a = c.querySelector('a[href*="product-detail"]');
    const url = abs(a && a.getAttribute('href'));
    const img = c.querySelector('img');
    const name = (img && img.getAttribute('alt') || S.text(c.querySelector('.li_txt1'))).replace(/\.\.\.$/, '');
    return { key: keyFrom(url), name: String(name || '').slice(0, 90), url,
             price: S.num(S.text(c.querySelector('.r1'))), was: S.num(S.text(c.querySelector('.r2'))) };
  };
  const oosNow = () => {
    const t = (document.querySelector('#prod_price') || document.body).innerText || '';
    return /نفد|نفدت|غير متوفر|out of stock/i.test(t) || !document.querySelector('.sizeaddtocart');
  };

  S.adapters.firstcry = {
    render: true,
    async collectRender(cfg, rules, opts = {}) {
      const want = opts.want || cfg.collect.want || 60; let last = -1, stuck = 0, steps = 0;
      while (cardsNow().length < want && stuck < 3 && steps < 25) {
        const more = [...document.querySelectorAll('button, a, div')]
          .find(b => /عرض المزيد|المزيد|Load more|Show more|التالي/i.test((b.textContent || '').trim()) && (b.textContent || '').trim().length < 24);
        if (more) more.click();
        window.scrollTo(0, document.body.scrollHeight);
        await S.sleep(1800); steps++;
        const n = cardsNow().length; if (n === last) stuck++; else { stuck = 0; last = n; }
      }
      const seen = new Set(), out = [];
      for (const c of cardsNow()) { const x = parseCard(c);
        if (!x.key || !x.url || seen.has(x.key)) continue; seen.add(x.key);
        if (!S.isCandidate(x.price, x.was, rules)) continue;
        out.push({ ...x, brand: '', inStock: true, cat: cfg.collect.cat || 'firstcry' }); }
      out.sort((a, b) => (b.was - b.price) - (a.was - a.price));
      return { candidates: out, stats: { cards: cardsNow().length, steps, stop: stuck >= 3 ? 'listStoppedGrowing' : 'enough', passing: out.length } };
    },
    async collect() { throw new Error('firstcry: prices render client-side — use collectRender() on a listing page'); },
    // rendered check: the tab must already be ON r.url (driver navigates, waits, then calls this)
    async checkCurrent(r) {
      const here = keyFrom(location.href), want = keyFrom(r.url);
      if (want && here && here !== want) return { id: r.id, found: false, status: 'wrongPage' };
      const live = S.num(S.text(document.querySelector('#prod_price .prod-price')));
      if (live == null) return { id: r.id, found: false, status: 'noPrice' };
      const buyable = !oosNow();
      return { id: r.id, found: true, live, buyable, stock: buyable ? 99 : 0,
               was: S.num(S.text(document.querySelector('.original_mrp_main'))) };
    },
    async check() { throw new Error('firstcry: prices render client-side — navigate the row and call checkCurrent({id,url})'); }
  };
})();
