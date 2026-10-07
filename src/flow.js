// Warehouse flow (v92–v94 from the plant console, on demo data): replay one day of MB51 in the 3D warehouse.
//  - 101 receipts: one inbound truck per Material Document at the dock; each line is released at its entry
//    time and a forklift puts it away to the part's high-bay lane / VLM port, or to floor storage when the
//    part has no location.
//  - 261 issues: tugger runs from the bins to the line (a day without 261 gets a simulated loop, labelled).
//  - Show day KPIs: the day's numbers straight from the data, without replaying (nothing simulated in them).
// Dock, floor storage, line-side, fleet size and speeds are schematic presentation choices, not data.
// Builds on the showcase scene (warehouse3d mount) and only reads from it.
import * as THREE from '../lib/three.module.min.js';
import * as R from './rules.js';
import { state } from './state.js';
import { h, fill, fmt, pnLink, table, empty } from './ui.js';
import { FLOW, flowDays, flowPlan, locator, pacing, dayKpis, hhmm, dayLabel } from './flow-plan.js';

const D = () => state.data;
const FORK_SPEED = 5.5, TUG_SPEED = 4.2, LIFT_SPEED = 1.6, TURN_SPEED = 3.2; // m/s, rad/s at 1× — chosen to look right, not measured
const TUG_CARTS = 3;
const COLOR = { RED: '#ff6b6b', GREEN: '#4cc38a', ORANGE: '#f0a35a', NEEDS_REVIEW: '#b393ff', EXCLUDED: '#b8c0cc', NONE: '#b8c0cc' };

const statusMap = () => {
  const d = D(), c = d.config;
  const plan = new Map(d.matplan.filter((m) => m.date === d.asOf).map((m) => [m.material, m]));
  return (pn) => { const m = plan.get(pn); return m ? R.dohStatus(m, c).status : 'NONE'; };
};
const redPool = () => R.showcaseOrder(D(), D().config, D().asOf).filter((x) => x.status === 'RED').map((x) => x.partNo);
export function planFor(key) {
  const day = flowDays(D().flowlog).get(key);
  return day ? flowPlan(day, locator(D().wh), redPool()) : null;
}

// ---------------------------------------------------------------- tab screen
let tabState = { day: null, kpis: false };
export function flowScreen(root, ctx) {
  const days = flowDays(D().flowlog);
  const keys = [...days.keys()].sort().reverse();
  if (ctx.param && days.has(ctx.param)) tabState.day = ctx.param;
  if (!tabState.day || !days.has(tabState.day)) tabState.day = keys[0];
  const summary = h('p', { class: 'flow-summary' });
  const kpiWrap = h('div', { class: 'flow-kpis' });
  const sel = h('select', { id: 'flowDay', 'aria-label': 'Day', onchange: (e) => { tabState.day = e.target.value; draw(); } },
    keys.map((k) => { const d = days.get(k); return h('option', { value: k, selected: k === tabState.day }, `${dayLabel(k)} — ${d.gr.length} receipt lines · ${d.gi.length} issues`); }));
  const draw = () => {
    const plan = planFor(tabState.day);
    fill(summary, `${dayLabel(plan.key)}: `, h('b', {}, String(plan.trucks.length)), ' inbound trucks (material documents), ', h('b', {}, String(plan.lines.length)),
      ` receipt lines → high-bay ${plan.counts.hb} · VLM ${plan.counts.vlm} · floor storage ${plan.counts.floor} (no location). `,
      plan.simulated ? 'No 261 issues this day → the tugger loop is simulated and marked as such.' : h('span', {}, h('b', {}, String(plan.issues)), ` goods issues (261) → ${plan.runs.length} tugger runs to the line.`));
    if (tabState.kpis) renderKpis(kpiWrap, plan); else fill(kpiWrap);
  };
  root.append(
    h('div', { class: 'panel' },
      h('h2', {}, 'Warehouse flow'),
      h('p', { class: 'muted' }, 'One day of MB51 goods movements replayed in the 3D warehouse: each material document is a truck at the dock, forklifts put every receipt line (101) away to the part’s current location, and tuggers take goods issues (261) to the line. Or skip the replay and read the day’s numbers.'),
      h('div', { class: 'toolbar' },
        h('label', { class: 'flow-day' }, 'Day ', sel),
        h('button', { class: 'btn', type: 'button', onclick: () => openFlow(tabState.day, { gesture: true }) }, 'Play replay (TV)'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { tabState.kpis = true; draw(); } }, 'Show day KPIs (skip replay)')),
      summary,
      h('p', { class: 'muted small' }, 'Schematic: dock, floor storage, line-side, forklift count and speeds are presentation choices. Entry time is when the line was entered in SAP, not when it was moved.')),
    kpiWrap,
  );
  draw();
}

