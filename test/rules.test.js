import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { makeSeed, CONFIG, ASOF } from '../src/seed.js';
import * as R from '../src/rules.js';

const data = makeSeed();
const P = data.PLANTED;
const sorted = (a) => [...a].sort();

test('seed is deterministic and roughly the planned size', () => {
  assert.equal(JSON.stringify(makeSeed()), JSON.stringify(data));
  assert.ok(data.pkg.length >= 1400 && data.pkg.length <= 1600, `pkg ${data.pkg.length}`);
  assert.ok(data.mb51.length >= 3000, `mb51 ${data.mb51.length}`);
  assert.equal(new Set(data.pkg.map((r) => r.partNo)).size, data.pkg.length, 'unique part numbers');
  const cols = Object.keys(data.pkg[0]);
  assert.equal(cols.length, 34);
});

test('R2–R5 mapping rules', () => {
  assert.deepEqual(R.parseStack('2/1'), { ok: true, value: 3 });
  assert.deepEqual(R.parseStack('4'), { ok: true, value: 4 });
  assert.equal(R.parseStack('2-1').ok, false);
  assert.equal(R.parseWeight('0.85 kg').value, 850);
  assert.equal(R.parseWeight('1.2').flag, 'WEIGHT_UNIT_CHECK');
  assert.equal(R.parseDim('23.6').flag, 'UNIT_CHECK');
  assert.equal(R.parseDim('600 mm').value, 600);
  assert.equal(R.confirmInches('23.6'), 599.4);
  assert.equal(R.matchSupplier('ACME LIGHTING, INC.', data.supplierMaster).vendorName, 'Acme Lighting');
  assert.equal(R.matchSupplier('Zenith Mouldings Ltd', data.supplierMaster).ok, false);
});

test('R7 detects exactly the planted systematic errors', () => {
  const { report, changes } = R.detectSystemErrors(data, CONFIG);
  assert.deepEqual(sorted(report.WEIGHT_KG.map((x) => x.partNo)), sorted(P.weightKg));
  assert.deepEqual(sorted(report.STACK_FIXED.map((x) => x.partNo)), sorted(P.stackFixed.parts));
  assert.deepEqual(sorted(report.DIM_SWAP.map((x) => sorted(x.pair).join('|'))), sorted(P.dimSwap.map((p) => sorted(p).join('|'))));
  // applying the fixes leaves nothing to detect
  const fixed = R.applyChanges(data.pkg, changes, ASOF);
  const again = R.detectSystemErrors({ ...data, pkg: fixed }, CONFIG).report;
  assert.equal(again.WEIGHT_KG.length + again.STACK_FIXED.length + again.DIM_SWAP.length, 0);
  // rows without a signed form are never corrected
  const formParts = new Set(data.forms.map((f) => f.partNo));
  assert.ok(changes.every((c) => formParts.has(c.partNo)));
});

test('R8 service parts: tiers and auto-add only for Tier A service matches', () => {
  const { report, changes } = R.serviceGaps(data, ASOF);
  const g = P.serviceGaps;
  const by = new Map(report.map((x) => [x.partNo, x]));
  for (const x of g.autoAdd) { assert.equal(by.get(x.partNo).tier, 'A'); assert.equal(by.get(x.partNo).auto, true); assert.equal(by.get(x.partNo).matchedTo, x.matchedTo); }
  for (const x of g.tierAProduction) { assert.equal(by.get(x.partNo).tier, 'A'); assert.equal(by.get(x.partNo).auto, false); }
  for (const x of g.tierB) assert.equal(by.get(x.partNo).tier, 'B');
  for (const x of g.tierC) assert.equal(by.get(x.partNo).tier, 'C');
  assert.equal(changes.length, g.autoAdd.length);
  assert.ok(changes.every((c) => c.row.product.endsWith('[similar-part-match-needed]')));
});

test('R9 chains: multi-hop, fork by latest date, tie and cycle go to manual', () => {
  const { chains, manual } = R.resolveChains(data.sq01);
  const ch = chains.find((c) => c.start === P.chain[0]);
  assert.deepEqual(ch.path, P.chain);
  assert.equal(chains.find((c) => c.start === P.fork.old).final, P.fork.adopted);
  assert.ok(manual.some((m) => m.kind === 'FORK_TIE' && m.at === P.forkTie.old));
  assert.ok(manual.some((m) => m.kind === 'CYCLE' && P.cycle.includes(m.at)));
});

test('R10 sync review saves nothing; apply fills both ways and copies the location', () => {
  const before = JSON.stringify(data.pkg);
  const { changes, whChanges, report } = R.syncReview(data);
  assert.equal(JSON.stringify(data.pkg), before, 'review does not mutate');
  for (const f of P.sync.fill) assert.ok(changes.some((c) => c.partNo === f.to && c.field === f.field), `${f.field} → ${f.to}`);
  assert.ok(whChanges.some((w) => w.material === P.sync.whCopy.new && w.copiedFrom === P.sync.whCopy.old));
  const pkg2 = R.applyChanges(data.pkg, changes, ASOF);
  const wh2 = R.applyWh(data.wh, whChanges);
  assert.ok(wh2.some((w) => w.material === P.sync.whCopy.old), 'old row kept');
  assert.ok(pkg2.find((r) => r.partNo === P.sync.whCopy.old).tags.includes(`old → ${P.sync.whCopy.new}`));
  assert.ok(report.length >= P.sync.fill.length + 1);
});

