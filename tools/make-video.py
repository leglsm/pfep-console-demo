"""Render the README showcase video offline (no screen recording, no real-time playback).

Usage: FONT_CSS=path/to/fonts.css python3 tools/make-video.py [--fps 30] [--count 5]
Writes docs/showcase-top5.mp4 (1920x1080, H.264) and docs/showcase.gif (short loop for the README).
Needs Playwright (Chromium + SwiftShader) and ffmpeg with libx264.

The page exposes window.__pfepClip: the same "Export top 5" sequence on a manual clock, advanced one
frame per call, so the result is smooth however slow the software renderer is.
"""
import base64, functools, http.server, os, shutil, socketserver, subprocess, sys, tempfile, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
arg = lambda k, d: type(d)(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
FPS, COUNT = arg('--fps', 30), arg('--count', 5)
FONT_CSS = os.environ.get('FONT_CSS')
OUT_MP4, OUT_GIF = ROOT / 'docs' / 'showcase-top5.mp4', ROOT / 'docs' / 'showcase.gif'

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_address[1]}/index.html#overview'

def fonts(route):
    if FONT_CSS and 'fonts.googleapis.com' in route.request.url:
        return route.fulfill(path=FONT_CSS, content_type='text/css')
    return route.abort()

frames = Path(tempfile.mkdtemp(prefix='pfep-frames-'))
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1920, 'height': 1080})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.route('**/fonts.g*/**', fonts)
    pg.goto(BASE); pg.wait_for_timeout(1500)
    pg.evaluate('document.fonts.ready.then(() => true)')
    info = pg.evaluate(f'window.__pfepClip.start({COUNT})')
    print(f"sequence {info['total'] / 1000:.1f}s at {FPS} fps", flush=True)
    n = 0
    while True:
        r = pg.evaluate(f'window.__pfepClip.step({1000 / FPS}, 0.9)')
        (frames / f'f{n:05d}.jpg').write_bytes(base64.b64decode(r['jpeg'].split(',', 1)[1]))
        n += 1
        if n % 150 == 0: print(f'  {n} frames', flush=True)
        if r['done']: break
    b.close()
srv.shutdown()
if errors: sys.exit('page errors: ' + ' | '.join(errors[:3]))
if r['inside']: sys.exit(f"camera was inside a rack on {r['inside']} frames")
print(f'{n} frames, camera never inside a rack', flush=True)

ff = lambda *a: subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *a], check=True)
ff('-framerate', str(FPS), '-i', str(frames / 'f%05d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
   '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(OUT_MP4))
# README loop: the opening overview and the first two parts (13 s), 720 px, 8 fps, 96 colours (~3 MB)
pal = frames / 'pal.png'
vf = 'fps=8,scale=720:-1:flags=lanczos'
ff('-t', '13', '-i', str(OUT_MP4), '-vf', vf + ',palettegen=max_colors=96:stats_mode=diff', str(pal))
ff('-t', '13', '-i', str(OUT_MP4), '-i', str(pal), '-lavfi', vf + '[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', str(OUT_GIF))
shutil.rmtree(frames)
for f in (OUT_MP4, OUT_GIF): print(f'{f.relative_to(ROOT)}  {f.stat().st_size / 1048576:.1f} MB')
