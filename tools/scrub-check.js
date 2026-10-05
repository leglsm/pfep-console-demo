// De-identification gate: fails if any term from .scrub-terms.txt (one per line, not committed)
// appears in tracked or about-to-be-committed files. Matching is case-insensitive.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import XLSX from 'xlsx';

const termsFile = new URL('../.scrub-terms.txt', import.meta.url);
if (!existsSync(termsFile)) { console.error('No .scrub-terms.txt — create it locally (one term per line).'); process.exit(2); }
const terms = readFileSync(termsFile, 'utf8').split(/\r?\n/).map((t) => t.trim()).filter((t) => t && !t.startsWith('#'));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean);
// Whole-word match so short names don't hit inside longer words.
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const res = terms.map((t) => ({ t, re: new RegExp(`(^|[^a-z0-9])${esc(t.toLowerCase())}($|[^a-z0-9])`) }));
// Binary formats are checked by what a reader would see: PDF text layer + metadata, XLSX cell text + sheet names + properties.
const textOf = (f) => {
  if (f.endsWith('.pdf')) return execFileSync('pdftotext', [f, '-'], { encoding: 'utf8' }) + execFileSync('pdfinfo', [f], { encoding: 'utf8' });
  if (f.endsWith('.xlsx')) {
    const wb = XLSX.read(readFileSync(f), { type: 'buffer' });
    return JSON.stringify(wb.Props || {}) + wb.SheetNames.join('\n') + wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n');
  }
  return readFileSync(f, 'utf8');
};
let hits = 0;
for (const f of files) {
  let text;
  try { text = textOf(f).toLowerCase(); } catch (e) { console.log(`UNREADABLE ${f}: ${e.message.split('\n')[0]}`); hits++; continue; } // unreadable never passes
  for (const { t, re } of res) if (re.test(text)) { console.log(`HIT ${f}: "${t}"`); hits++; }
}
console.log(hits ? `${hits} hit(s) — do not push` : `0 hits across ${files.length} files, ${terms.length} terms`);
process.exit(hits ? 1 : 0);
