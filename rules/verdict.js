// verdict.js — the ONLY place that decides ok/warn/bad/na and in/low/oos/ended/gone. Pure functions, node + browser safe.
const fmt = n => n == null ? '' : Math.round(n).toLocaleString('en-US');

/** Availability from a live observation.
 * obs: { found, live, buyable, stock, captcha, url }  row: { price, was, ref }  rules: config/rules.json
 * returns { avail, note, price (possibly updated), priceChanged } */
function availability(obs, row, rules, storeLabel) {
  const R = rules.avail;
  if (!obs || obs.captcha) return { avail: row.avail || 'in', note: `${storeLabel}: لم يُفحص (حجب مؤقت)`, price: row.price, priceChanged: false, unchecked: true };
  if (obs.found === false) return { avail: 'gone', note: `${storeLabel}: الصفحة غير موجودة`, price: row.price, priceChanged: false };
  const live = obs.live;
  // discount gone?
  // the deal is 'ended' when the live price climbs back to the reference it was measured against —
  // only meaningful when that reference sits ABOVE the deal price (a 'before' price, not a cheaper competitor / past low)
  const endedAt = (row.ref && row.ref > row.price) ? row.ref : (row.was ? row.was * R.endedIfLiveAtLeastOfClaimed : null);
  if (live != null && endedAt != null && live >= endedAt && obs.buyable) return { avail: 'ended', note: `${storeLabel}: عاد السعر إلى ${fmt(live)} — انتهى العرض`, price: row.price, priceChanged: false };
  if (!obs.buyable) return { avail: 'oos', note: `${storeLabel}: ${obs.note || 'نفد المخزون — لا يوجد زر «أضف إلى السلة»'}`, price: row.price, priceChanged: false };
  const priceChanged = live != null && Math.abs(live - row.price) / row.price > R.priceMatchTolerance;
  const price = priceChanged ? Math.round(live) : row.price;
  const low = obs.stock != null && obs.stock <= R.lowStockMax;
  return { avail: low ? 'low' : 'in', note: low ? `${storeLabel}: متبقي ${obs.stock}` : '', price, priceChanged };
}

/** Verdict from evidence.
 * ev: { prev, min, max, market: {store, price} | null, tracked }  price: current  claimed: claimedWas
 * returns { verdict, ref, finding } — finding is a default Arabic text the model may refine. */
function verdict(price, claimed, ev, rules, opts = {}) {
  const V = rules.verdict; const f = [];
  const ref = ev.market && ev.market.price && (!ev.prev || ev.market.price < ev.prev * 1.0) && opts.marketIsRef ? ev.market.price : (ev.prev ?? (ev.market && ev.market.price) ?? null);
  if (ref == null) return { verdict: 'na', ref: null, finding: opts.naFinding || 'لا يوجد سجل ولا نفس الموديل في متجر آخر للمقارنة' };
  const real = 1 - price / ref;
  // market check: same model cheaper elsewhere → bad
  if (ev.market && ev.market.price && ev.market.price < price * (1 - V.cheaperElsewhereTolerance)) return { verdict: 'bad', ref: ev.market.price, finding: `${ev.market.store} ${fmt(ev.market.price)} · أرخص من هنا` };
  if (ev.prev != null && price > ev.prev * 1.02) return { verdict: 'bad', ref, finding: `السعر ارتفع (كان ${fmt(ev.prev)})${ev.min && ev.min < ev.prev ? ` · وأقل سعر مسجل ${fmt(ev.min)}` : ''}` };
  if (real < V.warnMin) return { verdict: 'bad', ref, finding: ev.prev != null ? `الفرق الحقيقي ${Math.round(real * 100)}٪ فقط · «قبل» ${fmt(claimed)} ${ev.max && claimed > ev.max * 1.05 ? 'لم يُسجّل' : ''}`.trim() : `نفس سعر ${ev.market.store} (${fmt(ev.market.price)})` };
  if (ev.prev != null) f.push(`كان ${fmt(ev.prev)}`); else if (ev.market) f.push(`أرخص من ${ev.market.store} (${fmt(ev.market.price)})`);
  const belowMin = ev.min != null && price <= ev.min * 1.01; const soldLower = ev.min != null && ev.min < price * 0.95;
  if (belowMin) f.push('أقل سعر مسجل'); if (soldLower) f.push(`سبق ونزل ${fmt(ev.min)}`);
  if (ev.max != null && claimed > ev.max * 1.05) f.push(`«قبل» ${fmt(claimed)} لم يُسجّل`);
  const v = real >= V.okMin ? (soldLower ? 'warn' : 'ok') : 'warn';
  return { verdict: v, ref, finding: f.join(' · ') };
}

/** Candidate pre-filter shared by all stores. */
function isCandidate(c, rules, minSaving) { return c.price > 0 && c.was > c.price && (c.was - c.price) >= (minSaving ?? rules.candidate.minSaving) && (1 - c.price / c.was) >= rules.candidate.minClaimedPct; }

/** Trendyol-specific verdict (its own numbers; suggestedPrice never used as claimed). */
function trendyolVerdict(c, rules, market) {
  const ref = c.lowestRecent ?? (market && market.price) ?? null;
  if (ref == null) return { verdict: 'na', ref: null, finding: `لا يوجد الموديل نفسه في متجر آخر للمقارنة${c.suggested ? ` · «قبل» ${fmt(c.suggested)} هو «السعر المقترح» من ترينديول نفسه` : ''}` };
  const real = 1 - c.price / ref; const cond = c.plusOnly ? 'والسعر لمشتركي Trendyol Plus فقط' : (c.promos || []).some(p => /سلة|عند الدفع|عند شراء|كوبون|رمز/.test(p)) ? 'والخصم يظهر في السلة/عند الدفع فقط' : '';
  const badge = c.suggested && c.suggested > (c.was || 0) ? `شارة «${Math.round(100 * (1 - c.price / c.suggested))}٪» محسوبة من «سعر مقترح» ${fmt(c.suggested)}` : '';
  let v = real >= rules.verdict.okMin ? 'ok' : real >= rules.verdict.warnMin ? 'warn' : 'bad';
  if (cond && v === 'ok') v = 'warn'; if (cond && real < 0.05) v = 'bad';
  if (market && market.price && market.price < c.price * 0.99) { v = 'bad'; }
  const parts = [market ? `${market.store} ${fmt(market.price)}` : `أقل سعر حديث ${fmt(ref)}`, `الفرق الحقيقي ${Math.round(real * 100)}٪`, badge, cond].filter(Boolean);
  return { verdict: v, ref, finding: parts.join(' · ') };
}

module.exports = { availability, verdict, trendyolVerdict, isCandidate, fmt };
