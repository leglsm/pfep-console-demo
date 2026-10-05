// Writes the sample spreadsheets (fictional) to samples/imports/*.xlsx.
// Cell types are kept on purpose: numbers stay number cells, {date} becomes a real date cell,
// text stays text — that is how the planted format breaks are reproduced.
import XLSX from 'xlsx';
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeSeed } from '../src/seed.js';
import { buildImportSamples, toSerial } from '../src/import-samples.js';

const OUT = new URL('../samples/imports/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const samples = buildImportSamples(makeSeed());
for (const s of samples) {
  const ws = {};
  let maxC = 0;
  s.cells.forEach((row, r) => (row || []).forEach((v, c) => {
    if (v === '' || v === null || v === undefined) return;
    const ref = XLSX.utils.encode_cell({ r, c });
    if (typeof v === 'object' && v.date) ws[ref] = { t: 'n', v: toSerial(v.date), z: 'm/d/yyyy' };
    else if (typeof v === 'number') ws[ref] = { t: 'n', v };
    else ws[ref] = { t: 's', v: String(v) };
    maxC = Math.max(maxC, c);
  }));
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: s.cells.length - 1, c: maxC } });
  const wb = XLSX.utils.book_new();
  wb.Props = { Title: s.title, Author: 'pfep-console-demo', CreatedDate: new Date('2026-09-30T12:00:00Z') };
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  writeFileSync(new URL(s.file, OUT), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }));
}
writeFileSync(new URL('manifest.json', OUT), JSON.stringify(samples.map(({ file, target, title, expect }) => ({ file, target, title, expect })), null, 2) + '\n');
console.log(`wrote ${samples.length} spreadsheets`);
