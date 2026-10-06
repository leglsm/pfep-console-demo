// Fictional sample data for the Package Database Console demo.
// Every company, person, program and part number here is invented.
// Same SEED -> same data, so tests and screenshots are reproducible.

export const SEED = 20261005;
export const ASOF = '2026-09-30';

export const CONFIG = {
  workdays: 5,
  trailerL: 13600, trailerW: 2450, trailerH: 2700, // mm
  dohRed: 5, dohOrange: 22,
  recentDays: 30, ooWeeks: 3,
  levelHeightIn: 26, maxStack: 4,
  importRejectMaxPct: 20, dateOrder: 'MDY',
  stackFixedMinRows: 10,
};

export const COMPANY = 'Northwind Bumper Systems';
export const PLANT = 'NB01';

export const PROGRAMS = [
  { code: 'X1', vehicle: 'Crossover X1' },
  { code: 'V7', vehicle: 'Van V7' },
  { code: 'R3', vehicle: 'Roadster R3' },
  { code: 'M5', vehicle: 'Midsize M5' },
  { code: 'K2', vehicle: 'Compact K2' },
];

export const SUPPLIERS = [
  'Acme Lighting', 'Delta Fasteners', 'Harbor Plastics', 'Summit Molding', 'Pioneer Clips',
  'Keystone Brackets', 'Bluewater Sensors', 'Granite Steel Works', 'Northstar Foam', 'Cedar Valley Rubber',
  'Orion Electronics', 'Lakeside Packaging', 'Redwood Composites', 'Silverline Trim', 'Atlas Coatings',
  'Meridian Wire', 'Crescent Seals', 'Falcon Hardware', 'Ironbridge Stamping', 'Willow Creek Labels',
];
export const vendorNoOf = (i) => String(104200 + i * 137).padStart(10, '0');

const NOUNS = [
  'FASCIA CLIP', 'RETAINER', 'BRACKET', 'SPACER', 'GROMMET', 'RIVET', 'SCREW', 'NUT', 'WASHER',
  'SEAL STRIP', 'FOAM PAD', 'REINFORCEMENT BAR', 'ENERGY ABSORBER', 'SENSOR BRACKET', 'SENSOR HOUSING',
  'HARNESS CLIP', 'DEFLECTOR', 'DUCT', 'SKID PLATE', 'TRIM MOLDING', 'BEZEL', 'INSERT', 'GRILLE MESH',
  'CLOSE OUT PANEL', 'MOUNTING PLATE', 'HEAT SHIELD', 'DRAIN VALVE', 'LABEL', 'CAP', 'BUMPER BEAM',
];
const SIGNERS = ['J. Rivera', 'K. Osei', 'M. Novak', 'T. Lindqvist'];
const PLANNERS = ['P01', 'P02', 'P03', 'P04', 'P05'];

