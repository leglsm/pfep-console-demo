// Reads a PDF's text layer in the browser (pdf.js) and returns it as lines,
// then hands the lines to the pure parser in rules.js.
import * as pdfjs from '../lib/pdf.min.mjs';
import { parseFormText } from './rules.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../lib/pdf.worker.min.mjs', import.meta.url).href;

export async function openPdf(bytes) {
  return pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
}

// Group text items into lines by their baseline (y), left to right.
export async function pdfLines(doc) {
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map();
    for (const it of tc.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x: it.transform[4], s: it.str });
    }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => lines.push(items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim()));
  }
  return lines;
}

export async function readForm(bytes) {
  const doc = await openPdf(bytes);
  const lines = await pdfLines(doc);
  return { doc, lines, fields: parseFormText(lines.join('\n')) };
}

export async function renderPage(doc, canvas, cssWidth) {
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = page.getViewport({ scale: scale * dpr });
  canvas.width = vp.width; canvas.height = vp.height;
  canvas.style.width = `${cssWidth}px`; canvas.style.height = `${vp.height / dpr}px`;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
}
