// Full-screen warehouse showcase (TV mode) — v91 behaviour from the plant console, on demo data.
//  - Opens on the whole warehouse with status counts, then per part: back up to the bird's-eye view
//    (next part already blinking) → 360° orbit around its row → two-leg flight into the aisle → hold.
//  - ‹ Prev · ❚❚ Pause · Next ›, keys ← / → / Space, Esc to exit. Loops forever.
//  - Export top 5 records the first five parts at a faster tempo into a 1920×1080 video (MediaRecorder),
//    drawn on a 2D canvas so the info card is in the file. Saved with a plain browser download.
//  - Single-part view (from Part lookup): overview → orbit → fly in → hold until Close.
//  - window.__pfepClip: the same export sequence on a manual clock, frame by frame (used to render the README video).
import * as R from './rules.js';
import { state } from './state.js';
import { h, fill, fmt } from './ui.js';

const D = () => state.data;
const cfg = () => state.data.config;
const COLOR = { RED: '#ff6b6b', GREEN: '#4cc38a', ORANGE: '#f0a35a', NEEDS_REVIEW: '#b393ff', EXCLUDED: '#b8c0cc', NONE: '#b8c0cc' };
const BADGE = { RED: 'Red', GREEN: 'Green', ORANGE: 'Orange', NEEDS_REVIEW: 'Needs review', EXCLUDED: 'Excluded', NONE: 'Not on plan' };
const REC_W = 1920, REC_H = 1080, REC_FPS = 30, REC_COUNT = 5;
let active = null;

export function showcaseItems() {
  const d = D();
  const byPn = new Map(d.pkg.map((r) => [r.partNo, r]));
  const plan = new Map(d.matplan.filter((m) => m.date === d.asOf).map((m) => [m.material, m]));
  return R.showcaseOrder(d, cfg(), d.asOf).map((it) => {
    const w = d.wh.find((x) => x.material === it.partNo);
    const m = plan.get(it.partNo);
    return { ...it, wh: w, product: byPn.get(it.partNo)?.product || m?.description || '', supplier: m?.supplier || '', planner: m?.planner || '' };
  });
}

function locationText(w, vlmTowerOf) {
  if (!w) return { big: 'No warehouse location', small: '' };
  if (w.area === 'VLM') { const t = vlmTowerOf(w.tray); return { big: `VLM ${t.tower} · Tray ${t.slot}`, small: `VLM tray ${w.tray}` }; }
  const lanes = w.lanes > 1 ? `Lanes ${w.lane}–${w.lane + w.lanes - 1}` : `Lane ${w.lane}`;
  return { big: `HB ${w.row}${String(w.bay).padStart(2, '0')}-${w.level}`, small: `Row ${w.row} · Bay ${String(w.bay).padStart(2, '0')} · Level ${w.level} · ${lanes}` };
}
function slideInfo(it, vlmTowerOf) {
  const loc = locationText(it.wh, vlmTowerOf);
  return {
    partNo: it.partNo, product: it.product || '—', doh: it.doh === null || it.doh === undefined ? '—' : String(it.doh),
    color: COLOR[it.status] || '#e9edf3', badge: BADGE[it.status] || it.status, locBig: loc.big, locSmall: loc.small,
    sp: [it.supplier, it.planner && `Planner ${it.planner}`].filter(Boolean).join(' · '),
  };
}
const cardEl = (f) => [
  h('div', { class: 'sc-pn' }, f.partNo),
  h('div', { class: 'sc-desc' }, f.product),
  h('div', { class: 'sc-row' },
    h('div', {}, h('div', { class: 'sc-doh', style: { color: f.color } }, f.doh), h('div', { class: 'sc-dim' }, 'days on hand')),
    h('div', {}, h('span', { class: 'sc-badge', style: { borderColor: f.color, color: f.color } }, f.badge),
      h('div', { class: 'sc-loc' }, f.locBig), h('div', { class: 'sc-dim' }, f.locSmall))),
  f.sp ? h('div', { class: 'sc-dim sc-sp' }, f.sp) : null,
];
const countsEl = (list) => {
  const c = list.reduce((a, x) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {});
  return h('div', { class: 'sc-row' }, ['RED', 'ORANGE', 'GREEN', 'NEEDS_REVIEW', 'EXCLUDED', 'NONE'].filter((k) => c[k]).map((k) =>
    h('div', {}, h('div', { class: 'sc-doh', style: { color: COLOR[k] } }, String(c[k])), h('div', { class: 'sc-dim' }, BADGE[k]))));
};

