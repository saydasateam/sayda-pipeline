// kanbkam.js — runs on https://www.kanbkam.com. Price history (Noon/Amazon/Extra), market comparison, and
// seller listings (used as the Extra and Amazon collectors). Not a store adapter; registered under S.kanbkam.
(function(){
  const S = window.SAYDA;
  const parseList = html => { const d = S.dom(html), out = []; d.querySelectorAll('li.thumbnail-new').forEach(li => {
    const a = li.querySelector('a[data-gtmid]') || li.querySelector('a[href]'); const gt = a && a.dataset && a.dataset.gtmid || '';
    const price = S.num((li.querySelector('.caption p') || {}).textContent), was = S.num((li.querySelector('.old-price') || {}).textContent);
    const href = a ? a.getAttribute('href') : ''; const idm = href.match(/-(e\d+|B0[A-Z0-9]{8}|N\d+[A-Z]|Z[0-9A-F]{20,}Z)(?:\?|$)/i);
    out.push({ store: gt.split('|')[1] || '', title: S.text(li.querySelector('h3')).slice(0, 90), price, was, href, kid: idm ? idm[1] : null }); }); return out; };
  S.kanbkam = {
    // history for a list of ids: Noon SKU, Amazon ASIN, or Extra 'e<id>' — mid is the merchant id per store (config.kanbkamMid)
    async history(ids, mid) {
      return S.pool(ids, 5, async id => { const { json } = await S.fetchJson(`/sa/ar/autoUpdateProduct/${id}?mid=${mid}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!json) return { id, tracked: false };
        return { id, tracked: true, price: S.num(json.price), prev: S.num(json.previousPrice), min: S.num(json.min), max: S.num(json.max), inStock: json.inventory == 1, rate: json.rateText }; });
    },
    // market search: same model at other stores. terms = ['brand model', ...]
    async market(terms) {
      return S.pool(terms, 4, async term => { const en = await S.fetchText('/sa/en/search/l?q=' + encodeURIComponent(term));
        let items = parseList(en.text).filter(x => x.price); if (items.length < 3) { const ar = await S.fetchText('/sa/ar/search/l?q=' + encodeURIComponent(term)); items = items.concat(parseList(ar.text).filter(x => x.price)); }
        return { term, items: items.slice(0, 12) }; });
    },
    // seller listing (Extra seller=13, Amazon seller=1) sorted by biggest recent drop
    async listing(seller, cats, rules) {
      const out = await S.pool(cats, 5, async c => { const { text } = await S.fetchText(`/sa/ar/${c}/l?seller=${seller}&sort=chan_desc`);
        return parseList(text).filter(x => x.price && x.was && S.isCandidate(x.price, x.was, rules, 100)).map(x => ({ ...x, cat: c })); });
      return out.flat().sort((a, b) => (b.was - b.price) - (a.was - a.price));
    }
  };
})();
