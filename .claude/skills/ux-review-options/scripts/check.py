#!/usr/bin/env python3
"""Catch what review misses: banned words, dead links, external requests, and a
missing brief, entry screen, Sends line, phone frame, fold or Other states appendix.

Usage: check.py <index.html>
Exits 1 and lists problems if any are found.

Build shapes are required. Fails when <work>/build/ is missing, unless
<work>/no-build-shape.txt gives a one-line reason to skip. When <work>/build/
exists, also fails when an option has no build-shape fragment, when a fragment's
hash no longer matches its section in <work>/page/src.html, or when index.html was
built without the current fragment.
"""
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

sys.dont_write_bytecode = True
from option_section import FRAGMENT_HEADER, OPTION_IDS, option_hash

BANNED = [
    (r'\u2014', 'em dash'),
    (r'\blorem ipsum\b', 'lorem ipsum'),
    (r'\[[A-Z][A-Z _-]{2,}\]', '[BRACKET] placeholder'),
    (r'\bchatbots?\b', 'chatbot (say agent)'),
    (r'\bseamless(ly)?\b', 'seamless'),
    (r'\bsimply\b', 'simply'),
    (r'\brecommended\b', 'recommended (no recommendation)'),
    (r'\bbest option\b', 'best option (no recommendation)'),
    (r'\u2605|\u2606', 'star (no ranking)'),
]
SERVE_BANNED = [r'\bvoters?\b', r'\belections?\b', r'\bballots?\b']


VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}


class TextParser(HTMLParser):
    def __init__(self, skip_win):
        super().__init__()
        self.skip_win = skip_win
        self.stack = []
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        a = dict(attrs)
        hidden = tag in ('script', 'style') or (
            self.skip_win and (a.get('data-product') == 'win' or 'build-shape' in (a.get('class') or '').split())
        )
        self.stack.append(hidden or (bool(self.stack) and self.stack[-1]))

    def handle_endtag(self, tag):
        if tag not in VOID and self.stack:
            self.stack.pop()

    def handle_data(self, data):
        if not (self.stack and self.stack[-1]):
            self.parts.append(data)


