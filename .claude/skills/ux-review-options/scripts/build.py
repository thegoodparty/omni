#!/usr/bin/env python3
"""Inline the design tokens, component CSS and logo into the page.

Usage: build.py <src.html> <out-dir>

Reads <src.html>, replaces /*GP_TOKENS*/, /*GP_UI*/ and {{HEART_LOGO_SVG}}, and
writes <out-dir>/index.html. Fails if any {{placeholder}} is left.
"""
import re
import sys
from pathlib import Path

skill = Path(__file__).resolve().parent.parent
repo = skill.parents[2]
tokens = repo / 'packages/styleguide/src/design-tokens.css'


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    if not tokens.exists():
        sys.exit(f'missing {tokens}; run from a checkout of thegoodparty/omni')
    html = src.read_text()
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