function renderKpis(wrap, plan) {
  const k = dayKpis(plan, statusMap());
  const pct = (n) => h('span', { class: 'muted' }, ` (${k.pct(n)}%)`);
  const stat = (value, label, note, cls) => h('div', { class: `stat ${cls || ''}` }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, value), note ? h('span', { class: 'stat-note' }, note) : null);
  fill(wrap,
    h('div', { class: 'panel' },
      h('h3', {}, `Day KPIs — ${dayLabel(plan.key)} `, h('span', { class: 'muted small' }, '(what a full replay would end on)')),
      h('div', { class: 'stats' },
        stat(String(k.trucks), 'Inbound trucks', 'one per material document'),
        stat(String(k.lines), 'Receipt lines (101)', `${k.parts} different parts`),
        stat(h('span', {}, String(k.counts.hb), pct(k.counts.hb)), 'Put away to high-bay'),
        stat(h('span', {}, String(k.counts.vlm), pct(k.counts.vlm)), 'Put away to VLM'),
        stat(h('span', {}, String(k.counts.floor), pct(k.counts.floor)), 'To floor storage', 'part has no location', k.counts.floor ? 'stat-bad' : '')),
      h('div', { class: 'stats' },
        stat(k.window ? `${hhmm(k.window[0])}–${hhmm(k.window[1])}` : '—', 'Receiving window', 'first → last SAP entry time'),
        stat(k.peakHour === null ? '—' : `${String(k.peakHour).padStart(2, '0')}:00`, 'Busiest hour', `${k.peakLines} lines in that hour`),
        stat(k.trucks ? k.linesPerTruck.toFixed(1) : '—', 'Lines per truck (avg)', k.biggest ? `max ${k.biggest.lines} · doc ${k.biggest.doc}` : ''),
        stat(h('span', {}, String(k.onSite), h('small', { class: 'muted' }, ` / ${k.doors} doors`)), 'Trucks on site at once (est.)', k.onSiteAt === null ? '' : `peak around ${hhmm(k.onSiteAt)} · stay = 10 min before first line → 5 min after last`, k.onSite > k.doors ? 'stat-bad' : ''),
        stat(k.qty.map(([u, q]) => `${q.toLocaleString('en-US')} ${u}`).join(' · ') || '—', 'Quantity received')),
      h('div', { class: 'stats' },
        stat(String(k.status.RED), 'Red parts received', 'today’s DOH status', k.status.RED ? 'stat-red' : ''),
        stat(String(k.status.ORANGE), 'Orange (excess) parts received'),
        stat(String(k.status.GREEN), 'Green parts received'),
        stat(String(k.runs), k.simulated ? 'Tugger runs (simulated)' : 'Tugger runs', k.simulated ? 'no 261 this day — not data' : `${k.issues} goods issues (261) to the line`)),
      h('p', { class: 'muted small' }, 'From this day’s MB51 rows (101 receipts; reversals not counted), today’s locations and DOH status. Travel and dock-wait times are left out on purpose: in the replay they depend on the assumed forklift fleet, so they are not data.')),
    h('div', { class: 'grid2' },
      h('div', { class: 'panel' }, h('h3', {}, `Received with no location → floor storage (${k.floorParts.length} parts)`), h('p', { class: 'muted small' }, 'Candidates for a high-bay or VLM location.'),
        k.floorParts.length ? table([{ key: 'material', label: 'Part', render: (p) => pnLink(p.material) }, { key: 'desc', label: 'Description' }, { key: 'lines', label: 'Lines', num: true }, { key: 'qty', label: 'Qty', num: true, render: (p) => `${fmt(p.qty)} ${p.unit}` }], k.floorParts.slice(0, 50), { label: 'Floor storage parts', dense: true }) : empty('Every receipt had a location.')),
      h('div', { class: 'panel' }, h('h3', {}, `Red parts that came in this day (${k.redParts.length})`), h('p', { class: 'muted small' }, 'Where the urgent stock went.'),
        k.redParts.length ? table([{ key: 'material', label: 'Part', render: (p) => pnLink(p.material) }, { key: 'desc', label: 'Description' }, { key: 'bin', label: 'Location', render: (p) => p.bin || h('span', { class: 'review-pu' }, 'none') }, { key: 'qty', label: 'Qty', num: true, render: (p) => `${fmt(p.qty)} ${p.unit}` }], k.redParts.slice(0, 50), { label: 'Red parts received', dense: true }) : empty('No Red parts received.'))),
  );
}

