/*
 * Package Database Console (PFEP) — demo. Fictional data only.
 *
 * FEATURES
 *  F-01 Data quality overview (landing)      F-10 Lifecycle 2×2 (+ obsolete override)
 *  F-02 PFEP table (34 columns)              F-11 Planning-list day-over-day delta
 *  F-03 Form ingest (PDF text layer)         F-12 3D high-bay warehouse
 *  F-04 Form → PFEP mapping rules            F-13 Slot reallocation candidates
 *  F-05 Conflicts: signed form wins          F-14 TV showcase (Red first, lowest DOH)
 *  F-06 Systematic error detection/fix       F-15 Part lookup with source mismatches
 *  F-07 Service parts by similar-part match  F-16 DOH status badge
 *  F-08 Supersession chains (fork / cycle)   F-17 Demo guide, reset, export
 *  F-09 Old/new sync: review → apply         F-18 Spreadsheet import validation
 *
 * SCHEMA (collections): pkg, vendors, sq01, mb51, matplan, openorders, wh, forms, config
 * Rules live in rules.js / validate.js (pure). Persistence only through state.js `store`.
 */
import { init, state, onChange, reset, exportJson } from './state.js';
import * as A from './screens-a.js';
import * as B from './screens-b.js';
import { h, toast } from './ui.js';

const VIEWS = [
  ['overview', 'Overview', A.overview],
  ['pfep', 'PFEP', A.pfep],
  ['imports', 'Imports', A.imports],
  ['forms', 'Form ingest', A.forms],
  ['fixes', 'Data fixes', A.fixes],
  ['supersession', 'Supersession', B.supersession],
  ['lifecycle', 'Lifecycle', B.lifecycle],
  ['warehouse', 'Warehouse 3D', B.warehouse],
  ['lookup', 'Part lookup', B.lookup],
  ['guide', 'Demo guide', B.guide],
];

const ctx = { sampleForms: [], sampleImports: [], cleanups: [], param: '' };
let wh3d = null;
ctx.mount3d = async (el, opts) => {
  if (!el) return null;
  try {
    wh3d = wh3d || (await import('./warehouse3d.js'));
    const view = wh3d.mount(el, state.data, opts);
    ctx.cleanups.push(() => view.dispose());
    return view;
  } catch (e) {
    el.replaceChildren(h('p', { class: 'muted small' }, `3D view unavailable in this browser (${e.message}).`));
    return null;
  }
};

const main = () => document.getElementById('main');

function route() {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, '')) || 'overview';
  const [name, ...rest] = raw.split('/');
  const view = VIEWS.find((v) => v[0] === name) || VIEWS[0];
  ctx.param = rest.join('/');
  ctx.cleanups.splice(0).forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  document.querySelectorAll('.nav a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.view === view[0]));
  const root = main();
  root.replaceChildren();
  root.dataset.view = view[0];
  view[2](root, ctx);
  document.title = `${view[1]} · PFEP Console demo`;
}

function buildChrome() {
  const nav = document.getElementById('nav');
  nav.replaceChildren(...VIEWS.map(([k, label]) => h('a', { href: `#${k}`, 'data-view': k }, label)));
  document.getElementById('asof').textContent = `${state.data.company} · plant ${state.data.plant} · data as of ${state.data.asOf}`;
  document.getElementById('btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('pfepDemo.theme', next); } catch { /* ignore */ }
    if (document.getElementById('main').dataset.view === 'overview' || document.getElementById('main').dataset.view === 'warehouse') route();
  });
}

ctx.reset = () => { reset(); toast('Sample data restored'); route(); };
ctx.exportJson = () => {
  const blob = new Blob([exportJson()], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `pfep-demo-export-${state.data.asOf}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

async function boot() {
  try { const t = localStorage.getItem('pfepDemo.theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* ignore */ }
  init();
  const [forms, imports] = await Promise.all([
    fetch('samples/forms/manifest.json').then((r) => r.json()).catch(() => []),
    fetch('samples/imports/manifest.json').then((r) => r.json()).catch(() => []),
  ]);
  ctx.sampleForms = forms; ctx.sampleImports = imports;
  buildChrome();
  onChange(() => { /* screens redraw themselves after commits */ });
  main().addEventListener('rerender', route);
  window.addEventListener('hashchange', route);
  route();
}
boot();
