// Spreadsheet import validation (R19–R25). Pure: (cells, target, config) -> report.
// cells: array of rows, each an array of raw cell values as read from the sheet
// (numbers stay numbers, text stays text, date cells arrive as Excel serial numbers).

export const TARGETS = {
  matplan: {
    label: 'Material planning', key: ['material'],
    columns: {
      material: { type: 'pn', required: true, aliases: ['material', 'part number', 'part no', 'pn', 'sap part number'] },
      description: { type: 'text', aliases: ['description', 'material description', 'desc'] },
      supplier: { type: 'text', aliases: ['supplier', 'vendor name', 'supplier name'] },
      planner: { type: 'text', aliases: ['planner', 'mrp controller'] },
      stock: { type: 'num', required: true, aliases: ['stock', 'unrestricted', 'on hand', 'unrestricted stock'] },
      doh: { type: 'num', required: true, aliases: ['doh', 'days on hand', 'days of supply'] },
      program: { type: 'text', aliases: ['program', 'vehicle program'] },
    },
  },
  vendors: {
    label: 'Vendor master export', key: ['material'],
    columns: {
      material: { type: 'pn', required: true, aliases: ['material', 'part number', 'pn'] },
      vendorNo: { type: 'vendor', required: true, aliases: ['vendor', 'vendor number', 'vendor no', 'supplier no', 'supplier number'] },
      vendorName: { type: 'text', required: true, aliases: ['vendor name', 'supplier name', 'name'] },
    },
  },
  openorders: {
    label: 'Open order forecast export', key: ['material', 'week'],
    columns: {
      material: { type: 'pn', required: true, aliases: ['material', 'part number', 'pn'] },
      week: { type: 'date', required: true, aliases: ['week', 'week start', 'week starting', 'bucket'] },
      qty: { type: 'num', required: true, aliases: ['qty', 'quantity', 'open qty', 'open quantity'] },
    },
  },
  mb51: {
    label: 'MB51 material movements', key: null,
    columns: {
      postingDate: { type: 'date', required: true, aliases: ['posting date', 'pstng date', 'date'] },
      material: { type: 'pn', required: true, aliases: ['material', 'part number'] },
      description: { type: 'text', aliases: ['material description', 'description'] },
      mvt: { type: 'mvt', required: true, aliases: ['movement type', 'mvt', 'mvt type', 'mvmt type'] },
      qty: { type: 'num', required: true, aliases: ['quantity', 'qty', 'qty in une'] },
      sloc: { type: 'text', aliases: ['storage location', 'sloc', 'sloc.'] },
    },
  },
  wh: {
    label: 'Warehouse locations', key: ['material'],
    columns: {
      material: { type: 'pn', required: true, aliases: ['material', 'part number'] },
      area: { type: 'area', required: true, aliases: ['area', 'storage type', 'zone'] },
      row: { type: 'text', aliases: ['row', 'aisle'] },
      bay: { type: 'int', aliases: ['bay'] },
      level: { type: 'int', aliases: ['level'] },
      lanes: { type: 'int', aliases: ['lanes', 'lane count'] },
    },
  },
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

// Part number schemes (8 digits; 15/16/33 prefixes are 9 digits).
const PN_RE = /^(?:(?:1|2|3|5|6|7|8|9)\d{7}|4[56]\d{6}|(?:15|16|33)\d{7})$/;

export function checkPn(v) {
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) return { status: 'rejected', reason: 'Part number is a decimal number' };
    const s = String(v);
    if (!PN_RE.test(s)) return { status: 'rejected', value: s, reason: `"${s}" is not a valid part number` };
    return { status: 'coerced', value: s, reason: 'Number cell → text' };
  }
  let s = String(v).trim();
  const sci = s.match(/^(\d)(?:\.(\d+))?E\+?(\d+)$/i);
  if (sci) {
    const digits = sci[1] + (sci[2] || '');
    const exp = Number(sci[3]);
    if (digits.length < exp + 1) { // fewer significant digits than the number has — the rest were rounded away
      return { status: 'rejected', reason: `"${s}" lost digits in scientific notation` };
    }
    const full = digits.slice(0, exp + 1);
    if (digits.length > exp + 1) return { status: 'rejected', reason: `"${s}" is not a whole number` };
    if (!PN_RE.test(full)) return { status: 'rejected', reason: `"${s}" → ${full} is not a valid part number` };
    return { status: 'coerced', value: full, reason: 'Scientific notation restored' };
  }
  const cleaned = s.replace(/[\s-]/g, '').replace(/\.0+$/, '');
  if (!/^\d+$/.test(cleaned)) return { status: 'rejected', reason: `"${s}" is not numeric` };
  if (!PN_RE.test(cleaned)) return { status: 'rejected', reason: `"${s}" does not fit a part-number scheme` };
  if (cleaned !== String(v)) return { status: 'coerced', value: cleaned, reason: 'Spaces, hyphens or ".0" removed' };
  return { status: 'ok', value: s };
}

