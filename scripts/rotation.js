#!/usr/bin/env node
// rotation.js — which market store and which no-record store this run works on (22 Nov 2026).
//
// The four refresh slots share the stores that cannot all fit in one run:
//   · market stores (rules.discovery.rotation.market): one per slot, the same slot every day,
//     so each is collected once a day — 08:21 the first, 12:21 the second, and so on;
//   · no-record stores (rules.discovery.rotation.selfVerify): one per run in turn, so each of the
//     seven gets its branded items checked against Amazon/noon about every second day.
// Deterministic from the Riyadh clock, so two runs never argue about whose turn it is.
//
//   node scripts/rotation.js            # now, Riyadh time
//   node scripts/rotation.js 2026-11-23T16:25   # any Riyadh wall-clock time, for testing
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rules = require(path.join(ROOT, 'config/rules.json'));
const campaign = require(path.join(ROOT, 'config/campaign.json'));
const rot = (rules.discovery || {}).rotation || {};
const market = rot.market || [], self = rot.selfVerify || [];

const arg = process.argv[2];
const riyadh = arg ? new Date(arg + 'Z') : new Date(Date.now() + 3 * 3600e3);   // Riyadh wall clock, read as UTC fields
const hour = riyadh.getUTCHours();
const SLOTS = [8, 12, 16, 20];
// the slot a run belongs to: the latest slot at or before its start (a 12:21 run that fires late at 14:30 is still the 12:21 slot)
let slot = SLOTS.length - 1; for (let i = 0; i < SLOTS.length; i++) if (hour >= SLOTS[i]) slot = i;
if (hour < SLOTS[0]) slot = SLOTS.length - 1;
const start = new Date((campaign.campaignStart || '2026-11-19') + 'T00:00:00Z');
// a run that starts after midnight and before 08:21 belongs to the previous day's 20:21 slot
const day = Math.max(0, Math.floor((riyadh - start) / 86400e3) - (hour < SLOTS[0] ? 1 : 0));
const runNo = day * SLOTS.length + slot;
const out = {
  riyadh: riyadh.toISOString().slice(0, 16).replace('T', ' '),
  slot: `${String(SLOTS[slot]).padStart(2, '0')}:21`,
  market: market.length ? market[slot % market.length] : null,
  selfVerify: self.length ? self[runNo % self.length] : null,
  ceilingPerStore: (rules.discovery || {}).ceilingPerStore || null,
  stopDiscoveryAtMinute: (rules.discovery || {}).stopDiscoveryAtMinute || null,
  toolCallBudget: (rules.discovery || {}).toolCallBudget || null,   // BLD-47: the run log's `budget:` line is measured against it (RUNBOOK §5)
};
console.log(JSON.stringify(out));