// ---------------------------------------------------------------- full-screen replay
let active = null;
// opts: gesture (fullscreen on click), manual (offline clip: no rAF, caller ticks), speed, cam, size {w,h}
export async function openFlow(key, opts = {}) {
  if (active) active.stop();
  const plan = planFor(key);
  if (!plan) return null;
  const wh3d = await import('./warehouse3d.js');
  const statusOf = statusMap();
  const { fleet, rate } = pacing(plan);

  const overlay = h('div', { class: 'showcase fl-overlay', role: 'dialog', 'aria-label': 'Warehouse flow' });
  if (opts.size) overlay.style.cssText = `width:${opts.size.w}px;height:${opts.size.h}px;inset:0 auto auto 0`;
  const box = h('div', { class: 'sc-canvas' });
  const clock = h('span', { class: 'fl-clock' }, '--:--');
  const btn = (txt, label) => h('button', { type: 'button', class: 'sc-btn', title: label, 'aria-label': label }, txt);
  const pauseBtn = btn('❚❚ Pause', 'Pause / play (Space)'), speedBtn = btn('Speed 2×', 'Replay speed 1 / 2 / 4 (keys 1 2 4)'), camBtn = btn('Camera: Auto', 'Camera: auto / overview / follow (C)');
  const exit = btn('Exit (Esc)', 'Exit'); exit.classList.add('sc-exit');
  const stats = h('div', { class: 'sc-card fl-stats' }), ticker = h('div', { class: 'fl-ticker' }), bar = h('div', { class: 'sc-progress' });
  const note = h('div', { class: 'fl-note' }, 'Dock, floor storage, line-side and travel lanes are schematic. ',
    plan.simulated ? h('b', {}, 'Tugger runs: SIMULATED (no 261 this day) — Red-parts loop.') : `Tugger runs replayed from ${plan.issues} MB51 goods issues (261).`);
  overlay.append(box,
    h('div', { class: 'sc-top' }, h('div', { class: 'sc-title-wrap' }, clock, h('span', { class: 'sc-title' }, `Warehouse flow · MB51 replay · ${dayLabel(plan.key)}`)),
      opts.manual ? null : h('div', { class: 'sc-ctrls' }, pauseBtn, speedBtn, camBtn, exit)),
    stats, ticker, note, bar);
  document.body.append(overlay);

  let stopped = false, view = null, speed = opts.speed || 2, camMode = opts.cam || 'auto', fsArmed = false;
  const disposables = []; const keep = (x) => { disposables.push(x); return x; };
  const setPaused = (b) => { if (!view) return; view.setPaused(b); pauseBtn.textContent = b ? '▶ Play' : '❚❚ Pause'; overlay.classList.toggle('sc-paused', b); };
  const setSpeed = (s) => { speed = s; speedBtn.textContent = `Speed ${s}×`; };
  const CAMS = ['auto', 'overview', 'follow'];
  const camState = { mode: 'overview', until: 0, target: null, pos: null, look: null, pick: 0 };
  const setCam = (m) => { camMode = m; camBtn.textContent = `Camera: ${m[0].toUpperCase()}${m.slice(1)}`; camState.until = 0; };
  const enterFs = () => (document.fullscreenElement || !overlay.requestFullscreen ? Promise.resolve(!!document.fullscreenElement) : overlay.requestFullscreen().then(() => true, () => false));
  const onKey = (e) => {
    if (fsArmed && e.key !== 'Escape') { fsArmed = false; enterFs(); }
    if (e.key === 'Escape') { stop(); return; }
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); setPaused(!view.isPaused()); }
    else if (e.key === '1' || e.key === '2' || e.key === '4') setSpeed(+e.key);
    else if (e.key === 'c' || e.key === 'C') setCam(CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length]);
  };
  function stop() {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('keydown', onKey);
    if (view) { view.setOnFrame(null); disposables.forEach((d) => { try { d.dispose(); } catch { /* ignore */ } }); view.dispose(); }
    overlay.remove();
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch { /* ignore */ } }
    active = null; window.__flowDebug = null;
  }
  exit.addEventListener('click', stop);
  pauseBtn.addEventListener('click', () => setPaused(!(view && view.isPaused())));
  speedBtn.addEventListener('click', () => setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : 1));
  camBtn.addEventListener('click', () => setCam(CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length]));
  if (!opts.manual) document.addEventListener('keydown', onKey);
  active = { stop, overlay };
  if (opts.gesture) enterFs().then((ok) => { if (!ok) fsArmed = true; });

  await new Promise((r) => requestAnimationFrame(r));
  if (stopped) return null;
  try { view = wh3d.mount(box, D(), { mode: 'doh', showcase: true, manual: !!opts.manual, pixelRatio: opts.manual ? 1 : undefined }); } catch (e) { stats.textContent = `3D unavailable: ${e.message}`; return null; }
  active.view = view;
  const { camera, target, boxes, scene, parts, layout, rackTop, inRack } = view._debug;
  const S = 0.001;

  // ---- bounds (m): racks + VLM towers ----
  const minX = 0, maxX = layout.maxX * S, minZ = 0, maxZ = layout.depthMM * S;
  const topY = Math.max(rackTop, layout.vlmTopMM * S);
  const aisleHalf = layout.aisleMM / 2 * S;
  const frontX = minX - 4.5, backX = maxX + 4.5, endZ = maxZ + 4.5, startZ = minZ - 4.5;
  const dockX = frontX - 13, lineX = backX + 9, midZ = (minZ + maxZ) / 2;
  const doorZ = (i) => minZ + 2 + i * ((maxZ - minZ - 4) / (FLOW.doors - 1));
  const safeY = topY + 2.5;

  // ---- static scenery ----
  const matCache = new Map();
  const mat = (c) => { if (!matCache.has(c)) matCache.set(c, keep(new THREE.MeshLambertMaterial({ color: c }))); return matCache.get(c); };
  const geoBox = (w, hh, d) => keep(new THREE.BoxGeometry(w, hh, d));
  const addBox = (parent, w, hh, d, c, x, y, z) => { const m = new THREE.Mesh(geoBox(w, hh, d), typeof c === 'object' ? c : mat(c)); m.position.set(x, y, z); parent.add(m); return m; };
  const world = new THREE.Group(); scene.add(world);
  const floorM = new THREE.Mesh(keep(new THREE.PlaneGeometry(lineX - dockX + 60, maxZ - minZ + 40)), mat(0x151b23));
  floorM.rotation.x = -Math.PI / 2; floorM.position.set((dockX + lineX) / 2, -0.02, midZ); world.add(floorM);
  const laneMat = mat(0xd9a400);
  const lane = (x1, z1, x2, z2) => { const L = Math.hypot(x2 - x1, z2 - z1); const m = addBox(world, L, 0.02, 0.12, laneMat, (x1 + x2) / 2, 0.01, (z1 + z2) / 2); m.rotation.y = Math.atan2(-(z2 - z1), x2 - x1); };
  [[frontX - 1.6, startZ, frontX - 1.6, endZ], [frontX + 1.6, startZ, frontX + 1.6, endZ], [backX - 1.6, startZ, backX - 1.6, endZ], [backX + 1.6, startZ, backX + 1.6, endZ],
    [frontX - 1.6, endZ + 1.6, backX + 1.6, endZ + 1.6], [frontX - 1.6, endZ - 1.6, backX + 1.6, endZ - 1.6]].forEach((a) => lane(...a));
  addBox(world, 0.35, 5, maxZ - minZ + 10, 0x2a3442, dockX, 2.5, midZ); // dock wall
  for (let i = 0; i < FLOW.doors; i++) { addBox(world, 0.4, 3.4, 3.2, 0x3d4b5e, dockX + 0.05, 1.7, doorZ(i)); addBox(world, 0.42, 0.18, 3.4, 0xf2b705, dockX + 0.06, 3.45, doorZ(i)); }
  addBox(world, 9, 0.02, maxZ - minZ + 6, 0x1f2833, dockX + 5, 0.0, midZ);
  const floorZone = { x0: dockX + 3.5, x1: frontX - 2.5, z0: maxZ - 14, z1: maxZ + 2 };
  addBox(world, floorZone.x1 - floorZone.x0, 0.02, floorZone.z1 - floorZone.z0, 0x2b2f3a, (floorZone.x0 + floorZone.x1) / 2, 0.015, (floorZone.z0 + floorZone.z1) / 2);
  for (let i = 0; i < 3; i++) { const z = midZ - 8 + i * 8; addBox(world, 2.4, 1.1, 6, 0x46505e, lineX + 2.5, 0.55, z); addBox(world, 2.45, 0.08, 6, 0xe07b24, lineX + 2.5, 1.12, z); }
  const sprite = (text, x, y, z, size, color, parent = world) => {
    const c = document.createElement('canvas'); const g = c.getContext('2d'); g.font = 'bold 64px "Barlow Condensed", Arial, sans-serif';
    const w = Math.ceil(g.measureText(text).width) + 40; c.width = w; c.height = 96;
    g.font = 'bold 64px "Barlow Condensed", Arial, sans-serif'; g.fillStyle = 'rgba(11,15,21,.72)'; g.fillRect(0, 0, w, 96);
    g.fillStyle = color || '#f2a54a'; g.textBaseline = 'middle'; g.fillText(text, 20, 50);
    const sp = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: keep(new THREE.CanvasTexture(c)), depthTest: false, transparent: true })));
    sp.scale.set(size * w / 96, size, 1); sp.position.set(x, y, z); sp.renderOrder = 10; parent.add(sp); return sp;
  };
  sprite('RECEIVING DOCK', dockX + 2, 7, midZ, 1.6);
  for (let i = 0; i < FLOW.doors; i++) sprite(`D${i + 1}`, dockX + 0.4, 4.4, doorZ(i), 0.7, '#e9edf3');
  sprite('FLOOR STORAGE', (floorZone.x0 + floorZone.x1) / 2, 3.2, (floorZone.z0 + floorZone.z1) / 2, 1.0, '#c9d1dc');
  sprite('LINE-SIDE', lineX + 2.5, 5, midZ, 1.6);

  // ---- vehicles (local +X = forward), all built from boxes: no model files ----
  const colorOf = (pn) => COLOR[statusOf(pn)] || COLOR.NONE;
  const wheelGeo = keep(new THREE.CylinderGeometry(0.26, 0.26, 0.2, 14)), smallWheelGeo = keep(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 10));
  const black = mat(0x111111), steel = mat(0x59606b), yellow = mat(0xf2b705), blue = mat(0x2f6fdf), dark = mat(0x2a2f37);
  const wheel = (g, geo, x, y, z) => { const w = new THREE.Mesh(geo, black); w.rotation.x = Math.PI / 2; w.position.set(x, y, z); g.add(w); };
  const palletGeo = geoBox(1.15, 1.0, 1.0), toteGeo = geoBox(0.5, 0.32, 0.4), woodMat = mat(0x8a6a43), woodGeo = geoBox(1.15, 0.14, 1.0);
  const makePallet = (color) => { const g = new THREE.Group(); const b = new THREE.Mesh(palletGeo, mat(color)); b.position.y = 0.64; g.add(b); const w = new THREE.Mesh(woodGeo, woodMat); w.position.y = 0.07; g.add(w); return g; };
  function makeForklift(n) {
    const g = new THREE.Group();
    addBox(g, 1.6, 0.7, 1.05, yellow, -0.15, 0.55, 0); addBox(g, 0.5, 0.85, 1.05, dark, -0.95, 0.62, 0);
    [[-0.65, 0.48], [-0.65, -0.48], [0.35, 0.48], [0.35, -0.48]].forEach(([x, z]) => addBox(g, 0.06, 1.3, 0.06, dark, x, 1.55, z));
    addBox(g, 1.1, 0.06, 1.05, dark, -0.15, 2.22, 0);
    addBox(g, 0.1, 2.3, 0.1, steel, 0.72, 1.15, 0.33); addBox(g, 0.1, 2.3, 0.1, steel, 0.72, 1.15, -0.33);
    const inner = new THREE.Group(); g.add(inner);
    addBox(inner, 0.08, 2.3, 0.08, steel, 0.79, 0, 0.27); addBox(inner, 0.08, 2.3, 0.08, steel, 0.79, 0, -0.27);
    const carriage = new THREE.Group(); carriage.position.set(0.82, 0, 0); g.add(carriage);
    addBox(carriage, 0.08, 0.55, 0.9, dark, 0, 0.32, 0);
    addBox(carriage, 1.1, 0.05, 0.12, steel, 0.58, 0.04, 0.25); addBox(carriage, 1.1, 0.05, 0.12, steel, 0.58, 0.04, -0.25);
    [[0.5, 0.48], [0.5, -0.48], [-0.75, 0.48], [-0.75, -0.48]].forEach(([x, z]) => wheel(g, wheelGeo, x, 0.26, z));
    sprite(`FL${n}`, 0, 3.0, 0, 0.55, '#f2b705', g);
    world.add(g);
    return { kind: 'fork', name: `FL${n}`, g, carriage, inner, lift: 0, load: null, x: 0, z: 0, heading: 0, tasks: [], job: null };
  }
  function makeTugger(n) {
    const g = new THREE.Group();
    addBox(g, 1.3, 0.7, 0.95, blue, 0, 0.5, 0); addBox(g, 0.4, 0.6, 0.8, dark, -0.35, 1.1, 0);
    [[0.4, 0.45], [0.4, -0.45], [-0.4, 0.45], [-0.4, -0.45]].forEach(([x, z]) => wheel(g, wheelGeo, x, 0.26, z));
    sprite(`TUG${n}`, 0, 2.4, 0, 0.55, '#6d9bff', g);
    world.add(g);
    const carts = [];
    for (let i = 0; i < TUG_CARTS; i++) {
      const c = new THREE.Group();
      addBox(c, 1.7, 0.12, 0.95, steel, 0, 0.42, 0); addBox(c, 0.5, 0.05, 0.05, dark, 1.05, 0.35, 0);
      [[0.6, 0.42], [0.6, -0.42], [-0.6, 0.42], [-0.6, -0.42]].forEach(([x, z]) => wheel(c, smallWheelGeo, x, 0.14, z));
      c.userData.totes = []; world.add(c); carts.push(c);
    }
    return { kind: 'tug', name: `TUG${n}`, g, carts, trail: [], dist: 0, x: 0, z: 0, heading: 0, tasks: [], run: null };
  }
  function makeTruck() {
    const g = new THREE.Group();
    addBox(g, 13.6, 2.7, 2.5, 0xe8ebef, -6.8, 2.6, 0); addBox(g, 13.6, 0.25, 2.3, dark, -6.8, 1.15, 0);
    addBox(g, 2.4, 2.9, 2.5, 0xb13c2e, -14.9, 1.75, 0); addBox(g, 0.05, 1.0, 2.2, 0x9fc3e8, -16.11, 2.4, 0);
    [-1.2, -2.6, -12.4, -14.2].forEach((x) => { wheel(g, wheelGeo, x, 0.45, 1.1); wheel(g, wheelGeo, x, 0.45, -1.1); });
    g.children.forEach((m) => { if (m.geometry === wheelGeo) m.scale.set(1.7, 1, 1.7); });
    g.visible = false; world.add(g);
    return g;
  }

  // ---- movement: task queue of path / turn / lift / wait / call ----
  const angTo = (x1, z1, x2, z2) => Math.atan2(-(z2 - z1), x2 - x1);
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const place = (v) => { v.g.position.set(v.x, 0, v.z); v.g.rotation.y = v.heading; };
  const trailPush = (v) => { const last = v.trail[v.trail.length - 1]; const d = last ? Math.hypot(v.x - last.x, v.z - last.z) : 1; if (d >= 0.1) { v.dist += last ? d : 0; v.trail.push({ x: v.x, z: v.z, d: v.dist }); if (v.trail.length > 600) v.trail.splice(0, v.trail.length - 600); } };
  const trailAt = (v, d) => {
    const tr = v.trail; if (!tr.length) return { x: v.x, z: v.z, h: v.heading };
    if (d <= tr[0].d) return { x: tr[0].x, z: tr[0].z, h: v.heading };
    for (let i = tr.length - 1; i > 0; i--) if (tr[i - 1].d <= d) { const a = tr[i - 1], b = tr[i], k = (d - a.d) / Math.max(1e-6, b.d - a.d); return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, h: angTo(a.x, a.z, b.x, b.z) }; }
    return { x: tr[0].x, z: tr[0].z, h: v.heading };
  };
  // carts follow the tractor's breadcrumb trail 2 m apart, so they turn the corners with it
  const placeCarts = (v) => v.carts.forEach((c, i) => { const p = trailAt(v, v.dist - 2.0 * (i + 1)); c.position.set(p.x, 0, p.z); c.rotation.y = p.h; });
  function stepVehicle(v, dt) {
    while (dt > 1e-4 && v.tasks.length) {
      const t = v.tasks[0];
      if (t.type === 'path') {
        const p = t.pts[0];
        if (!p) { v.tasks.shift(); continue; }
        const dx = p[0] - v.x, dz = p[1] - v.z, d = Math.hypot(dx, dz);
        if (d < 0.02) { t.pts.shift(); continue; }
        const want = wrap(angTo(v.x, v.z, p[0], p[1]) + (t.reverse ? Math.PI : 0));
        const err = wrap(want - v.heading);
        if (Math.abs(err) > 0.3) { const st = Math.sign(err) * Math.min(Math.abs(err), TURN_SPEED * dt); v.heading = wrap(v.heading + st); dt -= Math.abs(st) / TURN_SPEED; continue; } // turn on the spot first
        v.heading = wrap(v.heading + err * Math.min(1, dt * 8));
        const mv = Math.min(d, t.speed * dt);
        v.x += dx / d * mv; v.z += dz / d * mv; dt -= mv / t.speed;
        if (v.kind === 'tug') trailPush(v);
      } else if (t.type === 'turn') {
        const err = wrap(t.heading - v.heading);
        if (Math.abs(err) < 0.01) { v.heading = t.heading; v.tasks.shift(); continue; }
        const st = Math.sign(err) * Math.min(Math.abs(err), TURN_SPEED * dt); v.heading = wrap(v.heading + st); dt -= Math.abs(st) / TURN_SPEED;
      } else if (t.type === 'lift') {
        const err = t.h - v.lift;
        if (Math.abs(err) < 0.005) { v.lift = t.h; v.tasks.shift(); continue; }
        const st = Math.sign(err) * Math.min(Math.abs(err), LIFT_SPEED * dt); v.lift += st; dt -= Math.abs(st) / LIFT_SPEED;
      } else if (t.type === 'wait') {
        t.s -= dt; if (t.s <= 0) { dt = -t.s; v.tasks.shift(); } else dt = 0;
      } else if (t.type === 'call') { v.tasks.shift(); t.fn(); }
    }
    place(v);
    if (v.kind === 'fork') { v.carriage.position.y = v.lift; v.inner.position.y = 1.15 + Math.max(0, v.lift - 1.0); }
    if (v.kind === 'tug') placeCarts(v);
  }

  // ---- destinations: in front of the part's lane (high-bay) or the VLM port ----
  function destFor(material) {
    const p = parts.get(material); if (!p) return null;
    if (p.vlm) return { vlm: true, x: p.vlm.x * S, z: (p.vlm.zFace + p.vlm.faceDir * p.vlm.gap * 0.45) * S, face: p.vlm.faceDir, y: 0, markY: p.vlm.y * S };
    if (!p.boxIdx.length) return null;
    let x = 0, yb = Infinity, yt = 0; p.boxIdx.forEach((i) => { const b = boxes[i]; x += b.x; yb = Math.min(yb, b.y - b.h / 2); yt = Math.max(yt, b.y + b.h / 2); });
    return { vlm: false, x: x / p.boxIdx.length * S, z: p.faceZ * S + p.faceDir * aisleHalf, face: p.faceDir, y: yb * S, markY: yt * S };
  }
  const beacons = [];
  const ringGeo = keep(new THREE.RingGeometry(0.5, 0.8, 32)), colGeo = keep(new THREE.CylinderGeometry(0.06, 0.06, 1, 8));
  function beacon(x, y, z, color) { // flashing ring + column where a pallet just landed / a tote was picked
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const r = new THREE.Mesh(ringGeo, m); r.rotation.x = -Math.PI / 2; r.position.set(x, 0.05, z);
    const c = new THREE.Mesh(colGeo, m); c.scale.y = Math.max(0.5, y); c.position.set(x, y / 2, z);
    world.add(r); world.add(c); beacons.push({ r, c, m, t: 0 });
  }

  // ---- day state ----
  let st = null;
  const homeFork = (i) => [dockX + 6.5, midZ - (fleet - 1) * 1.6 + i * 3.2];
  const homeTug = (i) => [lineX - 3, midZ + 8 + i * 4];
  const audit = { samples: 0, cameraInside: 0, vehicleInside: 0, putaways: 0, putawayOff: 0 };
  function reset() {
    if (st) {
      st.forks.forEach((v) => world.remove(v.g)); st.tugs.forEach((v) => { world.remove(v.g); v.carts.forEach((c) => world.remove(c)); });
      st.trucks.forEach((t) => world.remove(t.g)); st.floorPallets.forEach((p) => p && world.remove(p));
      beacons.forEach((b) => { world.remove(b.r); world.remove(b.c); b.m.dispose(); }); beacons.length = 0;
    }
    st = { sim: plan.start, forks: [], tugs: [], trucks: [], doors: new Array(FLOW.doors).fill(null), queue: [], released: new Set(), done: { hb: 0, vlm: 0, floor: 0 }, arrived: 0, runsDone: 0, runIdx: 0, floorPallets: [], floorSlot: 0, log: [] };
    for (let i = 0; i < fleet; i++) { const v = makeForklift(i + 1); [v.x, v.z] = homeFork(i); v.heading = Math.PI; place(v); st.forks.push(v); }
    const nTug = plan.runs.length > 12 ? 2 : 1;
    for (let i = 0; i < nTug; i++) { const v = makeTugger(i + 1); [v.x, v.z] = homeTug(i); v.heading = Math.PI / 2; v.trail = [{ x: v.x, z: v.z + 6, d: 0 }, { x: v.x, z: v.z, d: 6 }]; v.dist = 6; place(v); placeCarts(v); st.tugs.push(v); }
    st.trucks = plan.trucks.map((t) => ({ plan: t, g: makeTruck(), state: 'due', door: -1, x: 0, left: t.lines.length }));
  }
  reset();
  const log = (text) => { st.log.unshift([hhmm(st.sim), text]); st.log.length = Math.min(st.log.length, 6); };

  function assignFork(v, line) {
    const tr = st.trucks[line.truck];
    const zDoor = doorZ(tr.door);
    const [hx, hz] = homeFork(st.forks.indexOf(v));
    const color = colorOf(line.material);
    v.job = line;
    const T = v.tasks;
    T.push({ type: 'path', speed: FORK_SPEED, pts: [[dockX + 5, zDoor], [dockX + 2.3, zDoor]] });
    T.push({ type: 'turn', heading: Math.PI });
    T.push({ type: 'lift', h: 0.15 });
    T.push({ type: 'call', fn: () => { v.load = makePallet(color); v.load.position.set(0.62, 0.06, 0); v.carriage.add(v.load); tr.left--; } });
    T.push({ type: 'path', speed: FORK_SPEED * 0.6, reverse: true, pts: [[dockX + 5, zDoor]] });
    const dest = line.kind === 'floor' ? null : destFor(line.material);
    if (dest) {
      const liftH = dest.vlm ? 0.15 : dest.y + 0.05;
      T.push({ type: 'lift', h: 0.4 });
      T.push({ type: 'path', speed: FORK_SPEED, pts: [[frontX - 1.1, zDoor], [frontX - 1.1, dest.z], [dest.x, dest.z]] });
      T.push({ type: 'turn', heading: dest.face > 0 ? Math.PI / 2 : -Math.PI / 2 }); // face the rack (heading +Z is −π/2)
      T.push({ type: 'lift', h: liftH });
      T.push({ type: 'path', speed: 0.8, pts: [[dest.x, dest.z - dest.face * 0.35]] });
      T.push({ type: 'lift', h: Math.max(0, liftH - 0.08) });
      T.push({ type: 'call', fn: () => {
        if (v.load) { // check: the pallet is set down in front of the part's own lane (or the VLM port)
          const wp = new THREE.Vector3(); v.load.getWorldPosition(wp);
          audit.putaways++; if (Math.abs(wp.x - dest.x) > 1.6 || Math.abs(wp.z - dest.z) > aisleHalf + 0.5) audit.putawayOff++;
          v.carriage.remove(v.load); v.load = null;
        }
        st.done[line.kind]++; beacon(dest.x, dest.markY || 1, dest.z - dest.face * (aisleHalf - 0.2), new THREE.Color(color).getHex());
        log(`${v.name} put away ${line.material} → ${line.bin}${line.qty ? ` · ${line.qty.toLocaleString('en-US')} ${line.unit}` : ''}`);
      } });
      T.push({ type: 'path', speed: 0.8, reverse: true, pts: [[dest.x, dest.z]] });
      T.push({ type: 'lift', h: 0 });
      T.push({ type: 'path', speed: FORK_SPEED, pts: [[frontX - 1.1, dest.z], [frontX - 1.1, hz], [hx, hz]] });
    } else {
      const slot = st.floorSlot++ % 40, fx = floorZone.x0 + 1.2 + (slot % 5) * 1.6, fz = floorZone.z0 + 1.5 + Math.floor(slot / 5) * 1.8;
      T.push({ type: 'path', speed: FORK_SPEED, pts: [[dockX + 5, fz], [fx - 1.44, fz]] }); // pallet sits 1.44 m ahead of the truck centre
      T.push({ type: 'turn', heading: 0 });
      T.push({ type: 'lift', h: 0.02 });
      T.push({ type: 'call', fn: () => {
        if (v.load) { v.carriage.remove(v.load); const p = makePallet(color); p.position.set(fx, 0, fz); world.add(p); const prev = st.floorPallets[slot]; if (prev) world.remove(prev); st.floorPallets[slot] = p; v.load = null; }
        st.done.floor++; log(`${v.name} staged ${line.material} on the floor (no location)`);
      } });
      T.push({ type: 'path', speed: 0.8, reverse: true, pts: [[fx - 3, fz]] });
      T.push({ type: 'lift', h: 0 });
      T.push({ type: 'path', speed: FORK_SPEED, pts: [[hx, hz]] });
    }
    T.push({ type: 'turn', heading: Math.PI });
    T.push({ type: 'call', fn: () => { v.job = null; } });
  }
  // tugger run: line → back lane → each stop's aisle (in from the back, out at the front) → around the end → line
  function assignTug(v, run) {
    v.run = run;
    const [hx, hz] = homeTug(st.tugs.indexOf(v));
    const T = v.tasks; const L = backX + 1.1, F = frontX + 1.1, E = endZ + 1.1;
    v.carts.forEach((c) => { c.userData.totes.forEach((t) => c.remove(t)); c.userData.totes = []; });
    T.push({ type: 'path', speed: TUG_SPEED, pts: [[L, hz]] });
    run.stops.forEach((s, i) => {
      const d = destFor(s.material); if (!d) return;
      T.push({ type: 'path', speed: TUG_SPEED, pts: [[L, d.z], [d.x + 1.5, d.z]] });
      T.push({ type: 'wait', s: 2.2 });
      T.push({ type: 'call', fn: () => {
        const c = v.carts[Math.min(i, v.carts.length - 1)];
        for (let k = 0; k < 2; k++) { const t = new THREE.Mesh(toteGeo, mat(colorOf(s.material))); t.position.set(-0.4 + k * 0.6, 0.66, 0); c.add(t); c.userData.totes.push(t); }
        beacon(d.x, d.markY || 1, d.z - d.face * (aisleHalf - 0.2), new THREE.Color(colorOf(s.material)).getHex());
        log(`${v.name} picked ${s.material} at ${s.bin}${run.simulated ? ' (simulated)' : s.qty ? ` · ${s.qty.toLocaleString('en-US')} ${s.unit}` : ''}`);
      } });
      T.push({ type: 'path', speed: TUG_SPEED, pts: [[F, d.z], [F, E], [L, E]] });
    });
    T.push({ type: 'path', speed: TUG_SPEED, pts: [[L, hz - 6], [hx, hz - 6], [hx, hz]] });
    T.push({ type: 'wait', s: 2.5 });
    T.push({ type: 'call', fn: () => { v.carts.forEach((c) => { c.userData.totes.forEach((t) => c.remove(t)); c.userData.totes = []; }); st.runsDone++; v.run = null; log(`${v.name} delivered ${run.stops.length} stop${run.stops.length > 1 ? 's' : ''} to the line`); } });
  }

  // ---- camera director (moves the shared target; the 3D loop looks at it) ----
  const cx = (dockX + lineX) / 2, spanX = lineX - dockX + 12;
  const overviewAt = (a) => {
    const hFov = 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
    const dist = ((spanX / 2) / Math.tan(hFov / 2) + (maxZ - minZ) * 0.45) * 1.05, el = 50 * Math.PI / 180, az = Math.PI / 2 + a; // from +Z: dock left, line-side right
    return { pos: new THREE.Vector3(cx + Math.cos(az) * Math.cos(el) * dist, Math.sin(el) * dist, midZ + Math.sin(az) * Math.cos(el) * dist), look: new THREE.Vector3(cx, 0, midZ) };
  };
  function camUpdate(dt, t) {
    if (t > camState.until) {
      if (camMode === 'auto') camState.mode = camState.mode === 'overview' ? 'follow' : 'overview';
      const busy = [...st.forks, ...st.tugs].filter((v) => v.tasks.length);
      camState.target = busy.length ? busy[camState.pick++ % busy.length] : null; // round robin: same replay every time
      camState.until = t + (camMode === 'auto' && camState.mode === 'overview' ? 12000 : 11000);
    }
    const follow = camMode === 'follow' || (camMode === 'auto' && camState.mode === 'follow');
    let goal;
    if (follow && camState.target) {
      const v = camState.target, hx = Math.cos(v.heading), hz = -Math.sin(v.heading);
      goal = { pos: new THREE.Vector3(v.x - hx * 13 + hz * 6, safeY + 7, v.z - hz * 13 - hx * 6), look: new THREE.Vector3(v.x + hx * 2, 0.8, v.z + hz * 2) }; // high and back: clear of the bay signs
    } else goal = overviewAt(Math.sin(t / 16000) * 0.22);
    if (!camState.pos) { camState.pos = goal.pos.clone(); camState.look = goal.look.clone(); }
    const k = 1 - Math.exp(-dt * 1.6);
    camState.pos.lerp(goal.pos, k); camState.look.lerp(goal.look, k);
    if (camState.pos.y < safeY && camState.pos.x > minX - 1 && camState.pos.x < maxX + 1 && camState.pos.z > minZ - 1 && camState.pos.z < maxZ + 1) camState.pos.y = safeY; // never down among the racks
    camera.position.copy(camState.pos); target.copy(camState.look); camera.lookAt(target);
  }

  // ---- HUD ----
  const n = plan.lines.length;
  function hud() {
    clock.textContent = hhmm(st.sim);
    const done = st.done.hb + st.done.vlm + st.done.floor, waiting = st.queue.length;
    const kpi = (v, of, label, color) => h('div', {}, h('div', { class: 'fl-n', style: color ? { color } : null }, String(v), of !== null ? h('small', {}, ` / ${of}`) : null), h('div', { class: 'sc-dim' }, label));
    fill(stats,
      h('div', { class: 'fl-kpis' }, kpi(st.arrived, plan.trucks.length, 'inbound trucks'), kpi(done, n, 'lines put away'), kpi(waiting, null, 'waiting at dock', waiting > fleet * 2 ? '#ff6b5e' : null), kpi(st.runsDone, plan.runs.length, `tugger runs${plan.simulated ? ' (sim)' : ''}`)),
      h('div', { class: 'sc-dim fl-split' }, `High-bay ${st.done.hb}/${plan.counts.hb} · VLM ${st.done.vlm}/${plan.counts.vlm} · Floor ${st.done.floor}/${plan.counts.floor} · ${fleet} forklifts`));
    fill(ticker, st.log.map(([tm, text]) => h('div', {}, h('span', { class: 'fl-t' }, tm), ' ', text)));
    bar.style.width = `${Math.min(100, (st.sim - plan.start) / (plan.end - plan.start) * 100)}%`;
  }

  // ---- main tick (runs right after each render, on the 3D clock: Pause freezes everything) ----
  let last = null, restartAt = null;
  view.setOnFrame((t) => {
    if (last === null) last = t;
    const dtReal = Math.min(0.1, (t - last) / 1000); last = t;
    const dt = dtReal * speed;
    if (dt > 0) {
      st.sim = Math.min(plan.end + 7200, st.sim + dt * rate);
      st.trucks.forEach((tr) => { // trucks back onto a free door, leave when every line is off
        if (tr.state === 'due' && st.sim >= tr.plan.arrive) {
          const d = st.doors.indexOf(null);
          if (d >= 0) { st.doors[d] = tr; tr.door = d; tr.state = 'in'; tr.x = dockX - 45; tr.g.visible = true; st.arrived++; log(`Truck at D${d + 1} · doc ${tr.plan.doc} · ${tr.plan.lines.length} line${tr.plan.lines.length > 1 ? 's' : ''}`); }
        }
        if (tr.state === 'in') { tr.x = Math.min(dockX - 0.25, tr.x + 9 * dt); if (tr.x >= dockX - 0.25) tr.state = 'docked'; }
        if (tr.state === 'docked') {
          tr.plan.lines.forEach((l) => { if (!st.released.has(l) && st.sim >= l.sec) { st.released.add(l); st.queue.push(l); } });
          if (tr.left <= 0) { tr.state = 'out'; st.doors[tr.door] = null; }
        }
        if (tr.state === 'out') { tr.x -= 9 * dt; if (tr.x < dockX - 50) { tr.state = 'gone'; tr.g.visible = false; } }
        if (tr.g.visible) tr.g.position.set(tr.x, 0, doorZ(Math.max(0, tr.door)));
      });
      st.forks.forEach((v) => { if (!v.job && !v.tasks.length && st.queue.length) assignFork(v, st.queue.shift()); });
      while (st.runIdx < plan.runs.length && st.sim >= plan.runs[st.runIdx].start) {
        const v = st.tugs.find((x) => !x.run && !x.tasks.length); if (!v) break;
        assignTug(v, plan.runs[st.runIdx++]);
      }
      st.forks.forEach((v) => stepVehicle(v, dt));
      st.tugs.forEach((v) => stepVehicle(v, dt));
      for (let i = beacons.length - 1; i >= 0; i--) {
        const b = beacons[i]; b.t += dt; const k = b.t / 3;
        b.m.opacity = Math.max(0, 0.9 * (1 - k)) * (0.6 + 0.4 * Math.sin(b.t * 12)); b.r.scale.setScalar(1 + k * 1.5);
        if (b.t > 3) { world.remove(b.r); world.remove(b.c); b.m.dispose(); beacons.splice(i, 1); }
      }
      const allDone = st.trucks.every((tr) => tr.state === 'gone') && !st.queue.length && st.forks.every((v) => !v.tasks.length) && st.runIdx >= plan.runs.length && st.tugs.every((v) => !v.tasks.length);
      if (allDone && st.sim >= plan.end - 900 && restartAt === null) { restartAt = t + 8000; log(`Day complete — ${st.done.hb + st.done.vlm + st.done.floor} lines put away, ${st.runsDone} tugger runs. Replaying…`); }
      // audit (tests): neither the camera nor a vehicle body ever inside a rack or VLM tower
      audit.samples++;
      if (inRack(camera.position)) audit.cameraInside++;
      [...st.forks, ...st.tugs].forEach((v) => { if (inRack(new THREE.Vector3(v.x, 0.6, v.z))) audit.vehicleInside++; });
    }
    if (restartAt !== null && t >= restartAt) { restartAt = null; reset(); }
    camUpdate(dtReal, t);
    hud();
  });
  window.__flowDebug = { plan, get st() { return st; }, fleet, rate, safeY, audit, bounds: { minX, maxX, minZ, maxZ, topY }, setCam, setSpeed };
  return { stop, tick: (dt) => view.tick(dt), audit, plan, overlay, view };
}

// Offline clip (tools/make-flow-video.py): the replay on a manual clock at a fixed size; the caller screenshots each frame.
window.__pfepFlowClip = {
  async start(key, speed = 4, w = 1920, hgt = 1080) {
    const k = key || [...flowDays(D().flowlog).keys()].sort().pop();
    this._h = await openFlow(k, { manual: true, speed, cam: 'auto', size: { w, h: hgt } });
    return { key: k, lines: this._h.plan.lines.length };
  },
  step(dt) { this._h.tick(dt); const s = window.__flowDebug; return { sim: s.st.sim, audit: { ...this._h.audit } }; },
  stop() { if (this._h) this._h.stop(); this._h = null; },
};
