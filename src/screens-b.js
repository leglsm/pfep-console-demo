// Screens: Supersession, Lifecycle, Warehouse 3D (+ showcase), Part lookup, Demo guide.
import * as R from './rules.js';
import { state, commit } from './state.js';
import { quadrant } from './screens-a.js';
import { h, fill, fmt, badge, lifeBadge, dohBadge, pnLink, table, empty, section, toast, steps } from './ui.js';
import { startShowcase, openPartShowcase } from './showcase.js';

const D = () => state.data;
const cfg = () => state.data.config;
const rerender = (el) => el.dispatchEvent(new CustomEvent('rerender', { bubbles: true }));

// ---------------------------------------------------------------- Supersession
let syncPreview = null;
export function supersession(root) {
  const d = D();
  const { chains, manual } = R.resolveChains(d.sq01);
  const node = (pn, cls = '') => h('a', { class: `node ${cls}`, href: `#lookup/${pn}` }, pn);
  const pathEl = (c) => h('span', { class: 'chain' }, c.path.flatMap((pn, i) => [i ? h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→') : null, node(pn, i === c.path.length - 1 && c.status === 'OK' ? 'final' : c.status === 'CYCLE' && i === c.path.length - 1 ? 'bad' : '')]));
  const interesting = chains.filter((c) => c.path.length > 2 || c.forks.length || c.status !== 'OK');
  const simple = chains.length - interesting.length;
  const lc = R.lifecycle(d, cfg(), d.asOf);
  const tc = R.transitionCheck(d, lc);

  const syncBox = h('div', {});
  const drawSync = () => {
    if (!syncPreview) { fill(syncBox, h('button', { class: 'btn', onclick: () => { syncPreview = R.syncReview(D()); drawSync(); } }, 'Run sync review')); return; }
    const { changes, whChanges, report } = syncPreview;
    fill(syncBox, 
      report.length ? table([
        { key: 'old', label: 'Old', render: (x) => pnLink(x.old) }, { key: 'new', label: 'New', render: (x) => pnLink(x.new) },
        { key: 'field', label: 'Field' }, { key: 'direction', label: 'Copy' }, { key: 'value', label: 'Value' },
      ], report, { label: 'Sync preview' }) : empty('Nothing to copy — old and new rows already agree.'),
      h('p', { class: 'muted small' }, 'Preview only — nothing is saved until you apply. Old part numbers stay visible and get an "old → new" tag.'),
      h('div', { class: 'apply-box' },
        h('button', { class: 'btn', disabled: !report.length, onclick: () => { commit({ kind: 'SYNC', label: `Old/new sync: ${report.length} field(s)`, pkg: changes, wh: whChanges }); toast(`Applied ${report.length} synced field(s)`); syncPreview = null; rerender(root); } }, `Apply reviewed changes (${report.length})`),
        h('button', { class: 'btn ghost', onclick: () => { syncPreview = null; drawSync(); } }, 'Discard preview')),
    );
  };
  root.append(
    section('Supersession chains (SQ01)', 'Old material → new material, followed hop by hop. A fork takes the most recently created link; a tie or a loop goes to a person.',
      h('div', { class: 'banner info' }, h('strong', {}, 'Lineage, not status. '), 'During a changeover both numbers are alive, so the old row is never hidden — status comes from orders and usage (Lifecycle).'),
      table([
        { key: 'path', label: 'Chain', render: pathEl },
        { key: 'status', label: 'Result', render: (c) => (c.status === 'OK' ? badge(`Final ${c.final}`, 'b-green') : badge(c.status === 'CYCLE' ? 'Cycle — review' : 'Fork tie — review', 'b-red')) },
        { key: 'forks', label: 'Note', render: (c) => (c.status === 'CYCLE' ? 'Loops back to an earlier number' : c.forks.length ? c.forks.map((f) => (f.kind === 'latest' ? `Fork at ${f.at}: took ${f.adopted} (newer)` : `Fork at ${f.at}: same date — ${f.options.join(' / ')}`)).join('; ') : c.path.length > 2 ? `${c.path.length - 1} hops` : '') },
      ], interesting, { label: 'Chains' }),
      h('p', { class: 'muted small' }, `${simple} more single-hop pairs resolve without review.`),
      manual.length ? h('div', {}, h('h4', {}, `Manual review (${manual.length})`), table([
        { key: 'kind', label: 'Case', render: (m) => badge(m.kind === 'CYCLE' ? 'Cycle' : 'Fork tie', 'b-red') },
        { key: 'path', label: 'Where', render: (m) => (m.kind === 'CYCLE' ? h('span', { class: 'chain' }, m.path.flatMap((pn, i) => [i ? h('span', { class: 'arrow' }, '→') : null, node(pn, i === m.path.length - 1 ? 'bad' : '')])) : h('span', {}, node(m.at), ' → ', m.options.map((o, i) => [i ? ' or ' : '', node(o)]))) },
        { key: 'why', label: 'Why a person decides', render: (m) => (m.kind === 'CYCLE' ? 'Links point back to an earlier number — chain stopped' : 'Two new numbers created the same day — no rule can pick') },
      ], manual, { label: 'Manual review' })) : null,
    ),
    h('div', { class: 'grid2' },
      section('Old / new field sync', 'Blank fields are filled from the partner row in both directions; a warehouse location held only by the old number is copied to the new one.', syncBox),
      section('Changeover check', 'Reading the pair with Lifecycle: old Run-out + new Phase-in is a normal changeover; an Inactive old number whose new number is not Phase-in needs a look.',
        tc.length ? table([
          { key: 'old', label: 'Old', render: (x) => h('span', {}, pnLink(x.old), ' ', lifeBadge(x.oldState)) },
          { key: 'new', label: 'New', render: (x) => h('span', {}, pnLink(x.new), ' ', lifeBadge(x.newState)) },
          { key: 'verdict', label: 'Verdict', render: (x) => badge(x.verdict, x.verdict === 'Check' ? 'b-orange' : 'b-green') },
        ], tc, { label: 'Changeover check' }) : empty('No pairs to read.')),
    ),
  );
  drawSync();
}

// ---------------------------------------------------------------- Lifecycle
export function lifecycle(root, ctx) {
  const d = D();
  const lc = R.lifecycle(d, cfg(), d.asOf);
  const counts = { Active: 0, 'Phase-in': 0, 'Run-out': 0, Inactive: 0, Obsolete: 0 };
  lc.forEach((x) => counts[x.state]++);
  const sel = ['Active', 'Phase-in', 'Run-out', 'Inactive', 'Obsolete'].includes(ctx.param) ? ctx.param : 'Inactive';
  const plan = new Map(d.matplan.filter((m) => m.date === d.asOf).map((m) => [m.material, m]));
  const rows = lc.filter((x) => x.state === sel);
  const delta = R.planningDelta(d.matplan, d.asOf);
  const unconf = lc.filter((x) => x.ooUnconfirmed);
  const q = quadrant(counts, true);
  q.querySelectorAll('a.q').forEach((a) => { if (a.getAttribute('href') === `#lifecycle/${sel}`) a.classList.add('on'); });
  root.append(
    h('div', { class: 'grid2' },
      section('Part lifecycle 2×2', `Every part on today's planning list (${lc.length.toLocaleString('en-US')}). Obsolete wording wins first; then open orders × usage in the last ${cfg().recentDays} days. Receipts (101/102) are not usage.`, q),
      section("Planning list vs yesterday", 'A part that joins the list is an introduction signal; one that drops off is an end-of-production or changeover signal.',
        h('h4', {}, `Added today (${delta.added.length})`),
        delta.added.length ? table([{ key: 'material', label: 'Part', render: (m) => pnLink(m.material) }, { key: 'description', label: 'Description' }, { key: 'program', label: 'Program' }], delta.added, { label: 'Added' }) : empty('None'),
        h('h4', {}, `Dropped today (${delta.removed.length})`),
        delta.removed.length ? table([{ key: 'material', label: 'Part', render: (m) => pnLink(m.material) }, { key: 'description', label: 'Description' }, { key: 'program', label: 'Program' }], delta.removed, { label: 'Dropped' }) : empty('None'),
      ),
    ),
    section(`${sel} (${rows.length})`, sel === 'Obsolete' ? 'Marked OBSOLETE / OBSO / OBSL or a one-letter typo of OBSOLETE — even with open orders or usage.' : 'Click a quadrant above to switch lists.',
      table([
        { key: 'partNo', label: 'Part', render: (x) => pnLink(x.partNo) },
        { key: 'description', label: 'Description', cls: 'wide' },
        { key: 'program', label: 'Program' },
        { key: 'reason', label: 'Why' },
        { key: 'doh', label: 'DOH', render: (x) => { const m = plan.get(x.partNo); return m ? h('span', {}, fmt(m.doh), ' ', dohBadge(R.dohStatus(m, cfg()).status)) : '—'; } },
        { key: 'flag', label: 'Open orders check', render: (x) => (x.ooUnconfirmed ? badge(`only ${x.weeksSeen} of ${cfg().ooWeeks} weeks seen`, 'b-orange') : `${x.weeksSeen} weeks`) },
      ], rows.slice(0, 300), { label: `${sel} parts` }),
      rows.length > 300 ? h('p', { class: 'muted small' }, `Showing 300 of ${rows.length}.`) : null,
    ),
    unconf.length ? section('"No open orders" not confirmed yet', `Zero open orders count as "none" only after ${cfg().ooWeeks} weekly snapshots in a row.`,
      table([{ key: 'partNo', label: 'Part', render: (x) => pnLink(x.partNo) }, { key: 'state', label: 'Current reading', render: (x) => lifeBadge(x.state) }, { key: 'weeksSeen', label: 'Weeks seen', num: true }], unconf, { label: 'Unconfirmed' })) : null,
  );
}

// ---------------------------------------------------------------- Warehouse 3D
const whView = { mode: 'life', slots: true };
export function warehouse(root, ctx) {
  const d = D();
  const lc = R.lifecycle(d, cfg(), d.asOf);
  const slots = R.slotCandidates(d.wh, lc, d.asOf);
  const slotSet = new Set(slots.rows.map((x) => x.partNo));
  const canvasBox = h('div', { class: 'wh-canvas', 'aria-label': '3D high-bay warehouse. Drag to rotate, scroll to zoom, click a box for details.' });
  const tip = h('div', { class: 'wh-tip', hidden: true });
  canvasBox.append(tip);
  const info = h('div', {});
  const legend = h('div', { class: 'legend' });
  let view = null;
  const drawLegend = () => {
    const items = whView.mode === 'life' ? [['Active', '#2e9e66'], ['Phase-in', '#3a6fd8'], ['Run-out', '#e08a2b'], ['Inactive', '#4f5d75'], ['Obsolete', '#9b5532'], ['Not on plan', '#b8c0cc']]
      : [['Red', '#d64545'], ['Green', '#2e9e66'], ['Orange (excess)', '#e08a2b'], ['Needs review', '#8a5cd6'], ['Excluded / not on plan', '#b8c0cc']];
    fill(legend, ...items.map(([t, c]) => h('span', {}, h('i', { style: { background: c } }), t)));
  };
  const showInfo = (pn) => {
    if (!pn || pn === '__VLM__') { fill(info, pn === '__VLM__' ? h('p', { class: 'muted small' }, `VLM tower — ${d.wh.filter((w) => w.area === 'VLM').length} small parts in trays.`) : h('p', { class: 'muted small' }, 'Click a box to see the part.')); view?.select(null); return; }
    const p = d.pkg.find((r) => r.partNo === pn); const w = d.wh.find((x) => x.material === pn); const s = view?.statusOf(pn);
    view?.select(pn);
    fill(info, 
      h('h4', {}, pn),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Product'), h('dd', {}, fmt(p?.product)),
        h('dt', {}, 'Location'), h('dd', {}, w ? R.whLabel(w) : '—'),
        h('dt', {}, 'PU'), h('dd', {}, p ? `${fmt(p.puL)} × ${fmt(p.puW)} × ${fmt(p.puH)} mm` : '—'),
        h('dt', {}, 'Boxes / lane'), h('dd', {}, p ? `${Math.max(1, R.stackCount(p.puH, cfg()))} (level ${cfg().levelHeightIn}" ÷ PU height, max ${cfg().maxStack})` : '—'),
        h('dt', {}, 'Lifecycle'), h('dd', {}, s ? lifeBadge(s.life === 'none' ? 'Not on plan' : s.life) : '—'),
        h('dt', {}, 'DOH'), h('dd', {}, s ? h('span', {}, fmt(s.dohValue), ' ', dohBadge(s.doh)) : '—'),
        w && w.area === 'HIGHBAY' && R.puReview(p, cfg()).length ? [h('dt', {}, '3D'), h('dd', { class: 'review-pu' }, '⚠ Review PU size: ', R.puReview(p, cfg()).join(' · '))] : null),
      h('p', {}, h('a', { href: `#lookup/${pn}` }, 'Open part lookup →')),
    );
  };
  const seg = (opts, key, on) => h('div', { class: 'seg', role: 'group' }, opts.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(whView[key] === v), onclick: (e) => { whView[key] = v; e.target.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.target))); on(v); } }, t)));
  root.append(
    h('div', { class: 'toolbar' },
      seg([['life', 'Color: lifecycle'], ['doh', 'Color: DOH status']], 'mode', (v) => { view?.setMode(v); drawLegend(); }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: whView.slots, onchange: (e) => { whView.slots = e.target.checked; view?.setHighlight(whView.slots ? slotSet : null); } }), 'Highlight lanes that can be freed'),
      h('button', { class: 'btn', onclick: () => startShowcase({ gesture: true }) }, 'Start showcase (TV)')),
    legend,
    h('div', { class: 'wh-layout' },
      h('div', {}, canvasBox, h('p', { class: 'muted small' }, `Lines A | B, C | D, E | F (back-to-back racks, 9 ft aisles), 24 bays × 4 lanes on level 1. One part per lane; boxes per lane = min(${cfg().maxStack}, ${cfg().levelHeightIn}" ÷ PU height). Levels 2–5 are pallet storage (shown full in the showcase). VLM towers V1–V3 on the right.`)),
      h('div', {},
        section('Slot reallocation', `${slots.lanes} lanes held by ${slots.rows.length} obsolete or inactive parts. Listed with the reason — the move plan stays a person's call.`,
          h('div', { class: 'slot-list' }, table([
            { key: 'partNo', label: 'Part', render: (x) => h('a', { href: '#', class: 'pn', onclick: (e) => { e.preventDefault(); view?.focusPart(x.partNo); showInfo(x.partNo); } }, x.partNo) },
            { key: 'location', label: 'Location' }, { key: 'lanes', label: 'Lanes', num: true }, { key: 'state', label: 'State', render: (x) => lifeBadge(x.state) },
          ], slots.rows, { label: 'Slot candidates' }))),
        section('Selected part', null, info),
      ),
    ),
  );
  drawLegend(); showInfo(null);
  ctx.mount3d(canvasBox, { mode: whView.mode }).then((v) => {
    view = v; if (!v) return;
    v.setHighlight(whView.slots ? slotSet : null);
    v.onPick((pn) => showInfo(pn));
    v.onHover((pn) => { if (pn && pn !== '__VLM__') { tip.hidden = false; tip.textContent = `${pn} · ${R.whLabel(d.wh.find((w) => w.material === pn))}`; } else tip.hidden = true; });
    if (ctx.param === 'showcase') startShowcase({});
  });
}

