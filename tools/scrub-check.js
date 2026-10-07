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
  // Media: compressed pixels are random bytes and trip short terms by chance (pixels come from fictional data).
  // Video and GIF: check the container metadata (tags, comments, encoder) as ffprobe reports it.
  // PNG / JPEG: check what can hold words — printable runs of 6+ characters (like `strings`), i.e. text chunks.
  if (/\.(gif|mp4|webm)$/i.test(f)) return execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', f], { encoding: 'utf8' });
  if (/\.(png|jpe?g)$/i.test(f)) return (readFileSync(f).toString('latin1').match(/[\x20-\x7e]{6,}/g) || []).join('\n');
  return readFileSync(f, 'utf8');
};
// Vendored libraries are not term-scanned (minified third-party code trips short names);
// instead they must be byte-identical to the pinned npm package, so nothing of ours can hide in them.
const VENDORED = {
  'lib/pdf.min.mjs': 'node_modules/pdfjs-dist/build/pdf.min.mjs',
  'lib/pdf.worker.min.mjs': 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  'lib/three.module.min.js': 'node_modules/three/build/three.module.min.js',
  'lib/OrbitControls.js': 'node_modules/three/examples/jsm/controls/OrbitControls.js',
  'lib/xlsx.full.min.js': 'node_modules/xlsx/dist/xlsx.full.min.js',
  'lib/LICENSE.pdfjs.txt': 'node_modules/pdfjs-dist/LICENSE',
  'lib/LICENSE.three.txt': 'node_modules/three/LICENSE',
  'lib/LICENSE.sheetjs.txt': 'node_modules/xlsx/LICENSE',
};
let hits = 0;
for (const [f, src] of Object.entries(VENDORED)) {
  if (!files.includes(f)) continue;
  let a, b;
  try { a = readFileSync(f, 'utf8'); b = readFileSync(src, 'utf8'); } catch (e) { console.log(`UNVERIFIED ${f}: ${e.message.split('\n')[0]} (run npm install)`); hits++; continue; }
  if (f === 'lib/OrbitControls.js') b = b.replace("from 'three'", "from './three.module.min.js'"); // the one intended edit
  if (a !== b) { console.log(`MODIFIED ${f}: differs from ${src}`); hits++; }
}
for (const f of files) {
  if (f in VENDORED) continue;
  let text;
  try { text = textOf(f).toLowerCase(); } catch (e) { console.log(`UNREADABLE ${f}: ${e.message.split('\n')[0]}`); hits++; continue; } // unreadable never passes
  for (const { t, re } of res) if (re.test(text)) { console.log(`HIT ${f}: "${t}"`); hits++; }
}
console.log(hits ? `${hits} hit(s) — do not push` : `0 hits across ${files.length} files, ${terms.length} terms (${Object.keys(VENDORED).length} vendored files verified unchanged)`);
process.exit(hits ? 1 : 0);
