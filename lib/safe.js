// safe.js — the one place that decides how text and links from outside may reach the page.
//
// WHY THIS EXISTS (security audit of 22 Nov 2026, findings SEC-F1 to SEC-F4)
// Product titles, merchant names, coupon wording and offer terms are written by stores, by
// marketplace sellers and by search listings. The build copied them into the page as they came:
// into the page's script as plain JSON, into static HTML, and into href attributes. A title holding
// «</script>» ended the page's script early, and a link that was not an https address became a
// clickable link. Nothing was being exploited; these helpers close the path.
//
// THREE RULES, each used by name so a reader can find every place it is applied:
//   cleanHttps(u)     a link is accepted only as a plain https address. Applied when a row is added
//                     or its link is fixed (apply.js, scripts/market-apply.js) and again at build.
//   jsonForScript(v)  every value written into the page's <script> goes through this.
//   escHtml(t)        every outside value written into static HTML goes through this;
//                     boldOnly(t) is the same and then lets <b> and </b> back in, nothing else.
// The page's own script escapes what it draws with its esc() (template/index.html, template/en.html).

/** A clean https address: starts with https://, and has no space, quote or angle bracket anywhere.
 *  The same rule scripts/apply-images.js has always applied to pictures. */
const cleanHttps = u => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u);

/** A link field that is present must be clean; an absent one (null, undefined, '') is not a link. */
const cleanOrAbsent = u => u == null || u === '' || cleanHttps(u);

/** BLD-37 (Codex audit 03, 24 Nov 2026): a product's buy link must be on its own store's site. `origin` is the store's
 *  `origin` in config/stores.json; the link's host must be that host or a subdomain of it, with a leading «www.»
 *  ignored on the store side (www.noon.com accepts noon.com and m.noon.com). A link to another site, or a store with no
 *  origin, fails. Checked on 24 Nov: all 831 rows of 14 stores pass, so no alias list is needed today. */
const onStoreSite = (u, origin) => {
  try {
    const h = new URL(u).hostname.toLowerCase(), base = new URL(origin).hostname.toLowerCase().replace(/^www\./, '');
    return !!base && (h === base || h.endsWith('.' + base));
  } catch { return false; }
};

const SCRIPT_UNSAFE = { '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' };
/** JSON that is safe inside an inline <script>. `<`, `>` and `&` become \u escapes, so no value can
 *  close the script block or open a comment; U+2028 and U+2029 are line ends to older JavaScript.
 *  «{{» is split too: build.js fills the template by replacing {{NAME}} one key after another, and a
 *  product title holding «{{T_JSON}}» would otherwise be filled in by a later key. The page reads
 *  back exactly the same values: these are escapes inside JSON strings, not changes to the text. */
const jsonForScript = v => JSON.stringify(v).replace(/[<>&\u2028\u2029]/g, c => SCRIPT_UNSAFE[c]).replace(/\{\{/g, '{\\u007b');

const HTML_UNSAFE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '{': '&#123;' };
/** Text for static HTML, in an element or in a quoted attribute. `{` is escaped for the same
 *  template-filling reason as above. null and undefined become the empty string. */
const escHtml = t => String(t == null ? '' : t).replace(/[&<>"'{]/g, c => HTML_UNSAFE[c]);

/** Escaped text in which only <b> and </b> are live again. Coupon wording uses <b> on purpose. */
const boldOnly = t => escHtml(t).replace(/&lt;(\/?)b&gt;/g, '<$1b>');

module.exports = { cleanHttps, cleanOrAbsent, onStoreSite, jsonForScript, escHtml, boldOnly };