test('R11 lifecycle: obsolete wins, receipts are not usage, unconfirmed open orders flagged, all four quadrants filled', () => {
  const lc = R.lifecycle(data, CONFIG, ASOF);
  const st = new Map(lc.map((x) => [x.partNo, x]));
  for (const o of P.obsolete) assert.equal(st.get(o.partNo).state, 'Obsolete', o.mark);
  assert.equal(st.get(P.receiptNotUsage).state, 'Phase-in');
  for (const pn of P.ooUnconfirmed) assert.equal(st.get(pn).ooUnconfirmed, true);
  const counts = {};
  for (const x of lc) counts[x.state] = (counts[x.state] || 0) + 1;
  for (const s of ['Active', 'Phase-in', 'Run-out', 'Inactive', 'Obsolete']) assert.ok(counts[s] >= 3, `${s}: ${counts[s]}`);
  assert.equal(R.obsoleteMark('BRACKET OBSOLTE'), 'OBSOLTE');
  assert.equal(R.obsoleteMark('ABSORBER LH'), null);
});

test('R12 changeover check and R13 planning delta', () => {
  const lc = R.lifecycle(data, CONFIG, ASOF);
  const tc = R.transitionCheck(data, lc);
  assert.ok(tc.some((x) => x.old === P.transitionOk.old && x.verdict === 'Normal changeover'));
  assert.ok(tc.some((x) => x.old === P.transitionCheck.old && x.verdict === 'Check'));
  const d = R.planningDelta(data.matplan, ASOF);
  assert.deepEqual(sorted(d.added.map((m) => m.material)), sorted(P.planningAdded));
  assert.deepEqual(sorted(d.removed.map((m) => m.material)), sorted(P.planningRemoved));
});

test('R14–R16, R18 warehouse, slots, DOH badge, showcase order', () => {
  assert.equal(R.stackCount(150, CONFIG), 4);
  assert.equal(R.stackCount(300, CONFIG), 2);
  assert.equal(R.stackCount(1150, CONFIG), 0);
  const lc = R.lifecycle(data, CONFIG, ASOF);
  const slots = R.slotCandidates(data.wh, lc, ASOF);
  assert.ok(slots.rows.length >= 5 && slots.rows.every((x) => x.state === 'Obsolete' || x.state === 'Inactive'));
  const plan = new Map(data.matplan.filter((m) => m.date === ASOF).map((m) => [m.material, m]));
  for (const pn of P.doh.zero) assert.equal(R.dohStatus(plan.get(pn), CONFIG).status, 'EXCLUDED');
  for (const pn of P.doh.supplierBlank) assert.equal(R.dohStatus(plan.get(pn), CONFIG).status, 'EXCLUDED');
  for (const pn of [...P.doh.placeholder999, ...P.doh.negative]) assert.equal(R.dohStatus(plan.get(pn), CONFIG).status, 'NEEDS_REVIEW');
  const order = R.showcaseOrder(data, CONFIG, ASOF);
  assert.ok(order.every((x) => x.area === 'HIGHBAY' || x.area === 'VLM'));
  const firstNonRed = order.findIndex((x) => x.status !== 'RED');
  assert.ok(firstNonRed > 0, 'Red parts exist and come first');
  assert.ok(order.slice(firstNonRed).every((x) => x.status !== 'RED'));
  const reds = order.slice(0, firstNonRed).map((x) => x.doh);
  assert.deepEqual(reds, [...reds].sort((a, b) => a - b), 'Red parts by DOH, lowest first');
});

// Forms: read the committed PDFs' text layer and ingest them.
let hasPdftotext = true;
try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch { hasPdftotext = false; }

test('R6 form ingest on the sample PDFs', { skip: !hasPdftotext && 'pdftotext not installed' }, () => {
  for (const nf of P.newForms) {
    const text = execFileSync('pdftotext', ['-layout', new URL(`../samples/forms/${nf.file}`, import.meta.url).pathname, '-'], { encoding: 'utf8' });
    const fields = R.parseFormText(text);
    assert.equal(fields.partNo, nf.partNo, nf.file);
    const { report, changes } = R.ingestForm(data, { file: nf.file, fields }, ASOF);
    const e = nf.expect;
    if (e.newRows) assert.deepEqual(report.newRows.map((x) => x.partNo), e.newRows, nf.file);
    if (e.autoFilled) for (const f of e.autoFilled) assert.ok(report.autoFilled.some((x) => x.field === f), `${nf.file} autofill ${f}`);
    if (e.conflicts) assert.deepEqual(report.conflicts.map((x) => x.field), e.conflicts, nf.file);
    if (e.held) for (const f of e.held) assert.ok(report.held.some((x) => x.field === f), `${nf.file} held ${f}`);
    if (e.values) {
      const row = R.applyChanges(data.pkg, changes, ASOF).find((r) => r.partNo === nf.partNo);
      for (const [k, v] of Object.entries(e.values)) assert.equal(row[k], v, `${nf.file} ${k}`);
    }
    if (nf.case === 'UNSIGNED_HELD') assert.equal(report.conflicts.length, 0, 'unsigned never overwrites');
    if (nf.case === 'UNIT_CHECK') assert.ok(changes.some((c) => c.op === 'flag' && c.flag === 'UNIT_CHECK'));
  }
});
