// Fictional MB51 export with Entry time and Material document — the input of the Warehouse flow tab.
// Separate from the 90-day `mb51` log the lifecycle rules read, so those rules and their planted cases
// are untouched. Own random stream, so adding this changes nothing else in the seed.
//
// Shape of a day (fictional, chosen to look like a busy plant receiving dock):
//  - working days only; 8–45 inbound trucks (one Material Document each), lines per truck mostly 1–8,
//    sometimes 9–20, now and then one big delivery of 40–80 lines;
//  - SAP entry times 07:00–21:30 with an afternoon peak; lines of one truck entered 20–90 s apart;
//  - receipts go to parts with a high-bay location (~80%), a VLM tray (~6%) or no location (~14% → floor);
//  - 261 goods issues to the line from located parts, bunched after shift start (06:00, 14:30).
import { mulberry32, addDays } from './seed.js';

export const FLOW_DAYS = 22;

const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
const hms = (sec) => {
  sec = Math.max(0, Math.min(86399, Math.round(sec)));
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export function makeFlowLog({ pkg, wh, matplan, asOf }, seed) {
  const rnd = mulberry32(seed + 92);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return s - 3; };
  const byPn = new Map(pkg.map((r) => [r.partNo, r]));
  const desc = new Map(matplan.map((m) => [m.material, m.description]));
  const live = (pn) => !/OBS/i.test(desc.get(pn) || byPn.get(pn)?.product || ''); // nothing is received for obsolete parts
  const hb = wh.filter((w) => w.area === 'HIGHBAY' && live(w.material)).map((w) => w.material);
  const vlm = wh.filter((w) => w.area === 'VLM' && live(w.material)).map((w) => w.material);
  // a fixed pool of components without a location: the same few keep landing on the floor,
  // so the "no location" table reads as a list of slotting candidates
  const noLoc = wh.filter((w) => w.area === 'NOT-WH' && w.material.startsWith('2') && live(w.material)).map((w) => w.material);
  const floorPool = [];
  while (floorPool.length < Math.min(36, noLoc.length)) { const pn = pick(noLoc); if (!floorPool.includes(pn)) floorPool.push(pn); }
  const located = [...hb, ...vlm];
  const material = () => { const u = rnd(); return u < 0.8 ? pick(hb) : u < 0.86 ? pick(vlm) : pick(floorPool); };
  const qtyOf = (pn) => { const p = byPn.get(pn); return (p?.partsPerPu || 8) * ri(2, 12); };

  // working days, oldest first, ending on asOf
  const days = [];
  for (let d = 0; days.length < FLOW_DAYS; d++) { const iso = addDays(asOf, -d); if (weekday(iso) % 6 !== 0) days.unshift(iso); }

  let docNo = 5000184000;
  const rows = [];
  days.forEach((date, di) => {
    const last = di === days.length - 1;
    const trucks = last ? 34 : Math.max(8, Math.min(45, Math.round(26 + gauss() * 9)));
    const bigAt = last || rnd() < 0.35 ? ri(0, trucks - 1) : -1; // one large delivery on some days
    for (let t = 0; t < trucks; t++) {
      const doc = String(docNo += ri(3, 40));
      const n = t === bigAt ? ri(40, 80) : rnd() < 0.82 ? ri(1, 8) : ri(9, 20);
      // arrival: afternoon peak (around 14:30) blended with a flat 07:00–21:30 spread
      const start = rnd() < 0.6 ? 14.5 * 3600 + gauss() * 2.2 * 3600 : ri(7 * 3600, 21 * 3600);
      let sec = Math.max(7 * 3600, Math.min(21.5 * 3600 - n * 40, start));
      for (let k = 0; k < n; k++) {
        const pn = material();
        rows.push({ date, time: hms(sec), doc, material: pn, description: desc.get(pn) || byPn.get(pn)?.product || '', mvt: '101', qty: qtyOf(pn), unit: 'PC' });
        sec += ri(20, 90);
      }
    }
    // goods issues to the line: a burst after each shift start, a trickle in between
    const issues = ri(24, 48);
    let doc261 = String(docNo += ri(3, 40));
    for (let k = 0; k < issues; k++) {
      const u = rnd();
      const sec = u < 0.4 ? 6 * 3600 + ri(0, 90 * 60) : u < 0.8 ? 14.5 * 3600 + ri(0, 90 * 60) : ri(8 * 3600, 21 * 3600);
      if (k % 6 === 0) doc261 = String(docNo += ri(3, 40));
      const pn = pick(located);
      rows.push({ date, time: hms(sec), doc: doc261, material: pn, description: desc.get(pn) || byPn.get(pn)?.product || '', mvt: '261', qty: -(byPn.get(pn)?.partsPerPu || 8) * ri(1, 4), unit: 'PC' });
    }
  });
  return rows;
}
