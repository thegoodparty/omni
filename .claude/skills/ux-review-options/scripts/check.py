#!/usr/bin/env python3
"""Catch what review misses: banned words, dead links, external requests, and a
missing brief, entry screen, Sends line, phone frame or fold.

Usage: check.py <index.html>
Exits 1 and lists problems if any are found.
"""
import re
import sys
from pathlib import Path

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


def visible_text(html):
    html = re.sub(r'<(script|style)\b.*?</\1>', ' ', html, flags=re.S | re.I)
    return re.sub(r'<[^>]+>', ' ', html)


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    html = Path(sys.argv[1]).read_text()
    text = visible_text(html)
    problems = []

    for pat, label in BANNED:
        for m in re.finditer(pat, text, flags=re.I):
            ctx = text[max(0, m.start() - 30):m.end() + 30].replace('\n', ' ')
            problems.append(f'{label}: ...{ctx}...')
    for pat in SERVE_BANNED:
        if re.search(pat, text, flags=re.I):
            problems.append(f'found {pat}; fine on a Win screen, wrong on a Serve screen')
    if re.search(r'\bjust\b', text, flags=re.I):
        problems.append('"just" in copy')
    if '!' in text:
        problems.append('exclamation point in copy')

    for bid in ('brief', 'brief-user', 'brief-problem', 'brief-solution', 'brief-data',
                'brief-measure', 'brief-entry', 'feedback-ask'):
        if f'id="{bid}"' not in html:
            problems.append(f'missing brief block id="{bid}"')

    for oid in ('option-a', 'option-b', 'option-c'):
        if f'id="{oid}"' not in html:
            problems.append(f'missing section id="{oid}"')
            continue
        x = oid[-1]
        section = html.split(f'id="{oid}"', 1)[1].split('<section', 1)[0]
        if f'id="{x}-entry"' not in section:
            problems.append(f'{oid}: no entry screen id="{x}-entry" (start where the user starts)')
        if f'id="{x}-sends"' not in section:
            problems.append(f'{oid}: no Sends line id="{x}-sends"')
        frames = re.findall(r'<div[^>]*class="(?:[^"]*\s)?frame(?:\s[^"]*)?"[^>]*>', section)
        if not frames:
            problems.append(f'{oid}: no wireframe frame')
        for f in frames:
            if 'frame--phone' not in f and 'data-desktop-reason=' not in f:
                problems.append(f'{oid}: desktop frame without data-desktop-reason (phone first)')
        if section.count('class="fold"') < len(frames):
            problems.append(f'{oid}: a frame has no fold line')
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
