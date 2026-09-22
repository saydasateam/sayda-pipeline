// market.js (adapter) — the comparator sweep. Runs in a browser tab, like every other adapter.
//
// IT EXTRACTS, IT DOES NOT INTERPRET.
// This file walks the DOM and hands back the raw text lines of each result block. Turning lines
// into a listing is rules/listing.js; deciding whether a listing may be used as a reference is
// rules/match.js. Both are node-side and both have tests that run offline. The split is the point:
// on 2026-09-20 a DOM harvester that "looked right" returned "18.6 / 18,999" as a price pair, and
// nothing could catch it because the parser only existed inside a browser.
//
// Results are cached per product in data/market/<store>.json (lib/market.js), so this runs once per
// product, not once per run: seconds per NEW row rather than minutes per cycle.
//
// NON-NEGOTIABLE, restated here because this is the one adapter that leaves the storefronts:
//   never sign in, never add to cart, never accept a cookie banner, never read or send a token.
//   It reads a results page and nothing else.
(function(){
  const S = window.SAYDA;

  // gl=sa pins the country, hl=en pins the language. BOTH are load-bearing, verified live 20 Sep:
  //   gl=sa  — without it the index returns Egyptian and Tunisian merchants, and a Cairo price
  //            inside a Saudi comparison is worse than no comparison.
  //   hl=en  — with hl=ar the titles come back as «تلفزيون سامسونج، 100 بوصة، نيو كيوليد»: no
  //            Latin brand, no model code, so rules/match.js correctly rejects every one of them
  //            and the sweep yields nothing. English titles keep the model code intact.
  const URL = q => `https://www.google.com/search?tbm=shop&gl=sa&hl=en&num=20&q=${encodeURIComponent(q)}`;

  const CURRENCY = /(?:SAR|ر\.?\s?س|ريال)/i;

  /** Walk a results document and return candidate blocks as { lines, url }.
   *  A result block states a price, names a merchant on its own line, and holds between three and
   *  nine lines. Nesting means a product appears several times with progressively longer text;
   *  rules/listing.js → fromBlocks keeps the innermost one, so over-collecting here is harmless. */
  function blocksIn(doc) {
    const out = [];
    for (const el of doc.querySelectorAll('div,li')) {
      const t = (el.innerText || el.textContent || '').trim();
      if (!t || t.length < 20 || t.length > 400) continue;
      if (!CURRENCY.test(t)) continue;
      const lines = t.split('\n').map(x => x.trim()).filter(Boolean);
      if (lines.length < 3 || lines.length > 9) continue;
      const a = el.querySelector('a[href]');
      out.push({ lines, url: a ? a.href : null });
      if (out.length >= 200) break;
    }
    return out;
  }

  S.adapters.market = {
    blocksIn,   // exported so it can be run against a saved document

    /** jobs: [{ id, q }] → [{ id, q, blocks, n, error? }].
     *  Sequential with a pause. This is a shared index, not a storefront we have a relationship
     *  with; a burst is both rude and the fastest way to be handed a challenge page. */
    async sweep(jobs, opts = {}) {
      const gap = opts.gapMs || 3000;
      const out = [];
      for (const j of jobs) {
        try {
          const { status, text } = await S.fetchText(URL(j.q));
          if (/captcha|unusual traffic|حركة مرور غير عادية/i.test(text)) {
            // stop the whole sweep: continuing past a challenge produces empty results that are
            // indistinguishable from "no comparator exists", which is the one confusion to avoid
            out.push({ id: j.id, q: j.q, blocks: [], n: 0, error: 'CHALLENGE PAGE — sweep stopped, report it' });
            break;
          }
          const blocks = blocksIn(S.dom(text));
          out.push({ id: j.id, q: j.q, status, blocks, n: blocks.length });
        } catch (e) {
          out.push({ id: j.id, q: j.q, blocks: [], n: 0, error: String(e && e.message || e).slice(0, 90) });
        }
        await S.sleep(gap);
      }
      return out;
    },
  };
})();
