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

  // Nested DOM means a parent block repeats its children's text. Keep the innermost blocks only, so a
  // saved result stays small: a block is dropped when a shorter kept block's lines all appear in it.
  // Structural only — nothing here decides what a line means (that is rules/listing.js).
  function innermost(blocks, cap) {
    const uniq = [...new Map(blocks.map(b => [b.lines.join('\n'), b])).values()].sort((a, b) => a.lines.join('').length - b.lines.join('').length);
    const kept = [];
    for (const b of uniq) { const txt = b.lines.join('\n'); if (kept.some(k => k.lines.every(l => txt.includes(l)))) continue; kept.push(b); if (kept.length >= cap) break; }
    return kept;
  }
  const CHALLENGE = /unusual traffic|not a robot|حركة (?:مرور|زيارات) غير (?:عادية|معتادة)/i;
  const KEY = 'sayda-mkt';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
  const save = a => { try { localStorage.setItem(KEY, JSON.stringify(a)); return true; } catch (e) { return false; } };

  S.adapters.market = {
    blocksIn,   // exported so it can be run against a saved document
    url: URL,

    /** RENDERED path — the only one that works (22 Sep). Google now serves a JavaScript wall to a
     *  plain fetch, and the challenge check that used to scan fetched HTML matched the word "captcha"
     *  inside Google's own scripts, stopping every sweep at query 1 as a false challenge. So the
     *  driver navigates the tab to url(q), re-injects core + this file, and calls here(job): it reads
     *  the RENDERED page, checks only the VISIBLE text for a challenge, and appends the result to
     *  localStorage on google.com so results survive the next navigation. Returns a small receipt. */
    here(job) {
      const visible = (document.body && document.body.innerText) || '';
      const all = load();
      let rec;
      if (/^\/sorry\//.test(location.pathname) || CHALLENGE.test(visible.slice(0, 3000)))
        rec = { id: job.id, q: job.q, blocks: [], n: 0, error: 'CHALLENGE PAGE — sweep stopped, report it' };
      else { const blocks = innermost(blocksIn(document), 40); rec = { id: job.id, q: job.q, status: 200, blocks, n: blocks.length }; }
      const i = all.findIndex(x => x.id === job.id); if (i >= 0) all[i] = rec; else all.push(rec);
      const ok = save(all);
      return { id: job.id, n: rec.n, error: rec.error || (ok ? undefined : 'localStorage full'), saved: all.length };
    },
    /** Write the saved results for these ids onto the page as one JSON line, for get_page_text. */
    dump(ids) { const want = ids ? new Set(ids) : null; const out = load().filter(x => !want || want.has(x.id));
      document.body.innerHTML = '<pre id="sayda-out" style="white-space:pre-wrap;font:12px monospace"></pre>';
      document.getElementById('sayda-out').textContent = 'SAYDA:mkt\n' + JSON.stringify(out); return out.length; },
    clear() { try { localStorage.removeItem(KEY); } catch (e) {} return 'cleared'; },

    /** FETCH path — retired. Kept only so an old driver gets an explicit error per job instead of an
     *  empty result that reads as "no comparator exists", which is the one confusion to avoid. */
    async sweep(jobs) {
      return jobs.map(j => ({ id: j.id, q: j.q, blocks: [], n: 0, error: 'FETCH PATH RETIRED — Google requires a rendered page; use market.here() per query (RUNBOOK 3b)' }));
    },
  };
})();
