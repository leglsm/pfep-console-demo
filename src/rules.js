// Pure rule functions (R1–R18). No DOM, no storage.
// Each detector returns { changes, report }; applyChanges() is the separate "apply" step.

import { addDays } from './seed.js';

// ---------- small helpers ----------
export const isBlank = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
export const normPn = (s) => String(s ?? '').replace(/[\s-]/g, '').trim(); // R1

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}

function bigrams(s) {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}
export function diceSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  const counts = new Map();
  for (const g of A) counts.set(g, (counts.get(g) || 0) + 1);
  let hit = 0;
  for (const g of B) { const c = counts.get(g); if (c) { hit++; counts.set(g, c - 1); } }
  return (2 * hit) / (A.length + B.length);
}

// ---------- R2 stackability "X/Y" -> X+Y ----------
export function parseStack(raw) {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return { ok: true, value: Number(m[1]) + Number(m[2]) };
  m = s.match(/^(\d+)$/);
  if (m) return { ok: true, value: Number(m[1]) };
  return { ok: false, reason: `Stackability "${s}" is not "X/Y" or a number` };
}

// ---------- R3 component weight kg -> g ----------
export function parseWeight(raw) {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(kg|g|lb)?$/i);
  if (!m) return { ok: false, reason: `Weight "${s}" is not a number` };
  const unit = (m[2] || '').toLowerCase();
  if (!unit) return { ok: false, reason: `Weight "${s}" has no unit`, flag: 'WEIGHT_UNIT_CHECK' };
  const v = Number(m[1]);
  const g = unit === 'kg' ? v * 1000 : unit === 'lb' ? v * 453.592 : v;
  return { ok: true, value: Math.round(g * 1000) / 1000 };
}

// ---------- R4 dimensions: never guess a unit ----------
export function parseDim(raw) {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|in|")?$/i);
  if (!m) return { ok: false, reason: `Dimension "${s}" is not a number`, raw: s };
  const unit = (m[2] || '').toLowerCase();
  const v = Number(m[1]);
  if (!unit) return { ok: false, reason: `Dimension "${s}" has no unit — kept as written`, flag: 'UNIT_CHECK', raw: s };
  const mm = unit === 'mm' ? v : unit === 'cm' ? v * 10 : v * 25.4;
  return { ok: true, value: Math.round(mm * 10) / 10 };
}
export const confirmInches = (raw) => Math.round(Number(String(raw).trim()) * 25.4 * 10) / 10;

// ---------- R5 supplier name -> vendor code ----------
export function normSupplier(name) {
  return String(name ?? '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/).filter((t) => t && !['INC', 'LLC', 'CO', 'CORP', 'LTD', 'COMPANY', 'THE'].includes(t)).join(' ');
}
export function matchSupplier(name, supplierMaster, threshold = 0.85) {
  const n = normSupplier(name);
  let best = null;
  for (const v of supplierMaster) {
    const score = diceSimilarity(n, normSupplier(v.vendorName));
    if (!best || score > best.score) best = { vendorNo: v.vendorNo, vendorName: v.vendorName, score };
  }
  if (best && best.score >= threshold) return { ok: true, ...best };
  return { ok: false, best, flag: 'SUPPLIER_CHECK', reason: `No vendor match ≥ ${threshold} for "${name}"` };
}

// ---------- form text -> fields ("Label: value" text layer) ----------
const FORM_LABELS = {
  'part number': 'partNo', description: 'description', supplier: 'supplier', program: 'program',
  'packaging type': 'packagingType', 'pu length': 'puL', 'pu width': 'puW', 'pu height': 'puH',
  'parts per pu': 'partsPerPu', 'pu per hu': 'puPerHu', stackability: 'stackability',
  'component weight': 'componentWeight', 'mixed pallet': 'mixedPallet', 'returnable container': 'returnable',
  'signed by': 'signedBy', 'date signed': 'dateSigned',
};
// Field order and labels as printed on the packaging form.
export const FORM_LAYOUT = [
  ['partNo', 'Part Number'], ['description', 'Description'], ['supplier', 'Supplier'], ['program', 'Program'],
  ['packagingType', 'Packaging Type'], ['puL', 'PU Length'], ['puW', 'PU Width'], ['puH', 'PU Height'],
  ['partsPerPu', 'Parts per PU'], ['puPerHu', 'PU per HU'], ['stackability', 'Stackability'],
  ['componentWeight', 'Component Weight'], ['mixedPallet', 'Mixed Pallet'], ['returnable', 'Returnable Container'],
  ['signedBy', 'Signed By'], ['dateSigned', 'Date Signed'],
];
export function parseFormText(text) {
  const fields = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z ]+?)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const key = FORM_LABELS[m[1].toLowerCase()];
    if (key && !(key in fields)) fields[key] = m[2].replace(/^_+$/, '');
  }
  return fields;
}
export function formSigned(fields) {
  const by = (fields.signedBy || '').trim(), at = (fields.dateSigned || '').trim();
  if (by && at) return true;
  if (!by && !at) return false;
  return 'unknown';
}

