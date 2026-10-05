// Screens: Overview, PFEP table, Imports, Form ingest, Data fixes.
import * as R from './rules.js';
const FORM_LABEL = Object.fromEntries(R.FORM_LAYOUT);
import { validateImport, acceptedRows, TARGETS } from './validate.js';
import { PKG_COLUMNS } from './seed.js';
import { state, commit } from './state.js';
import { h, fill, fmt, badge, lifeBadge, statusBadge, pnLink, table, empty, section, toast, stat } from './ui.js';

const D = () => state.data;
const cfg = () => state.data.config;

// ---------------------------------------------------------------- Overview
export function overview(root, ctx) {
  const d = D();
  const sys = R.detectSystemErrors(d, cfg()).report;
  const gaps = R.serviceGaps(d, d.asOf).report;
  const { manual } = R.resolveChains(d.sq01);
  const lc = R.lifecycle(d, cfg(), d.asOf);
  const counts = { Active: 0, 'Phase-in': 0, 'Run-out': 0, Inactive: 0, Obsolete: 0 };
  lc.forEach((x) => counts[x.state]++);
  const slots = R.slotCandidates(d.wh, lc, d.asOf);
  const formsLeft = ctx.sampleForms.filter((f) => !state.ingested.has(f.file)).length;
  const importsLeft = ctx.sampleImports.filter((f) => !state.imported.has(f.file)).length;

  root.append(
    h('div', { class: 'intro' },
      h('p', { class: 'eyebrow' }, 'Package database console · fictional data'),
      h('h1', {}, 'Scattered packaging data, cleaned by rules — then used for warehouse decisions.'),
      h('p', { class: 'lede' }, 'Signed packaging forms, spreadsheet exports and planning feeds disagree with each other. The console finds the systematic errors, fills gaps from signed forms, classifies every part on the planning list, and shows which high-bay lanes can be freed.'),
    ),
    h('div', { class: 'ov-grid' },
      h('div', { class: 'ov-col' },
        section('Data quality', 'Found by rules against signed forms — nothing is changed until you apply it.',
          h('div', { class: 'stats two' },
            stat('Weight typed in kg', sys.WEIGHT_KG.length, 'gram column ×1000 low', '#fixes'),
            stat('Stack fixed at "4"', sys.STACK_FIXED.length, `rows in Program ${sys.STACK_FIXED[0]?.program || '—'}`, '#fixes'),
            stat('Swapped dimensions', sys.DIM_SWAP.length, 'pairs', '#fixes'),
            stat('Service parts missing', gaps.length, 'received, no PFEP row', '#fixes'),
          ),
        ),
        section('Waiting for review', null,
          h('div', { class: 'stats two' },
            stat('Spreadsheets to validate', importsLeft, `of ${ctx.sampleImports.length} samples`, '#imports'),
            stat('Packaging forms to ingest', formsLeft, `of ${ctx.sampleForms.length} PDFs`, '#forms'),
            stat('Supersession to check', manual.length, 'fork tie / cycle', '#supersession'),
            stat('High-bay lanes to free', slots.lanes, `${slots.rows.length} obsolete / inactive parts`, '#warehouse'),
          ),
        ),
      ),
      h('div', { class: 'ov-col' },
        section('Part lifecycle — planning list', `${lc.length.toLocaleString('en-US')} parts on today's list`,
          quadrant(counts, true),
        ),
        section('High-bay preview', 'Colored by lifecycle. Obsolete and inactive lanes are the slot-reallocation candidates.',
          h('div', { id: 'ov3d', class: 'ov3d' }),
          h('div', { class: 'row-actions' }, h('a', { class: 'btn', href: '#warehouse' }, 'Open warehouse'), h('a', { class: 'btn ghost', href: '#warehouse/showcase' }, 'Start showcase')),
        ),
      ),
    ),
  );
  ctx.mount3d?.(root.querySelector('#ov3d'), { mode: 'life', preview: true });
}

