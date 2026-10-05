// App state: seed data + the user's applied changes, replayed on load.
// All persistence goes through `store` — swap it for an API later without touching screens.
import { makeSeed } from './seed.js';
import * as R from './rules.js';

const PREFIX = 'pfepDemo.v1.';
const MAX_AGE_MS = 6 * 3600 * 1000;
const mem = new Map();
const ls = (() => { try { const k = PREFIX + '__t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; } catch { return null; } })();

export const store = {
  load(key, fallback) {
    try { const v = ls ? ls.getItem(PREFIX + key) : mem.get(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  save(key, value) {
    const s = JSON.stringify(value);
    try { if (ls) ls.setItem(PREFIX + key, s); else mem.set(key, s); } catch { mem.set(key, s); }
  },
  clear() {
    try { if (ls) Object.keys(ls).filter((k) => k.startsWith(PREFIX)).forEach((k) => ls.removeItem(k)); } catch { /* ignore */ }
    mem.clear();
  },
};

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);

export const state = { data: null, batches: [], ingested: new Set(), imported: new Set() };

function mergeImport(data, target, rows, asOf) {
  if (target === 'matplan') {
    const idx = new Map(data.matplan.map((m, i) => [m.date + '|' + m.material, i]));
    for (const r of rows) {
      const i = idx.get(asOf + '|' + r.material);
      if (i !== undefined) Object.assign(data.matplan[i], r);
      else data.matplan.push({ date: asOf, description: '', supplier: '', planner: '', program: '', ...r });
    }
  } else if (target === 'vendors') {
    const idx = new Map(data.vendors.map((v, i) => [v.material, i]));
    for (const r of rows) { const i = idx.get(r.material); if (i !== undefined) Object.assign(data.vendors[i], r); else data.vendors.push(r); }
  } else if (target === 'openorders') {
    const idx = new Map(data.openorders.map((o, i) => [o.material + '|' + o.week, i]));
    for (const r of rows) { const i = idx.get(r.material + '|' + r.week); if (i !== undefined) data.openorders[i].qty = r.qty; else data.openorders.push(r); }
  } else if (target === 'mb51') {
    const seen = new Set(data.mb51.map((m) => [m.postingDate, m.material, m.mvt, m.qty].join('|')));
    let n = 0;
    for (const r of rows) {
      const k = [r.postingDate, r.material, r.mvt, r.qty].join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      data.mb51.push({ id: `IMP${String(++n).padStart(5, '0')}`, description: '', sloc: '', ...r });
    }
  } else if (target === 'wh') {
    const idx = new Map(data.wh.map((w, i) => [w.material, i]));
    for (const r of rows) {
      const rec = { lane: 1, lanes: 1, tray: '', lineside: '', row: '', bay: '', level: '', ...r };
      const i = idx.get(r.material);
      if (i !== undefined) Object.assign(data.wh[i], rec); else data.wh.push(rec);
    }
  }
}

function applyBatch(b) {
  const d = state.data;
  if (b.pkg?.length) d.pkg = R.applyChanges(d.pkg, b.pkg, d.asOf);
  if (b.wh?.length) d.wh = R.applyWh(d.wh, b.wh);
  if (b.forms?.length) for (const f of b.forms) { d.forms.push(f); state.ingested.add(f.file); }
  if (b.import) { mergeImport(d, b.import.target, b.import.rows, d.asOf); state.imported.add(b.import.file); }
}

export function init() {
  const meta = store.load('meta', null);
  if (!meta || Date.now() - meta.createdAt > MAX_AGE_MS) { store.clear(); store.save('meta', { createdAt: Date.now() }); }
  state.data = makeSeed();
  state.batches = store.load('batches', []);
  state.ingested = new Set(); state.imported = new Set();
  for (const b of state.batches) applyBatch(b);
}

export function commit(batch) {
  const b = { at: new Date().toISOString(), ...batch };
  applyBatch(b);
  state.batches.push(b);
  store.save('batches', state.batches);
  listeners.forEach((fn) => fn(b));
}

export function reset() {
  store.clear();
  store.save('meta', { createdAt: Date.now() });
  init();
  listeners.forEach((fn) => fn({ kind: 'RESET' }));
}

export function exportJson() {
  const d = state.data;
  return JSON.stringify({ exportedAt: new Date().toISOString(), asOf: d.asOf, company: d.company, note: 'Fictional demo data', batches: state.batches, pkg: d.pkg, vendors: d.vendors, sq01: d.sq01, matplan: d.matplan, openorders: d.openorders, wh: d.wh, forms: d.forms }, null, 2);
}