export function recMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const c = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return c.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || null;
}

// One 1920×1080 video frame: the 3D view cover-fitted, plus title, info card and progress drawn with Canvas 2D.
function drawRecFrame(ctx, src, s) {
  const W = REC_W, H = REC_H;
  ctx.fillStyle = '#0b0f15'; ctx.fillRect(0, 0, W, H);
  if (src.width && src.height) { const k = Math.max(W / src.width, H / src.height), w = src.width * k, hh = src.height * k; ctx.drawImage(src, (W - w) / 2, (H - hh) / 2, w, hh); }
  const font = (px, w, kind) => `${w || 400} ${px}px ${kind === 'mono' ? '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace' : kind === 'head' ? '"Barlow Condensed", "Arial Narrow", Arial, sans-serif' : '"IBM Plex Sans", -apple-system, "Segoe UI", Roboto, Arial, sans-serif'}`;
  const fit = (t, max) => { t = String(t); if (ctx.measureText(t).width <= max) return t; while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1); return t + '…'; };
  const rr = (x, y, w, hh, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, hh, r); else ctx.rect(x, y, w, hh); };
  const g = ctx.createLinearGradient(0, 0, 0, 130); g.addColorStop(0, 'rgba(11,15,21,.8)'); g.addColorStop(1, 'rgba(11,15,21,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 130);
  ctx.textBaseline = 'alphabetic'; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 6;
  ctx.font = font(28); ctx.fillStyle = '#c9d1dc'; ctx.fillText(s.title, 44, 64);
  const tw = ctx.measureText(s.title).width;
  ctx.font = font(28, 600, 'mono'); ctx.fillStyle = '#fff'; ctx.fillText(s.counter, 44 + tw + 22, 64);
  ctx.font = font(22); ctx.fillStyle = 'rgba(201,209,220,.8)'; const brand = 'PFEP Console demo · fictional data'; ctx.fillText(brand, W - 44 - ctx.measureText(brand).width, 64);
  ctx.shadowBlur = 0;
  const x = 48, cw = 940, pad = 40, f = s.info;
  const ch = s.overview ? 330 : 440 + (f && f.sp ? 40 : 0);
  const y = H - 56 - ch;
  ctx.fillStyle = 'rgba(15,20,27,.8)'; ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2; rr(x, y, cw, ch, 16); ctx.fill(); ctx.stroke();
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 6;
  let cy = y + pad + 70;
  if (s.overview) {
    ctx.font = font(76, 700, 'head'); ctx.fillStyle = '#e9edf3'; ctx.fillText(fit(s.overview.head, cw - 2 * pad), x + pad, cy);
    ctx.font = font(32); ctx.fillStyle = 'rgba(233,237,243,.85)'; ctx.fillText(fit(s.overview.sub, cw - 2 * pad), x + pad, cy + 56);
    let cx = x + pad; const by = cy + 170;
    for (const [k, n] of s.overview.counts) {
      ctx.font = font(96, 700, 'head'); ctx.fillStyle = COLOR[k]; ctx.fillText(String(n), cx, by);
      const nw = ctx.measureText(String(n)).width;
      ctx.font = font(24); ctx.fillStyle = 'rgba(233,237,243,.75)'; ctx.fillText(BADGE[k], cx, by + 34);
      cx += Math.max(nw, ctx.measureText(BADGE[k]).width) + 56;
    }
  } else if (f) {
    ctx.font = font(84, 500, 'mono'); ctx.fillStyle = '#e9edf3'; ctx.fillText(fit(f.partNo, cw - 2 * pad), x + pad, cy);
    ctx.font = font(36); ctx.fillStyle = 'rgba(233,237,243,.88)'; ctx.fillText(fit(f.product, cw - 2 * pad), x + pad, cy += 58);
    cy += 150;
    ctx.font = font(132, 700, 'head'); ctx.fillStyle = f.color; ctx.fillText(f.doh, x + pad, cy);
    const dw = Math.max(ctx.measureText(f.doh).width, 180);
    ctx.font = font(26); ctx.fillStyle = 'rgba(233,237,243,.75)'; ctx.fillText('days on hand', x + pad, cy + 38);
    const bx = x + pad + dw + 60;
    ctx.font = font(28, 600); const bw = ctx.measureText(f.badge).width + 40;
    ctx.strokeStyle = f.color; ctx.lineWidth = 3; rr(bx, cy - 122, bw, 44, 22); ctx.stroke();
    ctx.fillStyle = f.color; ctx.fillText(f.badge, bx + 20, cy - 90);
    ctx.font = font(54, 500, 'mono'); ctx.fillStyle = '#F2A54A'; ctx.fillText(fit(f.locBig, x + cw - pad - bx), bx, cy - 18);
    ctx.font = font(26); ctx.fillStyle = 'rgba(233,237,243,.75)'; ctx.fillText(fit(f.locSmall, x + cw - pad - bx), bx, cy + 22);
    if (f.sp) ctx.fillText(fit(f.sp, cw - 2 * pad), x + pad, cy + 92);
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#6d9bff'; ctx.fillRect(0, H - 8, W * Math.max(0, Math.min(1, s.progress)), 8);
}

// The export sequence (live MediaRecorder or offline manual clock): opening view, then per part.
async function recordSequence(view, items, ui, T, isStopped, vlmTowerOf) {
  const s = ui.rec;
  s.counter = `0 / ${items.length}`; ui.counter.textContent = s.counter;
  const counts = items.reduce((a, x) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {});
  s.overview = { head: 'Warehouse overview', sub: `Top ${items.length} urgent parts · Red first, lowest days on hand first`, counts: ['RED', 'ORANGE', 'GREEN', 'NEEDS_REVIEW'].filter((k) => counts[k]).map((k) => [k, counts[k]]) };
  fill(ui.card, h('div', { class: 'sc-pn' }, 'Warehouse overview'), h('div', { class: 'sc-desc' }, `Top ${items.length} urgent parts`), countsEl(items));
  view.setHighlight(new Set(items.map((x) => x.partNo)));
  await view.overview(T.overview);
  for (let k = 0; k < items.length && !isStopped(); k++) {
    const it = items[k], f = slideInfo(it, vlmTowerOf);
    s.counter = `${k + 1} / ${items.length}`; ui.counter.textContent = s.counter;
    s.overview = null; s.info = f; fill(ui.card, cardEl(f));
    view.setHighlight(new Set([it.partNo]));
    if (k > 0) { await view.flyToOverview(T.ret, T.bird); if (isStopped()) break; }
    const v = view.viewOf(it.partNo);
    if (v && v.rowCenter) { await view.orbit(v.rowCenter, undefined, view.orbitHeight, T.orbit); if (isStopped()) break; }
    await view.focusPart(it.partNo, T.fly); if (isStopped()) break;
    await view.wait(T.hold);
  }
  if (!isStopped()) await view.wait(T.tail);
}
const recTotal = (n, T) => T.overview + n * (T.orbit + T.fly + T.hold) + Math.max(0, n - 1) * (T.ret + T.bird) + T.tail;

function buildOverlay(opts) {
  const overlay = h('div', { class: 'showcase', role: 'dialog', 'aria-label': opts.single ? 'Part location' : 'Warehouse showcase' });
  const box = h('div', { class: 'sc-canvas' });
  const title = h('span', { class: 'sc-title' }, opts.title);
  const counter = h('span', { class: 'sc-counter' });
  const btn = (txt, label, cls = '') => h('button', { type: 'button', class: `sc-btn ${cls}`, title: label, 'aria-label': label }, txt);
  const prev = btn('‹ Prev', 'Previous part (Left arrow)'), pause = btn('❚❚ Pause', 'Pause / play (Space)'), next = btn('Next ›', 'Next part (Right arrow)');
  const mime = recMime();
  const canRecord = !opts.single && mime && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  const exp = btn(`⬇ Export top ${REC_COUNT} (${mime && !mime.includes('mp4') ? 'WebM' : 'MP4'})`, `Record the first ${REC_COUNT} parts as a video clip`, 'sc-btn-export');
  const recTag = h('span', { class: 'sc-rec', hidden: true });
  const exit = btn(opts.single ? 'Close (Esc)' : 'Exit (Esc)', opts.single ? 'Close' : 'Exit', 'sc-exit');
  const ctrls = h('div', { class: 'sc-ctrls' }, opts.single || opts.offline ? null : [prev, pause, next], canRecord && !opts.offline ? exp : null, recTag, opts.offline ? null : exit);
  const card = h('div', { class: 'sc-card' });
  const bar = h('div', { class: 'sc-progress' });
  const toastEl = h('div', { class: 'sc-toast', hidden: true });
  overlay.append(box, h('div', { class: 'sc-top' }, h('div', { class: 'sc-title-wrap' }, title, counter), ctrls), card, bar, toastEl);
  return { overlay, box, title, counter, prev, pause, next, exp, recTag, exit, card, bar, toastEl, mime };
}

export async function startShowcase(opts = {}) {
  if (active) active.stop();
  const wh3d = await import('./warehouse3d.js');
  let order = opts.items || showcaseItems();
  if (!order.length) return;
  const ui = buildOverlay({ ...opts, title: opts.title || (opts.single ? 'Part location' : 'Warehouse showcase · Red first, lowest days on hand first') });
  document.body.append(ui.overlay);
  let stopped = false, view = null, wake = null, navReq = null, exportReq = false, recorder = null, toastTimer = null, curIdx = -1, fsArmed = false; // -1 = opening overview
  let slideStart = 0, slideMs = 0;
  const interrupted = () => stopped || navReq !== null || exportReq;
  const showToast = (msg, ms = 5000) => { ui.toastEl.textContent = msg; ui.toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { ui.toastEl.hidden = true; }, ms); };
  const setPaused = (b) => { if (!view) return; view.setPaused(b); ui.pause.textContent = b ? '▶ Play' : '❚❚ Pause'; ui.overlay.classList.toggle('sc-paused', b); };
  const nav = (d) => { if (!view || recorder || opts.single) return; let base = navReq !== null ? navReq : curIdx; if (base < 0 && d < 0) base = 0; navReq = ((base + d) % order.length + order.length) % order.length; view.cancel(); };
  const enterFs = () => (document.fullscreenElement || !ui.overlay.requestFullscreen ? Promise.resolve(!!document.fullscreenElement) : ui.overlay.requestFullscreen().then(() => true, () => false));
  const onKey = (e) => {
    if (fsArmed && e.key !== 'Escape') { fsArmed = false; enterFs(); }
    if (e.key === 'Escape') { stop(); return; }
    if (opts.single || recorder) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); nav(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); nav(-1); }
    else if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); setPaused(!view.isPaused()); } // also stops a focused button from "clicking"
  };
  const onPointer = (e) => { if (fsArmed && !e.target.closest?.('.sc-exit')) { fsArmed = false; enterFs(); } };
  function stop() {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('keydown', onKey); ui.overlay.removeEventListener('pointerdown', onPointer, true);
    if (recorder) { try { recorder.abort(); } catch { /* ignore */ } recorder = null; }
    if (wake) wake();
    if (view) { view.cancel(); view.dispose(); }
    clearTimeout(toastTimer); ui.overlay.remove();
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch { /* ignore */ } }
    active = null; if (window.__pfepShowcase) window.__pfepShowcase = null;
    if (location.hash === '#warehouse/showcase') history.replaceState(null, '', '#warehouse');
    opts.onClose?.();
  }
  ui.exit.addEventListener('click', stop);
  ui.prev.addEventListener('click', () => nav(-1));
  ui.next.addEventListener('click', () => nav(1));
  ui.pause.addEventListener('click', () => setPaused(!(view && view.isPaused())));
  ui.exp.addEventListener('click', () => { if (view && !recorder && !exportReq) { exportReq = true; view.cancel(); } });
  document.addEventListener('keydown', onKey);
  ui.overlay.addEventListener('pointerdown', onPointer, true);
  active = { stop, overlay: ui.overlay };
  if (opts.gesture) enterFs().then((ok) => { if (!ok) fsArmed = true; }); else fsArmed = true;

  await new Promise((r) => requestAnimationFrame(r)); // let the overlay lay out before sizing the canvas
  if (stopped) return;
  try { view = wh3d.mount(ui.box, D(), { mode: 'doh', showcase: true }); } catch (e) { ui.card.textContent = `3D unavailable: ${e.message}`; return; }
  active.view = view; window.__pfepShowcase = active; // test hook (e2e waits for the hold shot)
  const barHook = (clk) => { ui.bar.style.width = slideMs ? `${Math.min(100, (clk - slideStart) / slideMs * 100)}%` : '0%'; };
  view.setOnFrame(barHook);
  const startBar = (ms) => { slideStart = view.clock(); slideMs = ms; };
  const T = wh3d.SHOWCASE_T, S1 = wh3d.SINGLE_T;

  const showOverview = async (fly) => {
    curIdx = -1;
    ui.counter.textContent = `0 / ${order.length}`;
    fill(ui.card, h('div', { class: 'sc-pn' }, 'Warehouse overview'), h('div', { class: 'sc-desc' }, `${order.length} parts with a high-bay or VLM location · Red first, lowest days on hand first`), countsEl(order));
    view.setHighlight(null);
    startBar(T.overview + (fly ? T.ret : 0));
    if (fly) await view.flyToOverview(T.ret, T.overview); else await view.overview(T.overview);
  };

  const runExport = async () => {
    const items = order.slice(0, REC_COUNT);
    const mime = ui.mime, ext = mime.includes('mp4') ? 'mp4' : 'webm';
    const cv = h('canvas', { width: REC_W, height: REC_H }); const c2 = cv.getContext('2d');
    const recTitle = `Top ${items.length} urgent parts · ${D().asOf}`;
    const total = recTotal(items.length, wh3d.REC_T);
    const rec = { title: recTitle, counter: '', info: null, overview: null, progress: 0 };
    let recStart = null, aborted = false; const chunks = [];
    const stream = cv.captureStream(REC_FPS);
    const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((r) => { mr.onstop = r; });
    recorder = { abort() { aborted = true; try { if (mr.state !== 'inactive') mr.stop(); } catch { /* ignore */ } stream.getTracks().forEach((t) => t.stop()); } };
    setPaused(false);
    ui.overlay.classList.add('sc-recording'); ui.recTag.hidden = false;
    [ui.prev, ui.pause, ui.next, ui.exp].forEach((b) => { b.hidden = true; });
    const prevTitle = ui.title.textContent; ui.title.textContent = recTitle;
    view.setOnFrame((clk) => {
      if (recStart === null) recStart = clk;
      rec.progress = (clk - recStart) / total; ui.bar.style.width = `${Math.min(100, rec.progress * 100)}%`;
      const sec = Math.max(0, Math.round((clk - recStart) / 1000)), tot = Math.round(total / 1000);
      ui.recTag.textContent = `● REC ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} / ${Math.floor(tot / 60)}:${String(tot % 60).padStart(2, '0')}`;
      drawRecFrame(c2, view.canvas, rec);
    });
    mr.start(1000);
    try { await recordSequence(view, items, { ...ui, rec }, wh3d.REC_T, () => stopped, wh3d.vlmTowerOf); }
    finally { if (!aborted) { try { mr.stop(); } catch { /* ignore */ } } }
    await done; stream.getTracks().forEach((t) => t.stop()); recorder = null;
    if (stopped || aborted) return;
    view.setOnFrame(barHook);
    ui.overlay.classList.remove('sc-recording'); ui.recTag.hidden = true;
    [ui.prev, ui.pause, ui.next, ui.exp].forEach((b) => { b.hidden = false; });
    ui.title.textContent = prevTitle;
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    const filename = `warehouse_top${items.length}_urgent_${D().asOf}.${ext}`;
    window.__pfepLastExport = { size: blob.size, type: blob.type, filename };
    if (!blob.size) { showToast('The recording came out empty — keep this tab in front and try again.'); return; }
    // GitHub Pages has no save API: a plain browser download
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast(`Saved ${filename} (${(blob.size / 1048576).toFixed(1)} MB).`);
  };

  if (!opts.single) await showOverview(false);
  let atOverview = !opts.single;
  for (let i = 0; !stopped && order.length;) {
    if (exportReq) { exportReq = false; navReq = null; await runExport(); if (stopped) break; atOverview = false; continue; }
    if (navReq !== null) { i = navReq; navReq = null; }
    curIdx = i;
    const it = order[i];
    ui.counter.textContent = opts.single ? '' : `${i + 1} / ${order.length}`;
    fill(ui.card, cardEl(slideInfo(it, wh3d.vlmTowerOf)));
    view.setHighlight(new Set([it.partNo])); // focused part keeps its DOH colour and blinks; everything else dims
    if (opts.single) { ui.bar.hidden = true; await view.overview(S1.overview); if (stopped) break; }
    const v = view.viewOf(it.partNo);
    const orbitMs = opts.single ? S1.orbit : T.orbit, flyMs = opts.single ? S1.fly : T.fly;
    const returnMs = !opts.single && !atOverview ? T.ret + T.bird : 0;
    startBar(opts.single ? 0 : returnMs + (v && v.rowCenter ? orbitMs : 0) + flyMs + T.hold);
    if (returnMs) { await view.flyToOverview(T.ret, T.bird); if (interrupted()) { atOverview = false; continue; } }
    atOverview = false;
    if (v && v.rowCenter) { await view.orbit(v.rowCenter, undefined, view.orbitHeight, orbitMs); if (interrupted()) continue; }
    await view.focusPart(it.partNo, flyMs);
    if (interrupted()) continue;
    if (opts.single) { await new Promise((r) => { wake = r; }); break; } // hold until Close / Esc
    const rest = slideMs - (view.clock() - slideStart);
    if (rest > 0) await view.wait(rest);
    if (interrupted()) continue;
    i = (i + 1) % order.length;
    if (i === 0 && !stopped && !opts.items) { order = showcaseItems(); await showOverview(true); atOverview = true; } // new pass picks up applied changes
  }
}

