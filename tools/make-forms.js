// Renders the sample packaging forms (fictional) to samples/forms/*.pdf.
// Each field is printed as one "Label: value" text line so the browser can read the text layer.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeSeed, COMPANY } from '../src/seed.js';
import { FORM_LAYOUT } from '../src/rules.js';

const FIXED_DATE = new Date('2026-09-30T12:00:00Z');
const OUT = new URL('../samples/forms/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const data = makeSeed();
const manifest = [];

for (const f of data.newForms) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Packaging Specification ${f.fields.partNo}`);
  doc.setAuthor(COMPANY); doc.setCreator('pfep-console-demo'); doc.setProducer('pfep-console-demo');
  doc.setCreationDate(FIXED_DATE); doc.setModificationDate(FIXED_DATE);
  const page = doc.addPage([612, 792]);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.14, 0.18), muted = rgb(0.42, 0.45, 0.5), line = rgb(0.8, 0.82, 0.86);

  page.drawText(COMPANY.toUpperCase(), { x: 54, y: 735, size: 10, font: bold, color: muted });
  page.drawText('Packaging Specification Form', { x: 54, y: 710, size: 20, font: bold, color: ink });
  page.drawText('Supplier packaging approval — fictional sample for demo use', { x: 54, y: 692, size: 9, font: reg, color: muted });
  page.drawLine({ start: { x: 54, y: 680 }, end: { x: 558, y: 680 }, thickness: 1, color: line });

  let y = 652;
  for (const [key, label] of FORM_LAYOUT) {
    if (key === 'signedBy') {
      y -= 14;
      page.drawLine({ start: { x: 54, y: y + 16 }, end: { x: 558, y: y + 16 }, thickness: 0.6, color: line });
      page.drawText('APPROVAL', { x: 54, y, size: 9, font: bold, color: muted });
      y -= 22;
    }
    const value = f.fields[key] ?? '';
    // One text run per field: "Label: value" keeps the text layer parseable line by line.
    page.drawText(`${label}: ${value || '____________'}`, { x: 54, y, size: 11, font: reg, color: ink });
    y -= 24;
  }
  page.drawText('Values in this form are fictional.', { x: 54, y: 48, size: 8, font: reg, color: muted });

  const bytes = await doc.save({ useObjectStreams: false });
  writeFileSync(new URL(f.file, OUT), bytes);
  manifest.push({ file: f.file, partNo: f.fields.partNo, case: f.case });
}
writeFileSync(new URL('manifest.json', OUT), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${manifest.length} forms`);
