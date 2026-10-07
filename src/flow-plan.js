// Warehouse flow — pure part (no DOM, no 3D): read one day of MB51 (101 receipts, 261 issues) and turn it
// into a replay plan and the day's KPIs. Runs in Node tests and in the browser.
//  R28 one Material Document = one inbound truck, arriving 10 min before its first line's entry time
//  R29 put-away destination = the part's current location: high-bay, else VLM, else floor storage
//  R30 tugger runs = located 261 lines in time order, grouped (≤ 20 min from the run's first line, ≤ 3 stops);
//      a day with no 261 gets a simulated Red-parts loop, flagged `simulated`
//  R31 day KPIs use only data (MB51 + current locations + today's DOH status) — nothing from the simulated fleet
import * as R from './rules.js';

export const FLOW = { doors: 6, tugEveryMin: 30, tugStops: 3, tugGapMin: 20, dayMinS: 360, tripEstS: 26, truckEarlyS: 600, truckStayAfterS: 300 };

export function parseTime(v) { // -> seconds since midnight, or null ("1:44:48 PM", "13:44", Excel fraction)
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v >= 0 && v < 1 ? Math.round(v * 86400) : null;
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?$/);
  if (!m) return null;
  let hr = +m[1]; const mi = +m[2], s = +(m[3] || 0);
  if (m[4]) { const pm = /p/i.test(m[4]); if (hr === 12) hr = 0; if (pm) hr += 12; }
  return hr * 3600 + mi * 60 + s;
}
export const hhmm = (sec) => { sec = Math.max(0, Math.floor(sec)); return `${String(Math.floor(sec / 3600) % 24).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`; };
export const dayLabel = (iso) => { const [y, m, d] = iso.split('-'); return `${+m}/${+d}/${y}`; };

// day -> { key, gr: [line], gi: [line] }
export function flowDays(flowlog) {
  const days = new Map();
  flowlog.forEach((r, ri) => {
    const kind = r.mvt === '101' ? 'gr' : r.mvt === '261' ? 'gi' : null; // 102 reversals etc. are not replayed
    if (!kind) return;
    if (!days.has(r.date)) days.set(r.date, { key: r.date, gr: [], gi: [] });
    days.get(r.date)[kind].push({ material: r.material, desc: r.description || '', sec: parseTime(r.time), doc: r.doc || '', qty: Math.abs(Number(r.qty) || 0), unit: r.unit || '', ri });
  });
  return days;
}

// R29
export function locator(wh) {
  const map = new Map(wh.map((w) => [w.material, w]));
  return (material) => {
    const w = map.get(material);
    if (w && w.area === 'HIGHBAY') return { kind: 'hb', bin: R.whLabel(w) };
    if (w && w.area === 'VLM') return { kind: 'vlm', bin: R.whLabel(w) };
    return { kind: 'floor', bin: null };
  };
}

// R28 + R30
export function flowPlan(day, locate, redPool = []) {
  const fill = (list) => { const miss = list.filter((l) => l.sec === null); miss.forEach((l, i) => { l.sec = 6 * 3600 + Math.round((i + 0.5) / miss.length * 12 * 3600); }); };
  const gr = day.gr.map((l) => ({ ...l })), gi = day.gi.map((l) => ({ ...l }));
  fill(gr); fill(gi);
  gr.forEach((l) => Object.assign(l, locate(l.material)));
  const docs = new Map();
  gr.forEach((l) => { const k = l.doc || `row${l.ri}`; if (!docs.has(k)) docs.set(k, []); docs.get(k).push(l); });
  const trucks = [...docs.entries()].map(([doc, lines]) => { lines.sort((a, b) => a.sec - b.sec); return { doc, lines, arrive: lines[0].sec - FLOW.truckEarlyS }; })
    .sort((a, b) => a.arrive - b.arrive);
  trucks.forEach((t, i) => { t.id = i; t.lines.forEach((l) => { l.truck = i; }); });
  const runs = [];
  gi.map((l) => Object.assign(l, locate(l.material))).filter((l) => l.kind !== 'floor').sort((a, b) => a.sec - b.sec).forEach((l) => {
    const r = runs[runs.length - 1];
    if (r && r.stops.length < FLOW.tugStops && l.sec - r.stops[0].sec <= FLOW.tugGapMin * 60) r.stops.push(l);
    else runs.push({ start: l.sec, stops: [l], simulated: false });
  });
  const all = [...gr.map((l) => l.sec), ...gi.map((l) => l.sec), ...trucks.map((t) => t.arrive)];
  const start = all.length ? Math.floor((Math.min(...all) - 300) / 60) * 60 : 6 * 3600;
  const end = all.length ? Math.max(...all) + 900 : 18 * 3600;
  let simulated = false;
  if (!gi.length) { // no 261 this day → simulated loop over Red parts, labelled on screen
    simulated = true;
    const pool = redPool.map((pn) => ({ material: pn, ...locate(pn), qty: 0, unit: '', sec: 0 })).filter((x) => x.kind !== 'floor');
    let k = 0;
    for (let t = start + 15 * 60; pool.length && t < end - 20 * 60; t += FLOW.tugEveryMin * 60) {
      const stops = []; for (let j = 0; j < FLOW.tugStops && j < pool.length; j++) { stops.push({ ...pool[k % pool.length], sec: t }); k++; }
      runs.push({ start: t, stops, simulated: true });
    }
  }
  const counts = { hb: 0, vlm: 0, floor: 0 }; gr.forEach((l) => { counts[l.kind]++; });
  return { key: day.key, trucks, lines: gr, runs, start, end, simulated, counts, issues: gi.length };
}