// ---------------------------------------------------------------- Part lookup
export function lookup(root, ctx) {
  const d = D();
  const P = d.PLANTED;
  const examples = [
    [P.weightKg[0], 'weight in kg'], [P.dimSwap[0][0], 'swapped dims'], [P.chain[1], 'middle of a chain'],
    [P.obsolete.find((o) => o.mark === 'OBSL')?.partNo, 'marked OBSL'], [P.sync.whCopy.new, 'new number, no location'], [P.transitionCheck.old, 'changeover check'],
  ].filter((x) => x[0]);
  const input = h('input', { type: 'search', placeholder: 'Part number, e.g. ' + examples[0][0], value: ctx.param || '', 'aria-label': 'Part number', inputmode: 'numeric' });
  const out = h('div', {});
  const go = (pn) => { const v = R.normPn(pn); if (location.hash !== `#lookup/${v}`) location.hash = `#lookup/${v}`; else show(v); };
  const show = (pn) => { fill(out, pn ? partCard(pn) : h('p', { class: 'muted' }, 'Type a part number — the answer to "where is it, is it alive, how is it packed?" in one place.')); };
  root.append(
    section('Part lookup', 'One part number across every source. Values that disagree between sources are marked as mismatch.',
      h('form', { class: 'toolbar lookup-form', onsubmit: (e) => { e.preventDefault(); go(input.value); } }, input, h('button', { class: 'btn', type: 'submit' }, 'Look up')),
      h('div', { class: 'chips' }, h('span', { class: 'muted small' }, 'Try:'), examples.map(([pn, t]) => h('a', { href: `#lookup/${pn}`, class: 'badge b-muted', style: { textDecoration: 'none' } }, `${pn} · ${t}`)))),
    out,
  );
  show(R.normPn(ctx.param));
}