// The 34 PFEP columns, in display order.
export const PKG_COLUMNS = [
  'partNo', 'program', 'vehicle', 'product', 'oemPn', 'supplierCode', 'supplierName', 'puType',
  'puL', 'puW', 'puH', 'partsPerPu', 'puPerHu', 'huL', 'huW', 'huH', 'huType',
  'stackTrailer', 'stackWarehouse', 'weightG', 'tarePu', 'grossPu', 'grossHu', 'moq', 'returnable',
  'country', 'transitDays', 'dockCode', 'signedForm', 'lastReview', 'flags', 'tags', 'source', 'updatedAt',
];

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const round = (v, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

export function makeSeed(seed = SEED) {
  const rnd = mulberry32(seed);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const chance = (p) => rnd() < p;

  const used = new Set();
  const newPn = (prefix, len) => {
    for (;;) {
      let s = prefix;
      while (s.length < len) s += String(ri(0, 9));
      if (!used.has(s)) { used.add(s); return s; }
    }
  };
  const returnablePool = Array.from({ length: 10 }, () => newPn('6', 8));

  const vendors = SUPPLIERS.map((name, i) => ({ vendorNo: vendorNoOf(i), vendorName: name }));
  const supplierOfProgram = {};

  const pkg = [];
  const base = (partNo, prog) => ({
    partNo, program: prog.code, vehicle: prog.vehicle, product: '', oemPn: '',
    supplierCode: '', supplierName: '', puType: '', puL: null, puW: null, puH: null,
    partsPerPu: null, puPerHu: null, huL: null, huW: null, huH: null, huType: '',
    stackTrailer: null, stackWarehouse: null, weightG: null, tarePu: null, grossPu: null, grossHu: null,
    moq: null, returnable: '', country: '', transitDays: null, dockCode: '', signedForm: '',
    lastReview: '', flags: [], tags: [], source: 'seed', updatedAt: ASOF,
  });
  const fillComponent = (r, opts = {}) => {
    const vi = opts.vendor ?? ri(0, vendors.length - 1);
    r.supplierCode = vendors[vi].vendorNo; r.supplierName = vendors[vi].vendorName;
    const tote = chance(0.4);
    r.puType = tote ? 'Returnable tote' : 'Cardboard box';
    r.returnable = tote ? pick(returnablePool) : '';
    r.puL = pick([300, 400, 600]); r.puW = pick([200, 300, 400]); r.puH = pick([150, 200, 250, 300, 400]);
    r.partsPerPu = ri(2, 40) * 5; r.puPerHu = pick([8, 12, 16, 24, 32, 48]);
    r.huL = 1200; r.huW = 1000; r.huH = pick([900, 1000, 1100]);
    r.huType = chance(0.15) ? 'Mixed' : 'Homogeneous';
    r.stackTrailer = ri(1, 3); r.stackWarehouse = r.stackTrailer;
    r.weightG = ri(50, 1500);
    r.tarePu = tote ? 1.8 : 0.4;
    r.grossPu = round(r.partsPerPu * r.weightG / 1000 + r.tarePu, 2);
    r.grossHu = round(r.grossPu * r.puPerHu + 20, 1);
    r.moq = r.partsPerPu * pick([1, 2, 4]);
    r.oemPn = 'OEM-' + ri(100000, 999999);
    r.country = pick(['US', 'US', 'MX', 'CA', 'KR', 'DE']);
    r.transitDays = ri(1, 21);
    r.dockCode = pick(['D01', 'D02', 'D03', 'D05']);
    r.lastReview = addDays(ASOF, -ri(10, 400));
  };

  // --- components (2XXXXXXX)
  for (let i = 0; i < 1310; i++) {
    const prog = pick(PROGRAMS);
    const r = base(newPn('2', 8), prog);
    const side = chance(0.4) ? pick([' LH', ' RH']) : '';
    r.product = `${pick(['FRT', 'RR'])} ${pick(NOUNS)}${side} ${prog.code}`;
    fillComponent(r);
    pkg.push(r);
  }
  // --- finished goods (45XXXXXX)
  const trims = ['BASE', 'SPORT', 'LTD', 'OFFROAD'];
  const colors = ['BLACK', 'SILVER', 'WHITE', 'RED'];
  let fgCount = 0;
  outer: for (const prog of PROGRAMS) for (const pos of ['FRT', 'RR']) for (const trim of trims) for (const col of colors) {
    if (fgCount++ >= 140) break outer;
    const r = base(newPn('45', 8), prog);
    r.product = `${pos} BUMPER ASSY ${prog.code} ${trim} ${col}`;
    r.supplierCode = ''; r.supplierName = ''; // made in-house
    r.puType = 'Returnable rack'; r.returnable = pick(returnablePool);
    r.puL = 1900; r.puW = 1000; r.puH = 1150; r.partsPerPu = 8; r.puPerHu = 1;
    r.huL = 1900; r.huW = 1000; r.huH = 1150; r.huType = 'Homogeneous';
    r.stackTrailer = 2; r.stackWarehouse = 2; r.weightG = ri(4500, 7800);
    r.tarePu = 85; r.grossPu = round(8 * r.weightG / 1000 + 85, 1); r.grossHu = r.grossPu;
    r.moq = 8; r.oemPn = 'OEM-' + ri(100000, 999999); r.country = 'US'; r.transitDays = 1;
    r.dockCode = 'SHP'; r.lastReview = addDays(ASOF, -ri(10, 300));
    pkg.push(r);
  }
  // --- service parts (75XXXXXX, trading material) — boxed, not totes
  const svcRows = [];
  for (let i = 0; i < 38; i++) {
    const prog = pick(PROGRAMS);
    const r = base(newPn('75', 8), prog);
    r.product = `${pick(NOUNS)} ${prog.code} KIT`;
    fillComponent(r);
    r.puType = 'Service carton'; r.returnable = ''; r.partsPerPu = ri(1, 10);
    svcRows.push(r); pkg.push(r);
  }

  const byPn = new Map(pkg.map((r) => [r.partNo, r]));
  const comps = pkg.filter((r) => r.partNo.startsWith('2'));
  const taken = new Set();
  const takeComp = (pred = () => true) => {
    for (;;) {
      const r = pick(comps);
      if (!taken.has(r.partNo) && pred(r)) { taken.add(r.partNo); return r; }
    }
  };

  // --- named rows used by the service-part matching cases
  const progX1 = PROGRAMS[0], progV7 = PROGRAMS[1], progR3 = PROGRAMS[2];
  const injectRow = (prefix, prog, product, service) => {
    const r = base(newPn(prefix, 8), prog);
    r.product = product; fillComponent(r);
    if (service) { r.puType = 'Service carton'; r.returnable = ''; r.partsPerPu = ri(1, 10); }
    pkg.push(r); byPn.set(r.partNo, r); taken.add(r.partNo);
    if (!service) comps.push(r);
    return r;
  };
  const svcFog = injectRow('75', progX1, 'FOG LAMP BEZEL RH X1 KIT', true);
  const svcCam = injectRow('75', progV7, 'CAMERA GARNISH V7 KIT', true);
  const prodTow = injectRow('2', progX1, 'TOW HOOK COVER X1', false);
  const prodGrille = injectRow('2', progV7, 'GRILLE INSERT UPPER V7', false);

  const PLANTED = {};

  // --- signed-form archive (forms already on file) for ~45% of comps and finished goods
  const forms = [];
  const formOf = new Map();
  const stackText = (n) => (n <= 1 ? '1' : `${n - 1}/1`);
  const addArchiveForm = (r) => {
    const f = {
      id: `FRM-${String(forms.length + 1).padStart(4, '0')}`, file: '', partNo: r.partNo,
      fields: {
        supplier: r.supplierName, program: r.program, packagingType: r.puType,
        puL: `${r.puL} mm`, puW: `${r.puW} mm`, puH: `${r.puH} mm`,
        partsPerPu: String(r.partsPerPu), puPerHu: String(r.puPerHu),
        stackability: stackText(r.stackTrailer), componentWeight: `${round(r.weightG / 1000, 3)} kg`,
        mixedPallet: r.huType === 'Mixed' ? 'YES' : 'NO', returnable: r.returnable || 'N/A',
      },
      signed: true, signer: pick(SIGNERS), signedAt: addDays(r.lastReview, -ri(5, 60)), parsedAt: r.lastReview,
    };
    forms.push(f); formOf.set(r.partNo, f); r.signedForm = f.id;
  };
  for (const r of pkg) if (!r.partNo.startsWith('75') && chance(0.45)) addArchiveForm(r);

  // ===== Planted: system errors =====
  // (a) weight typed in kg into the gram column
  PLANTED.weightKg = [];
  for (let i = 0; i < 6; i++) {
    const r = takeComp((x) => formOf.has(x.partNo) && x.program !== 'R3' && x.weightG >= 100);
    r.weightG = round(r.weightG / 1000, 3);
    PLANTED.weightKg.push(r.partNo);
  }
  // (b) one program had trailer stackability filled as a fixed "4"
  PLANTED.stackFixed = { program: 'R3', parts: [] };
  for (const r of pkg) if (r.program === 'R3') {
    r.stackTrailer = 4;
    if (formOf.has(r.partNo)) PLANTED.stackFixed.parts.push(r.partNo);
  }
  // (c) two parts' dimensions swapped
  PLANTED.dimSwap = [];
  for (let i = 0; i < 2; i++) {
    const a = takeComp((x) => formOf.has(x.partNo) && x.program !== 'R3');
    const b = takeComp((x) => formOf.has(x.partNo) && x.program === a.program &&
      (x.puL !== a.puL || x.puW !== a.puW || x.puH !== a.puH));
    [a.puL, b.puL] = [b.puL, a.puL]; [a.puW, b.puW] = [b.puW, a.puW]; [a.puH, b.puH] = [b.puH, a.puH];
    PLANTED.dimSwap.push([a.partNo, b.partNo]);
  }

  // ===== Planted: new forms to ingest (rendered as PDFs by tools/make-forms.js) =====
  const formSpec = (r, over = {}) => ({
    partNo: r.partNo, description: r.product, supplier: r.supplierName, program: r.program,
    packagingType: r.puType, puL: `${r.puL} mm`, puW: `${r.puW} mm`, puH: `${r.puH} mm`,
    partsPerPu: String(r.partsPerPu), puPerHu: String(r.puPerHu), stackability: stackText(r.stackWarehouse),
    componentWeight: `${round(r.weightG / 1000, 3)} kg`, mixedPallet: r.huType === 'Mixed' ? 'YES' : 'NO',
    returnable: r.returnable || 'N/A', signedBy: pick(SIGNERS), dateSigned: addDays(ASOF, -ri(1, 6)), ...over,
  });
  const noForm = (x) => !formOf.has(x.partNo) && x.program !== 'R3';
  const NEW_FORMS = [];
  {
    const r = takeComp(noForm); const spec = formSpec(r); r.huType = ''; r.moq = null;
    NEW_FORMS.push({ file: 'PF-01_blank-fields.pdf', case: 'AUTOFILL', expect: { autoFilled: ['huType'] }, fields: spec });
  }
  {
    const r = takeComp(noForm); r.partsPerPu = 50;
    NEW_FORMS.push({ file: 'PF-02_signed-change.pdf', case: 'SIGNED_CONFLICT', expect: { conflicts: ['partsPerPu'] }, fields: formSpec(r, { partsPerPu: '60' }) });
  }
  {
    const r = takeComp(noForm); r.partsPerPu = 40;
    NEW_FORMS.push({ file: 'PF-03_unsigned.pdf', case: 'UNSIGNED_HELD', expect: { held: ['partsPerPu'] }, fields: formSpec(r, { partsPerPu: '48', signedBy: '', dateSigned: '' }) });
  }
  {
    const r = takeComp(noForm); const spec = formSpec(r, { puL: '23.6', puW: '15.7', puH: '9.8' });
    r.puL = null; r.puW = null; r.puH = null;
    NEW_FORMS.push({ file: 'PF-04_no-dim-units.pdf', case: 'UNIT_CHECK', expect: { held: ['puL', 'puW', 'puH'] }, fields: spec });
  }
  {
    const r = takeComp((x) => noForm(x) && x.supplierName === 'Acme Lighting');
    r.supplierCode = ''; r.supplierName = '';
    NEW_FORMS.push({ file: 'PF-05_supplier-variant.pdf', case: 'SUPPLIER_MATCH', expect: { autoFilled: ['supplierCode'] }, fields: formSpec({ ...r, supplierName: 'Acme Lighting' }, { supplier: 'ACME LIGHTING, INC.' }) });
  }
  {
    const pn = newPn('2', 8);
    const spec = {
      partNo: pn, description: 'FRT CAMERA BRACKET LH M5', supplier: 'Bluewater Sensors', program: 'M5',
      packagingType: 'Cardboard box', puL: '400 mm', puW: '300 mm', puH: '200 mm', partsPerPu: '30', puPerHu: '24',
      stackability: '2/1', componentWeight: '0.21 kg', mixedPallet: 'NO', returnable: 'N/A',
      signedBy: 'K. Osei', dateSigned: addDays(ASOF, -2),
    };
    NEW_FORMS.push({ file: 'PF-06_new-part.pdf', case: 'NEW_ROW', expect: { newRows: [pn] }, fields: spec });
  }
  {
    const r = takeComp(noForm); const spec = formSpec(r, { stackability: '2/1', componentWeight: '0.85 kg' });
    r.stackTrailer = null; r.stackWarehouse = null; r.weightG = null;
    NEW_FORMS.push({ file: 'PF-07_stack-and-kg.pdf', case: 'CONVERSIONS', expect: { autoFilled: ['stackTrailer', 'stackWarehouse', 'weightG'], values: { stackTrailer: 3, stackWarehouse: 3, weightG: 850 } }, fields: spec });
  }
  {
    const r = takeComp(noForm);
    NEW_FORMS.push({ file: 'PF-08_unknown-supplier.pdf', case: 'SUPPLIER_CHECK', expect: { held: ['supplierCode', 'weightG'] }, fields: formSpec(r, { supplier: 'Zenith Mouldings Ltd', componentWeight: '1.2' }) });
  }
  PLANTED.newForms = NEW_FORMS.map((f) => ({ file: f.file, case: f.case, partNo: f.fields.partNo, expect: f.expect }));

  // ===== Planted: supersession (SQ01) =====
  const sq01 = [];
  const link = (o, n, createdOn) => sq01.push({ oldMaterial: o.partNo, newMaterial: n.partNo, createdOn });
  const plainComp = () => takeComp((x) => x.program !== 'R3');
  const ch = [plainComp(), plainComp(), plainComp()];
  link(ch[0], ch[1], '2025-04-01'); link(ch[1], ch[2], '2026-03-15');
  const fk = [plainComp(), plainComp(), plainComp()];
  link(fk[0], fk[1], '2025-06-01'); link(fk[0], fk[2], '2026-02-10');
  const tie = [plainComp(), plainComp(), plainComp()];
  link(tie[0], tie[1], '2026-01-05'); link(tie[0], tie[2], '2026-01-05');
  const cyc = [plainComp(), plainComp()];
  link(cyc[0], cyc[1], '2025-09-01'); link(cyc[1], cyc[0], '2026-04-01');
  const s1o = plainComp(), s1n = plainComp(), s2o = plainComp(), s2n = plainComp();
  link(s1o, s1n, '2026-05-20'); link(s2o, s2n, '2026-06-02');
  s1o.moq = null; s1n.tarePu = null; s2n.huType = '';
  const tOk = [plainComp(), plainComp()], tChk = [plainComp(), plainComp()];
  link(tOk[0], tOk[1], '2026-07-01'); link(tChk[0], tChk[1], '2026-04-18');
  for (let i = 0; i < 25; i++) link(plainComp(), plainComp(), addDays(ASOF, -ri(30, 700)));
  PLANTED.chain = ch.map((r) => r.partNo);
  PLANTED.fork = { old: fk[0].partNo, adopted: fk[2].partNo, rejected: fk[1].partNo };
  PLANTED.forkTie = { old: tie[0].partNo, candidates: [tie[1].partNo, tie[2].partNo] };
  PLANTED.cycle = cyc.map((r) => r.partNo);
  PLANTED.sync = {
    whCopy: { old: s1o.partNo, new: s1n.partNo },
    fill: [
      { from: s1n.partNo, to: s1o.partNo, field: 'moq' },
      { from: s1o.partNo, to: s1n.partNo, field: 'tarePu' },
      { from: s2o.partNo, to: s2n.partNo, field: 'huType' },
    ],
  };
  PLANTED.transitionOk = { old: tOk[0].partNo, new: tOk[1].partNo };
  PLANTED.transitionCheck = { old: tChk[0].partNo, new: tChk[1].partNo };

  // ===== Material planning list + lifecycle targets =====
  const state = new Map(); // partNo -> intended state
  const onPlan = [];
  for (const r of pkg) {
    if (r.partNo.startsWith('75')) continue;
    if (r.partNo.startsWith('45') || taken.has(r.partNo) || chance(0.62)) onPlan.push(r);
  }
  for (const r of onPlan) {
    const x = rnd();
    state.set(r.partNo, x < 0.78 ? 'Active' : x < 0.87 ? 'Run-out' : x < 0.93 ? 'Phase-in' : 'Inactive');
  }
  // keep planted parts' states controlled
  for (const pn of [...PLANTED.weightKg, ...PLANTED.dimSwap.flat(), ...PLANTED.newForms.map((f) => f.partNo),
    ...PLANTED.chain, fk[0].partNo, fk[1].partNo, fk[2].partNo, ...PLANTED.forkTie.candidates, PLANTED.forkTie.old,
    ...PLANTED.cycle, s1o.partNo, s1n.partNo, s2o.partNo, s2n.partNo]) if (state.has(pn)) state.set(pn, 'Active');
  state.set(tOk[0].partNo, 'Run-out'); state.set(tOk[1].partNo, 'Phase-in');
  state.set(tChk[0].partNo, 'Inactive'); state.set(tChk[1].partNo, 'Active');
  state.set(s1o.partNo, 'Run-out'); state.set(s1n.partNo, 'Phase-in');

  // obsolete marks (including typos); some still show orders/usage to prove the override
  PLANTED.obsolete = [];
  const marks = ['OBSOLETE', 'OBSOLETE', 'OBSOLETE', 'OBSOLETE', 'OBSOLETE', 'OBSL', 'OBSL', 'OBSL', 'OBSO', 'OBSO', 'OBSOLTE', 'OBSOLETTE'];
  const descOf = new Map();
  for (const m of marks) {
    const r = takeComp((x) => state.has(x.partNo) && x.program !== 'R3');
    descOf.set(r.partNo, `${r.product} ${m}`);
    state.set(r.partNo, chance(0.5) ? 'Active' : 'Inactive');
    PLANTED.obsolete.push({ partNo: r.partNo, mark: m });
  }
  // open orders with too few weekly snapshots
  PLANTED.ooUnconfirmed = [];
  for (let i = 0; i < 3; i++) {
    const r = takeComp((x) => state.has(x.partNo) && x.program !== 'R3');
    state.set(r.partNo, 'Inactive');
    PLANTED.ooUnconfirmed.push(r.partNo);
  }
  // receipts must not count as usage: a Phase-in part that only received stock in the last 30 days
  const grOnly = takeComp((x) => state.has(x.partNo) && x.program !== 'R3');
  state.set(grOnly.partNo, 'Phase-in');
  PLANTED.receiptNotUsage = grOnly.partNo;

  // planning list day-over-day delta
  const d0Parts = onPlan.slice();
  const added = [];
  for (let i = 0; i < 4; i++) {
    const r = takeComp((x) => state.get(x.partNo) === 'Phase-in');
    added.push(r.partNo);
  }
  const removed = [];
  for (let i = 0; i < 4; i++) {
    const r = takeComp((x) => !state.has(x.partNo) && x.program !== 'R3');
    removed.push(r);
  }
  PLANTED.planningAdded = added;
  PLANTED.planningRemoved = removed.map((r) => r.partNo);

  const doh = new Map();
  for (const r of d0Parts) {
    const s = state.get(r.partNo);
    doh.set(r.partNo, s === 'Phase-in' ? ri(8, 30) : s === 'Inactive' ? ri(25, 80) : s === 'Run-out' ? ri(1, 15) : ri(2, 30));
  }
  // placeholders and exclusions for the DOH badge
  const nonPlanted = () => takeComp((x) => state.get(x.partNo) === 'Active' && x.program !== 'R3');
  PLANTED.doh = { zero: [], placeholder999: [], negative: [], supplierBlank: [] };
  for (let i = 0; i < 3; i++) { const r = nonPlanted(); doh.set(r.partNo, 0); PLANTED.doh.zero.push(r.partNo); }
  for (let i = 0; i < 3; i++) { const r = nonPlanted(); doh.set(r.partNo, 999); PLANTED.doh.placeholder999.push(r.partNo); }
  for (let i = 0; i < 2; i++) { const r = nonPlanted(); doh.set(r.partNo, -3); PLANTED.doh.negative.push(r.partNo); }
  const supplierBlank = new Set();
  for (let i = 0; i < 2; i++) { const r = nonPlanted(); supplierBlank.add(r.partNo); PLANTED.doh.supplierBlank.push(r.partNo); }

  const planRow = (r, date) => ({
    date, material: r.partNo, description: descOf.get(r.partNo) || r.product,
    supplier: supplierBlank.has(r.partNo) ? '' : (r.supplierName || 'In-house'),
    planner: PLANNERS[parseInt(r.partNo.slice(-1), 10) % PLANNERS.length],
    stock: Math.max(0, Math.round((doh.get(r.partNo) ?? 10) * (r.partsPerPu || 8) * 2)),
    doh: doh.get(r.partNo) ?? 10, program: r.program,
  });
  const d1 = addDays(ASOF, -1);
  const matplan = [
    ...d0Parts.map((r) => planRow(r, ASOF)),
    ...d0Parts.filter((r) => !added.includes(r.partNo)).map((r) => planRow(r, d1)),
    ...removed.map((r) => ({ ...planRow(r, d1), doh: ri(0, 4) })),
  ];

  // ===== Open orders (weekly snapshots) =====
  const weeks = ['2026-09-14', '2026-09-21', '2026-09-28'];
  const openorders = [];
  for (const r of d0Parts) {
    const s = state.get(r.partNo);
    const ws = PLANTED.ooUnconfirmed.includes(r.partNo) ? weeks.slice(1) : weeks;
    const hasOO = s === 'Active' || s === 'Phase-in';
    for (const w of ws) openorders.push({ material: r.partNo, week: w, qty: hasOO ? (chance(0.85) ? ri(1, 20) * (r.partsPerPu || 8) : 0) : 0 });
    if (hasOO && openorders.slice(-ws.length).every((o) => o.qty === 0)) openorders[openorders.length - 1].qty = (r.partsPerPu || 8) * 2;
  }

  // ===== MB51 (90 days) =====
  const mb51 = [];
  const mv = (r, daysAgo, mvt, qty, desc) => mb51.push({
    id: `MV${String(mb51.length + 1).padStart(6, '0')}`, postingDate: addDays(ASOF, -daysAgo),
    material: r.partNo, description: desc || r.product, mvt, qty, sloc: mvt === '261' ? '2000' : pick(['1000', '1100']),
  });
  for (const r of d0Parts) {
    const s = state.get(r.partNo);
    const q = r.partsPerPu || 8;
    if (s === 'Active') {
      mv(r, ri(1, 25), '261', -q);
      for (let k = ri(2, 4); k > 0; k--) mv(r, ri(1, 89), '261', -q);
      mv(r, ri(1, 89), '101', q * ri(2, 6));
      if (chance(0.03)) mv(r, ri(1, 60), '262', q);
    } else if (s === 'Run-out') {
      mv(r, ri(1, 20), '261', -q); mv(r, ri(5, 89), '261', -q);
      if (chance(0.5)) mv(r, ri(60, 89), '101', q * 4);
    } else if (s === 'Phase-in') {
      if (chance(0.5) || r.partNo === grOnly.partNo) mv(r, ri(2, 20), '101', q * ri(2, 6));
    } else if (s === 'Inactive') {
      mv(r, ri(35, 89), '261', -q);
      if (chance(0.4)) mv(r, ri(40, 89), '122', -q);
    }
  }
  for (const r of removed) mv(r, ri(1, 10), '261', -(r.partsPerPu || 8));
  for (const r of pkg) if (r.partNo.startsWith('75') && chance(0.6)) mv(r, ri(1, 89), '101', ri(2, 20));
  // service parts received with no PFEP row
  const gap = (product, prog) => { const pn = newPn('75', 8); mv({ partNo: pn }, ri(1, 40), '101', ri(2, 12), product); return pn; };
  PLANTED.serviceGaps = {
    autoAdd: [{ partNo: gap('SP FOG LAMP BEZEL RH X1', progX1), matchedTo: svcFog.partNo },
      { partNo: gap('KIT CAMERA GARNISH V7 SP', progV7), matchedTo: svcCam.partNo }],
    tierAProduction: [{ partNo: gap('CS TOW HOOK COVER X1', progX1), matchedTo: prodTow.partNo }],
    tierB: [{ partNo: gap('SP GRILLE INSERT UPPER V7 CHROME', progV7), matchedTo: prodGrille.partNo }],
    tierC: [{ partNo: gap('MP WIRING CLIP SET R3', progR3) }],
  };
  mb51.sort((a, b) => (a.postingDate < b.postingDate ? -1 : a.postingDate > b.postingDate ? 1 : a.id < b.id ? -1 : 1));

  // ===== Warehouse locations =====
  const wh = [];
  const hbRows = ['A', 'B', 'C', 'D', 'E', 'F'];
  // High-bay parts live on level 1 (the floor HU/PU lanes); the dynamic levels above are pallet storage
  // and are drawn as always full in the 3D view. 6 rows × HB_BAYS bays × 4 lanes.
  const HB_BAYS = 24;
  // Locations are filled in a shuffled order so parts spread across all rows, as in a real high-bay.
  const order = Array.from({ length: hbRows.length * HB_BAYS }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  let ptr = 0, lane = 1;
  const placeHB = (r, lanes) => {
    for (;;) {
      if (ptr >= order.length) return false;
      if (lane + lanes - 1 <= 4) break;
      ptr++; lane = 1;
    }
    const slot = order[ptr];
    const row = hbRows[Math.floor(slot / HB_BAYS)], bay = (slot % HB_BAYS) + 1, level = 1;
    wh.push({ material: r.partNo, area: 'HIGHBAY', row, bay, level, lane, lanes, tray: '', lineside: '' });
    lane += lanes;
    return true;
  };
  const hbCandidates = d0Parts.filter((r) => r.partNo.startsWith('2') && r.puH && r.puH <= 400 &&
    !PLANTED.newForms.some((f) => f.partNo === r.partNo) && r.partNo !== s1n.partNo);
  // make sure the slot-reallocation story has material: obsolete and inactive parts sit in the high-bay
  const priority = hbCandidates.filter((r) => state.get(r.partNo) === 'Inactive' || descOf.has(r.partNo) || r.partNo === s1o.partNo);
  const rest = hbCandidates.filter((r) => !priority.includes(r));
  const hbSet = new Set();
  for (const r of [...priority, ...rest]) {
    if (hbSet.size >= 250) break;
    if (placeHB(r, ri(1, 3))) hbSet.add(r.partNo); else break;
  }
  let tray = 1, vlmCount = 0;
  for (const r of comps) {
    if (hbSet.has(r.partNo) || r.partNo === s1n.partNo || vlmCount >= 150) continue;
    if (r.puH && r.puH <= 250 && chance(0.25)) {
      wh.push({ material: r.partNo, area: 'VLM', row: '', bay: '', level: '', lane: '', lanes: 1, tray: `T${String(tray++).padStart(3, '0')}`, lineside: '' });
      vlmCount++;
    }
  }
  const inWh = new Set(wh.map((w) => w.material));
  for (const r of pkg) {
    if (inWh.has(r.partNo) || r.partNo === s1n.partNo || r.partNo.startsWith('75')) continue;
    wh.push({ material: r.partNo, area: 'NOT-WH', row: '', bay: '', level: '', lane: '', lanes: 0, tray: '', lineside: r.partNo.startsWith('45') ? 'SHIP-DOCK' : `LS-${String(ri(1, 24)).padStart(2, '0')}` });
  }

  // vendor master export: material -> vendor
  const vendorMaster = pkg.filter((r) => r.supplierCode).map((r) => ({ material: r.partNo, vendorNo: r.supplierCode, vendorName: r.supplierName }));

  return {
    asOf: ASOF, config: { ...CONFIG }, company: COMPANY, plant: PLANT,
    pkg, vendors: vendorMaster, supplierMaster: vendors, sq01, mb51, matplan, openorders, wh, forms,
    newForms: NEW_FORMS, PLANTED,
  };
}