export function quadrant(c, linked) {
  const cell = (label, n, cls, note) => h(linked ? 'a' : 'div', { class: `q ${cls}`, href: linked ? `#lifecycle/${label}` : null }, h('span', { class: 'q-n' }, fmt(n)), h('span', { class: 'q-l' }, label), h('span', { class: 'q-note' }, note));
  return h('div', { class: 'quad-wrap' },
    h('div', { class: 'quad-axes' }, h('span', {}, 'Used in last 30 days →'), h('span', {}, 'Open orders ↓')),
    h('div', { class: 'quad' },
      h('span', { class: 'qh' }, ''), h('span', { class: 'qh' }, 'Used'), h('span', { class: 'qh' }, 'Not used'),
      h('span', { class: 'qv' }, 'Open orders'), cell('Active', c.Active, 'q-active', 'running'), cell('Phase-in', c['Phase-in'], 'q-phasein', 'MRP ahead of use'),
      h('span', { class: 'qv' }, 'No orders'), cell('Run-out', c['Run-out'], 'q-runout', 'using up stock'), cell('Inactive', c.Inactive, 'q-inactive', 'EOP candidate'),
    ),
    h(linked ? 'a' : 'div', { class: 'q q-obsolete wide', href: linked ? '#lifecycle/Obsolete' : null }, h('span', { class: 'q-n' }, fmt(c.Obsolete)), h('span', { class: 'q-l' }, 'Obsolete'), h('span', { class: 'q-note' }, 'marked in description — overrides orders and usage')),
  );
}

// ---------------------------------------------------------------- PFEP table
const COL_LABEL = {
  partNo: 'Part number', program: 'Program', vehicle: 'Vehicle', product: 'Product', oemPn: 'OEM PN', supplierCode: 'Supplier code', supplierName: 'Supplier',
  puType: 'PU type', puL: 'PU L mm', puW: 'PU W mm', puH: 'PU H mm', partsPerPu: 'Parts/PU', puPerHu: 'PU/HU', huL: 'HU L mm', huW: 'HU W mm', huH: 'HU H mm', huType: 'HU type',
  stackTrailer: 'Stack trailer', stackWarehouse: 'Stack WH', weightG: 'Part weight g', tarePu: 'Tare PU kg', grossPu: 'Gross PU kg', grossHu: 'Gross HU kg', moq: 'MOQ', returnable: 'Returnable',
  country: 'Country', transitDays: 'Transit days', dockCode: 'Dock', signedForm: 'Signed form', lastReview: 'Last review', flags: 'Flags', tags: 'Tags', source: 'Source', updatedAt: 'Updated',
};
const NUMS = new Set(['puL', 'puW', 'puH', 'partsPerPu', 'puPerHu', 'huL', 'huW', 'huH', 'stackTrailer', 'stackWarehouse', 'weightG', 'tarePu', 'grossPu', 'grossHu', 'moq', 'transitDays']);
const pfepView = { q: '', program: '', type: '', issues: false, page: 0 };

