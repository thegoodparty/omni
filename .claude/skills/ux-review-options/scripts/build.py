#!/usr/bin/env python3
"""Inline the design tokens, component CSS and logo into the page.

Usage: build.py <src.html> <out-dir>

Reads <src.html>, replaces /*GP_TOKENS*/, /*GP_UI*/ and {{HEART_LOGO_SVG}}, and
writes <out-dir>/index.html. Fails if any {{placeholder}} is left.

If <work>/build/ exists next to <work>/page/src.html, inlines each build-shape
fragment <work>/build/option-x.html at the end of its #option-x section, the
build-shape panel CSS once, and a "Show how it's built" switch at the right end
of the page bar. Build shapes start hidden so the page opens on the prototypes.
"""
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
from option_section import OPTION_IDS, section_span

skill = Path(__file__).resolve().parent.parent
repo = skill.parents[2]
tokens = repo / 'packages/styleguide/src/design-tokens.css'
panel_css = skill.parent / 'build-shape/assets/ux-panel.css'

toggle_css = '''
#build-toggle { margin-left: 8px; }
body:not(.show-build) .build-shape { display: none; }
'''

toggle_button = (
    '<button class="gp-btn gp-btn--outline gp-btn--sm" id="build-toggle" '
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


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    if not tokens.exists():
        sys.exit(f'missing {tokens}; run from a checkout of thegoodparty/omni')
    html = src.read_text()
    build = src.resolve().parent.parent / 'build'
    if build.is_dir():
        inlined = 0
        for oid in OPTION_IDS:
            fragment = build / f'{oid}.html'
            span = section_span(html, oid)
            if span and fragment.exists():
                html = html[:span[1]] + fragment.read_text().strip() + '\n' + html[span[1]:]
                inlined += 1
        if inlined:
            html = html.replace('</head>', f'<style>\n{panel_css.read_text()}{toggle_css}</style>\n</head>', 1)
            nav_end = html.find('</nav>', html.find('class="page-bar"'))
            if nav_end == -1:
                sys.exit('no <nav class="page-bar"> to hold the build shape switch')
            html = html[:nav_end] + toggle_button + html[nav_end:]
            html = html.replace('</body>', toggle_script + '</body>', 1)
        print(f'inlined {inlined} build shape(s) from {build}')
    html = html.replace('/*GP_TOKENS*/', tokens.read_text())
    html = html.replace('/*GP_UI*/', (skill / 'assets/gp-ui.css').read_text())
    html = html.replace('{{HEART_LOGO_SVG}}', (skill / 'assets/heart-logo.svg').read_text().strip())
    left = sorted(set(re.findall(r'\{\{[A-Z0-9_]+\}\}', html)))
    if left:
        sys.exit('unfilled placeholders: ' + ', '.join(left))
    out.mkdir(parents=True, exist_ok=True)
    (out / 'index.html').write_text(html)
    print(f'wrote {out / "index.html"} ({len(html) // 1024} KB)')


main()
