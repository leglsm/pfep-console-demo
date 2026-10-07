"""Render the Warehouse flow clip offline: the replay on a manual clock, one page screenshot per frame
(so the on-screen clock, counters and event log are in the video), then ffmpeg.

Usage: FONT_CSS=path/to/fonts.css python3 tools/make-flow-video.py [--from 13:00] [--seconds 40] [--speed 4]
Writes docs/flow-day.mp4 (1920x1080, H.264) and docs/flow.gif (first 12 s, 720 px) for the README.
Fails if the camera or a vehicle is ever inside a rack or a VLM tower.
"""
import base64, functools, http.server, os, shutil, socketserver, subprocess, sys, tempfile, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
arg = lambda k, d: type(d)(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
FPS, SECONDS, SPEED, FROM = 30, arg('--seconds', 40), arg('--speed', 4), arg('--from', '13:00')
FONT_CSS = os.environ.get('FONT_CSS')
OUT_MP4, OUT_GIF = ROOT / 'docs' / 'flow-day.mp4', ROOT / 'docs' / 'flow.gif'
from_sec = int(FROM.split(':')[0]) * 3600 + int(FROM.split(':')[1]) * 60

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()

def fonts(route):
    if FONT_CSS and 'fonts.googleapis.com' in route.request.url:
        return route.fulfill(path=FONT_CSS, content_type='text/css')
    return route.abort()

frames = Path(tempfile.mkdtemp(prefix='pfep-flow-'))
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1920, 'height': 1080})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.route('**/fonts.g*/**', fonts)
    pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html#flow'); pg.wait_for_timeout(1500)
    pg.evaluate('document.fonts.ready.then(() => true)')
    info = pg.evaluate('window.__pfepFlowClip.start(null, 16)')
    print(f"day {info['key']}, {info['lines']} receipt lines; fast-forward to {FROM}", flush=True)
    while pg.evaluate('window.__pfepFlowClip.step(100).sim') < from_sec: pass  # 0.1 s ticks at 16× (no frames kept)
    pg.evaluate(f'window.__flowDebug.setSpeed({SPEED}); window.__flowDebug.setCam("auto")')
    n = 0
    for n in range(SECONDS * FPS):
        r = pg.evaluate(f'window.__pfepFlowClip.step({1000 / FPS})')
        pg.screenshot(path=str(frames / f'f{n:05d}.jpg'), type='jpeg', quality=88)
        if n % 150 == 0: print(f"  {n} frames, clock {r['sim'] // 3600:02.0f}:{r['sim'] % 3600 // 60:02.0f}", flush=True)
    audit = r['audit']
    b.close()
srv.shutdown()
if errors: sys.exit('page errors: ' + ' | '.join(errors[:3]))
if audit['cameraInside'] or audit['vehicleInside']: sys.exit(f'inside a rack: {audit}')
print(f'{n + 1} frames, audit {audit}', flush=True)

ff = lambda *a: subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *a], check=True)
ff('-framerate', str(FPS), '-i', str(frames / 'f%05d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '25',
   '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(OUT_MP4))
pal, vf = frames / 'pal.png', 'fps=8,scale=720:-1:flags=lanczos'
ff('-t', '12', '-i', str(OUT_MP4), '-vf', vf + ',palettegen=max_colors=96:stats_mode=diff', str(pal))
ff('-t', '12', '-i', str(OUT_MP4), '-i', str(pal), '-lavfi', vf + '[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', str(OUT_GIF))
shutil.rmtree(frames)
for f in (OUT_MP4, OUT_GIF): print(f'{f.relative_to(ROOT)}  {f.stat().st_size / 1048576:.1f} MB')