export function pfep(root) {
  const d = D();
  const sys = R.detectSystemErrors(d, cfg()).report;
  const bad = new Map();
  const mark = (pn, f) => { if (!bad.has(pn)) bad.set(pn, new Set()); bad.get(pn).add(f); };
  sys.WEIGHT_KG.forEach((x) => mark(x.partNo, 'weightG'));
  sys.STACK_FIXED.forEach((x) => mark(x.partNo, 'stackTrailer'));
  sys.DIM_SWAP.forEach((x) => x.pair.forEach((pn) => ['puL', 'puW', 'puH'].forEach((f) => mark(pn, f))));
  const programs = [...new Set(d.pkg.map((r) => r.program))].sort();
  const out = h('div', {});
  const draw = () => {
    const q = pfepView.q.trim().toUpperCase();
    let rows = d.pkg.filter((r) => (!pfepView.program || r.program === pfepView.program) &&
      (!pfepView.type || r.partNo.startsWith(pfepView.type)) &&
      (!pfepView.issues || bad.has(r.partNo) || (r.flags && r.flags.length) || (r.tags && r.tags.length)) &&
      (!q || r.partNo.includes(q) || String(r.product).toUpperCase().includes(q) || String(r.supplierName).toUpperCase().includes(q)));
    const per = 50, pages = Math.max(1, Math.ceil(rows.length / per));
    pfepView.page = Math.min(pfepView.page, pages - 1);
    const slice = rows.slice(pfepView.page * per, pfepView.page * per + per);
    const cols = PKG_COLUMNS.map((k) => ({
      key: k, label: COL_LABEL[k], num: NUMS.has(k),
      cls: k === 'product' ? 'wide' : null,
      render: k === 'partNo' ? (r) => pnLink(r.partNo)
        : k === 'flags' ? (r) => (r.flags?.length ? r.flags.map((f) => badge(f, 'b-orange')) : '—')
          : k === 'tags' ? (r) => (r.tags?.length ? r.tags.map((t) => badge(t, 'b-muted')) : '—')
            : (r) => { const v = fmt(r[k]); return bad.get(r.partNo)?.has(k) ? h('span', { class: 'cell-bad', title: 'Rule finding — see Data fixes' }, v) : v; },
    }));
    fill(out, 
      h('p', { class: 'muted small' }, `${rows.length.toLocaleString('en-US')} of ${d.pkg.length.toLocaleString('en-US')} rows · 34 columns · cells in red are rule findings (see Data fixes)`),
      table(cols, slice, { dense: true, label: 'PFEP table' }),
      h('div', { class: 'pager' },
        h('button', { class: 'btn ghost', disabled: pfepView.page === 0, onclick: () => { pfepView.page--; draw(); } }, '← Prev'),
        h('span', {}, `Page ${pfepView.page + 1} of ${pages}`),
        h('button', { class: 'btn ghost', disabled: pfepView.page >= pages - 1, onclick: () => { pfepView.page++; draw(); } }, 'Next →')),
    );
  };
  const search = h('input', { type: 'search', placeholder: 'Part number, product or supplier', value: pfepView.q, 'aria-label': 'Search', oninput: (e) => { pfepView.q = e.target.value; pfepView.page = 0; draw(); } });
  const sel = (label, key, opts) => h('label', { class: 'field' }, h('span', {}, label), h('select', { onchange: (e) => { pfepView[key] = e.target.value; pfepView.page = 0; draw(); } }, opts.map(([v, t]) => h('option', { value: v, selected: pfepView[key] === v }, t))));
  root.append(section('Package database (PFEP)', 'One row per part number — the key every source is matched on.',
    h('div', { class: 'toolbar' }, search,
      sel('Program', 'program', [['', 'All'], ...programs.map((p) => [p, p])]),
      sel('Type', 'type', [['', 'All'], ['2', 'Components 2…'], ['45', 'Finished 45…'], ['75', 'Service 75…']]),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: pfepView.issues, onchange: (e) => { pfepView.issues = e.target.checked; pfepView.page = 0; draw(); } }), 'Findings, flags or tags only')),
    out));
  draw();
}

// ---------------------------------------------------------------- Imports
const FIELD_LABEL = { material: 'Material', description: 'Description', supplier: 'Supplier', planner: 'Planner', stock: 'Stock', doh: 'DOH', program: 'Program', vendorNo: 'Vendor number', vendorName: 'Vendor name', week: 'Week', qty: 'Quantity', postingDate: 'Posting date', mvt: 'Movement type', sloc: 'Storage location', area: 'Area', row: 'Row', bay: 'Bay', level: 'Level', lanes: 'Lanes' };
let importSel = null;

export function imports(root, ctx) {
  const list = h('div', { class: 'file-list' });
  const pane = h('div', { class: 'file-pane' });
  const drawList = () => fill(list, ...ctx.sampleImports.map((s) => h('button', {
    class: `file ${importSel === s.file ? 'on' : ''}`, onclick: () => { importSel = s.file; drawList(); load(s); },
  }, h('span', { class: 'file-name' }, s.file), h('span', { class: 'file-meta' }, `${TARGETS[s.target].label} · ${s.title}`), state.imported.has(s.file) ? badge('Applied', 'b-green') : null)));
  const load = async (s) => {
    fill(pane, h('p', { class: 'muted' }, 'Reading spreadsheet…'));
    try {
      const buf = await (await fetch(`samples/imports/${s.file}`)).arrayBuffer();
      const wb = window.XLSX.read(buf, { type: 'array' });
      const cells = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: true, defval: '' });
      renderReport(pane, s, cells, drawList);
    } catch (e) { fill(pane, h('p', { class: 'error' }, `Could not read ${s.file}: ${e.message}`)); }
  };
  root.append(section('Spreadsheet imports', 'Exports from the material team and SAP are validated cell by cell before anything is applied. Pick a sample — each has planted format problems.',
    h('div', { class: 'split' }, list, pane)));
  drawList();
  const first = ctx.sampleImports.find((s) => s.file === importSel) || ctx.sampleImports[0];
  importSel = first.file; drawList(); load(first);
}