// ---------- form -> candidate PFEP values ----------
export function mapForm(fields, supplierMaster) {
  const values = {}, held = [], flags = [];
  const holdIt = (field, reason, flag) => { held.push({ field, raw: fieldRaw(field, fields), reason }); if (flag) flags.push(flag); };
  if (fields.description) values.product = fields.description;
  if (fields.program) values.program = fields.program;
  if (fields.packagingType) values.puType = fields.packagingType;
  for (const [f, k] of [['puL', 'puL'], ['puW', 'puW'], ['puH', 'puH']]) {
    if (isBlank(fields[k])) continue;
    const d = parseDim(fields[k]);
    if (d.ok) values[f] = d.value; else holdIt(f, d.reason, d.flag);
  }
  for (const f of ['partsPerPu', 'puPerHu']) {
    if (isBlank(fields[f])) continue;
    if (/^\d+$/.test(fields[f].trim())) values[f] = Number(fields[f]); else holdIt(f, `"${fields[f]}" is not a whole number`);
  }
  if (!isBlank(fields.stackability)) {
    const st = parseStack(fields.stackability);
    if (st.ok) { values.stackTrailer = st.value; values.stackWarehouse = st.value; }
    else { holdIt('stackTrailer', st.reason); holdIt('stackWarehouse', st.reason); }
  }
  if (!isBlank(fields.componentWeight)) {
    const w = parseWeight(fields.componentWeight);
    if (w.ok) values.weightG = w.value; else holdIt('weightG', w.reason, w.flag);
  }
  if (!isBlank(fields.mixedPallet)) {
    const v = fields.mixedPallet.trim().toUpperCase();
    if (v === 'YES') values.huType = 'Mixed'; else if (v === 'NO') values.huType = 'Homogeneous';
    else holdIt('huType', `Mixed pallet "${fields.mixedPallet}" is not YES/NO`);
  }
  if (!isBlank(fields.returnable) && fields.returnable.trim().toUpperCase() !== 'N/A') {
    if (/^6\d{7}$/.test(normPn(fields.returnable))) values.returnable = normPn(fields.returnable);
    else holdIt('returnable', `Returnable "${fields.returnable}" is not a 6XXXXXXX container number`);
  }
  if (!isBlank(fields.supplier)) {
    const s = matchSupplier(fields.supplier, supplierMaster);
    if (s.ok) { values.supplierCode = s.vendorNo; values.supplierName = s.vendorName; }
    else holdIt('supplierCode', s.reason, s.flag);
  }
  return { values, held, flags };
}
const FIELD_SOURCE = { puL: 'puL', puW: 'puW', puH: 'puH', stackTrailer: 'stackability', stackWarehouse: 'stackability', weightG: 'componentWeight', huType: 'mixedPallet', supplierCode: 'supplier', returnable: 'returnable' };
function fieldRaw(field, fields) { return fields[FIELD_SOURCE[field] || field] ?? ''; }

