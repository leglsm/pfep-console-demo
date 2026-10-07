// 3D high-bay view (v91 model from the plant console, on the demo's fictional layout).
// Takes data only (wh + pkg + derived states) and draws it; no app state inside.
//
// Physical model (mm, scene units are metres):
//  - Rows pair up back-to-back into lines A|B, C|D, E|F: frame 44" + spacer 8" + frame 44" = 96".
//  - 9 ft aisle between lines; 10 ft from row F to the VLM towers V1–V3.
//  - Level 1 holds the HU/PU lanes (R14: boxes per lane = min(4, 26" ÷ PU height), one part per lane).
//  - Levels 2–5 are dynamic pallet storage, always full: one 48"W × 45"D × 50"H pallet per position.
//  - A bay-number sign above every bay; one label per line ("A | B").
// Showcase engine: its own clock (Pause freezes moves mid-flight), cancellable moves (Prev/Next/Export),
// two-leg flights that never pass through the racks, focus pulse, and an onFrame hook for video export.
import * as THREE from '../lib/three.module.min.js';
import { OrbitControls } from '../lib/OrbitControls.js';
import * as R from './rules.js';

const S = 0.001, IN = 25.4, FT = 304.8;
const LINES = [['A', 'B'], ['C', 'D'], ['E', 'F']];
const ROWS = LINES.flat();
const BAYS = 24, LANES = 4;
const LANE_W_MM = 650, UPRIGHT_MM = 100, BAY_W_MM = LANES * LANE_W_MM, BAY_PITCH_MM = BAY_W_MM + UPRIGHT_MM;
const FRAME_D_MM = 44 * IN, SPACER_MM = 8 * IN, AISLE_MM = 9 * FT, VLM_GAP_MM = 10 * FT;
const L1_H_MM = 30 * IN, L1_USABLE_MM = 26 * IN, DYN_H_MM = 56 * IN, BEAM_MM = 100;
const LEVELS = [1, 2, 3, 4, 5];
const PALLET_MM = { w: 48 * IN, d: 45 * IN, h: 50 * IN };
const VLM_TOWERS = ['V1', 'V2', 'V3'], VLM_TRAYS = 50, VLM_W_MM = 2500, VLM_H_MM = 6000, VLM_D_MM = 96 * IN;
const FILLER_COLOR = '#9c8463';

export const LIFE_COLORS = { Active: '#2e9e66', 'Phase-in': '#3a6fd8', 'Run-out': '#e08a2b', Inactive: '#4f5d75', Obsolete: '#9b5532', none: '#b8c0cc' };
export const DOH_COLORS = { RED: '#d64545', GREEN: '#2e9e66', ORANGE: '#e08a2b', NEEDS_REVIEW: '#8a5cd6', EXCLUDED: '#b8c0cc', NONE: '#b8c0cc' };
export const SHOWCASE_T = { overview: 8000, ret: 2800, bird: 3000, orbit: 6000, fly: 2800, hold: 3600 }; // looping TV showcase (v90: 2× slower)
export const SINGLE_T = { overview: 2500, orbit: 3000, fly: 1400 };                                       // one-part view
export const REC_T = { overview: 4000, ret: 1400, bird: 1500, orbit: 3000, fly: 1400, hold: 3600, tail: 600 }; // video export, ≈56 s for 5 parts
export const ORBIT_R = 16;

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const levelYBottom = (level) => (level === 1 ? 0 : L1_H_MM + BEAM_MM + (level - 2) * (DYN_H_MM + BEAM_MM));
const RACK_TOP_MM = levelYBottom(LEVELS[LEVELS.length - 1]) + DYN_H_MM;
export const vlmTowerOf = (tray) => { const n = Math.max(1, parseInt(String(tray).replace(/\D/g, ''), 10) || 1); return { tower: VLM_TOWERS[Math.min(VLM_TOWERS.length - 1, Math.floor((n - 1) / VLM_TRAYS))], slot: ((n - 1) % VLM_TRAYS) + 1 }; };