function renderReport(pane, s, cells, refresh) {
  const r = validateImport(cells, s.target, cfg());
  const header = cells[r.headerRow - 1] || [];
  const issues = r.rows.filter((x) => x.status !== 'ok').flatMap((x) => x.issues.map((i) => ({ row: x.row, rowStatus: x.status, ...i })));
  let showAll = false;
  const rowsBox = h('div', {});
  const drawRows = () => {
    const rows = showAll ? r.rows.flatMap((x) => (x.issues.length ? x.issues.map((i) => ({ row: x.row, rowStatus: x.status, ...i })) : [{ row: x.row, rowStatus: 'ok', field: '', raw: '', value: '', reason: '' }])) : issues;
    fill(rowsBox, rows.length ? table([
      { key: 'row', label: 'Row', num: true },
      { key: 'rowStatus', label: 'Row result', render: (x) => statusBadge(x.rowStatus) },
      { key: 'field', label: 'Field', render: (x) => FIELD_LABEL[x.field] || x.field || '—' },
      { key: 'raw', label: 'As written', render: (x) => h('code', {}, x.raw === '' ? '(blank)' : String(x.raw)) },
      { key: 'value', label: 'Becomes', render: (x) => (x.status === 'rejected' ? '—' : h('code', {}, fmt(x.value))) },
      { key: 'reason', label: 'Why' },
    ], rows, { label: 'Validation details' }) : empty('Every row passed as written.'));
  };
  const applyBox = h('div', { class: 'apply-box' });
  const accepted = acceptedRows(r);
  const already = state.imported.has(s.file);
  if (r.blocked) applyBox.append(h('p', { class: 'muted' }, 'Nothing can be applied from a blocked file. Fix the source and export again.'));
  else if (already) applyBox.append(h('p', {}, badge('Applied', 'b-green'), ` ${accepted.length} rows from this file are in the data.`));
  else applyBox.append(
    h('p', {}, `${accepted.length} rows pass (${r.counts.ok} as written, ${r.counts.coerced} corrected). ${r.counts.rejected} rejected rows stay out.`),
    h('button', { class: 'btn', onclick: () => { commit({ kind: 'IMPORT', label: `${s.file} → ${TARGETS[s.target].label}`, import: { file: s.file, target: s.target, rows: accepted } }); toast(`Applied ${accepted.length} rows to ${TARGETS[s.target].label}`); refresh(); renderReport(pane, s, cells, refresh); } }, `Apply ${accepted.length} rows`),
  );
  fill(pane, 
    h('h3', {}, s.file),
    h('p', { class: 'muted' }, `Target: ${TARGETS[s.target].label} · ${s.title}`),
    r.blocked ? h('div', { class: 'banner bad', role: 'alert' }, h('strong', {}, 'Blocked. '), r.reason) : null,
    h('div', { class: 'chips' },
      badge(`${r.counts.ok} OK`, 'b-green'), badge(`${r.counts.coerced} corrected`, 'b-orange'), badge(`${r.counts.rejected} rejected`, 'b-red'), badge(`${r.counts.skipped} skipped`, 'b-muted'),
      r.rejectPct !== undefined ? h('span', { class: 'muted small' }, `reject rate ${r.rejectPct}% (block above ${cfg().importRejectMaxPct}%)`) : null),
    h('details', { class: 'mapping', open: r.blocked || r.unknownColumns.length > 0 || r.headerRow > 1 },
      h('summary', {}, `Header found on row ${r.headerRow} — column mapping`),
      table([{ key: 'f', label: 'Field' }, { key: 'c', label: 'Column in file' }, { key: 'req', label: 'Required' }],
        Object.entries(TARGETS[s.target].columns).map(([f, def]) => ({ f: FIELD_LABEL[f] || f, c: r.columns[f] ? `${String.fromCharCode(64 + r.columns[f])} · "${header[r.columns[f] - 1]}"` : (def.required ? h('strong', { class: 'error' }, 'missing') : 'not in file'), req: def.required ? 'yes' : '' })), { label: 'Column mapping' }),
      r.unknownColumns.length ? h('p', { class: 'muted small' }, `Ignored columns: ${r.unknownColumns.join(', ')}`) : null),
    r.blocked && !r.rows.length ? null : h('div', {},
      h('div', { class: 'row-actions' }, h('h4', {}, 'Cells that needed attention'), h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { showAll = e.target.checked; drawRows(); } }), 'Show all rows')),
      rowsBox,
      r.skipped.length ? h('p', { class: 'muted small' }, `Skipped: ${r.skipped.map((x) => `row ${x.row} (${x.reason.toLowerCase()})`).join(', ')}`) : null),
    applyBox,
  );
  drawRows();
}

