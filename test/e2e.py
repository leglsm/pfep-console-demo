"""Browser checks for the PFEP console demo (Playwright, Chromium + SwiftShader for WebGL).

Usage: python3 test/e2e.py [--shots DIR]
Serves the repo on a local port, walks the scenarios, prints PASS/FAIL per check, exits 1 on any failure.
Google Fonts are blocked here on purpose (offline sandbox); FONT_CSS can point at a local stylesheet.
"""
import http.server, json, os, socketserver, sys, threading, functools
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = Path(sys.argv[sys.argv.index('--shots') + 1]) if '--shots' in sys.argv else ROOT / 'docs'
SHOTS.mkdir(parents=True, exist_ok=True)
FONT_CSS = os.environ.get('FONT_CSS')

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Quiet, directory=str(ROOT))
srv = socketserver.TCPServer(('127.0.0.1', 0), handler)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{PORT}/index.html'

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail and not ok else ''))

VIEWS = ['overview', 'pfep', 'imports', 'forms', 'fixes', 'supersession', 'lifecycle', 'warehouse', 'flow', 'lookup', 'guide']
# planted cases straight from the seed (same SEED -> same data)
import subprocess
PLANTED = json.loads(subprocess.run(['node', '-e', "import('./src/seed.js').then(m => console.log(JSON.stringify(m.makeSeed().PLANTED)))"], cwd=ROOT, capture_output=True, text=True, check=True).stdout)

