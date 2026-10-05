// Builds the sample spreadsheets used by the Imports screen. Each sample carries the
// format breaks we planted and the outcome the validator must produce (`expect`).
// tools/make-imports.js writes them to samples/imports/*.xlsx; tests read those files back.

const DATE0 = Date.UTC(1899, 11, 30);
export const toSerial = (isoDate) => Math.round((Date.parse(isoDate + 'T00:00:00Z') - DATE0) / 86400000);
const sci = (pn, keep) => `${pn[0]}.${pn.slice(1, keep)}E+${String(pn.length - 1).padStart(2, '0')}`;

export function buildImportSamples(data) {
  const d0 = data.matplan.filter((m) => m.date === data.asOf);
  const planRows = (n, offset = 0) => d0.slice(offset, offset + n);
  const MP_HEAD = ['Material', 'Description', 'Supplier', 'Planner', 'Stock', 'DOH', 'Program'];
  const mpRow = (m) => [m.material, m.description, m.supplier, m.planner, m.stock, m.doh, m.program];
  const out = [];

  // IM-01 clean
  out.push({
    file: 'IM-01_matplan_clean.xlsx', target: 'matplan', title: 'Clean planning export',
    cells: [MP_HEAD, ...planRows(30).map(mpRow)],
    expect: { blocked: false, rejected: 0, coerced: 0, ok: 30 },
  });

  // IM-02 part numbers damaged by Excel
  {
    const rows = planRows(30, 30).map(mpRow);
    const pn = (i) => rows[i][0];
    rows[2][0] = Number(pn(2));                    // number cell
    rows[4][0] = Number(pn(4));                    // number cell
    rows[6][0] = sci(pn(6), 8);                    // full-precision scientific text
    rows[8][0] = sci(pn(8), 3);                    // 2.51E+07 — digits lost
    rows[10][0] = `${pn(10).slice(0, 4)}-${pn(10).slice(4)}`;
    rows[12][0] = ` ${pn(12)} `;
    rows[14][0] = 'PN-TBD';
    out.push({
      file: 'IM-02_matplan_part-numbers.xlsx', target: 'matplan', title: 'Part numbers turned into numbers / scientific notation',
      cells: [MP_HEAD, ...rows],
      expect: { blocked: false, rejected: 2, coerced: 5, rejectedRows: [10, 16], coercedRows: [4, 6, 8, 12, 14] },
    });
  }

  // IM-03 renamed + reordered headers under a title block, extra column
  {
    const oo = data.openorders.slice(0, 30);
    out.push({
      file: 'IM-03_openorders_renamed-headers.xlsx', target: 'openorders', title: 'Renamed, reordered headers under a title row',
      cells: [
        ['Open order forecast — exported for planning review'],
        [],
        ['Week Start', 'Open Qty', 'Part Number', 'Planner Note'],
        ...oo.map((o, i) => [{ date: o.week }, o.qty, o.material, i % 7 === 0 ? 'check with buyer' : '']),
      ],
      expect: { blocked: false, rejected: 0, coerced: 0, ok: 30, headerRow: 3, unknownColumns: ['Planner Note'] },
    });
  }

  // IM-04 required column missing -> whole file blocked
  out.push({
    file: 'IM-04_vendors_missing-column.xlsx', target: 'vendors', title: 'Vendor number column missing',
    cells: [['Material', 'Vendor Name'], ...data.vendors.slice(0, 20).map((v) => [v.material, v.vendorName])],
    expect: { blocked: true, missingColumns: ['vendorNo'] },
  });

  // IM-05 MB51 with mixed dates and numbers stored as text
  {
    const mv = data.mb51.slice(-30);
    const rows = mv.map((m) => [{ date: m.postingDate }, m.material, m.description, Number(m.mvt), m.qty, m.sloc]);
    rows[1][0] = '09/14/2026';      // MM/DD text
    rows[3][0] = '14/09/2026';      // DD/MM text (first > 12)
    rows[5][0] = '09/08/2026';      // ambiguous -> MM/DD
    rows[7][0] = '2026-9-3';        // unpadded ISO
    rows[9][0] = 'TBD';             // rejected
    rows[11][4] = '1,200';          // comma
    rows[13][4] = '12 pcs';         // unit text
    rows[15][4] = 'N/A';            // rejected
    rows[17][0] = '30.09.2026';     // DD.MM.YYYY
    const cells = [['Posting Date', 'Material', 'Material Description', 'Movement Type', 'Quantity', 'Storage Location'], ...rows.slice(0, 20), [], ...rows.slice(20), ['Total', '', '', '', 0, '']];
    out.push({
      file: 'IM-05_mb51_dates-and-numbers.xlsx', target: 'mb51', title: 'Mixed date formats, numbers stored as text',
      cells,
      expect: { blocked: false, rejected: 2, coerced: 7, skipped: 2, rejectedRows: [11, 17], ambiguousRows: [7] },
    });
  }

  // IM-06 warehouse with duplicate keys
  {
    const hb = data.wh.filter((w) => w.area === 'HIGHBAY').slice(0, 24);
    const rows = hb.map((w) => [w.material, w.area, w.row, w.bay, w.level, w.lanes]);
    rows[3][1] = 'High Bay';
    rows.splice(6, 0, [...rows[5]]);                       // exact duplicate of row 7 -> merged
    rows.splice(12, 0, [rows[11][0], 'HIGHBAY', 'F', 12, 4, 2]); // same part, different place -> both rejected
    out.push({
      file: 'IM-06_wh_duplicates.xlsx', target: 'wh', title: 'Duplicate part rows (identical and conflicting)',
      cells: [['Material', 'Area', 'Row', 'Bay', 'Level', 'Lanes'], ...rows],
      expect: { blocked: false, rejected: 2, rejectedRows: [13, 14], mergedRows: [8] },
    });
  }

  // IM-07 columns shifted on half the rows -> blocked by reject rate
  {
    const rows = planRows(20, 60).map(mpRow);
    for (let i = 5; i < 15; i++) rows[i] = [rows[i][0], rows[i][1], rows[i][2], rows[i][3], '', rows[i][4], rows[i][5], rows[i][6]];
    out.push({
      file: 'IM-07_matplan_shifted-columns.xlsx', target: 'matplan', title: 'Columns shifted on half the rows',
      cells: [MP_HEAD, ...rows],
      expect: { blocked: true, rejected: 10, reasonIncludes: 'rejected' },
    });
  }

  // IM-08 vendor numbers that lost leading zeros
  {
    const rows = data.vendors.slice(20, 40).map((v, i) => [v.material, i % 2 ? v.vendorNo : Number(v.vendorNo), v.vendorName]);
    out.push({
      file: 'IM-08_vendors_leading-zeros.xlsx', target: 'vendors', title: 'Vendor numbers lost their leading zeros',
      cells: [['Material', 'Vendor Number', 'Vendor Name'], ...rows],
      expect: { blocked: false, rejected: 0, coerced: 10, ok: 10 },
    });
  }
  return out;
}