// ---------- R6 ingest one form ----------
export function ingestForm(data, form, asOf) {
  const fields = form.fields;
  const partNo = normPn(fields.partNo);
  const signed = formSigned(fields);
  const source = form.file || form.id;
  const { values, held, flags } = mapForm(fields, data.supplierMaster);
  const report = { file: source, partNo, signed, newRows: [], autoFilled: [], conflicts: [], held: [...held], flags };
  const changes = [];
  if (!/^\d{8,9}$/.test(partNo)) {
    report.held.push({ field: 'partNo', raw: fields.partNo, reason: 'Part number missing or malformed' });
    return { changes, report };
  }
  const row = data.pkg.find((r) => r.partNo === partNo);
  if (!row) {
    if (signed !== true) {
      report.held.push({ field: 'partNo', raw: partNo, reason: 'New part on an unsigned form — not added' });
      return { changes, report };
    }
    const newRow = { partNo, ...values, flags: flags.slice(), tags: ['from-form'], source, updatedAt: asOf, signedForm: source };
    changes.push({ op: 'add', row: newRow });
    report.newRows.push({ partNo, fields: Object.keys(values) });
    return { changes, report };
  }
  for (const [field, value] of Object.entries(values)) {
    const old = row[field];
    if (isBlank(old)) {
      changes.push({ op: 'set', partNo, field, value, source });
      report.autoFilled.push({ field, value });
      if (field === 'supplierCode') { changes.push({ op: 'set', partNo, field: 'supplierName', value: values.supplierName, source }); }
    } else if (!sameValue(old, value)) {
      if (field === 'supplierName') continue;
      if (signed === true) {
        changes.push({ op: 'set', partNo, field, value, source });
        report.conflicts.push({ field, old, new: value, source, action: 'Overwritten (signed form wins)' });
      } else {
        report.held.push({ field, raw: value, old, reason: signed === false ? 'Form is not signed' : 'Signature incomplete' });
      }
    }
  }
  for (const f of flags) changes.push({ op: 'flag', partNo, flag: f, source });
  if (signed === true) changes.push({ op: 'set', partNo, field: 'signedForm', value: source, source });
  return { changes, report };
}
export function sameValue(a, b) {
  if (typeof a === 'number' || typeof b === 'number') return Math.abs(Number(a) - Number(b)) < 1e-6;
  return String(a ?? '').trim() === String(b ?? '').trim();
}

// ---------- apply step (shared) ----------
export function applyChanges(pkg, changes, asOf) {
  const out = pkg.map((r) => ({ ...r, flags: [...(r.flags || [])], tags: [...(r.tags || [])] }));
  const idx = new Map(out.map((r, i) => [r.partNo, i]));
  for (const c of changes) {
    if (c.op === 'add') {
      if (idx.has(c.row.partNo)) continue;
      idx.set(c.row.partNo, out.length);
      out.push({ flags: [], tags: [], ...c.row });
      continue;
    }
    const i = idx.get(c.partNo);
    if (i === undefined) continue;
    const r = out[i];
    if (c.op === 'set') { r[c.field] = c.value; r.updatedAt = asOf; }
    else if (c.op === 'flag' && !r.flags.includes(c.flag)) r.flags.push(c.flag);
    else if (c.op === 'unflag') r.flags = r.flags.filter((f) => f !== c.flag);
    else if (c.op === 'tag' && !r.tags.includes(c.tag)) r.tags.push(c.tag);
  }
  return out;
}