// ---------------------------------------------------------------- Form ingest
let formSel = null;
export function forms(root, ctx) {
  const list = h('div', { class: 'file-list' });
  const pane = h('div', { class: 'file-pane' });
  const upload = h('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'visually-hidden', id: 'pdf-upload', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    formSel = null; drawList();
    await loadForm(pane, { file: f.name, uploaded: true }, new Uint8Array(await f.arrayBuffer()), ctx, drawList);
    e.target.value = '';
  } });
  const drawList = () => fill(list, 
    ...ctx.sampleForms.map((s) => h('button', { class: `file ${formSel === s.file ? 'on' : ''}`, onclick: async () => {
      formSel = s.file; drawList();
      fill(pane, h('p', { class: 'muted' }, 'Reading PDF…'));
      try { await loadForm(pane, s, new Uint8Array(await (await fetch(`samples/forms/${s.file}`)).arrayBuffer()), ctx, drawList); }
      catch (e) { fill(pane, h('p', { class: 'error' }, `Could not read ${s.file}: ${e.message}`)); }
    } }, h('span', { class: 'file-name' }, s.file), h('span', { class: 'file-meta' }, CASE_TEXT[s.case] || ''), state.ingested.has(s.file) ? badge('Applied', 'b-green') : null)),
    h('label', { class: 'file upload', for: 'pdf-upload' }, h('span', { class: 'file-name' }, 'Upload a PDF…'), h('span', { class: 'file-meta' }, 'Read in your browser only — not saved or sent')),
    upload,
  );
  root.append(section('Packaging form ingest', 'A signed packaging form is the reference value. The PDF text layer is read in the browser, mapped to PFEP fields, then compared with the current row.',
    h('div', { class: 'split' }, list, pane)));
  drawList();
  const idx = Math.max(0, ctx.sampleForms.findIndex((s) => s.file === formSel));
  list.querySelectorAll('button.file')[idx]?.click();
}
const CASE_TEXT = { AUTOFILL: 'Fills blank fields', SIGNED_CONFLICT: 'Signed form differs from PFEP', UNSIGNED_HELD: 'Not signed — differences held', UNIT_CHECK: 'Dimensions without a unit', SUPPLIER_MATCH: 'Supplier name written differently', NEW_ROW: 'Part not in PFEP yet', CONVERSIONS: 'Stack "2/1" and weight in kg', SUPPLIER_CHECK: 'Unknown supplier, weight without unit' };
const PFEP_LABEL = { ...COL_LABEL };

