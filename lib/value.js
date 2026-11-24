// value.js — the page's «best value» score, ONE copy (BLD-26, 23 Nov 2026).
//
// Until now the score lived three times: VAL and TIER in template/index.html, the same in template/en.html, and valRow and
// tierRow in build.js (which orders the ticker and the category cards to match the page). A change to one and not the others
// would make the ticker disagree with the first cards. Now the formula is written once, here, as source text: build.js runs
// it (require) AND writes the same text into both pages ({{VALUE_JS}}), so the browser and the build use byte-identical code.
//
// x = { real: our measured discount in % (null if none), ok: verdict is ok, bad: verdict is bad, ref, price,
//       claim: the store's own claimed % (only to order rows we could not verify), low: at the lowest recorded price,
//       dead: unavailable at the last check,
//       boost: BLD-50, rules.page.brandBoost.factor for a row of a known brand or a season staple (else 1). It multiplies a
//       positive score only, so it reorders rows inside a tier and never moves a row across tiers }
const SRC = `const VALUE={val:x=>{if(x.real==null||x.real<=0||x.bad)return -1e9+(x.claim||0);return (x.ok?1:0.55)*x.real*Math.log10(10+(x.ref-x.price))*(x.low?1.15:1)*(x.boost>1?x.boost:1);},tier:x=>(x.dead?2:0)+(VALUE.val(x)<=-1e8?1:0)};`;
const VALUE = new Function(SRC + 'return VALUE;')();
module.exports = { SRC, VALUE };