export function mount(el, data, opts = {}) {
  const cfg = data.config;
  const showcase = !!opts.showcase;
  const fillers = opts.fillers ?? showcase;
  const DIM = opts.dim ?? (showcase ? 0.6 : 0.9);
  const lc = new Map(R.lifecycle(data, cfg, data.asOf).map((x) => [x.partNo, x]));
  const plan = new Map(data.matplan.filter((m) => m.date === data.asOf).map((m) => [m.material, m]));
  const pkg = new Map(data.pkg.map((r) => [r.partNo, r]));

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!opts.preserve });
  renderer.setPixelRatio(opts.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2));
  el.append(renderer.domElement);
  const scene = new THREE.Scene();
  const bg = new THREE.Color(showcase ? '#0b0f15' : cssVar('--panel-2', '#f8f9fb'));
  scene.background = bg;
  const dark = bg.getHSL({}).l < 0.4;
  const disposables = [];
  const keep = (o) => { disposables.push(o); return o; };
  scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x202634 : 0xb9c2cf, dark ? 1.1 : 1.35));
  const sun = new THREE.DirectionalLight(0xffffff, dark ? 0.9 : 1.2);
  sun.position.set(-20, 40, -25); scene.add(sun);

  // ---- layout: lines of back-to-back rows, then the VLM towers ----
  const sides = new Map(); // row -> { zMin, faceZ, faceDir, zC }
  let zCursor = 0;
  LINES.forEach(([front, back], li) => {
    const z0 = zCursor, backMin = z0 + FRAME_D_MM + SPACER_MM;
    sides.set(front, { zMin: z0, faceZ: z0, faceDir: -1, zC: z0 + FRAME_D_MM / 2, line: li });
    sides.set(back, { zMin: backMin, faceZ: backMin + FRAME_D_MM, faceDir: 1, zC: backMin + FRAME_D_MM / 2, line: li });
    zCursor = backMin + FRAME_D_MM + (li === LINES.length - 1 ? VLM_GAP_MM : AISLE_MM);
  });
  const vlmZMin = zCursor, vlmFaceZ = vlmZMin, vlmZC = vlmZMin + VLM_D_MM / 2;
  const depthMM = vlmZMin + VLM_D_MM;
  const rowLenMM = BAYS * BAY_PITCH_MM;
  const towers = new Map(VLM_TOWERS.map((t, i) => [t, { x: rowLenMM + 4000 + i * (VLM_W_MM + 300) + VLM_W_MM / 2 }]));
  const maxX = rowLenMM + 4000 + VLM_TOWERS.length * (VLM_W_MM + 300);
  const bayX0 = (bay) => (bay - 1) * BAY_PITCH_MM + UPRIGHT_MM / 2;

  const posts = [], beams = [], boxes = [];
  const parts = new Map(); // partNo -> { boxIdx[], rowCenter, faceZ, faceDir, vlm? }
  for (const row of ROWS) {
    const sd = sides.get(row);
    for (let b = 0; b <= BAYS; b++) for (const z of [sd.zMin + 20, sd.zMin + FRAME_D_MM - 20]) posts.push({ x: b * BAY_PITCH_MM, z, h: RACK_TOP_MM });
    for (let b = 1; b <= BAYS; b++) for (const level of LEVELS) {
      const y = levelYBottom(level) + (level === 1 ? L1_H_MM : DYN_H_MM);
      for (const z of [sd.zMin + 20, sd.zMin + FRAME_D_MM - 20]) beams.push({ x: bayX0(b) + BAY_W_MM / 2, y, z, w: BAY_W_MM });
    }
    if (fillers) {
      const secW = (BAY_W_MM - UPRIGHT_MM) / 2;
      for (let b = 1; b <= BAYS; b++) for (const level of LEVELS.slice(1)) for (const s of [0, 1]) {
        const x = bayX0(b) + (s === 0 ? secW / 2 : BAY_W_MM - secW / 2);
        boxes.push({ partNo: null, filler: true, x, y: levelYBottom(level) + 40 + PALLET_MM.h / 2, z: sd.zC, w: Math.min(PALLET_MM.w, secW - 40), h: PALLET_MM.h, d: PALLET_MM.d });
      }
    }
  }
  for (const w of data.wh) {
    if (w.area === 'VLM') {
      const { tower, slot } = vlmTowerOf(w.tray);
      const t = towers.get(tower);
      const y = 400 + (slot - 1) / (VLM_TRAYS - 1) * (VLM_H_MM - 1200);
      parts.set(w.material, { boxIdx: [], wh: w, vlm: { tower, x: t.x, y, zFace: vlmFaceZ, faceDir: -1, gap: VLM_GAP_MM } });
      continue;
    }
    if (w.area !== 'HIGHBAY' || !sides.has(w.row)) continue;
    const sd = sides.get(w.row), p = pkg.get(w.material);
    const n = Math.max(1, R.stackCount(p?.puH || 300, cfg));
    const unitH = Math.min(p?.puH || 300, L1_USABLE_MM / n);
    const d = Math.min(FRAME_D_MM - 80, Math.max(350, p?.puL || 600));
    const info = { boxIdx: [], wh: w, faceZ: sd.faceZ, faceDir: sd.faceDir, rowCenter: new THREE.Vector3(rowLenMM / 2 * S, 1.6, sd.zC * S) };
    const levelY = levelYBottom(w.level || 1);
    for (let k = 0; k < (w.lanes || 1); k++) {
      const x = bayX0(w.bay) + ((w.lane || 1) - 1 + k) * LANE_W_MM + LANE_W_MM / 2;
      for (let s = 0; s < n; s++) {
        info.boxIdx.push(boxes.length);
        boxes.push({ partNo: w.material, x, y: levelY + unitH * (s + 0.5), z: sd.faceZ - sd.faceDir * (d / 2 + 60), w: LANE_W_MM * 0.9, h: unitH * 0.94, d });
      }
    }
    parts.set(w.material, info);
  }

  // ---- geometry (instanced: one draw call per kind) ----
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  const unit = keep(new THREE.BoxGeometry(1, 1, 1));
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry((maxX + 16000) * S, (depthMM + 16000) * S)), keep(new THREE.MeshLambertMaterial({ color: dark ? 0x1a212b : 0xe3e7ec })));
  floor.rotation.x = -Math.PI / 2; floor.position.set(maxX / 2 * S, 0, depthMM / 2 * S); scene.add(floor);
  const instanced = (list, color, fn) => {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(unit, keep(new THREE.MeshLambertMaterial({ color })), list.length);
    list.forEach((it, i) => { fn(it); m4.compose(pos, q, sc); mesh.setMatrixAt(i, m4); });
    scene.add(mesh); return mesh;
  };
  instanced(posts, dark ? 0x3d6fb8 : 0x2f5ea8, (p) => { pos.set(p.x * S, p.h / 2 * S, p.z * S); sc.set(0.08, p.h * S, 0.08); });
  instanced(beams, 0xb8661f, (b) => { pos.set(b.x * S, b.y * S, b.z * S); sc.set(b.w * S, 0.05, 0.05); });
  const boxMesh = boxes.length ? new THREE.InstancedMesh(unit, keep(new THREE.MeshLambertMaterial({ color: 0xffffff })), boxes.length) : null;
  if (boxMesh) { boxes.forEach((b, i) => { pos.set(b.x * S, b.y * S, b.z * S); sc.set(b.w * S, b.h * S, b.d * S); m4.compose(pos, q, sc); boxMesh.setMatrixAt(i, m4); }); scene.add(boxMesh); }
  const towerMat = keep(new THREE.MeshLambertMaterial({ color: dark ? 0x2b3442 : 0x9aa6b6 }));
  const towerGeo = keep(new THREE.BoxGeometry(VLM_W_MM * S, VLM_H_MM * S, (VLM_D_MM - 100) * S));
  const towerMeshes = [];
  towers.forEach((t) => { const m = new THREE.Mesh(towerGeo, towerMat); m.position.set(t.x * S, VLM_H_MM / 2 * S, vlmZC * S); scene.add(m); towerMeshes.push(m); });
  const trayMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const tray = new THREE.Mesh(keep(new THREE.BoxGeometry((VLM_W_MM - 300) * S, 0.18, 0.12)), trayMat);
  tray.visible = false; scene.add(tray);

  // ---- labels ----
  const label = (text, x, y, z, size, plaque, wide) => {
    const W = wide ? 512 : 256;
    const c = document.createElement('canvas'); c.width = W; c.height = 128;
    const g = c.getContext('2d');
    if (plaque) { g.fillStyle = 'rgba(15,20,27,0.78)'; g.fillRect(14, 22, W - 28, 90); g.strokeStyle = '#F2A54A'; g.lineWidth = 5; g.strokeRect(14, 22, W - 28, 90); }
    g.fillStyle = plaque ? '#F2A54A' : (dark ? '#e6e9ee' : '#151a22');
    let fs = 76; const setF = () => { g.font = `700 ${fs}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`; }; setF();
    while (fs > 30 && g.measureText(text).width > W - 46) { fs -= 4; setF(); }
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2, 68);
    const s = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: keep(new THREE.CanvasTexture(c)), depthWrite: false })));
    s.position.set(x, y, z); s.scale.set(size * W / 128, size, 1); scene.add(s);
  };
  LINES.forEach(([f, b]) => label(`${f} | ${b}`, -3.2, RACK_TOP_MM * S + 1.2, (sides.get(f).zC + sides.get(b).zC) / 2 * S, 1.0, false, true));
  for (const row of ROWS) for (let b = 1; b <= BAYS; b++) label(`${row}${String(b).padStart(2, '0')}`, (bayX0(b) + BAY_W_MM / 2) * S, (RACK_TOP_MM + 350) * S, sides.get(row).zC * S, 0.6, true);
  towers.forEach((t, name) => label(name, t.x * S, (VLM_H_MM + 500) * S, vlmZC * S, 0.8));
  label('VLM', (maxX - (VLM_TOWERS.length * (VLM_W_MM + 300)) / 2) * S, (VLM_H_MM + 1600) * S, vlmZC * S, 1.1);

  // ---- colour ----
  const statusOf = (pn) => {
    const m = plan.get(pn);
    return { life: lc.get(pn)?.state || 'none', doh: m ? R.dohStatus(m, cfg).status : 'NONE', dohValue: m ? m.doh : null };
  };
  const statusCache = new Map();
  const st = (pn) => { if (!statusCache.has(pn)) statusCache.set(pn, statusOf(pn)); return statusCache.get(pn); };
  let mode = opts.mode || 'life';
  let highlight = null, selected = null, focusIdx = [];
  const col = new THREE.Color(), dim = new THREE.Color(dark ? '#0b0f15' : '#e3e7ec'), white = new THREE.Color(0xffffff);
  const baseColor = (b) => (b.filler ? FILLER_COLOR : mode === 'doh' ? DOH_COLORS[st(b.partNo).doh] : LIFE_COLORS[st(b.partNo).life]);
  const paint = () => {
    if (!boxMesh) return;
    focusIdx = [];
    boxes.forEach((b, i) => {
      const lit = highlight && !b.filler && highlight.has(b.partNo);
      if (lit && showcase) focusIdx.push(i);
      col.set(baseColor(b));
      if (highlight && !lit) col.lerp(dim, DIM);
      if (selected && selected === b.partNo) col.set('#ffc93c'); // selection is always the same bright yellow
      boxMesh.setColorAt(i, col);
    });
    if (boxMesh.instanceColor) boxMesh.instanceColor.needsUpdate = true;
  };
  paint();
  const pulse = (t) => { // focused part pulses toward white (~1.1 s cycle), keeping its DOH hue
    if (!boxMesh || !focusIdx.length) return;
    const k = 0.45 * (0.5 + 0.5 * Math.sin(t / 180));
    focusIdx.forEach((i) => { col.set(baseColor(boxes[i])).lerp(white, k); boxMesh.setColorAt(i, col); });
    boxMesh.instanceColor.needsUpdate = true;
  };

  // ---- picking ----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let pickCb = null, hoverCb = null;
  const pickAt = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = boxMesh && ray.intersectObject(boxMesh, false)[0];
    if (hit && hit.instanceId !== undefined && boxes[hit.instanceId].partNo) return boxes[hit.instanceId].partNo;
    return ray.intersectObjects(towerMeshes, false).length ? '__VLM__' : null;
  };
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => { if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) <= 5 && pickCb) pickCb(pickAt(e)); });
  renderer.domElement.addEventListener('pointermove', (e) => { if (hoverCb && e.pointerType === 'mouse') hoverCb(pickAt(e)); });

  // ---- camera ----
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
  const center = new THREE.Vector3(maxX / 2 * S, 1.4, depthMM / 2 * S);
  const controls = new OrbitControls(camera, renderer.domElement);
  const target = controls.target; target.copy(center);
  controls.enableDamping = !showcase;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 3; controls.maxDistance = 160;
  if (opts.preview) { controls.autoRotate = true; controls.autoRotateSpeed = 0.6; controls.enableZoom = false; }
  if (showcase) controls.enabled = false;
  // Bird's-eye pose: from the front (-Z) at 38° elevation, distance fitted so every line is in frame.
  const overviewPose = (swing = 0, elev = 38, fit = 1.15) => {
    const halfX = (maxX / 2 + 4000) * S, halfZ = (depthMM / 2 + 4000) * S;
    const vFov = camera.fov * Math.PI / 180, hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const dist = Math.max(halfX / Math.tan(hFov / 2), halfZ / Math.tan(vFov / 2)) * fit;
    const e = elev * Math.PI / 180, az = -Math.PI / 2 + swing;
    return new THREE.Vector3(center.x + Math.cos(az) * Math.cos(e) * dist, center.y + Math.sin(e) * dist, center.z + Math.sin(az) * Math.cos(e) * dist);
  };

  // Showcase clock: every move and wait runs on vclock, so Pause freezes everything mid-flight.
  // cancel() resolves the move in flight and bumps `gen`, so remaining legs of a multi-leg move are skipped.
  let vclock = 0, lastNow = null, paused = false, gen = 0, waits = [], onFrame = null, anim = null, animResolve = null;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const animateTo = (toPos, toTarget, ms = 900) => new Promise((resolve) => {
    const fromP = camera.position.clone(), fromT = target.clone(), t0 = vclock;
    animResolve = resolve;
    anim = (now) => { const t = Math.min(1, (now - t0) / ms), k = ease(t); camera.position.lerpVectors(fromP, toPos, k); target.lerpVectors(fromT, toTarget, k); if (t >= 1) { anim = null; animResolve = null; resolve(); } };
  });
  const legs = (g, ...fns) => fns.reduce((p, f) => p.then(() => (g === gen ? f() : undefined)), Promise.resolve());
  const orbitHeight = Math.max(8, RACK_TOP_MM * S + 5);
  const orbit = (c, radius = ORBIT_R, height = orbitHeight, ms = 3000) => new Promise((resolve) => {
    const t0 = vclock, a0 = Math.atan2(camera.position.z - c.z, camera.position.x - c.x);
    const fromT = target.clone(), fromP = camera.position.clone();
    animResolve = resolve;
    anim = (now) => {
      const t = Math.min(1, (now - t0) / ms), a = a0 + ease(t) * Math.PI * 2;
      // ease into the circle: climb straight up first (out of an aisle), then slide across — first 30% of the orbit
      const on = new THREE.Vector3(c.x + Math.cos(a) * radius, height, c.z + Math.sin(a) * radius);
      const kIn = Math.min(1, t / 0.3), kY = ease(Math.min(1, kIn / 0.5)), kXZ = ease(Math.max(0, (kIn - 0.35) / 0.65));
      camera.position.set(fromP.x + (on.x - fromP.x) * kXZ, fromP.y + (on.y - fromP.y) * kY, fromP.z + (on.z - fromP.z) * kXZ);
      target.lerpVectors(fromT, c, Math.min(1, t * 4));
      if (t >= 1) { anim = null; animResolve = null; resolve(); }
    };
  });
  // Two legs in the same total time: across above the rack tops to the point over the aisle (40%), then straight down (60%).
  const dropInto = (toPos, toTarget, ms) => {
    const clearY = Math.max(camera.position.y, RACK_TOP_MM * S + 1.5);
    return legs(gen, () => animateTo(new THREE.Vector3(toPos.x, clearY, toPos.z), toTarget, ms * 0.4), () => animateTo(toPos, toTarget, ms * 0.6));
  };
  const viewOf = (pn) => {
    const p = parts.get(pn); if (!p) return null;
    if (p.vlm) return { vlm: true, wh: p.wh, tower: p.vlm.tower };
    const box3 = new THREE.Box3();
    p.boxIdx.forEach((i) => { const b = boxes[i]; box3.expandByPoint(new THREE.Vector3(b.x * S, b.y * S, b.z * S)); });
    const c = new THREE.Vector3(); box3.getCenter(c);
    return { rowCenter: p.rowCenter, center: c, wh: p.wh };
  };
  const focusPart = (pn, ms = 900) => {
    const p = parts.get(pn);
    tray.visible = false;
    if (!p) return Promise.resolve();
    if (p.vlm) {
      trayMat.color.set(DOH_COLORS[st(pn).doh] || '#ffffff');
      tray.position.set(p.vlm.x * S, p.vlm.y * S, (p.vlm.zFace - 60) * S); tray.visible = true;
      const t = new THREE.Vector3(p.vlm.x * S, p.vlm.y * S, p.vlm.zFace * S);
      return dropInto(t.clone().add(new THREE.Vector3(-4.5, 1.2, p.vlm.faceDir * p.vlm.gap * 0.45 * S)), t, ms);
    }
    const v = viewOf(pn);
    // stand in the middle of the aisle the rack faces, a little to the left and above the part
    const camZ = (p.faceZ + p.faceDir * AISLE_MM / 2) * S;
    return dropInto(new THREE.Vector3(v.center.x - 2.4, v.center.y + 0.9, camZ), v.center, ms);
  };
  const overview = (ms) => { camera.position.copy(overviewPose(-0.12)); target.copy(center); return animateTo(overviewPose(0.12), center.clone(), ms); };
  // Fly (no cut) back to the bird's-eye view: straight up out of the aisle (30%), across to the pose (70%), then drift.
  const flyToOverview = (ms, driftMs) => {
    const up = new THREE.Vector3(camera.position.x, Math.max(camera.position.y, RACK_TOP_MM * S + 1.5), camera.position.z);
    return legs(gen, () => animateTo(up, target.clone(), ms * 0.3), () => animateTo(overviewPose(-0.06), center.clone(), ms * 0.7),
      () => (driftMs ? animateTo(overviewPose(0.06), center.clone(), driftMs) : undefined));
  };
  // ---- loop ----
  let raf = 0, alive = true;
  const size = () => { const w = el.clientWidth || 300, h = el.clientHeight || 300; renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px'; camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(size); ro.observe(el); size();
  // initial pose after size(): the fit depends on the real aspect ratio
  if (showcase) { camera.position.copy(overviewPose(-0.12)); } else { camera.position.copy(overviewPose(-0.45, 30, 0.8)); }
  camera.lookAt(target);
  const step = (dt) => {
    if (!paused) vclock += dt;
    if (anim) anim(vclock);
    if (waits.length) { const due = waits.filter((w) => vclock >= w.until); if (due.length) { waits = waits.filter((w) => vclock < w.until); due.forEach((w) => w.resolve()); } }
    pulse(vclock);
    if (controls.enabled) controls.update(); else camera.lookAt(target);
    renderer.render(scene, camera);
    if (onFrame) onFrame(vclock); // same task as render(), so the WebGL canvas can still be copied (video export)
  };
  const loop = (now) => { if (!alive) return; if (lastNow === null) lastNow = now; const dt = now - lastNow; lastNow = now; step(dt); raf = requestAnimationFrame(loop); };
  if (!opts.manual) raf = requestAnimationFrame(loop); else step(0);

  return {
    setMode(m) { mode = m; paint(); },
    setHighlight(set) { highlight = set && set.size ? new Set(set) : null; paint(); },
    select(pn) { selected = pn; paint(); },
    onPick(cb) { pickCb = cb; },
    onHover(cb) { hoverCb = cb; },
    focusPart, orbit, animateTo, viewOf, overview, flyToOverview, statusOf: st,
    overviewCam: () => animateTo(overviewPose(-0.45, 30, 0.8), center.clone(), 900),
    clock: () => vclock,
    setPaused(b) { paused = !!b; },
    isPaused: () => paused,
    wait(ms) { return new Promise((resolve) => waits.push({ until: vclock + ms, resolve })); },
    cancel() { gen++; const r = animResolve; anim = null; animResolve = null; if (r) r(); const ws = waits; waits = []; ws.forEach((w) => w.resolve()); },
    setOnFrame(fn) { onFrame = fn || null; },
    tick(dt) { if (alive) step(dt); }, // manual clock (offline video rendering)
    orbitHeight, boxCount: boxes.length, partCount: parts.size,
    canvas: renderer.domElement,
    _debug: { camera, target, boxes, rackTop: RACK_TOP_MM * S, inRack: (p) => insideRack(p), scene, parts, // read-only: Warehouse flow builds on the scene
      layout: { rowLenMM, maxX, depthMM, vlmZMin, aisleMM: AISLE_MM, vlmTopMM: VLM_H_MM, towers: [...towers.values()].map((t) => t.x), vlmW: VLM_W_MM } },
    dispose() {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      disposables.forEach((d) => { try { d.dispose(); } catch { /* ignore */ } });
      renderer.dispose(); if (renderer.forceContextLoss) renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };

  // Test helper: is a camera position inside any rack volume (frames, both sides of a line) or a VLM tower?
  function insideRack(p) {
    const x = p.x / S, y = p.y / S, z = p.z / S;
    if (y < RACK_TOP_MM && x > -UPRIGHT_MM && x < rowLenMM + UPRIGHT_MM) {
      for (const [f, b] of LINES) { const zf = sides.get(f).zMin, zb = sides.get(b).zMin + FRAME_D_MM; if (z > zf && z < zb) return true; }
    }
    if (y < VLM_H_MM && z > vlmZMin && z < depthMM) for (const t of towers.values()) if (Math.abs(x - t.x) < VLM_W_MM / 2) return true;
    return false;
  }
}