async function loadForm(pane, s, bytes, ctx, refresh) {
  const { readForm, renderPage } = await import('./pdf-parse.js');
  const { doc, fields } = await readForm(bytes);
  const canvas = h('canvas', { class: 'pdf-canvas', 'aria-label': `Preview of ${s.file}` });
  const draw = () => {
    const { changes, report } = R.ingestForm(D(), { file: s.file, fields }, D().asOf);
    const done = state.ingested.has(s.file);
    const actionable = changes.filter((c) => c.op !== 'flag' && !(c.op === 'set' && c.field === 'signedForm'));
    const unitHeld = report.held.filter((x) => ['puL', 'puW', 'puH'].includes(x.field) && /no unit/.test(x.reason));
    fill(pane, 
      h('div', { class: 'form-head' },
        h('div', {}, h('h3', {}, s.file), h('p', { class: 'muted' }, `Part ${report.partNo || '—'} · `, report.signed === true ? badge('Signed', 'b-green') : report.signed === false ? badge('Not signed', 'b-red') : badge('Signature incomplete', 'b-orange'), s.uploaded ? ' · uploaded file (session only)' : '')),
        done ? badge('Applied', 'b-green') : null),
      h('div', { class: 'form-split' },
        h('div', { class: 'pdf-box' }, canvas),
        h('div', {},
          h('h4', {}, 'Read from the form'),
          table([{ key: 'k', label: 'Field' }, { key: 'v', label: 'Value', render: (x) => h('code', {}, x.v || '(blank)') }], Object.entries(fields).map(([k, v]) => ({ k: FORM_LABEL[k] || k, v })), { dense: true, label: 'Extracted fields' }))),
      h('div', { class: 'result3' },
        h('div', { class: 'r3' }, h('h4', {}, `New rows (${report.newRows.length})`), report.newRows.length ? table([{ key: 'partNo', label: 'Part', render: (x) => x.partNo }, { key: 'fields', label: 'Fields from form', render: (x) => x.fields.length }], report.newRows, { label: 'New rows' }) : empty('None')),
        h('div', { class: 'r3' }, h('h4', {}, `Auto-filled (${report.autoFilled.length})`), report.autoFilled.length ? table([{ key: 'field', label: 'Field', render: (x) => PFEP_LABEL[x.field] || x.field }, { key: 'value', label: 'Value' }], report.autoFilled, { label: 'Auto-filled' }) : empty('No blank fields to fill')),
        h('div', { class: 'r3' }, h('h4', {}, `Conflicts (${report.conflicts.length})`), report.conflicts.length ? table([{ key: 'field', label: 'Field', render: (x) => PFEP_LABEL[x.field] || x.field }, { key: 'old', label: 'Old' }, { key: 'new', label: 'New' }, { key: 'source', label: 'Source' }], report.conflicts, { label: 'Conflicts' }) : empty('No value disagrees on a signed form'))),
      report.held.length ? h('div', { class: 'held' }, h('h4', {}, `Held for review (${report.held.length})`),
        table([{ key: 'field', label: 'Field', render: (x) => PFEP_LABEL[x.field] || x.field }, { key: 'raw', label: 'Form says', render: (x) => h('code', {}, fmt(x.raw)) }, { key: 'old', label: 'PFEP has' }, { key: 'reason', label: 'Why held' }], report.held, { label: 'Held' }),
        unitHeld.length && report.partNo && D().pkg.some((r) => r.partNo === report.partNo) ? h('button', { class: 'btn ghost', onclick: () => {
          const ch = unitHeld.map((x) => ({ op: 'set', partNo: report.partNo, field: x.field, value: R.confirmInches(x.raw), source: `${s.file} (confirmed inches)` }));
          commit({ kind: 'UNIT_CONFIRM', label: `${report.partNo} dimensions confirmed as inches`, pkg: [...ch, { op: 'unflag', partNo: report.partNo, flag: 'UNIT_CHECK' }] });
          toast('Converted inches → mm (×25.4)'); draw();
        } }, 'Confirm these dimensions are inches (×25.4 → mm)') : null) : null,
      h('div', { class: 'apply-box' },
        done ? h('p', {}, 'This form has been applied.') :
          h('button', { class: 'btn', disabled: !actionable.length && !report.flags.length, onclick: () => {
            commit({ kind: 'INGEST', label: `${s.file} → ${report.partNo}`, pkg: changes, forms: [{ id: s.file, file: s.file, partNo: report.partNo, fields, signed: report.signed === true, parsedAt: D().asOf }] });
            toast(`Applied ${actionable.length} change(s) from ${s.file}`); refresh(); draw();
          } }, actionable.length ? `Apply ${actionable.length} change(s)` : 'Record flags only')),
    );
    renderPage(doc, canvas, Math.min(360, pane.clientWidth || 360)).catch(() => {});
  };
  draw();
}