function partCard(pn) {
  const d = D(), c = cfg();
  const p = d.pkg.find((r) => r.partNo === pn);
  const vend = d.vendors.find((v) => v.material === pn);
  const w = d.wh.find((x) => x.material === pn);
  const m0 = d.matplan.find((m) => m.date === d.asOf && m.material === pn);
  const lc = R.lifecycle(d, c, d.asOf).find((x) => x.partNo === pn);
  const moves = d.mb51.filter((m) => m.material === pn).slice(-8).reverse();
  const oo = d.openorders.filter((o) => o.material === pn).sort((a, b) => (a.week < b.week ? 1 : -1));
  const asOld = d.sq01.filter((e) => e.oldMaterial === pn), asNew = d.sq01.filter((e) => e.newMaterial === pn);
  const form = [...d.forms].reverse().find((f) => f.partNo === pn && f.signed);
  if (!p && !vend && !w && !m0 && !moves.length && !asOld.length && !asNew.length) return section(pn, null, empty('Not found in any source.'));

  const mism = [];
  if (p && vend && p.supplierCode && vend.vendorNo !== p.supplierCode) mism.push(['Supplier code', `PFEP ${p.supplierCode}`, `Vendor master ${vend.vendorNo}`]);
  if (p && m0 && m0.supplier && p.supplierName && m0.supplier !== p.supplierName && m0.supplier !== 'In-house') mism.push(['Supplier', `PFEP ${p.supplierName}`, `Planning ${m0.supplier}`]);
  if (p && m0 && m0.program && m0.program !== p.program) mism.push(['Program', `PFEP ${p.program}`, `Planning ${m0.program}`]);
  if (p && form) {
    const fv = R.formValues(form, d.supplierMaster);
    for (const f of ['puL', 'puW', 'puH', 'partsPerPu', 'stackTrailer', 'weightG', 'huType']) if (fv[f] !== undefined && !R.isBlank(p[f]) && !R.sameValue(p[f], fv[f])) mism.push([f, `PFEP ${fmt(p[f])}`, `Signed form ${fmt(fv[f])}`]);
  }
  const dohS = m0 ? R.dohStatus(m0, c) : null;
  const kv = (pairs) => h('dl', { class: 'kv' }, pairs.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v === undefined || v === null || v === '' ? '—' : v)]));
  return h('div', {},
    h('div', { class: 'panel' },
      h('div', { class: 'row-actions', style: { marginTop: 0 } },
        h('div', {}, h('h2', {}, pn), h('p', { class: 'muted', style: { margin: '.2rem 0 0' } }, p?.product || m0?.description || moves[0]?.description || '')),
        h('div', { class: 'chips' }, lc ? lifeBadge(lc.state) : badge('Not on planning list', 'b-muted'), dohS ? dohBadge(dohS.status) : null, w ? badge(R.whLabel(w), 'b-muted') : badge('No warehouse location', 'b-orange'), p?.tags?.map((t) => badge(t, 'b-muted')))),
      mism.length ? h('div', { class: 'banner bad', role: 'alert' }, h('strong', {}, `${mism.length} mismatch${mism.length > 1 ? 'es' : ''}: `), mism.map(([f, a, b]) => `${f} — ${a} vs ${b}`).join(' · ')) : h('p', { class: 'muted small' }, 'Sources agree.'),
    ),
    h('div', { class: 'grid3' },
      section('Packaging (PFEP)', p ? (p.signedForm ? `Signed form ${p.signedForm}` : 'No signed form on file') : 'No PFEP row', p ? kv([
        ['PU', `${p.puType || '—'} · ${fmt(p.puL)} × ${fmt(p.puW)} × ${fmt(p.puH)} mm`], ['Parts / PU', fmt(p.partsPerPu)], ['PU / HU', fmt(p.puPerHu)], ['HU type', fmt(p.huType)],
        ['Stack trailer / WH', `${fmt(p.stackTrailer)} / ${fmt(p.stackWarehouse)}`], ['Part weight', p.weightG == null ? '—' : `${fmt(p.weightG)} g`], ['Returnable', fmt(p.returnable)], ['Flags', p.flags?.length ? p.flags.map((f) => badge(f, 'b-orange')) : '—'],
        ...(w && w.area === 'HIGHBAY' && R.puReview(p, c).length ? [['3D', h('span', { class: 'review-pu' }, '⚠ Review PU size: ', R.puReview(p, c).join(' · '))]] : []), // R32
      ]) : empty('—')),
      section('Status', lc ? lc.reason : 'Not on today’s planning list', kv([
        ['Lifecycle', lc ? lifeBadge(lc.state) : '—'], ['DOH', m0 ? h('span', {}, fmt(m0.doh), ' ', dohBadge(dohS.status), ' ', h('span', { class: 'muted small' }, dohS.reason)) : '—'], ['Stock', m0 ? fmt(m0.stock) : '—'], ['Planner', m0?.planner],
        ['Open orders', oo.length ? oo.map((o) => `${o.week}: ${o.qty}`).join(' · ') : '—'],
      ])),
      section('Where & who', null, kv([
        ['Location', w ? h('span', {}, R.whLabel(w), ' ', w.area !== 'NOT-WH' ? h('button', { class: 'btn ghost btn-sm', type: 'button', onclick: () => openPartShowcase(pn) }, 'Show in 3D') : null) : 'None'], ['Supplier', p ? `${fmt(p.supplierName)} (${fmt(p.supplierCode)})` : '—'], ['Vendor master', vend ? `${vend.vendorName} (${vend.vendorNo})` : '—'],
        ['Replaced by', asOld.length ? asOld.map((e) => h('span', {}, pnLink(e.newMaterial), ` (${e.createdOn}) `)) : '—'], ['Replaces', asNew.length ? asNew.map((e) => h('span', {}, pnLink(e.oldMaterial), ` (${e.createdOn}) `)) : '—'],
      ])),
    ),
    section('Recent movements (MB51)', '261 = consumption, 101 = goods receipt (not counted as usage).',
      moves.length ? table([{ key: 'postingDate', label: 'Date' }, { key: 'mvt', label: 'Mvt' }, { key: 'qty', label: 'Qty', num: true }, { key: 'sloc', label: 'SLoc' }], moves, { label: 'Movements' }) : empty('No movements in 90 days.')),
  );
}