export function openPartShowcase(partNo) {
  const it = showcaseItems().find((x) => x.partNo === partNo);
  if (!it) return false;
  startShowcase({ items: [it], single: true, gesture: true, title: 'Part location' });
  return true;
}

// Offline clip: same sequence as Export, on a manual clock at a fixed 1920×1080, one frame per call.
// Used by tools/make-video.py to render the README video without depending on real-time playback.
window.__pfepClip = {
  async start(count = REC_COUNT) {
    const wh3d = await import('./warehouse3d.js');
    const items = showcaseItems().slice(0, count);
    const ui = buildOverlay({ offline: true, title: `Top ${items.length} urgent parts · ${D().asOf}` });
    ui.overlay.style.cssText = `width:${REC_W}px;height:${REC_H}px;inset:0 auto auto 0`;
    document.body.append(ui.overlay);
    await new Promise((r) => requestAnimationFrame(r));
    const view = wh3d.mount(ui.box, D(), { mode: 'doh', showcase: true, manual: true, pixelRatio: 1 });
    const cv = h('canvas', { width: REC_W, height: REC_H }); const c2 = cv.getContext('2d');
    const total = recTotal(items.length, wh3d.REC_T);
    const rec = { title: ui.title.textContent, counter: '', info: null, overview: null, progress: 0 };
    view.setOnFrame((clk) => { rec.progress = clk / total; drawRecFrame(c2, view.canvas, rec); });
    let finished = false;
    recordSequence(view, items, { ...ui, rec }, wh3d.REC_T, () => false, wh3d.vlmTowerOf).then(() => { finished = true; });
    this._s = { view, cv, total, isDone: () => finished, ui, insideCount: 0 };
    return { total, fps: REC_FPS };
  },
  async step(dt, quality = 0.92) {
    const s = this._s;
    await new Promise((r) => setTimeout(r, 0)); // let the sequence schedule its next move first
    s.view.tick(dt);
    if (s.view._debug.inRack(s.view._debug.camera.position)) s.insideCount++;
    return { done: s.isDone(), jpeg: s.cv.toDataURL('image/jpeg', quality), clock: s.view.clock(), inside: s.insideCount };
  },
  stop() { const s = this._s; if (s) { s.view.dispose(); s.ui.overlay.remove(); this._s = null; } },
};