// pacing (presentation, not data): fleet size and how long a 1× replay of the day lasts
export function pacing(plan) {
  const fleet = Math.max(3, Math.min(8, Math.ceil(plan.lines.length / 50)));
  const realDay = Math.max(FLOW.dayMinS, plan.lines.length * FLOW.tripEstS / fleet);
  return { fleet, realDay, rate: (plan.end - plan.start) / realDay };
}

// R31 — statusOf(material) -> 'RED' | 'ORANGE' | 'GREEN' | …
export function dayKpis(plan, statusOf) {
  const L = plan.lines, nL = L.length, nT = plan.trucks.length;
  const qty = new Map(); L.forEach((l) => { const u = l.unit || '—'; qty.set(u, (qty.get(u) || 0) + l.qty); });
  const secs = L.map((l) => l.sec).sort((a, b) => a - b);
  const byHour = new Map(); L.forEach((l) => { const hr = Math.floor(l.sec / 3600); byHour.set(hr, (byHour.get(hr) || 0) + 1); });
  let peakHour = null, peakLines = 0; [...byHour.entries()].sort((a, b) => a[0] - b[0]).forEach(([hr, n]) => { if (n > peakLines) { peakLines = n; peakHour = hr; } });
  const biggest = plan.trucks.reduce((a, t) => (!a || t.lines.length > a.lines.length ? t : a), null);
  const ev = []; plan.trucks.forEach((t) => { ev.push([t.arrive, 1]); ev.push([t.lines[t.lines.length - 1].sec + FLOW.truckStayAfterS, -1]); });
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, onSite = 0, onSiteAt = null; ev.forEach(([s, d]) => { cur += d; if (cur > onSite) { onSite = cur; onSiteAt = s; } });
  const parts = new Map();
  L.forEach((l) => { if (!parts.has(l.material)) parts.set(l.material, { material: l.material, desc: l.desc, kind: l.kind, bin: l.bin, lines: 0, qty: 0, unit: l.unit }); const p = parts.get(l.material); p.lines++; p.qty += l.qty; });
  const status = { RED: 0, ORANGE: 0, GREEN: 0, OTHER: 0 };
  parts.forEach((p) => { p.status = statusOf(p.material); status[p.status in status ? p.status : 'OTHER']++; });
  return {
    trucks: nT, lines: nL, parts: parts.size, counts: plan.counts,
    pct: (n) => (nL ? Math.round(n / nL * 100) : 0),
    window: secs.length ? [secs[0], secs[secs.length - 1]] : null,
    peakHour, peakLines,
    linesPerTruck: nT ? nL / nT : 0, biggest: biggest ? { doc: biggest.doc, lines: biggest.lines.length } : null,
    onSite, onSiteAt, doors: FLOW.doors,
    qty: [...qty.entries()].sort((a, b) => b[1] - a[1]),
    status, runs: plan.runs.length, simulated: plan.simulated, issues: plan.issues,
    floorParts: [...parts.values()].filter((p) => p.kind === 'floor').sort((a, b) => b.lines - a.lines || b.qty - a.qty),
    redParts: [...parts.values()].filter((p) => p.status === 'RED').sort((a, b) => b.qty - a.qty),
  };
}