// ---------------------------------------------------------------- Demo guide
export function guide(root, ctx) {
  const P = D().PLANTED;
  const sc = (id, title, link, list) => h('div', { class: 'panel' }, h('h3', {}, h('span', { class: 'muted' }, `${id} · `), title), steps(list), h('p', {}, h('a', { href: link }, 'Go →')));
  root.append(
    h('div', { class: 'intro' }, h('p', { class: 'eyebrow' }, 'Demo guide'), h('h1', {}, 'Package Database Console'), h('p', { class: 'lede' }, 'A rebuild of a working tool from an automotive exterior-parts plant (current role), on fictional data. Built by Daniel Lee; the requirements came from the manager and the floor.')),
    h('div', { class: 'grid3' },
      section('Problem', null, h('ul', {}, h('li', {}, 'Packaging data lived in signed forms, SAP exports and spreadsheets that disagreed.'), h('li', {}, 'Launch-time hand entry left systematic errors: kg in a gram column, one stack value stamped across a program, swapped dimensions.'), h('li', {}, 'Service parts had no form; old and new part numbers lived side by side; nobody could say quickly which parts were still alive.'))),
      section('Approach', null, h('ul', {}, h('li', {}, 'Signed form = reference value; rules decide fill / overwrite / hold.'), h('li', {}, 'Every spreadsheet is validated cell by cell before it touches the data.'), h('li', {}, 'Supersession read as lineage; status from open orders × usage.'), h('li', {}, 'Review first, then apply — for every change.'))),
      section('Result', 'Qualitative', h('ul', {}, h('li', {}, 'Reported the part-lifecycle 2×2 to the manager.'), h('li', {}, 'Answered colleagues’ and material handlers’ "where is it / is it alive / how is it packed" questions on the spot.'), h('li', {}, 'Found lanes to free immediately when slot reallocation was requested.'))),
    ),
    h('h2', { style: { margin: '8px 0 12px' } }, 'Scenarios'),
    h('div', { class: 'grid2' },
      sc('S1', 'What is wrong with the data?', '#overview', ['Open Overview.', 'Read the error counts and the 2×2.', 'Click any card to drill in.']),
      sc('S10', 'Validate a spreadsheet before it lands', '#imports', ['Pick IM-02 — part numbers turned into numbers and scientific notation.', 'See which cells were corrected and which were rejected (2.51E+07 lost digits).', 'Pick IM-07 — half the rows shifted: the whole file is blocked.']),
      sc('S2', 'Ingest a signed packaging form', '#forms', ['Pick PF-07 — "2/1" becomes 3 and 0.85 kg becomes 850 g.', 'PF-02 is signed and differs: overwritten and reported. PF-03 is unsigned: held.', 'PF-04 has no units: kept as written until you confirm inches.']),
      sc('S3', 'Fix systematic errors', '#fixes', ['Review weight-in-kg, fixed stack "4" and swapped dimensions.', 'Apply — only rows backed by a signed form change.', 'Overview counts drop to zero.']),
      sc('S4', 'Fill service parts without a form', '#fixes', ['Five service parts were received with no PFEP row.', 'Two Tier A matches to service parts are added; a Tier A match to a production part is not.']),
      sc('S5', 'Follow old → new part numbers', '#supersession', ['A three-hop chain, a fork resolved by date, a same-day tie and a loop.', 'Run sync review, then apply: blanks are filled both ways and a location is copied to the new number.']),
      sc('S6', 'Classify every planned part', '#lifecycle', ['Obsolete wording first (OBSL, OBSO and typos).', `Then open orders × usage in ${cfg().recentDays} days.`, 'Check the parts that joined or left the planning list today.']),
      sc('S7', 'Free up high-bay lanes', '#warehouse', ['Lanes held by obsolete or inactive parts are highlighted.', 'Click a row in the list to fly to it.']),
      sc('S8', 'Answer a floor question', `#lookup/${P.dimSwap[0][0]}`, ['One part number across PFEP, forms, vendor master, planning, open orders, MB51 and the warehouse.', 'Disagreements are marked as mismatch.']),
      sc('S9', 'Put it on the TV', '#warehouse/showcase', ['Opens on the whole warehouse with the status counts, colored by DOH.', 'Per part: back up to the bird’s-eye view, 360° around its row, then down into the aisle in front of it — Red first, lowest days on hand first.', '‹ Prev · Pause · Next › (← / Space / →), and Export top 5 saves a ~1-minute video.']),
      sc('S11', 'Replay a day of goods movements', '#flow', ['Show day KPIs: trucks, receipt lines, where they went (high-bay / VLM / floor), busiest hour, trucks on site at once — from the data only.', 'The parts that came in with no location are the slotting candidates.', 'Play replay: one truck per material document, forklifts put each line away, tuggers take goods issues to the line. Space, 1 / 2 / 4, C, Esc.']),
      sc('S12', 'Let the 3D check the data', '#lookup/20213438', ['This part’s PU is taller than the 26" level: the 3D squeezes the box and says Review PU size.', 'The packaging record is not changed — the data is what needs a look.']),
    ),
    section('Design decisions', null, h('ul', {},
      h('li', {}, h('strong', {}, 'Signed form wins. '), 'A different value on a signed form overwrites and is reported; an unsigned or malformed one is held.'),
      h('li', {}, h('strong', {}, 'Never guess a unit. '), 'A dimension without a unit stays as written until a person confirms it.'),
      h('li', {}, h('strong', {}, 'Reject, don’t guess. '), 'A cell that cannot be read safely is rejected; more than 20% rejected blocks the file (columns are probably shifted).'),
      h('li', {}, h('strong', {}, 'SQ01 is lineage, not status. '), 'Old numbers stay visible; status comes from orders and usage.'),
      h('li', {}, h('strong', {}, 'Receipts are not usage. '), 'Only consumption movements count; "no open orders" needs three weeks in a row.'),
      h('li', {}, h('strong', {}, 'Quantity is lanes. '), 'One part per lane; boxes per lane come from the 26" level height, capped at 4.'),
      h('li', {}, h('strong', {}, 'Review, then apply. '), 'Every rule produces a preview; nothing changes until you press apply.'))),
    section('Real vs demo', null, table([{ key: 'a', label: '' }, { key: 'r', label: 'Real tool' }, { key: 'd', label: 'This demo' }], [
      { a: 'Data', r: 'Plant SAP exports, signed supplier forms', d: 'Generated from a fixed seed — every company, person and part number is fictional' },
      { a: 'Storage', r: 'Server database', d: 'Your browser only (changes reset after 6 hours)' },
      { a: 'Spreadsheets', r: 'Uploaded daily', d: 'Eight built-in samples with planted format problems' },
      { a: 'Forms', r: 'Supplier PDFs', d: 'Eight sample PDFs; you can also upload one (read in the browser, never sent)' },
    ], { label: 'Real vs demo' })),
    section('Reset & export', 'Your changes are kept in this browser only.', h('div', { class: 'row-actions', style: { justifyContent: 'flex-start' } },
      h('button', { class: 'btn ghost', onclick: () => { if (confirm('Discard your changes and restore the sample data?')) ctx.reset(); } }, 'Reset sample data'),
      h('button', { class: 'btn ghost', onclick: () => ctx.exportJson() }, 'Export all data (JSON)'),
      h('span', { class: 'muted small' }, `${state.batches.length} change batch(es) applied`))),
  );
}
