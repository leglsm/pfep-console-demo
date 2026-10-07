// Warehouse flow (R28–R31) and PU size review (R32).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSeed } from '../src/seed.js';
import * as R from '../src/rules.js';
import { flowDays, flowPlan, locator, dayKpis, parseTime, pacing } from '../src/flow-plan.js';

const d = makeSeed();
const days = flowDays(d.flowlog);
const keys = [...days.keys()].sort();
const locate = locator(d.wh);

test('flow log: 22 working days ending on the as-of date, 101 and 261 only, entry times parse', () => {
  assert.equal(keys.length, 22);
  assert.equal(keys[keys.length - 1], d.asOf);
  assert.ok(keys.every((k) => ![0, 6].includes(new Date(`${k}T00:00:00Z`).getUTCDay())), 'no weekend days');
  assert.ok(d.flowlog.every((r) => ['101', '261'].includes(r.mvt)));
  assert.ok(d.flowlog.every((r) => parseTime(r.time) !== null));
  assert.equal(parseTime('12:05:00 AM'), 300); assert.equal(parseTime('1:30 PM'), 13.5 * 3600); assert.equal(parseTime(0.5), 43200);
});

test('R28 one material document = one truck, arriving 10 min before its first line', () => {
  const day = days.get(d.asOf), plan = flowPlan(day, locate);
  assert.equal(plan.trucks.length, new Set(day.gr.map((l) => l.doc)).size);
  assert.equal(plan.trucks.reduce((n, t) => n + t.lines.length, 0), day.gr.length);
  for (const t of plan.trucks) assert.equal(t.arrive, Math.min(...t.lines.map((l) => l.sec)) - 600);
});

test('R29 destination = current location: high-bay, else VLM, else floor', () => {
  const plan = flowPlan(days.get(d.asOf), locate);
  const wh = new Map(d.wh.map((w) => [w.material, w.area]));
  for (const l of plan.lines) assert.equal(l.kind, wh.get(l.material) === 'HIGHBAY' ? 'hb' : wh.get(l.material) === 'VLM' ? 'vlm' : 'floor');
  const { hb, vlm, floor } = plan.counts;
  assert.equal(hb + vlm + floor, plan.lines.length);
  assert.ok(hb > vlm && floor > 0, 'mostly high-bay, some floor');
});

test('R30 tugger runs group located 261 lines (≤ 20 min from the first stop, ≤ 3 stops); no 261 → simulated', () => {
  const plan = flowPlan(days.get(d.asOf), locate);
  assert.equal(plan.simulated, false);
  for (const r of plan.runs) { assert.ok(r.stops.length <= 3); assert.ok(r.stops.every((s) => s.sec - r.stops[0].sec <= 1200 && s.kind !== 'floor')); }
  const noIssues = flowPlan({ ...days.get(d.asOf), gi: [] }, locate, ['21056556']);
  assert.equal(noIssues.simulated, true);
  assert.ok(noIssues.runs.length > 0 && noIssues.runs.every((r) => r.simulated));
});

test('R31 day KPIs come from the data only and add up', () => {
  const plan = flowPlan(days.get(d.asOf), locate);
  const plan2 = new Map(d.matplan.filter((m) => m.date === d.asOf).map((m) => [m.material, m]));
  const k = dayKpis(plan, (pn) => (plan2.get(pn) ? R.dohStatus(plan2.get(pn), d.config).status : 'NONE'));
  assert.equal(k.trucks, plan.trucks.length);
  assert.equal(k.lines, plan.lines.length);
  assert.equal(k.status.RED + k.status.ORANGE + k.status.GREEN + k.status.OTHER, k.parts);
  assert.ok(k.window[0] < k.window[1] && k.peakLines > 0 && k.onSite >= 1);
  assert.ok(k.floorParts.every((p) => p.kind === 'floor'));
  assert.ok(!('travelTime' in k) && !('dockWait' in k), 'nothing from the simulated fleet');
  const p = pacing(plan); assert.ok(p.fleet >= 3 && p.fleet <= 8 && p.realDay >= 360);
});

test('R32 PU size review flags what the 3D view cannot draw true to size, and only that', () => {
  const pk = new Map(d.pkg.map((r) => [r.partNo, r]));
  const P = d.PLANTED.puReview;
  assert.match(R.puReview(pk.get(P.tall), d.config).join(), /over the 26" level/);
  assert.match(R.puReview(pk.get(P.wide), d.config).join(), /wider than a lane/);
  assert.match(R.puReview(pk.get(P.deep), d.config).join(), /deeper than the rack/);
  assert.match(R.puReview(pk.get(P.noDims), d.config).join(), /No PU dimensions/);
  const flagged = d.wh.filter((w) => w.area === 'HIGHBAY' && R.puReview(pk.get(w.material), d.config).length).map((w) => w.material).sort();
  assert.deepEqual(flagged, Object.values(P).sort());
});
