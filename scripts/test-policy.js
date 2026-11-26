#!/usr/bin/env node
// test-policy.js — BLD-44: config/site.json pagePolicy switches the Content-Security-Policy meta tag on both pages.
//   node scripts/test-policy.js        (scratch copy in os.tmpdir; the repo's dist/ and config/ are not touched)
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL ' + msg); } };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sayda-policy-'));
for (const d of ['config', 'rules', 'lib', 'template', 'data/state']) fs.cpSync(path.join(ROOT, d), path.join(TMP, d), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'build.js'), path.join(TMP, 'build.js'));
const site0 = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/site.json'), 'utf8'));
const setPolicy = v => { const c = { ...site0 }; if (v === undefined) delete c.pagePolicy; else c.pagePolicy = v; fs.writeFileSync(path.join(TMP, 'config/site.json'), JSON.stringify(c)); };
const build = () => { const r = cp.spawnSync(process.execPath, ['build.js'], { cwd: TMP, encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const pages = () => ['dist/index.html', 'dist/en/index.html'].map(p => { try { return fs.readFileSync(path.join(TMP, p), 'utf8'); } catch { return null; } });
const TAG = /<meta http-equiv="Content-Security-Policy"/;

setPolicy('on'); let r = build(); let [ar, en] = pages();
ok(r.code === 0 && TAG.test(ar) && TAG.test(en) && /page policy: on/.test(r.out), 'on: tag on both pages, said on the console');
const onAr = ar;
setPolicy(undefined); r = build(); [ar, en] = pages();
ok(r.code === 0 && ar === onAr && TAG.test(en), 'missing key: same as on');
setPolicy('off'); r = build(); [ar, en] = pages();
ok(r.code === 0 && !TAG.test(ar) && !TAG.test(en), 'off: no tag on either page');
ok(/page policy: OFF/.test(r.out), 'off: said loudly on the console');
ok(ar === onAr.replace(/\n<meta http-equiv="Content-Security-Policy"[^>]*>/, ''), 'off: the page is otherwise the same as with the policy on');
setPolicy('maybe'); r = build(); [ar, en] = pages();
ok(r.code !== 0 && /pagePolicy "maybe" must be "on" or "off"/.test(r.out), 'any other value stops the build and names it');
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`page policy switch: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