export function checkVendor(v) {
  const s = (typeof v === 'number' ? String(v) : String(v).trim()).replace(/\.0+$/, '');
  if (!/^\d{1,10}$/.test(s)) return { status: 'rejected', reason: `"${v}" is not a vendor number` };
  if (s.length === 10) return typeof v === 'number' ? { status: 'coerced', value: s, reason: 'Number cell → text' } : { status: 'ok', value: s };
  return { status: 'coerced', value: s.padStart(10, '0'), reason: 'Leading zeros restored' };
}

export function checkNum(v, intOnly = false) {
  if (typeof v === 'number') {
    if (intOnly && !Number.isInteger(v)) return { status: 'rejected', reason: `${v} is not a whole number` };
    return { status: 'ok', value: v };
  }
  const s = String(v).trim();
  const m = s.replace(/,/g, '').match(/^(-?\d+(?:\.\d+)?)\s*(kg|g|mm|in|pcs|pc|ea|days?)?$/i);
  if (!m) return { status: 'rejected', reason: `"${s}" is not a number` };
  const n = Number(m[1]);
  if (intOnly && !Number.isInteger(n)) return { status: 'rejected', reason: `"${s}" is not a whole number` };
  const why = [s.includes(',') && 'commas', m[2] && `unit "${m[2]}" (not converted)`].filter(Boolean);
  return { status: 'coerced', value: n, reason: why.length ? `Removed ${why.join(' and ')}` : 'Text → number' };
}

const iso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
};
export function checkDate(v, config) {
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return { status: 'rejected', reason: `${v} is not a date` };
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return { status: 'ok', value: d.toISOString().slice(0, 10) };
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) { const r = iso(+m[1], +m[2], +m[3]); return r ? { status: s === r ? 'ok' : 'coerced', value: r, reason: 'Padded date' } : { status: 'rejected', reason: `"${s}" is not a calendar date` }; }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    let r, why;
    if (a > 12 && b <= 12) { r = iso(y, b, a); why = 'Read as DD/MM (first number > 12)'; }
    else if (a <= 12 && b > 12) { r = iso(y, a, b); why = 'Text date (MM/DD)'; }
    else if (a <= 12 && b <= 12) { r = config.dateOrder === 'DMY' ? iso(y, b, a) : iso(y, a, b); why = `Ambiguous — read as ${config.dateOrder === 'DMY' ? 'DD/MM' : 'MM/DD'}`; }
    return r ? { status: 'coerced', value: r, reason: why, ambiguous: a <= 12 && b <= 12 && a !== b } : { status: 'rejected', reason: `"${s}" is not a calendar date` };
  }
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) { const r = iso(+m[3], +m[2], +m[1]); return r ? { status: 'coerced', value: r, reason: 'DD.MM.YYYY text date' } : { status: 'rejected', reason: `"${s}" is not a calendar date` }; }
  return { status: 'rejected', reason: `"${s}" is not a recognised date` };
}

const AREAS = { highbay: 'HIGHBAY', 'high bay': 'HIGHBAY', hb: 'HIGHBAY', vlm: 'VLM', 'not wh': 'NOT-WH', notwh: 'NOT-WH', 'non wh': 'NOT-WH', nonwh: 'NOT-WH' };
export function checkArea(v) {
  const s = String(v).trim();
  const a = AREAS[norm(s)];
  if (!a) return { status: 'rejected', reason: `"${s}" is not HIGHBAY / VLM / NOT-WH` };
  return a === s ? { status: 'ok', value: a } : { status: 'coerced', value: a, reason: `"${s}" → ${a}` };
}

function checkCell(type, v, config) {
  switch (type) {
    case 'pn': return checkPn(v);
    case 'vendor': return checkVendor(v);
    case 'num': return checkNum(v);
    case 'int': return checkNum(v, true);
    case 'date': return checkDate(v, config);
    case 'area': return checkArea(v);
    case 'mvt': {
      const s = String(v).trim().replace(/\.0+$/, '');
      return /^\d{3}$/.test(s) ? { status: 'ok', value: s } : { status: 'rejected', reason: `"${v}" is not a movement type` };
    }
    default: return { status: 'ok', value: String(v).trim() };
  }
}

// R19: find the header row in the first 10 rows and map columns by alias.
export function findHeader(cells, schema) {
  const cols = Object.entries(schema.columns);
  let best = { row: -1, map: {}, score: -1 };
  for (let r = 0; r < Math.min(10, cells.length); r++) {
    const map = {};
    (cells[r] || []).forEach((h, c) => {
      const n = norm(h);
      if (!n) return;
      for (const [field, def] of cols) if (!(field in map) && def.aliases.includes(n)) { map[field] = c; break; }
    });
    const score = cols.filter(([f, d]) => d.required && f in map).length * 100 + Object.keys(map).length;
    if (score > best.score) best = { row: r, map, score };
  }
  return best;
}

