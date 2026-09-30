"""The pieces every published surface inlines, so a change lands on all of them at once.

Three pages render the analytics governance snapshot: the analytics event explorer,
the product map and the event health console. They used to carry hand-copied
palettes and a hand-copied event card, which meant a change to the card on one page
was a change to one page. Now each template holds a placeholder per shared piece and
its build.py calls `inline()`.

Deliberately dependency-free: the republish routines run these builds with a bare
interpreter.
"""
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Each placeholder is written as a comment in its host language, so prettier formats the
# templates without touching it. The whole comment is what gets replaced.
PARTIALS = {
    "/* __THEME_CSS__ */": "theme.css",
    "/* __CARD_CSS__ */": "card.css",
    "/* __USAGE_CSS__ */": "usage.css",
    "// __CARD_JS__": "card.js",
    "// __USAGE_JS__": "usage.js",
}

# The published pages, so each one can link to the others. A page republishes to the
# same URL, which is what makes these safe to bake in.
LINKS = {
    "__EXPLORER_URL__": "https://claude.ai/artifact/8RStnYhwdSB9r2guuWiw3A",
    "__MAP_URL__": "https://claude.ai/artifact/1P4qyB56ZNPJ9VPaMjDLLZ",
    "__CONSOLE_URL__": "https://claude.ai/artifact/VoKnptbR1DMRmtznatSXht",
}

# The page's own data goes in last, by the page, so a placeholder-shaped string inside
# the data can never be mistaken for a partial.
PAGE_OWNED = {"__DATA__"}


def inline(html: str) -> str:
    for key, name in PARTIALS.items():
        html = html.replace(key, (HERE / name).read_text())
    for key, url in LINKS.items():
        html = html.replace(key, url)
    left = sorted(set(re.findall(r"__[A-Z][A-Z_]+__", html)) - PAGE_OWNED)
    if left:
        raise SystemExit(f"unfilled placeholders: {', '.join(left)}")
    return html


def inline_payload(doc) -> str:
    """JSON safe to embed in a <script> block. ``</`` would close the block early."""
    import json

    return json.dumps(doc, separators=(",", ":")).replace("</", "<\\/")
