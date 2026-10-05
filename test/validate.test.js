import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import XLSX from 'xlsx';
import { CONFIG } from '../src/seed.js';
import { validateImport, acceptedRows, checkPn, checkDate, checkNum, checkVendor } from '../src/validate.js';

const dir = new URL('../samples/imports/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
const readCells = (file) => {
  const wb = XLSX.read(readFileSync(new URL(file, dir)), { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: true, defval: '' });
};

for (const s of manifest) {
  test(`import ${s.file}: ${s.title}`, () => {
    const r = validateImport(readCells(s.file), s.target, CONFIG);
    const e = s.expect;
    assert.equal(r.blocked, e.blocked, r.reason);
    if (e.missingColumns) assert.deepEqual(r.missingColumns, e.missingColumns);
    if (e.blocked) {
      assert.equal(acceptedRows(r).length, 0, 'blocked file applies nothing');
      if (e.reasonIncludes) assert.match(r.reason, new RegExp(e.reasonIncludes));
    }
    for (const k of ['ok', 'coerced', 'rejected', 'skipped']) if (k in e) assert.equal(r.counts[k], e[k], `${k} count`);
    const rowsWith = (st) => r.rows.filter((x) => x.status === st).map((x) => x.row);
    if (e.rejectedRows) assert.deepEqual(rowsWith('rejected'), e.rejectedRows);
    if (e.coercedRows) assert.deepEqual(rowsWith('coerced'), e.coercedRows);
    if (e.mergedRows) assert.deepEqual(rowsWith('duplicate'), e.mergedRows);
    if (e.headerRow) assert.equal(r.headerRow, e.headerRow);
    if (e.unknownColumns) assert.deepEqual(r.unknownColumns, e.unknownColumns);
    if (e.ambiguousRows) for (const n of e.ambiguousRows) assert.ok(r.rows.find((x) => x.row === n).issues.some((i) => /Ambiguous/.test(i.reason)));
    // every non-ok row explains itself
    for (const row of r.rows) if (row.status !== 'ok') assert.ok(row.issues.length > 0 && row.issues.every((i) => i.reason), `row ${row.row} has reasons`);
  });
}

test('R20 part numbers', () => {
  assert.deepEqual(checkPn(21234567), { status: 'coerced', value: '21234567', reason: 'Number cell → text' });
  assert.equal(checkPn('2.1234567E+07').value, '21234567');
  assert.equal(checkPn('2.51E+07').status, 'rejected');
  assert.equal(checkPn('2123-4567').value, '21234567');
  assert.equal(checkPn('451234567').status, 'rejected', '45 prefix is 8 digits');
  assert.equal(checkPn('151234567').status, 'ok', '15 prefix is 9 digits');
  assert.equal(checkPn('41234567').status, 'rejected', '4 must be 45/46');
});
test('R21 numbers and R22 dates', () => {
  assert.equal(checkNum('1,200').value, 1200);
  assert.equal(checkNum('12 kg').value, 12);
  assert.equal(checkNum('N/A').status, 'rejected');
  assert.equal(checkDate('03/04/2026', CONFIG).value, '2026-03-04');
  assert.equal(checkDate('03/04/2026', CONFIG).ambiguous, true);
  assert.equal(checkDate('14/09/2026', CONFIG).value, '2026-09-14');
  assert.equal(checkDate('02/30/2026', CONFIG).status, 'rejected');
  assert.equal(checkDate(46295, CONFIG).value, '2026-09-30');
  assert.equal(checkVendor(104200).value, '0000104200');
});