def fonts(route):
    if FONT_CSS and 'fonts.googleapis.com' in route.request.url:
        return route.fulfill(path=FONT_CSS, content_type='text/css')
    return route.abort()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROMIUM') or None, args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'net::ERR_FAILED' not in m.text else None)
    pg.route('**/fonts.g*/**', fonts)
    go = lambda h: (pg.goto(f'{BASE}#{h}'), pg.wait_for_timeout(1200))
    main_text = lambda: pg.locator('main').inner_text()
    def shot(name):  # clean screenshot: no toasts, top of page
        pg.evaluate("document.querySelectorAll('.toast').forEach(t => t.remove()); window.scrollTo(0, 0)")
        pg.wait_for_timeout(300)
        pg.screenshot(path=str(SHOTS / name))

    # S1 overview
    go('overview')
    t = main_text()
    check('S1 overview shows error counts', 'Weight typed in kg' in t and 'Swapped dimensions' in t)
    check('S1 overview shows lifecycle 2x2', all(k in t for k in ['Active', 'Phase-in', 'Run-out', 'Inactive', 'Obsolete']))
    pg.wait_for_timeout(1500)
    check('S1 3D preview canvas rendered', pg.locator('#ov3d canvas').count() == 1)
    check('no literal "null" text on overview', 'null' not in t)
    shot('01-overview.png')

    # S10 imports
    go('imports')
    pg.get_by_role('button', name='IM-02').first.click(); pg.wait_for_timeout(1200)
    t = main_text()
    check('S10 IM-02: 5 corrected, 2 rejected', '5 corrected' in t and '2 rejected' in t, t[:200])
    check('S10 IM-02: lost-digit reason shown', 'lost digits' in t)
    check('no literal "null" text on imports', '\nnull\n' not in t)
    shot('02-imports.png')
    pg.get_by_role('button', name='IM-07').first.click(); pg.wait_for_timeout(1200)
    t = main_text()
    check('S10 IM-07 blocked (shifted columns)', 'Blocked.' in t and 'columns may be shifted' in t)
    check('S10 IM-07 has no apply button', pg.get_by_role('button', name='Apply').count() == 0)
    pg.get_by_role('button', name='IM-04').first.click(); pg.wait_for_timeout(1000)
    check('S10 IM-04 blocked (missing column)', 'Required column missing' in main_text())
    pg.get_by_role('button', name='IM-02').first.click(); pg.wait_for_timeout(1000)
    pg.get_by_role('button', name='Apply 28 rows').click(); pg.wait_for_timeout(600)
    check('S10 apply IM-02 marks it applied', 'are in the data' in main_text())

    # S2 forms
    go('forms')
    pg.wait_for_timeout(1500)
    pg.get_by_role('button', name='PF-07').first.click(); pg.wait_for_timeout(2000)
    t = main_text()
    check('S2 PF-07 read from PDF text layer', 'Stackability' in t and '2/1' in t)
    check('S2 PF-07 auto-fills stack and weight', 'Auto-filled (3)' in t, t[t.find('Auto-filled'):t.find('Auto-filled') + 40])
    check('S2 PDF preview rendered', pg.locator('canvas.pdf-canvas').count() == 1)
    shot('03-forms.png')
    pg.get_by_role('button', name='Apply 3 change(s)').click(); pg.wait_for_timeout(600)
    check('S2 apply PF-07', 'This form has been applied.' in main_text())
    pg.get_by_role('button', name='PF-02').first.click(); pg.wait_for_timeout(1500)
    check('S2 PF-02 signed conflict overwrites', 'Conflicts (1)' in main_text())
    pg.get_by_role('button', name='PF-03').first.click(); pg.wait_for_timeout(1500)
    t = main_text()
    check('S2 PF-03 unsigned is held', 'Not signed' in t and 'Held for review' in t and 'Conflicts (0)' in t)
    pg.get_by_role('button', name='PF-04').first.click(); pg.wait_for_timeout(1500)
    check('S2 PF-04 offers inch confirmation', pg.get_by_role('button', name='Confirm these dimensions are inches').count() == 1)

    # S3 / S4 fixes
    go('fixes')
    t = main_text()
    check('S3 lists all three error types', 'Weight typed in kg (6)' in t and 'Swapped dimensions (2 pairs)' in t and 'Trailer stack fixed' in t)
    shot('04-fixes.png')
    pg.get_by_role('button', name='Apply').filter(has_text='corrections').click(); pg.wait_for_timeout(1000)
    check('S3 after apply: no systematic errors left', 'No systematic errors left' in main_text())
    pg.get_by_role('button', name='Add 2 Tier A service rows').click(); pg.wait_for_timeout(800)
    t = main_text()
    check('S4 Tier A service rows added', 'Add 2 Tier A' not in t and 'Tier B' in t)

    # S5 supersession
    go('supersession')
    t = main_text()
    check('S5 shows cycle and fork tie for review', 'Cycle' in t and 'Fork tie' in t)
    pg.get_by_role('button', name='Run sync review').click(); pg.wait_for_timeout(500)
    check('S5 sync preview lists warehouse copy', 'warehouse' in main_text())
    shot('05-supersession.png')
    pg.get_by_role('button', name='Apply reviewed changes').click(); pg.wait_for_timeout(800)
    pg.get_by_role('button', name='Run sync review').click(); pg.wait_for_timeout(500)
    check('S5 after apply nothing left to sync', 'Nothing to copy' in main_text())

    # S6 lifecycle
    go('lifecycle/Obsolete')
    t = main_text()
    check('S6 obsolete list includes typo marks', 'OBSL' in t and 'OBSOLTE' in t)
    check('S6 planning delta shown', 'Added today (4)' in t and 'Dropped today (4)' in t)
    shot('06-lifecycle.png')

    # S7 warehouse
    go('warehouse'); pg.wait_for_timeout(2500)
    t = main_text()
    check('S7 slot reallocation lists lanes', 'lanes held by' in t)
    check('S7 3D canvas rendered', pg.locator('.wh-canvas canvas').count() == 1)
    shot('07a-highbay.png')
    pg.locator('.slot-list a.pn').first.click(); pg.wait_for_timeout(1500)
    check('S7 clicking a slot row shows the part', 'Boxes / lane' in main_text())
    shot('07-warehouse.png')

    # S9 showcase: opening overview → Next → first (Red) part, flown in and held
    pg.get_by_role('button', name='Start showcase (TV)').click(); pg.wait_for_timeout(2500)
    check('S9 showcase opens on the warehouse overview', 'Warehouse overview' in pg.locator('.showcase .sc-card').inner_text())
    shot('08a-showcase-overview.png')
    pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(800)
    check('S9 Next shows a Red part first', pg.locator('.showcase .sc-card .sc-badge').inner_text() == 'Red')
    c = pg.locator('.showcase .sc-counter').inner_text(); check('S9 counter at 1', c.replace(' ', '').startswith('1/'), c)
    sc_pn = pg.locator('.showcase .sc-card .sc-pn').inner_text()
    # README shot: the first high-bay part (the top one may sit in a VLM tower). Wait until the camera is down in the aisle.
    for _ in range(5):
        if pg.locator('.showcase .sc-card .sc-loc').inner_text().startswith('HB'): break
        pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(400)
    pg.wait_for_function("(() => { const v = window.__pfepShowcase?.view; return v && v._debug.camera.position.y < v._debug.rackTop - 0.5; })()", timeout=30000)
    pg.wait_for_timeout(1500)
    pg.keyboard.press(' '); pg.wait_for_timeout(300)
    shot('08-showcase.png')
    check('S9 Space pauses', 'Play' in pg.locator('.showcase .sc-ctrls').inner_text())
    check('S9 export button offered', 'Export top 5' in pg.locator('.showcase .sc-ctrls').inner_text())
    pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
    check('S9 Esc closes showcase', pg.locator('.showcase').count() == 0)

    # S9b single-part 3D view from Part lookup
    go(f'lookup/{sc_pn}')
    pg.get_by_role('button', name='Show in 3D').click(); pg.wait_for_timeout(1500)
    check('S9b Show in 3D opens the part view', pg.locator('.showcase').count() == 1 and sc_pn in pg.locator('.showcase .sc-card').inner_text())
    pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
    check('S9b Esc closes the part view', pg.locator('.showcase').count() == 0)

    # S11 Warehouse flow: day KPIs from the data, then the replay
    go('flow')
    t = main_text()
    check('S11 flow tab lists days with receipts and issues', 'receipt lines' in t and 'goods issues (261)' in t)
    pg.get_by_role('button', name='Show day KPIs (skip replay)').click(); pg.wait_for_timeout(500)
    t = main_text()
    check('S11 day KPIs shown', all(k in t for k in ['Inbound trucks', 'Receipt lines (101)', 'To floor storage', 'Busiest hour', 'Trucks on site at once (est.)', 'Red parts received']))
    check('S11 no-location and Red tables', 'Received with no location' in t and 'Red parts that came in this day' in t)
    check('S11 KPIs leave simulated values out', 'not data' in t and 'Travel time' not in t)
    shot('12-flow-kpis.png')
    pg.get_by_role('button', name='Play replay (TV)').click()
    pg.wait_for_function("() => window.__flowDebug && window.__flowDebug.st && window.__flowDebug.st.arrived > 0", timeout=90000)
    pg.wait_for_timeout(4000)
    a = pg.evaluate("({ ...window.__flowDebug.audit, done: window.__flowDebug.st.done })")
    check('S11 replay: trucks arrive and the day clock runs', a['samples'] > 20, str(a))
    check('S11 camera and vehicles never inside a rack', a['cameraInside'] == 0 and a['vehicleInside'] == 0, str(a))
    shot('13-flow-replay.png')
    pg.keyboard.press(' '); pg.wait_for_timeout(300)
    check('S11 Space pauses the replay', 'Play' in pg.locator('.showcase .sc-ctrls').inner_text())
    pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
    check('S11 Esc closes the replay', pg.locator('.showcase').count() == 0)

    # S12 PU size review (R32) in Part lookup
    go('lookup/' + PLANTED['puReview']['tall'])
    check('S12 lookup flags a PU the 3D cannot draw true to size', 'Review PU size' in main_text() and 'over the 26" level' in main_text())

    # S8 lookup
    go('lookup')
    first = pg.locator('main .chips a').first.get_attribute('href').split('/')[-1]
    go(f'lookup/{first}')
    t = main_text()
    check('S8 lookup shows packaging, status and location', 'Packaging (PFEP)' in t and 'Where & who' in t)
    go('lookup/' + pg.locator('main .chips a').nth(1).get_attribute('href').split('/')[-1])
    check('S8 swapped-dims part was fixed earlier → sources agree', 'Sources agree' in main_text())
    shot('09-lookup.png')

    # persistence + reset
    pg.reload(); pg.wait_for_timeout(1200)
    go('guide')
    check('changes survive reload', 'change batch(es) applied' in main_text() and not main_text().count(' 0 change batch'))
    pg.on('dialog', lambda d: d.accept())
    pg.get_by_role('button', name='Reset sample data').click(); pg.wait_for_timeout(800)
    check('reset restores sample data', '0 change batch(es) applied' in main_text())

    # every view: phone width, no page-level horizontal scroll, no "null"
    m = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    m.route('**/fonts.g*/**', fonts)
    bad = []
    for v in VIEWS:
        m.goto(f'{BASE}#{v}'); m.wait_for_timeout(1200)
        if m.evaluate('document.documentElement.scrollWidth > window.innerWidth'): bad.append(v)
    check('390px: no horizontal page scroll on any view', not bad, ', '.join(bad))
    m.goto(f'{BASE}#overview'); m.wait_for_timeout(1500); m.screenshot(path=str(SHOTS / '10-phone.png'))

    # dark theme
    d = b.new_context(viewport={'width': 1440, 'height': 900}, color_scheme='dark').new_page()
    d.route('**/fonts.g*/**', fonts)
    d.goto(f'{BASE}#overview'); d.wait_for_timeout(2500)
    bg = d.evaluate("getComputedStyle(document.body).backgroundColor")
    check('dark theme follows the system setting', bg != 'rgb(243, 244, 246)', bg)
    d.screenshot(path=str(SHOTS / '11-dark.png'))

    check('no console or page errors', not errors, ' | '.join(errors[:3]))
    b.close()
srv.shutdown()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} checks passed')
sys.exit(1 if fails else 0)
