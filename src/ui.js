// Small DOM helpers shared by the screens. Text always goes in as text nodes (no innerHTML from data).

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const fmt = (v) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? (v.length ? v.join(', ') : '—') : typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString('en-US') : String(Math.round(v * 1000) / 1000)) : String(v));

export function badge(text, kind = '') { return h('span', { class: `badge ${kind}` }, text); }

const LIFE_CLASS = { Active: 'b-active', 'Phase-in': 'b-phasein', 'Run-out': 'b-runout', Inactive: 'b-inactive', Obsolete: 'b-obsolete' };
export const lifeBadge = (s) => badge(s, LIFE_CLASS[s] || '');
const DOH_CLASS = { RED: 'b-red', GREEN: 'b-green', ORANGE: 'b-orange', NEEDS_REVIEW: 'b-review', EXCLUDED: 'b-muted', NONE: 'b-muted' };
const DOH_TEXT = { RED: 'Red', GREEN: 'Green', ORANGE: 'Orange', NEEDS_REVIEW: 'Needs review', EXCLUDED: 'Excluded', NONE: 'Not on plan' };
export const dohBadge = (s) => badge(DOH_TEXT[s] || s, DOH_CLASS[s] || '');
const ST_CLASS = { ok: 'b-green', coerced: 'b-orange', rejected: 'b-red', duplicate: 'b-muted' };
export const statusBadge = (s) => badge(s === 'duplicate' ? 'Merged' : s[0].toUpperCase() + s.slice(1), ST_CLASS[s] || '');

export function pnLink(pn) {
  return h('a', { class: 'pn', href: `#lookup/${pn}`, title: 'Look up this part' }, pn);
}

// columns: [{ key, label, render?(row), num?, cls? }]
export function table(columns, rows, opts = {}) {
  const head = h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: [c.num ? 'num' : '', c.cls || ''].join(' ').trim() || null, scope: 'col' }, c.label))));
  const body = h('tbody', {}, rows.map((r) => h('tr', { class: opts.rowClass ? opts.rowClass(r) : null }, columns.map((c) => h('td', { class: [c.num ? 'num' : '', c.cls || ''].join(' ').trim() || null }, c.render ? c.render(r) : fmt(r[c.key]))))));
  const t = h('table', { class: `tbl ${opts.dense ? 'dense' : ''}` }, head, body);
  return h('div', { class: 'tbl-wrap', tabindex: '0', role: 'region', 'aria-label': opts.label || 'Table' }, t);
}

export function empty(text) { return h('p', { class: 'empty' }, text); }

export function section(title, sub, ...body) {
  return h('section', { class: 'panel' }, h('header', { class: 'panel-head' }, h('h2', {}, title), sub ? h('p', { class: 'sub' }, sub) : null), ...body);
}

export function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

export function stat(label, value, note, href) {
  const inner = [h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, fmt(value)), note ? h('span', { class: 'stat-note' }, note) : null];
  return href ? h('a', { class: 'stat', href }, inner) : h('div', { class: 'stat' }, inner);
}

export function steps(list) { return h('ol', { class: 'steps' }, list.map((s) => h('li', {}, s))); }

// replaceChildren() prints null/false as text — always go through fill().
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  return el;
}
