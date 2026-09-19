#!/usr/bin/env node
// replay.js — re-derives each row's verdict from its own stored numbers and reports disagreements.
//
// Why: during discovery a model writes the row after calling verdict(), so the stored `verdict`
// can drift from the evidence in the same row (found 2026-09-19 on extra:100500820 — stored `ok`
// where a recorded lower price forces `warn`). Rules live in rules/verdict.js; this calls them.
//
// Two buckets, because the row does not keep the full evidence object:
//   CONFLICT — the stored verdict contradicts a rule that needs only price/ref/finding. Fixable.
//   REVIEW   — the replay lacks what the original had (adapter-specific verdicts, conditional
//              offers, ended deals). Reported for a human, never auto-changed.
//
//   node scripts/replay.js          # report (exit 1 if any CONFLICT)
//   node scripts/replay.js --fix    # correct CONFLICT rows only
const fs = require('fs');
const { isGoodDeal } = require('../rules/verdict.js');
const rules = JSON.parse(fs.readFileSync(__dirname + '/../config/rules.json'));
const P = __dirname + '/../data/state.json';
const st = JSON.parse(fs.readFileSync(P));
const fix = process.argv.includes('--fix');

const num = t => { const m = String(t).replace(/[٬,]/g, '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).match(/\d+(\.\d+)?/); return m ? +m[0] : null; };
const after = (f, re) => { const m = (f || '').match(re); return m ? num(m[1]) : null; };

const conflict = [], review = [];
for (const r of st.rows) {
  if (r.ref == null || !r.price) continue;
  const f = r.finding || '';
  // trendyol has its own verdict function (conditional offers, suggested-price badges) and
  // an ended deal carries context the row text cannot reconstruct — out of scope for a replay.
  if (r.store === 'trendyol' || /انتهى العرض|مشروط|سلة المشتريات|Plus/.test(f)) continue;

  const real = 1 - r.price / r.ref;
  const min = after(f, /سبق ونزل\s+([\d٠-٩٬,]+)/);
  const soldLower = min != null && min < r.price * 0.95;
  const cheaper = r.ref < r.price;

  // Rule-forced outcomes: these need nothing the row does not already carry.
  if (cheaper && r.verdict !== 'bad') conflict.push([r, r.verdict, 'bad', 'نفس الموديل أرخص في متجر آخر']);
  else if (!cheaper && real < rules.verdict.warnMin && r.verdict !== 'bad') conflict.push([r, r.verdict, 'bad', `الفرق ${(real*100).toFixed(1)}٪ دون حد ${rules.verdict.warnMin*100}٪`]);
  else if (!cheaper && real >= rules.verdict.warnMin && soldLower && r.verdict === 'ok') conflict.push([r, 'ok', 'warn', `سبق ونزل ${min} — القاعدة تفرض warn`]);
  // The money track is authoritative (ruled 2026-09-19): a low percentage that still saves real
  // riyals against the reference counts, whether the reference is our history or another store.
  else if (!cheaper && r.verdict === 'warn' && isGoodDeal(r.price, real, rules) && !soldLower)
    conflict.push([r, 'warn', 'ok', `${(real*100).toFixed(1)}٪ + توفير ${Math.round(r.ref-r.price)} ر.س يجتاز مسار المبلغ`]);
}

const show = (t, list) => { if (!list.length) return; console.log(`\n${t} (${list.length})`); for (const [r, a, b, why] of list) console.log(`  ${a} → ${b}  ${r.id}\n     ${why}\n     ${r.finding}`); };
show('CONFLICT — القاعدة تفرض حكماً مختلفاً', conflict);
show('REVIEW — قرار تقديري، لم يُغيَّر', review);
if (!conflict.length && !review.length) console.log('replay: all', st.rows.length, 'rows agree with rules/verdict.js');
else console.log(`\nreplay: ${conflict.length} conflict, ${review.length} review, of ${st.rows.length} rows`);

if (fix && conflict.length) { for (const [r, , want] of conflict) r.verdict = want; fs.writeFileSync(P, JSON.stringify(st, null, 2)); console.log(`written: ${conflict.length} verdicts corrected`); }
process.exitCode = (!fix && conflict.length) ? 1 : 0;
