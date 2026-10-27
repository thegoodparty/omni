#!/usr/bin/env python3
"""Render canvas boards headlessly: measure heights, take screenshots, tile contact sheets.

Needed because a Design canvas frame clips anything taller than its `h` and
`$preview` height, and estimates are reliably wrong on long pages, so every board's
height must be measured from a real render before it's published. Screenshots and
contact sheets are how review rounds look at 10 to 20 boards at once.

Boards need the canvas runtime to render. Save it once per work folder:
read `artifact-type/dc-runtime.js` from the canvas with the Artifact tool, then run
`render.py setup <work> <path-to-dc-runtime.js>`. It becomes `<work>/.render/support.js`.

Usage: .claude/skills/ux-review-canvas/scripts/render.py <command> ...

  setup   <work> <dc-runtime.js>
  measure <work> <board.dc.html>... [--width 1280]
          Prints "<board> <content height>". Removes the root min-height first, so
          the number is the content, not the current frame. It measures the
          state the board opens in; for a taller later state, measure a copy that
          opens there. Add 32 to 48 px of bottom room when you set the frame.
  shot    <work> <board.dc.html> <out.png> [--width 1280] [--height 900] [--hash from=email]
  sheet   <out.png> <columns> <tile-width> <image.png>...

Headless Chrome won't lay out narrower than 500 px. To check a 390 px phone width,
put the board in a 390 px iframe on a test page.
"""
import functools
import html
import http.server
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading

CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
MEASURE_JS = ('<script>setTimeout(function(){var h=0;document.querySelectorAll("body *").forEach(function(e){'
              'var b=e.getBoundingClientRect();if(b.bottom>h)h=b.bottom});'
              'document.body.setAttribute("data-measured",Math.ceil(h))},2500)</script>')


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def _serve(root):
    handler = functools.partial(_Quiet, directory=root)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _render_dir(work):
    d = os.path.join(work, '.render')
    if not os.path.exists(os.path.join(d, 'support.js')):
        sys.exit(f'No runtime in {d}. Run: render.py setup {work} <dc-runtime.js>')
    return d


def _chrome(args):
    return subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                           '--force-prefers-reduced-motion'] + args, capture_output=True, text=True, timeout=120)


def setup(work, runtime):
    d = os.path.join(work, '.render')
    os.makedirs(d, exist_ok=True)
    shutil.copy(runtime, os.path.join(d, 'support.js'))
    print('runtime saved to', os.path.join(d, 'support.js'))


def _zero_root_min_height(src):
    # The root is the first element after the helmet. Earlier min-heights (44px
    # targets in the helmet's styles) aren't the frame.
    start = src.find('</helmet>')
    start = src.find('<x-dc>') if start < 0 else start
    m = re.compile(r'<[a-zA-Z][^>]*>').search(src, start)
    if not m:
        return src
    tag = re.sub(r'min-height:\s*\d+px', 'min-height: 0px', m.group(0), count=1)
    return src[:m.start()] + tag + src[m.end():]


def measure(work, boards, width=1280):
    d = _render_dir(work)
    server = _serve(d)
    out = {}
    try:
        for b in boards:
            src = open(b).read()
            src = _zero_root_min_height(src)
            name = 'm-' + os.path.basename(b)
            open(os.path.join(d, name), 'w').write(src.replace('</body>', MEASURE_JS + '</body>'))
            r = _chrome([f'--window-size={width},900', '--virtual-time-budget=5000', '--dump-dom',
                         f'http://127.0.0.1:{server.server_port}/{name}'])
            m = re.search(r'data-measured="(\d+)"', r.stdout)
            out[b] = int(m.group(1)) if m else None
            print(os.path.basename(b), out[b] if out[b] else 'FAILED')
    finally:
        server.shutdown()
    return out


def shot(work, board, png, width=1280, height=900, hash_=''):
    d = _render_dir(work)
    shutil.copy(board, os.path.join(d, os.path.basename(board)))
    server = _serve(d)
    try:
        url = f'http://127.0.0.1:{server.server_port}/{os.path.basename(board)}' + (f'#{hash_}' if hash_ else '')
        _chrome([f'--window-size={width},{height}', '--virtual-time-budget=5000', f'--screenshot={os.path.abspath(png)}', url])
    finally:
        server.shutdown()
    print('saved', png)


def sheet(png, cols, tile, images):
    tmp = tempfile.mkdtemp()
    for i in images:
        shutil.copy(i, tmp)
    cells = ''.join(f'<div style="background:#fff"><div style="padding:3px 6px">{html.escape(os.path.basename(i))}</div>'
                    f'<img src="{html.escape(os.path.basename(i))}" style="width:{tile}px;display:block"></div>' for i in images)
    open(os.path.join(tmp, 'sheet.html'), 'w').write(
        f'<html><body style="margin:0;background:#888;font:12px sans-serif"><div style="display:grid;'
        f'grid-template-columns:repeat({cols},{tile}px);gap:8px;padding:8px;align-items:start">{cells}</div></body></html>')
    width = cols * (tile + 8) + 8
    _chrome([f'--window-size={width},2600', '--allow-file-access-from-files', f'--screenshot={os.path.abspath(png)}',
             'file://' + os.path.join(tmp, 'sheet.html')])
    print('saved', png)


def _opt(args, name, default):
    if name in args:
        i = args.index(name)
        val = args[i + 1]
        del args[i:i + 2]
        return val
    return default


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    cmd = a.pop(0)
    if cmd == 'setup':
        setup(a[0], a[1])
    elif cmd == 'measure':
        w = int(_opt(a, '--width', 1280))
        measure(a[0], a[1:], w)
    elif cmd == 'shot':
        w = int(_opt(a, '--width', 1280)); h = int(_opt(a, '--height', 900)); hs = _opt(a, '--hash', '')
        shot(a[0], a[1], a[2], w, h, hs)
    elif cmd == 'sheet':
        sheet(a[0], int(a[1]), int(a[2]), a[3:])
    else:
        sys.exit(__doc__)
