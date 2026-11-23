#!/usr/bin/env node
// test-csp.js — BLD-8 (SEC-F5): each built page carries one Content-Security-Policy whose script hashes match the page's
// own inline scripts exactly, no inline event handler (they would be blocked), and no comment (BLD-7).
//   node scripts/test-csp.js        (reads dist/ as node build.js left it)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL ' + m); } };
for (const [lang, f] of [['Arabic', 'dist/index.html'], ['English', 'dist/en/index.html']]) {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const metas = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g) || [];
  ok(metas.length === 1, `${lang}: exactly one policy tag (found ${metas.length})`);
  const policy = metas.length ? metas[0].match(/content="([^"]*)"/)[1] : '';
  ok(html.indexOf('<meta http-equiv="Content-Security-Policy"') < html.indexOf('<script'), `${lang}: the policy comes before the first script`);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  ok(scripts.length >= 1, `${lang}: has its inline script`);
  for (const s of scripts) ok(policy.includes(`'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`), `${lang}: a script's hash is in the policy`);
  ok(!/'unsafe-inline'[^;]*;/.test((policy.match(/script-src[^;]*;/) || [''])[0]), `${lang}: scripts are not allowed inline wholesale`);
  ok(/object-src 'none'/.test(policy) && /base-uri 'none'/.test(policy) && /font-src 'self'/.test(policy), `${lang}: object-src, base-uri and font-src are closed`);
  ok(!/\son[a-z]+="/.test(html), `${lang}: no inline event handler`);
  ok(!/<!--/.test(html), `${lang}: no HTML comment`);
  ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html), `${lang}: no Google Fonts address`);
}
console.log(`csp: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
