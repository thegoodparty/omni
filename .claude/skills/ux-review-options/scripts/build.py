#!/usr/bin/env python3
"""Build the review page: render the flows with the real styleguide components and inline them.

Usage: build.py <src.html> <out-dir>

Runs scripts/flow/build.mjs on <work>/flow/option-[abc].tsx (<work> is the folder
above src.html's), which needs node and the repo's node_modules (npm ci). Then
writes <out-dir>/index.html from <src.html>: /*GP_FLOW_CSS*/ gets the compiled CSS
(gp-webapp's globals.css through Tailwind, the product font inlined), the flows'
script goes in before </body>, and each option's screens and states go in as
<template data-gp-snapshot="option-x screen|state <key>"> static HTML after its
[data-gp-flow] element, for check.py. Inlined blocks end with /*GP_<NAME> end*/,
so check.py reads only the page's own CSS and script. Fails if any {{placeholder}}
is left, including {{PRODUCT}} on <main> ("win", "serve" or "both"). Works the
same for both templates: page-template.html (three options) and
page-template-one.html (one design, #option-a only).

If <work>/build/ exists next to <work>/page/src.html, inlines each build-shape
fragment <work>/build/option-x.html at the end of its #option-x section, the
build-shape panel CSS once, and a "Show how it's built" switch at the right end
of the page bar. Build shapes start hidden so the page opens on the prototypes.
"""
import hashlib
import html as htmllib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
from option_section import OPTION_IDS, section_span

skill = Path(__file__).resolve().parent.parent
repo = skill.parents[2]
flow_build = skill / 'scripts/flow/build.mjs'
panel_css = skill.parent / 'build-shape/assets/ux-panel.css'

toggle_css = '''
#build-toggle { margin-left: 8px; display: inline-flex; align-items: center; height: 32px; padding: 0 16px; border: 1px solid var(--color-tertiary-dark);
  border-radius: 9999px; background: transparent; color: var(--color-tertiary-dark); font: 500 14px/1 'Open Sans', system-ui, sans-serif; cursor: pointer; }
#build-toggle:hover { background: color-mix(in srgb, var(--color-tertiary-dark) 5%, transparent); }
body:not(.show-build) .build-shape { display: none; }
'''

toggle_button = (
    '<button id="build-toggle" '
    'type="button" aria-pressed="false">Show how it\'s built</button>\n'
)

toggle_script = '''<script>
(() => {
  const button = document.getElementById('build-toggle')
  const set = (on) => {
    document.body.classList.toggle('show-build', on)
    button.setAttribute('aria-pressed', String(on))
    button.textContent = on ? 'Hide how it\\'s built' : 'Show how it\\'s built'
    localStorage.setItem('show-build', on ? '1' : '0')
  }
  button.addEventListener('click', () => set(!document.body.classList.contains('show-build')))
  set(localStorage.getItem('show-build') === '1' || new URLSearchParams(location.search).has('build'))
})()
</script>
'''

def add_to_page_bar(html, button):
    nav_end = html.find('</nav>', html.find('class="page-bar"'))
    if nav_end == -1:
        sys.exit('no <nav class="page-bar"> to hold the switch')
    return html[:nav_end] + button + html[nav_end:]


def flows(work):
    """Run build.mjs; returns (css, js, snapshot)."""
    if not shutil.which('node'):
        sys.exit('build.py: node not found; the flows are built with node and the repo\'s node_modules')
    with tempfile.TemporaryDirectory() as tmp:
        run = subprocess.run(['node', str(flow_build), str(work), tmp], capture_output=True, text=True)
        if run.returncode:
            sys.exit(f'build.py: building the flows failed:\n{run.stderr or run.stdout}')
        print(run.stdout.strip())
        out = Path(tmp)
        return (out / 'flow.css').read_text(), (out / 'flow.js').read_text(), json.loads((out / 'snapshot.json').read_text())


def snapshot_templates(oid, snap):
    parts = []
    for kind, items in (('screen', snap.get('screens', {})), ('state', snap.get('states', {}))):
        for key, value in items.items():
            body = value if kind == 'screen' else value['html']
            label = '' if kind == 'screen' else f' data-gp-label="{htmllib.escape(value["label"])}"'
            parts.append(f'<template data-gp-snapshot="{oid} {kind} {htmllib.escape(key)}"{label}>{body}</template>')
    return '\n'.join(parts)


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    html = src.read_text()
    work = src.resolve().parent.parent
    build = work / 'build'
    if build.is_dir():
        inlined = 0
        for oid in OPTION_IDS:
            fragment = build / f'{oid}.html'
            span = section_span(html, oid)
            if span and fragment.exists():
                html = html[:span[1]] + fragment.read_text().strip() + '\n' + html[span[1]:]
                inlined += 1
        if inlined:
            html = html.replace('</head>', f'<style>\n/*GP_BUILD_SHAPE*/\n{panel_css.read_text()}{toggle_css}/*GP_BUILD_SHAPE end*/\n</style>\n</head>', 1)
            html = add_to_page_bar(html, toggle_button)
            html = html.replace('</body>', toggle_script + '</body>', 1)
        print(f'inlined {inlined} build shape(s) from {build}')
    css, js, snap = flows(work)
    if '/*GP_FLOW_CSS*/' not in html:
        sys.exit('build.py: no /*GP_FLOW_CSS*/ in the page\'s <style>; start from assets/page-template*.html')
    html = html.replace('/*GP_FLOW_CSS*/', '/*GP_FLOW_CSS*/\n' + css + '\n/*GP_FLOW_CSS end*/', 1)
    for oid, data in snap.items():
        mount = re.search(rf'<div\b[^>]*\bdata-gp-flow="{oid}"[^>]*>\s*</div>', html)
        if not mount:
            sys.exit(f'build.py: flow/{oid}.tsx has no <div data-gp-flow="{oid}"></div> on the page')
        flow = work / 'flow' / f'{oid}.tsx'
        built = 'sha256:' + hashlib.sha256(flow.read_bytes()).hexdigest()
        tag = mount.group(0).replace(f'data-gp-flow="{oid}"', f'data-gp-flow="{oid}" data-gp-built="{built}"', 1)
        html = html[:mount.start()] + tag + '\n' + snapshot_templates(oid, data) + html[mount.end():]
    script = '<script>/*GP_FLOW_JS*/\n' + js.replace('</script', '<\\/script') + '\n/*GP_FLOW_JS end*/</script>\n'
    html = html.replace('</body>', script + '</body>', 1)
    left = sorted(set(re.findall(r'\{\{[A-Z0-9_]+\}\}', html)))
    if left:
        sys.exit('unfilled placeholders: ' + ', '.join(left))
    out.mkdir(parents=True, exist_ok=True)
    (out / 'index.html').write_text(html)
    print(f'wrote {out / "index.html"} ({len(html) // 1024} KB)')


main()
