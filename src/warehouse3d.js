// 3D high-bay view. Takes data only (wh + pkg + derived states) and draws it; no app state inside.
// R14: boxes per lane = min(maxStack, floor(levelHeight ÷ PU height)); one part per lane, never mixed.
import * as THREE from '../lib/three.module.min.js';
import { OrbitControls } from '../lib/OrbitControls.js';
import * as R from './rules.js';

const LANE_W = 0.7, LANES = 4, BAY_W = LANE_W * LANES, BAYS = 12, LEVEL_H = 0.85, LEVELS = 4, DEPTH = 1.2, ROW_GAP = 3.4;
const ROWS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const LIFE_COLORS = { Active: '#2e9e66', 'Phase-in': '#3a6fd8', 'Run-out': '#e08a2b', Inactive: '#4f5d75', Obsolete: '#9b5532', none: '#b8c0cc' };
export const DOH_COLORS = { RED: '#d64545', GREEN: '#2e9e66', ORANGE: '#e08a2b', NEEDS_REVIEW: '#8a5cd6', EXCLUDED: '#b8c0cc', NONE: '#b8c0cc' };

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function layoutInfo() {
  return { rowZ: (i) => i * ROW_GAP, bayX: (b) => (b - 1) * BAY_W, levelY: (l) => (l - 1) * LEVEL_H + 0.15, length: BAYS * BAY_W, rows: ROWS };
}

