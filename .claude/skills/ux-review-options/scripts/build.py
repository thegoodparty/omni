#!/usr/bin/env python3
"""Inline the design tokens, Tailwind theme, component CSS and logo into the page.

Usage: build.py <src.html> <out-dir>

Reads <src.html>, replaces /*GP_TOKENS*/, /*GP_UI*/ and {{HEART_LOGO_SVG}}, and
writes <out-dir>/index.html. /*GP_TOKENS*/ gets the @theme block of the
styleguide's tailwind-theme.css as :root (some theme tokens point at variables
defined only there), then design-tokens.css. Each inlined block ends with a
/*GP_<NAME> end*/ marker, so check.py reads only the page's own CSS. Fails if any
{{placeholder}} is left.
Works the same for both templates: page-template.html (three options) and
page-template-one.html (one design, #option-a only).

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
theme = repo / 'packages/styleguide/src/tailwind-theme.css'
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

def add_to_page_bar(html, button):
    nav_end = html.find('</nav>', html.find('class="page-bar"'))
    if nav_end == -1:
        sys.exit('no <nav class="page-bar"> to hold the switch')
    return html[:nav_end] + button + html[nav_end:]


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    if not tokens.exists() or not theme.exists():
        sys.exit(f'missing {tokens} or {theme}; run from a checkout of thegoodparty/omni')
    theme_block = re.search(r'^@theme\s*\{.*?^\}', theme.read_text(), flags=re.M | re.S)
    if not theme_block:
        sys.exit(f'no @theme block in {theme}')
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
            html = html.replace('</head>', f'<style>\n/*GP_BUILD_SHAPE*/\n{panel_css.read_text()}{toggle_css}/*GP_BUILD_SHAPE end*/\n</style>\n</head>', 1)
            html = add_to_page_bar(html, toggle_button)
            html = html.replace('</body>', toggle_script + '</body>', 1)
        print(f'inlined {inlined} build shape(s) from {build}')
    # The theme goes first so design-tokens.css wins where both define a name.
    theme_root = re.sub(r'^@theme', ':root', theme_block.group(0))
    # The end markers let check.py tell inlined CSS from the page's own rules.
    html = html.replace('/*GP_TOKENS*/', '/*GP_TOKENS*/\n' + theme_root + '\n' + tokens.read_text() + '\n/*GP_TOKENS end*/')
    html = html.replace('/*GP_UI*/', '/*GP_UI*/\n' + (skill / 'assets/gp-ui.css').read_text() + '\n/*GP_UI end*/')
    html = html.replace('{{HEART_LOGO_SVG}}', (skill / 'assets/heart-logo.svg').read_text().strip())
    left = sorted(set(re.findall(r'\{\{[A-Z0-9_]+\}\}', html)))
    if left:
        sys.exit('unfilled placeholders: ' + ', '.join(left))
    out.mkdir(parents=True, exist_ok=True)
    (out / 'index.html').write_text(html)
    print(f'wrote {out / "index.html"} ({len(html) // 1024} KB)')


main()