def visible_text(html, skip_win=False):
    p = TextParser(skip_win)
    p.feed(html)
    return ' '.join(p.parts)


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    index = Path(sys.argv[1])
    html = index.read_text()
    text = visible_text(html)
    problems = []

    build = index.resolve().parent.parent / 'build'
    src = index.resolve().parent / 'src.html'
    skip = index.resolve().parent.parent / 'no-build-shape.txt'
    skip_reason = skip.read_text().strip() if skip.exists() else ''
    if not build.is_dir() and not skip_reason:
        problems.append(
            f'no build shapes: run build-shape in UX mode, or write {skip} '
            'with one line on why this has no system change'
        )
    if build.is_dir():
        src_html = src.read_text() if src.exists() else ''
        if not src_html:
            problems.append(f'{build} exists but {src} is missing; build shapes are hashed against src.html')
        for oid in OPTION_IDS:
            current = option_hash(src_html, oid)
            if not current:
                continue
            fragment = build / f'{oid}.html'
            if not fragment.exists():
                problems.append(f'{oid} has no build shape: run build-shape in UX mode')
                continue
            header = FRAGMENT_HEADER.match(fragment.read_text())
            if not header or header.group(1) != oid:
                problems.append(f'{fragment} must start with <!-- build-shape-for: {oid} sha256:<hash> -->')
            elif header.group(2) != current:
                problems.append(f'build shape for {oid} is stale: rerun build-shape')
            elif header.group(0).strip() not in html:
                problems.append(f'index.html is missing the current build shape for {oid}: rerun build.py')

    for pat, label in BANNED:
        for m in re.finditer(pat, text, flags=re.I):
            ctx = text[max(0, m.start() - 30):m.end() + 30].replace('\n', ' ')
            problems.append(f'{label}: ...{ctx}...')
    serve_text = visible_text(html, skip_win=True)
    for pat in SERVE_BANNED:
        if re.search(pat, serve_text, flags=re.I):
            problems.append(f'found {pat} outside a data-product="win" block; wrong on a Serve screen')
    if re.search(r'\bjust\b', text, flags=re.I):
        problems.append('"just" in copy')
    if '!' in text:
        problems.append('exclamation point in copy')

    for bid in ('brief', 'brief-user', 'brief-problem', 'brief-solution', 'brief-data',
                'brief-measure', 'brief-entry', 'feedback-ask'):
        if f'id="{bid}"' not in html:
            problems.append(f'missing brief block id="{bid}"')

    picked = re.search(r'data-picked="([abc])"', html)
    for oid in ([f'option-{picked.group(1)}'] if picked else ['option-a', 'option-b', 'option-c']):
        if f'id="{oid}"' not in html:
            problems.append(f'missing section id="{oid}"')
            continue
        x = oid[-1]
        section = html.split(f'id="{oid}"', 1)[1].split('<section', 1)[0]
        if f'id="{x}-entry"' not in section:
            problems.append(f'{oid}: no entry screen id="{x}-entry" (start where the user starts)')
        if f'id="{x}-sends"' not in section:
            problems.append(f'{oid}: no Sends line id="{x}-sends"')
        if f'id="{x}-appendix"' not in section:
            problems.append(f'{oid}: no Other states appendix id="{x}-appendix"')
        main_flow = section.split(f'id="{x}-appendix"', 1)[0]
        frames = re.findall(r'<div[^>]*class="(?:[^"]*\s)?frame(?:\s[^"]*)?"[^>]*>', main_flow)
        if not frames:
            problems.append(f'{oid}: no wireframe frame')
        for f in frames:
            if 'frame--phone' not in f and 'data-desktop-reason=' not in f:
                problems.append(f'{oid}: desktop frame without data-desktop-reason (phone first)')
        if main_flow.count('class="fold"') < len(frames):
            problems.append(f'{oid}: a frame has no fold line')
    for m in re.finditer(r'<(\w+)\b[^>]*\bclass="([^"]*)"[^>]*>', html):
        tag, cls = m.group(1), m.group(2).split()
        whole = m.group(0)
        if 'data-earned=' in whole:
            continue
        if tag == 'p' and 'muted' in cls:
            problems.append('unearned .muted paragraph (add data-earned="why" or remove)')
        if any(c in ('banner', 'alert', 'gp-alert', 'callout') for c in cls):
            problems.append(f'unearned banner <{tag} class="{m.group(2)}"> (add data-earned="why" or remove)')
    for m in re.finditer(r'<svg\b[^>]*>(.*?)</svg>', html, flags=re.S | re.I):
        if not re.search(r'<(path|circle|rect|line|polyline|polygon|ellipse)\b', m.group(1)):
            problems.append('blank icon: <svg> with no shapes')
    # Spacing parity: Tailwind spacing moves in 2px steps at its finest (0.5), so an odd px value is
    # never a real class. A pill, chip or toggle rule at 40px or taller is not the product's 36px.
    for sel, body in re.findall(r'([^{}<>]+)\{([^{}]*)\}', '\n'.join(re.findall(r'<style\b[^>]*>(.*?)</style>', html, flags=re.S | re.I))):
        sel = sel.strip()
        if sel.startswith('@') or ':root' in sel:
            continue
        for prop, val in re.findall(r'\b(gap|row-gap|column-gap|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?)\s*:\s*([^;]+)', body):
            for n in re.findall(r'(?<![\d.#-])(\d+(?:\.\d+)?)px', val):
                if float(n) % 2:
                    problems.append(f'off-scale spacing {prop}: {val.strip()} in "{sel[:50]}" (use real Tailwind steps, see wireframe-build.md "Spacing parity")')
        if re.search(r'pill|chip|toggle', sel, flags=re.I):
            for prop, n in re.findall(r'\b((?:min-)?height)\s*:\s*(\d+)px', body):
                if int(n) >= 40:
                    problems.append(f'"{sel[:50]}" {prop}: {n}px; the product filter pill is 36px (h-9). Use gp-pill or the real height')
    if re.search(r'id="option-d"', html):
        problems.append('more than three options')
    if '<iframe' in html.lower():
        problems.append('iframe (the Vercel comment toolbar cannot see inside)')
    if re.search(r'href=["\']#["\']', html):
        problems.append('href="#" dead link')
    if re.search(r'href=["\']mailto:', html):
        problems.append('mailto link (use an in-page panel)')

    for url in re.findall(r'(?:src|href)=["\'](https?://[^"\']+)', html):
        if not url.startswith('https://fonts.googleapis.com/'):
            problems.append(f'external request: {url}')
    if re.search(r'\b(fetch|XMLHttpRequest)\s*\(', html):
        problems.append('network call in script')

    ids = re.findall(r'\bid="([^"]+)"', html)
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        problems.append(f'duplicate id: {dup}')
    for target in re.findall(r'href="#([^"]+)"', html):
        if target not in ids:
            problems.append(f'link to missing id: #{target}')
    if len(html) > 5 * 1024 * 1024:
        problems.append('page over 5 MB')

    if problems:
        print('\n'.join(f'- {p}' for p in problems))
        sys.exit(1)
    print('ok')


main()