export function mount(el, data, opts = {}) {
  const cfg = data.config;
  const lc = new Map(R.lifecycle(data, cfg, data.asOf).map((x) => [x.partNo, x]));
  const plan = new Map(data.matplan.filter((m) => m.date === data.asOf).map((m) => [m.material, m]));
  const pkg = new Map(data.pkg.map((r) => [r.partNo, r]));
  const L = layoutInfo();

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!opts.preserve });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  el.append(renderer.domElement);
  const scene = new THREE.Scene();
  const bg = new THREE.Color(opts.showcase ? '#0b0f15' : cssVar('--panel-2', '#f8f9fb'));
  scene.background = bg;
  const dark = bg.getHSL({}).l < 0.4;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  const center = new THREE.Vector3(L.length / 2, 1.4, (ROWS.length - 1) * ROW_GAP / 2);
  camera.position.set(center.x - 19, 13, center.z + 21);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 3; controls.maxDistance = 90;
  if (opts.preview) { controls.autoRotate = true; controls.autoRotateSpeed = 0.6; controls.enableZoom = false; }
  if (opts.showcase) controls.enabled = false;

  scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x202634 : 0xb9c2cf, dark ? 1.1 : 1.35));
  const sun = new THREE.DirectionalLight(0xffffff, dark ? 1.1 : 1.3);
  sun.position.set(-20, 40, 25); scene.add(sun);

  // floor + aisle stripes
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(L.length + 30, ROWS.length * ROW_GAP + 26), new THREE.MeshLambertMaterial({ color: dark ? 0x1a212b : 0xe3e7ec }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(center.x + 3, 0, center.z); scene.add(floor);
  const grid = new THREE.GridHelper(Math.max(L.length + 30, ROWS.length * ROW_GAP + 26), 40, dark ? 0x2a3340 : 0xcfd5dd, dark ? 0x222a35 : 0xd9dee5);
  grid.position.set(center.x + 3, 0.002, center.z); scene.add(grid);

  // rack steel (instanced thin boxes)
  const steel = new THREE.MeshLambertMaterial({ color: dark ? 0x3d6fb8 : 0x2f5ea8 });
  const beam = new THREE.MeshLambertMaterial({ color: 0xe08a2b });
  const upGeo = new THREE.BoxGeometry(0.08, LEVEL_H * LEVELS + 0.2, 0.08);
  const beamGeo = new THREE.BoxGeometry(BAY_W, 0.07, 0.07);
  const ups = new THREE.InstancedMesh(upGeo, steel, ROWS.length * (BAYS + 1) * 2);
  const beams = new THREE.InstancedMesh(beamGeo, beam, ROWS.length * BAYS * LEVELS * 2);
  const m4 = new THREE.Matrix4();
  let ui = 0, bi = 0;
  ROWS.forEach((_, ri) => {
    const z = L.rowZ(ri);
    for (let b = 0; b <= BAYS; b++) for (const dz of [-DEPTH / 2, DEPTH / 2]) { m4.makeTranslation(b * BAY_W, (LEVEL_H * LEVELS + 0.2) / 2, z + dz); ups.setMatrixAt(ui++, m4); }
    for (let b = 1; b <= BAYS; b++) for (let l = 1; l <= LEVELS; l++) for (const dz of [-DEPTH / 2, DEPTH / 2]) { m4.makeTranslation(L.bayX(b) + BAY_W / 2, L.levelY(l) - 0.06, z + dz); beams.setMatrixAt(bi++, m4); }
  });
  scene.add(ups, beams);

  // row labels
  const label = (text, x, y, z, size = 1.1) => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d'); g.fillStyle = dark ? '#e6e9ee' : '#151a22'; g.font = '700 84px Barlow Condensed, Arial Narrow, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 68);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false }));
    s.position.set(x, y, z); s.scale.set(size, size, 1); scene.add(s); return s;
  };
  ROWS.forEach((r, i) => label(r, -1.2, LEVEL_H * LEVELS + 0.6, L.rowZ(i)));

  // VLM tower
  const vlmPos = new THREE.Vector3(L.length + 6, 0, center.z);
  const vlm = new THREE.Mesh(new THREE.BoxGeometry(3, 6, 2.2), new THREE.MeshLambertMaterial({ color: dark ? 0x2b3442 : 0x9aa6b6 }));
  vlm.position.set(vlmPos.x, 3, vlmPos.z); scene.add(vlm);
  label('VLM', vlmPos.x, 6.8, vlmPos.z, 1.6);

  // part boxes
  const boxes = []; // one entry per instance
  const parts = new Map(); // partNo -> { center, wh }
  for (const w of data.wh) {
    if (w.area === 'VLM') { parts.set(w.material, { center: vlmPos.clone().setY(3), wh: w }); continue; }
    if (w.area !== 'HIGHBAY') continue;
    const ri = ROWS.indexOf(w.row);
    if (ri < 0) continue;
    const p = pkg.get(w.material);
    const puHm = (p?.puH || 300) / 1000;
    const n = Math.max(1, R.stackCount(p?.puH || 300, cfg));
    const depth = Math.min(DEPTH - 0.1, Math.max(0.4, (p?.puL || 600) / 1000));
    const h = Math.min(puHm, (LEVEL_H - 0.12) / n) * 0.94;
    for (let k = 0; k < w.lanes; k++) {
      const x = L.bayX(w.bay) + (w.lane - 1 + k) * LANE_W + LANE_W / 2;
      for (let s = 0; s < n; s++) boxes.push({ partNo: w.material, x, y: L.levelY(w.level) + h / 2 + s * (h / 0.94), z: L.rowZ(ri), w: LANE_W * 0.86, h, d: depth });
    }
    parts.set(w.material, { center: new THREE.Vector3(L.bayX(w.bay) + (w.lane - 1 + w.lanes / 2) * LANE_W, L.levelY(w.level) + 0.3, L.rowZ(ri)), wh: w, rowCenter: new THREE.Vector3(L.length / 2, 1.6, L.rowZ(ri)) });
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const boxMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const inst = new THREE.InstancedMesh(boxGeo, boxMat, Math.max(1, boxes.length));
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  boxes.forEach((b, i) => { pos.set(b.x, b.y, b.z); sc.set(b.w, b.h, b.d); m4.compose(pos, q, sc); inst.setMatrixAt(i, m4); });
  scene.add(inst);

  const statusOf = (pn) => {
    const m = plan.get(pn);
    return { life: lc.get(pn)?.state || 'none', doh: m ? R.dohStatus(m, cfg).status : 'NONE', dohValue: m ? m.doh : null };
  };
  let mode = opts.mode || 'life';
  let highlight = null;
  let selected = null;
  const col = new THREE.Color(), dim = new THREE.Color(dark ? '#2a3340' : '#d9dee5');
  const paint = () => {
    boxes.forEach((b, i) => {
      const s = statusOf(b.partNo);
      col.set(mode === 'doh' ? DOH_COLORS[s.doh] : LIFE_COLORS[s.life]);
      if (highlight && !highlight.has(b.partNo)) col.lerp(dim, 0.9);
      if (selected === b.partNo) col.set('#ffc93c'); // selection is always the same bright yellow
      inst.setColorAt(i, col);
    });
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  };
  paint();

  // picking
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let pickCb = null, hoverCb = null;
  const pickAt = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(inst, false)[0];
    if (hit && hit.instanceId !== undefined) return boxes[hit.instanceId].partNo;
    return ray.intersectObject(vlm, false).length ? '__VLM__' : null;
  };
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const pn = pickAt(e); if (pickCb) pickCb(pn);
  });
  renderer.domElement.addEventListener('pointermove', (e) => { if (hoverCb && e.pointerType === 'mouse') hoverCb(pickAt(e)); });

  // camera animation
  let anim = null;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const animateTo = (toPos, toTarget, ms = 900) => new Promise((resolve) => {
    const fromP = camera.position.clone(), fromT = controls.target.clone(), t0 = performance.now();
    anim = (now) => {
      const t = Math.min(1, (now - t0) / ms), k = ease(t);
      camera.position.lerpVectors(fromP, toPos, k); controls.target.lerpVectors(fromT, toTarget, k);
      if (t >= 1) { anim = null; resolve(); }
    };
  });
  const orbit = (c, radius, height, ms) => new Promise((resolve) => {
    const t0 = performance.now(), a0 = Math.atan2(camera.position.z - c.z, camera.position.x - c.x);
    controls.target.copy(c);
    anim = (now) => {
      const t = Math.min(1, (now - t0) / ms), a = a0 + ease(t) * Math.PI * 2;
      camera.position.set(c.x + Math.cos(a) * radius, height, c.z + Math.sin(a) * radius);
      if (t >= 1) { anim = null; resolve(); }
    };
  });
  const viewOf = (pn) => parts.get(pn) || null;
  const focusPart = (pn, ms = 900) => {
    const p = parts.get(pn); if (!p) return Promise.resolve();
    const t = p.center.clone();
    // stand in the aisle in front of the rack (aisle centre is half a row-gap away), slightly above the level
    const off = p.wh.area === 'VLM' ? new THREE.Vector3(-6, 3, 7) : new THREE.Vector3(-2.2, 0.9, (p.center.z < center.z ? -1 : 1) * (ROW_GAP / 2));
    return animateTo(t.clone().add(off), t, ms);
  };
  const overviewCam = () => animateTo(new THREE.Vector3(center.x - 19, 13, center.z + 21), center.clone(), 900);

  // render loop + resize
  let raf = 0, alive = true;
  const size = () => { const w = el.clientWidth || 300, hgt = el.clientHeight || 300; renderer.setSize(w, hgt, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = hgt + 'px'; camera.aspect = w / hgt; camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(size); ro.observe(el); size();
  const loop = (now) => { if (!alive) return; if (anim) anim(now); controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);

  return {
    setMode(m) { mode = m; paint(); },
    setHighlight(set) { highlight = set && set.size ? set : null; paint(); },
    select(pn) { selected = pn; paint(); },
    onPick(cb) { pickCb = cb; },
    onHover(cb) { hoverCb = cb; },
    focusPart, orbit, animateTo, overviewCam, viewOf, statusOf,
    boxCount: boxes.length,
    canvas: renderer.domElement,
    dispose() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); inst.geometry.dispose(); renderer.domElement.remove(); },
  };
}