// ---------- R7 systematic errors, corrected only where a signed form backs it ----------
export function formValues(form, supplierMaster) {
  return mapForm(form.fields, supplierMaster).values;
}
export function detectSystemErrors(data, config) {
  const changes = [], findings = { WEIGHT_KG: [], STACK_FIXED: [], DIM_SWAP: [] };
  const fv = new Map();
  for (const f of data.forms) if (f.signed) fv.set(f.partNo, formValues(f, data.supplierMaster));
  // (a) grams column holding a kg number
  for (const r of data.pkg) {
    const f = fv.get(r.partNo);
    if (!f || isBlank(r.weightG) || !f.weightG) continue;
    const ratio = Number(r.weightG) / f.weightG;
    if (Math.abs(ratio - 0.001) < 0.00002) {
      findings.WEIGHT_KG.push({ partNo: r.partNo, old: r.weightG, new: f.weightG });
      changes.push({ op: 'set', partNo: r.partNo, field: 'weightG', value: f.weightG, source: 'signed form' });
    }
  }
  // (b) one value stamped across a whole program
  const byProgram = new Map();
  for (const r of data.pkg) {
    if (isBlank(r.stackTrailer)) continue;
    if (!byProgram.has(r.program)) byProgram.set(r.program, []);
    byProgram.get(r.program).push(r);
  }
  for (const [program, rows] of byProgram) {
    if (rows.length < config.stackFixedMinRows) continue;
    const vals = new Set(rows.map((r) => r.stackTrailer));
    if (vals.size !== 1) continue;
    for (const r of rows) {
      const f = fv.get(r.partNo);
      if (f && f.stackTrailer && f.stackTrailer !== r.stackTrailer) {
        findings.STACK_FIXED.push({ partNo: r.partNo, program, old: r.stackTrailer, new: f.stackTrailer });
        changes.push({ op: 'set', partNo: r.partNo, field: 'stackTrailer', value: f.stackTrailer, source: 'signed form' });
      }
    }
  }
  // (c) two rows that hold each other's dimensions
  const dimKey = (o) => `${o.puL}|${o.puW}|${o.puH}`;
  const bad = data.pkg.filter((r) => { const f = fv.get(r.partNo); return f && f.puL && dimKey(r) !== dimKey(f); });
  const byFormDim = new Map();
  for (const r of bad) { const k = dimKey(fv.get(r.partNo)); if (!byFormDim.has(k)) byFormDim.set(k, []); byFormDim.get(k).push(r); }
  const seen = new Set();
  for (const a of bad) {
    if (seen.has(a.partNo)) continue;
    const partner = (byFormDim.get(dimKey(a)) || []).find((b) => b.partNo !== a.partNo && !seen.has(b.partNo) && dimKey(b) === dimKey(fv.get(a.partNo)));
    if (!partner) continue;
    seen.add(a.partNo); seen.add(partner.partNo);
    findings.DIM_SWAP.push({ pair: [a.partNo, partner.partNo] });
    for (const r of [a, partner]) {
      const f = fv.get(r.partNo);
      for (const k of ['puL', 'puW', 'puH']) changes.push({ op: 'set', partNo: r.partNo, field: k, value: f[k], source: 'signed form' });
    }
  }
  return { changes, report: findings };
}

