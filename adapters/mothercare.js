// mothercare.js — runs on https://www.mothercare.com.sa (Adobe Commerce storefront, Edge Delivery).
// Listings are rendered client-side from a search service whose key we do not use, so collectRender()
// reads the RENDERED sale page: each `.product-item.card` shows the name (h6), the price paid
// (.item-price-discounted) and the store's own «before» (.item-price-original-slashed). It presses
// the page's own «load more» / scrolls until it has enough cards or the list stops growing.
// Product pages are server-rendered with schema.org Product JSON-LD (price + availability), which
// check() reads by plain fetch — no render needed. Verified live 2026-09-22.
(function(){
  const S = window.SAYDA;
  const cardsNow = () => [...document.querySelectorAll('.product-item.card')];
  const parseCard = c => {
    const a = c.querySelector('a[href]') || c.parentElement && c.parentElement.querySelector('a[href]');
    const href = a ? a.getAttribute('href').split('?')[0] : '';
    const price = S.num(S.text(c.querySelector('.item-price-discounted'))), was = S.num(S.text(c.querySelector('[class*="item-price-original"]')));
    return { key: href.split('/').filter(Boolean).pop() || '', name: S.text(c.querySelector('h6, h5, h4')).slice(0, 90), price, was,
             url: href ? new URL(href, location.origin).href : '' };
  };
  S.adapters.mothercare = {
    render: false,
    async collectRender(cfg, rules, opts = {}) {
      const want = opts.want || cfg.collect.want || 300; let last = -1, stuck = 0, steps = 0;
      while (cardsNow().length < want && stuck < 3 && steps < 40) {
        const more = [...document.querySelectorAll('button, a')].find(b => /عرض المزيد|تحميل المزيد|Load more|Show more/i.test(b.textContent || ''));
        if (more) more.click(); window.scrollTo(0, document.body.scrollHeight);
        await S.sleep(1800); steps++;
        const n = cardsNow().length; if (n === last) stuck++; else { stuck = 0; last = n; }
      }
      const seen = new Set(), out = [];
      for (const c of cardsNow()) { const x = parseCard(c); if (!x.key || seen.has(x.key)) continue; seen.add(x.key);
        if (!S.isCandidate(x.price, x.was, rules)) continue; out.push({ ...x, brand: 'Mothercare', cat: cfg.collect.cat || 'mothercare' }); }
      out.sort((a, b) => (b.was - b.price) - (a.was - a.price));
      return { candidates: out, stats: { cards: cardsNow().length, steps, stop: stuck >= 3 ? 'listStoppedGrowing' : 'enough', passing: out.length } };
    },
    async collect() { throw new Error('mothercare: listings need the rendered page — use collectRender() on store.landing'); },
    async check(rows) {
      return S.pool(rows, 3, async r => {
        const { status, text } = await S.fetchText(r.url.replace('https://www.mothercare.com.sa', ''));
        if (status === 404) return { id: r.id, found: false, status };
        const p = S.ldProduct(S.dom(text)); const o = p && (Array.isArray(p.offers) ? p.offers[0] : p.offers);
        if (!o) return { id: r.id, found: false, status };
        const inS = /in ?stock|InStock/i.test(o.availability || '');
        return { id: r.id, found: true, live: S.num(o.price), buyable: inS, stock: inS ? 99 : 0, brand: p.brand && p.brand.name };
      });
    }
  };
})();
