#!/usr/bin/env node
// (BLD-18) The WhatsApp channel links on both built pages. Run after `node build.js`.
// Checks: the channel address in config/site.json is a whatsapp.com/channel address; each page carries the four built-in
// follow links (banner, header, suggest, about) with that exact address, a new tab and rel="noopener"; the strip sits
// in the file right before the product grid and the script moves it after the first 10 cards (15 wider) (BLD-50), and can be closed; the follow block sits
// after the product grid and before the suggestion box; the privacy sentence names the channel click; and the page's
// script pushes follow_channel_click before the outbound-store branch can count the click.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/site.json'), 'utf8'));
const WA = String(site.whatsappChannel || '').trim();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL: ' + m); } };
if (!WA) { console.log('channel: config/site.json has no whatsappChannel, nothing to check'); process.exit(0); }
ok(/^https:\/\/whatsapp\.com\/channel\/[A-Za-z0-9]{16,40}$/.test(WA), 'whatsappChannel is not https://whatsapp.com/channel/<code>');
for (const [lang, f, privacy] of [['ar', 'dist/index.html', 'وفتح قناتنا على واتساب'], ['en', 'dist/en/index.html', 'opening our WhatsApp channel']]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { ok(false, `${f} missing, run node build.js first`); continue; }
  const h = fs.readFileSync(p, 'utf8');
  const links = [...h.matchAll(/<a\b[^>]*\bdata-ch="([a-z]+)"[^>]*>/g)];
  ok(links.map(m => m[1]).sort().join(',') === 'about,banner,header,suggest', `${lang}: follow links are [${links.map(m => m[1])}], want about, banner, header, suggest`);
  for (const m of links) {
    ok(m[0].includes(`href="${WA}"`), `${lang} ${m[1]}: href is not the channel address`);
    ok(/target="_blank"/.test(m[0]) && /rel="noopener"/.test(m[0]), `${lang} ${m[1]}: needs target="_blank" rel="noopener"`);
  }
  const hero = h.indexOf('class="hero"'), bar = h.indexOf('id="wabar"'), kat = h.indexOf('class="wrap"');
  const block = h.indexOf('class="wafol"'), suggest = h.indexOf('id="suggest"'), rows = h.indexOf('id="rows"');
  ok(bar > hero && bar > kat && bar < rows, `${lang}: the strip must sit under the top section, at the start of the content, before the product grid`);
  // (BLD-50) the file keeps the strip right before the grid; the page's script moves it after the 10th card on a phone and the 15th wider
  ok(/const barAt=\(\)=>\(window\.matchMedia&&matchMedia\('\(min-width:600px\)'\)\.matches\)\?15:10;/.test(h) && /rows\.insertBefore\(w(abEl)?,cards\[n\]\)/.test(h), `${lang}: the script must move the strip after the first 10 cards on a phone and 15 wider`);
  ok(h.includes('id="wabx"') && h.includes("localStorage.setItem('sayda.wabar','0')") && h.includes("localStorage.getItem('sayda.wabar')==='0'"), `${lang}: the strip must close and stay closed`);
  ok(block > rows && block < suggest, `${lang}: the follow block must sit after the product grid and before the suggestion box`);
  ok(h.includes(privacy), `${lang}: the privacy sentence does not name the channel click`);
  ok(h.includes(`WA=${JSON.stringify(WA)}`), `${lang}: the script does not receive the channel address`);
  const fc = h.indexOf("push('follow_channel_click'"), out = h.indexOf("push('outbound_store_click'");
  ok(fc > 0 && fc < out, `${lang}: follow_channel_click must be pushed before the outbound_store_click branch`);
  ok(h.includes('openDeal(id,true)'), `${lang}: a shared link must open the deal with the follow line`);
}
console.log(`channel: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