// ---------------------------------------------------------------- Data fixes
export function fixes(root) {
  const d = D();
  const { changes, report } = R.detectSystemErrors(d, cfg());
  const total = report.WEIGHT_KG.length + report.STACK_FIXED.length + report.DIM_SWAP.length;
  const byPn = new Map(d.pkg.map((r) => [r.partNo, r]));
  const sysBox = total === 0 ? empty('No systematic errors left — every finding has been corrected from its signed form.') : h('div', {},
    report.WEIGHT_KG.length ? h('div', {}, h('h4', {}, `Weight typed in kg (${report.WEIGHT_KG.length})`), h('p', { class: 'muted small' }, 'The gram column holds the kilogram number from the form — 1,000× too light, which skews trailer and HU weights.'),
      table([{ key: 'partNo', label: 'Part', render: (x) => pnLink(x.partNo) }, { key: 'p', label: 'Product', render: (x) => byPn.get(x.partNo)?.product }, { key: 'old', label: 'PFEP g', num: true }, { key: 'new', label: 'Signed form g', num: true }], report.WEIGHT_KG, { label: 'Weight fixes' })) : null,
    report.STACK_FIXED.length ? h('div', {}, h('h4', {}, `Trailer stack fixed at one value (${report.STACK_FIXED.length})`), h('p', { class: 'muted small' }, `Every row in Program ${report.STACK_FIXED[0].program} has the same trailer stack value. Rows with a signed form get the form value; rows without one keep the flag for review.`),
      table([{ key: 'partNo', label: 'Part', render: (x) => pnLink(x.partNo) }, { key: 'p', label: 'Product', render: (x) => byPn.get(x.partNo)?.product }, { key: 'old', label: 'PFEP', num: true }, { key: 'new', label: 'Signed form', num: true }], report.STACK_FIXED.slice(0, 12), { label: 'Stack fixes' }),
      report.STACK_FIXED.length > 12 ? h('p', { class: 'muted small' }, `…and ${report.STACK_FIXED.length - 12} more`) : null) : null,
    report.DIM_SWAP.length ? h('div', {}, h('h4', {}, `Swapped dimensions (${report.DIM_SWAP.length} pairs)`), h('p', { class: 'muted small' }, "Each part holds the other part's PU dimensions."),
      table([{ key: 'a', label: 'Part A', render: (x) => pnLink(x.pair[0]) }, { key: 'ad', label: 'A in PFEP', render: (x) => dims(byPn.get(x.pair[0])) }, { key: 'b', label: 'Part B', render: (x) => pnLink(x.pair[1]) }, { key: 'bd', label: 'B in PFEP', render: (x) => dims(byPn.get(x.pair[1])) }], report.DIM_SWAP, { label: 'Dimension swaps' })) : null,
    h('div', { class: 'apply-box' }, h('button', { class: 'btn', onclick: () => { commit({ kind: 'SYSFIX', label: `${changes.length} corrections from signed forms`, pkg: changes }); toast(`Applied ${changes.length} corrections`); rerender(root); } }, `Apply ${changes.length} corrections`)),
  );

  const gaps = R.serviceGaps(d, d.asOf);
  const autoN = gaps.report.filter((x) => x.auto).length;
  const gapBox = gaps.report.length ? h('div', {},
    table([
      { key: 'partNo', label: 'Service part', render: (x) => x.partNo },
      { key: 'description', label: 'Receipt description (MB51)' },
      { key: 'tier', label: 'Tier', render: (x) => badge(`Tier ${x.tier}`, x.tier === 'A' ? 'b-green' : x.tier === 'B' ? 'b-orange' : 'b-muted') },
      { key: 'score', label: 'Similarity', num: true },
      { key: 'matchedProduct', label: 'Closest PFEP row', render: (x) => h('span', {}, pnLink(x.matchedTo), ' ', x.matchedProduct) },
      { key: 'reason', label: 'Decision', render: (x) => (x.auto ? h('strong', {}, 'Add — copy packaging') : x.reason) },
    ], gaps.report, { label: 'Service part gaps' }),
    h('div', { class: 'apply-box' }, autoN ? h('button', { class: 'btn', onclick: () => { commit({ kind: 'SVC', label: `${autoN} service rows added by similar-part match`, pkg: gaps.changes }); toast(`Added ${autoN} service rows`); rerender(root); } }, `Add ${autoN} Tier A service rows`) : null,
      h('p', { class: 'muted small' }, 'Only Tier A matches to another service part are added — production parts ship in totes and returnables, service parts in cartons. Added rows end with [similar-part-match-needed].')),
  ) : empty('Every service part with a receipt has a PFEP row.');

  root.append(
    section('Systematic errors', 'Patterns, not one-off typos — found by comparing PFEP with signed forms. Only rows backed by a signed form are corrected.', sysBox),
    section('Service parts without a form', 'Received in the last 90 days (movement 101) but missing from PFEP. Descriptions are compared after removing SP / CS / KIT / MP / LCI / MOD.', gapBox),
  );
}
const dims = (r) => (r ? `${fmt(r.puL)} × ${fmt(r.puW)} × ${fmt(r.puH)}` : '—');
function rerender(root) { root.dispatchEvent(new CustomEvent('rerender', { bubbles: true })); }