const TOTAL_RE = /^(grand\s+)?(total|sum|subtotal)\b|^합계/i;

export function validateImport(cells, target, config) {
  const schema = TARGETS[target];
  if (!schema) throw new Error(`Unknown import target ${target}`);
  const report = { target, label: schema.label, headerRow: null, columns: {}, unknownColumns: [], missingColumns: [], rows: [], skipped: [], counts: { ok: 0, coerced: 0, rejected: 0, skipped: 0 }, blocked: false, reason: '' };
  const h = findHeader(cells, schema);
  report.headerRow = h.row + 1;
  report.columns = Object.fromEntries(Object.entries(h.map).map(([f, c]) => [f, c + 1]));
  const missing = Object.entries(schema.columns).filter(([f, d]) => d.required && !(f in h.map)).map(([f]) => f);
  if (h.row >= 0) (cells[h.row] || []).forEach((v, c) => { if (!blank(v) && !Object.values(h.map).includes(c)) report.unknownColumns.push(String(v)); });
  if (missing.length) {
    report.missingColumns = missing;
    report.blocked = true;
    report.reason = `Required column missing: ${missing.join(', ')}`;
    return report;
  }
  const keyField = schema.key ? schema.key[0] : null;
  for (let r = h.row + 1; r < cells.length; r++) {
    const raw = cells[r] || [];
    if (raw.every(blank)) { report.skipped.push({ row: r + 1, reason: 'Empty row' }); continue; }
    const first = raw.find((v) => !blank(v));
    if (TOTAL_RE.test(String(first ?? '').trim())) { report.skipped.push({ row: r + 1, reason: 'Total row' }); continue; }
    const values = {}, issues = [];
    let status = 'ok';
    for (const [field, def] of Object.entries(schema.columns)) {
      if (!(field in h.map)) continue;
      const v = raw[h.map[field]];
      if (blank(v)) {
        if (def.required) { issues.push({ col: h.map[field] + 1, field, raw: '', status: 'rejected', reason: 'Required value is blank' }); status = 'rejected'; }
        else values[field] = '';
        continue;
      }
      const res = checkCell(def.type, v, config);
      if (res.status !== 'ok') issues.push({ col: h.map[field] + 1, field, raw: v, value: res.value, status: res.status, reason: res.reason });
      if (res.status === 'rejected') status = 'rejected';
      else { values[field] = res.value; if (res.status === 'coerced' && status === 'ok') status = 'coerced'; }
    }
    report.rows.push({ row: r + 1, status, values, issues });
  }
  // R23 duplicate keys
  if (schema.key) {
    const groups = new Map();
    for (const row of report.rows) {
      if (row.status === 'rejected') continue;
      const k = schema.key.map((f) => row.values[f]).join('|');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(row);
    }
    for (const [k, rows] of groups) {
      if (rows.length < 2) continue;
      const sig = (x) => JSON.stringify(Object.keys(schema.columns).map((f) => x.values[f] ?? ''));
      if (rows.every((x) => sig(x) === sig(rows[0]))) {
        rows.slice(1).forEach((x) => { x.status = 'duplicate'; x.issues.push({ field: keyField, status: 'coerced', reason: `Same as row ${rows[0].row} — merged` }); });
        if (rows[0].status === 'ok') rows[0].status = 'coerced';
        rows[0].issues.push({ field: keyField, status: 'coerced', reason: `Duplicate rows ${rows.slice(1).map((x) => x.row).join(', ')} merged` });
      } else {
        rows.forEach((x) => { x.status = 'rejected'; x.issues.push({ field: keyField, status: 'rejected', reason: `Key ${k} appears in rows ${rows.map((y) => y.row).join(', ')} with different values` }); });
      }
    }
  }
  report.skipped.forEach(() => report.counts.skipped++);
  for (const row of report.rows) {
    if (row.status === 'duplicate') report.counts.skipped++;
    else report.counts[row.status]++;
  }
  const dataRows = report.counts.ok + report.counts.coerced + report.counts.rejected;
  const pct = dataRows ? (report.counts.rejected / dataRows) * 100 : 0;
  report.rejectPct = Math.round(pct * 10) / 10;
  if (pct > config.importRejectMaxPct) {
    report.blocked = true;
    report.reason = `${report.rejectPct}% of rows rejected (limit ${config.importRejectMaxPct}%) — columns may be shifted`;
  }
  return report;
}

// R25: only rows that passed are applied, and only after preview.
export function acceptedRows(report) {
  if (report.blocked) return [];
  return report.rows.filter((r) => r.status === 'ok' || r.status === 'coerced').map((r) => r.values);
}
