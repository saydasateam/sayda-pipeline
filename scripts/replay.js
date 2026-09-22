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
const { isGoodDeal, verdict } = require('../rules/verdict.js');
const rules = JSON.parse(fs.readFileSync(__dirname + '/../config/rules.json'));
const ROOT = __dirname + '/..';
const ST = require('../lib/state.js');
const cfgStores = JSON.parse(fs.readFileSync(ROOT + '/config/stores.json'));
const st = ST.load(ROOT, cfgStores);
const fix = process.argv.includes('--fix');

const num = t => { const m = String(t).replace(/[٬,]/g, '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).match(/\d+(\.\d+)?/); return m ? +m[0] : null; };
const after = (f, re) => { const m = (f || '').match(re); return m ? num(m[1]) : null; };

// ── gate lint ───────────────────────────────────────────────────────────────
// A collector may override the tiered candidate gate by passing isCandidate() a fourth argument.
// That is legitimate ONLY when the number comes from config (cfg.minSaving — the furniture stores).
// A numeric LITERAL there silently outranks config/rules.json and is invisible in any diff of the
// rules: on 2026-09-20 nextdata.js and saco.js passed 100 and shopify.js passed 300, which excluded
// every item under 83 SAR from the page and cost 34 of 201 qualifying Blackbox items. Caught here
// because replay is the pre-publish gate, so the check actually runs.
const path = require('path');
const ADIR = path.join(__dirname, '..', 'adapters');
const hardcoded = [];
for (const f of fs.readdirSync(ADIR).filter(n => n.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(ADIR, f), 'utf8');
  src.split('\n').forEach((line, i) => {
    // isCandidate(a, b, rules, <number literal>) — cfg.minSaving and friends are fine
    const m = line.match(/isCandidate\s*\([^)]*?,\s*(\d+(?:\.\d+)?)\s*\)/);
    if (m && f !== '_core.js') hardcoded.push(`${f}:${i + 1}  passes ${m[1]} as minSaving — use config/rules.json tiers`);
  });
}
if (hardcoded.length) {
  console.log(`\nGATE LINT — hardcoded candidate floors override the tiers (${hardcoded.length})`);
  for (const h of hardcoded) console.log('  ' + h);
}

const conflict = [], review = [];
for (const r of st.rows) {
  if (r.ref == null || !r.price) continue;
  const f = r.finding || '';
  // trendyol has its own verdict function (conditional offers, suggested-price badges) and
  // an ended deal carries context the row text cannot reconstruct — out of scope for a replay.
  if (r.store === 'trendyol' || /انتهى العرض|مشروط|سلة المشتريات|Plus/.test(f)) continue;

  // A row that kept its evidence can be re-derived exactly — no inference from prose needed.
  // This is the check that would have caught 2026-09-19's inflated references: a reference taken
  // from the 12-month MAX instead of the price the item actually sold at before the offer.
  if (r.ev && r.ev.prev != null && r.refKind === 'history') {
    const want = verdict(r.price, r.was, { prev: r.ev.prev, min: r.ev.min, max: r.ev.max, market: null }, rules);
    if (want.ref != null && Math.abs(want.ref - r.ref) / Math.max(want.ref, r.ref) > 0.02)
      conflict.push([r, r.verdict, want.verdict, `المرجع ${r.ref} لا يطابق السعر السابق المسجَّل ${r.ev.prev}`]);
    else if (want.verdict !== r.verdict)
      conflict.push([r, r.verdict, want.verdict, `القاعدة تعطي ${want.verdict} من نفس الدليل المحفوظ`]);
    continue;
  }

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

// --fix writes back only the shards that actually contained a corrected row, never the whole set
if (fix && conflict.length) {
  const touched = [...new Set(conflict.map(([r]) => r.store))];
  for (const [r, , want] of conflict) r.verdict = want;
  const all = ST.byStore(st.rows);
  ST.saveStores(ROOT, Object.fromEntries(touched.map(id => [id, all[id] || []])), { updated: st.meta.updated, checkedAt: st.meta.checkedAt });
  console.log(`written: ${conflict.length} verdicts corrected in ${touched.join(', ')}`);
}
process.exitCode = ((!fix && conflict.length) || hardcoded.length) ? 1 : 0;