// ---------- R8 service parts with receipts but no PFEP row ----------
const SVC_TOKENS = new Set(['SP', 'CS', 'KIT', 'MP', 'LCI', 'MOD']);
export const svcTokens = (s) => new Set(String(s ?? '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t && !SVC_TOKENS.has(t)));
export function jaccard(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}
export const isServicePn = (pn) => /^7\d{7}$/.test(pn);
export function serviceGaps(data, asOf) {
  const inPkg = new Set(data.pkg.map((r) => r.partNo));
  const gaps = new Map();
  for (const m of data.mb51) if (m.mvt === '101' && isServicePn(m.material) && !inPkg.has(m.material) && !gaps.has(m.material)) gaps.set(m.material, m.description);
  const pkgTokens = data.pkg.map((r) => ({ r, t: svcTokens(r.product) }));
  const rows = [], changes = [];
  for (const [partNo, description] of gaps) {
    const t = svcTokens(description);
    let best = null;
    for (const p of pkgTokens) { const s = jaccard(t, p.t); if (!best || s > best.score) best = { score: s, row: p.r }; }
    const tier = best.score >= 0.95 ? 'A' : best.score >= 0.75 ? 'B' : 'C';
    const sourceIsService = isServicePn(best.row.partNo);
    const auto = tier === 'A' && sourceIsService;
    rows.push({ partNo, description, tier, score: Math.round(best.score * 1000) / 1000, matchedTo: best.row.partNo, matchedProduct: best.row.product, auto, reason: auto ? 'Tier A, matched a service part' : tier === 'A' ? 'Tier A, but matched a production part (totes/returnables differ)' : `Tier ${tier} — review` });
    if (auto) {
      const src = best.row;
      const copy = { ...src, partNo, product: `${description} [similar-part-match-needed]`, oemPn: '', signedForm: '', flags: [], tags: ['similar-part-match'], source: `copied from ${src.partNo}`, updatedAt: asOf };
      changes.push({ op: 'add', row: copy });
    }
  }
  return { changes, report: rows };
}

// ---------- R9 supersession chains ----------
export function resolveChains(sq01) {
  const out = new Map();
  for (const e of sq01) { if (!out.has(e.oldMaterial)) out.set(e.oldMaterial, []); out.get(e.oldMaterial).push(e); }
  const pickNext = (pn) => {
    const edges = out.get(pn);
    if (!edges) return { next: null };
    if (edges.length === 1) return { next: edges[0].newMaterial };
    const sorted = [...edges].sort((a, b) => (a.createdOn < b.createdOn ? 1 : -1));
    if (sorted[0].createdOn === sorted[1].createdOn) return { next: null, fork: 'tie', options: edges.map((e) => e.newMaterial) };
    return { next: sorted[0].newMaterial, fork: 'latest', options: edges.map((e) => e.newMaterial) };
  };
  const news = new Set(sq01.map((e) => e.newMaterial));
  const chains = [], manual = [];
  const starts = [...out.keys()].filter((pn) => !news.has(pn));
  const startsCyc = [...out.keys()].filter((pn) => news.has(pn));
  const walk = (start) => {
    const path = [start], visited = new Set([start]);
    const forks = [];
    let cur = start;
    for (;;) {
      const step = pickNext(cur);
      if (step.fork) forks.push({ at: cur, kind: step.fork, options: step.options, adopted: step.next });
      if (step.fork === 'tie') { manual.push({ kind: 'FORK_TIE', at: cur, options: step.options, path: [...path] }); return { path, final: null, forks, status: 'MANUAL' }; }
      if (!step.next) return { path, final: cur, forks, status: 'OK' };
      if (visited.has(step.next)) { manual.push({ kind: 'CYCLE', at: cur, back: step.next, path: [...path, step.next] }); return { path: [...path, step.next], final: null, forks, status: 'CYCLE' }; }
      visited.add(step.next); path.push(step.next); cur = step.next;
    }
  };
  for (const s of starts) chains.push({ start: s, ...walk(s) });
  // cycles have no start node outside the cycle
  const covered = new Set(chains.flatMap((c) => c.path));
  for (const s of startsCyc) if (!covered.has(s)) { const c = walk(s); chains.push({ start: s, ...c }); c.path.forEach((p) => covered.add(p)); }
  return { chains, manual };
}

// ---------- R10 old/new sync: review (no save) then apply ----------
// `returnable` is not synced: blank means "one-way packaging", not "missing".
export const SYNC_FIELDS = ['puType', 'puL', 'puW', 'puH', 'partsPerPu', 'puPerHu', 'huL', 'huW', 'huH', 'huType', 'stackTrailer', 'stackWarehouse', 'weightG', 'tarePu', 'grossPu', 'grossHu', 'moq', 'supplierCode', 'supplierName'];
export function syncReview(data) {
  const { chains } = resolveChains(data.sq01);
  const byPn = new Map(data.pkg.map((r) => [r.partNo, r]));
  const whBy = new Map(data.wh.map((w) => [w.material, w]));
  const pairs = [];
  for (const c of chains) {
    if (c.status !== 'OK') continue;
    for (let i = 0; i < c.path.length - 1; i++) pairs.push([c.path[i], c.path[i + 1]]);
  }
  const rows = [], changes = [], whChanges = [];
  for (const [o, n] of pairs) {
    const ro = byPn.get(o), rn = byPn.get(n);
    if (!ro || !rn) continue;
    for (const f of SYNC_FIELDS) {
      if (isBlank(ro[f]) && !isBlank(rn[f])) { rows.push({ old: o, new: n, field: f, direction: 'new → old', value: rn[f] }); changes.push({ op: 'set', partNo: o, field: f, value: rn[f], source: `sync from ${n}` }); }
      else if (!isBlank(ro[f]) && isBlank(rn[f])) { rows.push({ old: o, new: n, field: f, direction: 'old → new', value: ro[f] }); changes.push({ op: 'set', partNo: n, field: f, value: ro[f], source: `sync from ${o}` }); }
    }
    const wo = whBy.get(o), wn = whBy.get(n);
    if (wo && !wn) { rows.push({ old: o, new: n, field: 'warehouse', direction: 'old → new', value: whLabel(wo) }); whChanges.push({ ...wo, material: n, copiedFrom: o }); }
    changes.push({ op: 'tag', partNo: o, tag: `old → ${n}` });
  }
  return { changes, whChanges, report: rows };
}
export const whLabel = (w) => w.area === 'HIGHBAY' ? `HB ${w.row}-${String(w.bay).padStart(2, '0')}-${w.level} L${w.lane}${w.lanes > 1 ? `–${w.lane + w.lanes - 1}` : ''}` : w.area === 'VLM' ? `VLM ${w.tray}` : `NOT-WH ${w.lineside}`;
export function applyWh(wh, whChanges) {
  const have = new Set(wh.map((w) => w.material));
  return [...wh, ...whChanges.filter((w) => !have.has(w.material))];
}

// ---------- R11 lifecycle ----------
const OBS_EXACT = new Set(['OBSOLETE', 'OBSO', 'OBSL', 'OBSLT']);
export function obsoleteMark(text) {
  for (const t of String(text ?? '').toUpperCase().split(/[^A-Z]+/)) {
    if (!t) continue;
    if (OBS_EXACT.has(t)) return t;
    if (t.length >= 6 && levenshtein(t, 'OBSOLETE') <= 1) return t;
  }
  return null;
}
const CONSUME = new Set(['261', '201', '551', '221']);
export function lifecycle(data, config, asOf) {
  const plan = data.matplan.filter((m) => m.date === asOf);
  const byPn = new Map(data.pkg.map((r) => [r.partNo, r]));
  const since = addDays(asOf, -config.recentDays);
  const used = new Set();
  for (const m of data.mb51) if (CONSUME.has(m.mvt) && m.postingDate > since && m.postingDate <= asOf) used.add(m.material);
  const oo = new Map();
  for (const o of data.openorders) { if (!oo.has(o.material)) oo.set(o.material, []); oo.get(o.material).push(o); }
  const result = [];
  for (const m of plan) {
    const r = byPn.get(m.material);
    const mark = obsoleteMark(m.description) || obsoleteMark(m.program) || obsoleteMark(r?.product);
    const snaps = (oo.get(m.material) || []).filter((o) => o.week <= asOf).sort((a, b) => (a.week < b.week ? 1 : -1));
    const weeks = [...new Set(snaps.map((s) => s.week))].slice(0, config.ooWeeks);
    const recent = snaps.filter((s) => weeks.includes(s.week));
    const hasOO = recent.some((s) => s.qty > 0);
    const ooUnconfirmed = !hasOO && weeks.length < config.ooWeeks;
    const recentUse = used.has(m.material);
    let state, reason;
    if (mark) { state = 'Obsolete'; reason = `Description marked "${mark}"`; }
    else {
      state = hasOO ? (recentUse ? 'Active' : 'Phase-in') : (recentUse ? 'Run-out' : 'Inactive');
      reason = `${hasOO ? 'Open orders' : 'No open orders'} · ${recentUse ? `usage in last ${config.recentDays} days` : `no usage in last ${config.recentDays} days`}`;
    }
    result.push({ partNo: m.material, description: m.description, program: m.program, state, reason, hasOO, recentUse, ooUnconfirmed, weeksSeen: weeks.length });
  }
  return result;
}

// ---------- R12 transition check for old/new pairs ----------
export function transitionCheck(data, lc) {
  const st = new Map(lc.map((x) => [x.partNo, x.state]));
  const out = [];
  for (const e of data.sq01) {
    const o = st.get(e.oldMaterial), n = st.get(e.newMaterial);
    if (!o || !n) continue;
    if (o === 'Run-out' && n === 'Phase-in') out.push({ old: e.oldMaterial, new: e.newMaterial, oldState: o, newState: n, verdict: 'Normal changeover' });
    else if (o === 'Inactive' && n !== 'Phase-in') out.push({ old: e.oldMaterial, new: e.newMaterial, oldState: o, newState: n, verdict: 'Check' });
  }
  return out;
}

// ---------- R13 planning list day-over-day ----------
export function planningDelta(matplan, asOf) {
  const prev = addDays(asOf, -1);
  const d0 = new Map(matplan.filter((m) => m.date === asOf).map((m) => [m.material, m]));
  const d1 = new Map(matplan.filter((m) => m.date === prev).map((m) => [m.material, m]));
  return {
    added: [...d0.keys()].filter((k) => !d1.has(k)).map((k) => d0.get(k)),
    removed: [...d1.keys()].filter((k) => !d0.has(k)).map((k) => d1.get(k)),
  };
}

// ---------- R14 3D stacking ----------
export function stackCount(puHmm, config) {
  if (!puHmm) return 0;
  return Math.min(config.maxStack, Math.floor(config.levelHeightIn / (puHmm / 25.4)));
}

// ---------- R15 slot reallocation candidates ----------
export function slotCandidates(wh, lc, asOf) {
  const st = new Map(lc.map((x) => [x.partNo, x]));
  const out = [];
  for (const w of wh) {
    if (w.area !== 'HIGHBAY') continue;
    const x = st.get(w.material);
    if (x && (x.state === 'Obsolete' || x.state === 'Inactive')) out.push({ partNo: w.material, location: whLabel(w), lanes: w.lanes, state: x.state, reason: `${x.reason} (as of ${asOf})` });
  }
  return { lanes: out.reduce((s, x) => s + x.lanes, 0), rows: out };
}

// ---------- R16 DOH badge ----------
export function dohStatus(m, config) {
  if (m.doh === 0) return { status: 'EXCLUDED', reason: 'DOH is exactly 0' };
  if (obsoleteMark(m.description)) return { status: 'EXCLUDED', reason: 'Obsolete wording' };
  if (isBlank(m.supplier)) return { status: 'EXCLUDED', reason: 'Supplier blank' };
  if (m.doh < 0 || m.doh === 999) return { status: 'NEEDS_REVIEW', reason: m.doh < 0 ? 'Negative DOH' : 'Placeholder 999' };
  if (m.doh < config.dohRed) return { status: 'RED', reason: `DOH < ${config.dohRed}` };
  if (m.doh > config.dohOrange) return { status: 'ORANGE', reason: `DOH > ${config.dohOrange}` };
  return { status: 'GREEN', reason: `${config.dohRed}–${config.dohOrange} DOH` };
}

// ---------- R32 PU size review ----------
// The 3D view fits every box into its lane: one lane wide, at most the rack depth, the stack inside the
// 26" level. When the packaging data can't be drawn that way, say why — the 3D squeezes the box and
// never changes the data, because the data is what needs a look.
export const LANE_W_MM = 650, RACK_DEPTH_MM = 44 * 25.4;
export function puReview(p, config) {
  if (!p || !(p.puL > 0) || !(p.puW > 0) || !(p.puH > 0)) return ['No PU dimensions — drawn with a default box'];
  const out = [], inch = (mm) => Math.round(mm / 25.4 * 10) / 10;
  if (p.puH / 25.4 > config.levelHeightIn) out.push(`PU height ${inch(p.puH)}" is over the ${config.levelHeightIn}" level — drawn squeezed`);
  if (p.puW > LANE_W_MM) out.push(`PU width ${p.puW} mm is wider than a lane (${LANE_W_MM} mm) — drawn at lane width`);
  if (p.puL > RACK_DEPTH_MM) out.push(`PU length ${p.puL} mm is deeper than the rack (44") — drawn at rack depth`);
  return out;
}

// ---------- R18 showcase order ----------
export function showcaseOrder(data, config, asOf) {
  const plan = new Map(data.matplan.filter((m) => m.date === asOf).map((m) => [m.material, m]));
  const rank = { RED: 0, GREEN: 1, ORANGE: 1, NEEDS_REVIEW: 2, EXCLUDED: 2, NONE: 2 };
  const items = data.wh.filter((w) => w.area === 'HIGHBAY' || w.area === 'VLM').map((w) => {
    const m = plan.get(w.material);
    const s = m ? dohStatus(m, config).status : 'NONE';
    return { partNo: w.material, location: whLabel(w), area: w.area, doh: m ? m.doh : null, status: s };
  });
  return items.sort((a, b) => rank[a.status] - rank[b.status] || (a.doh ?? 1e9) - (b.doh ?? 1e9) || (a.partNo < b.partNo ? -1 : 1));
}
