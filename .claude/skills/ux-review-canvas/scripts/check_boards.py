#!/usr/bin/env python3
"""Lint canvas boards for the mistakes the canvas runtime fails on silently.

A board with an unclosed tag, a script that doesn't parse, or a `{{hole}}` that
isn't a dotted lookup renders blank or half-rendered on the canvas with no error.
The copy checks catch what reviewers kept flagging by hand.

Usage: .claude/skills/ux-review-canvas/scripts/check_boards.py [--serve] <board.dc.html>...

  --serve  also flag Win nouns (voter, election, ballot...) for Serve boards.
           Leave it off for Win boards, where those words are correct.

Exits 1 if any board has a problem. Needs node on PATH for the script parse.
"""
import html.parser
import os
import re
import subprocess
import sys
import tempfile

VOID = {'meta', 'link', 'input', 'br', 'img', 'hr', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr'}
SVG_SELF = {'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'stop', 'use'}
BANNED = r'\b(just|simply|seamless(ly)?|delightful|chatbots?|lorem|ipsum)\b'
SERVE_BANNED = r'\b(voters?|elections?|electoral|ballots?|supporters?)\b'


class Tags(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack, self.errors = [], []

    def handle_starttag(self, tag, attrs):
        if tag not in VOID:
            self.stack.append((tag, self.getpos()))

    def handle_startendtag(self, tag, attrs):
        if tag not in VOID and tag not in SVG_SELF:
            self.errors.append(f'self-closed <{tag}> at line {self.getpos()[0]}')

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            self.errors.append(f'extra </{tag}> at line {self.getpos()[0]}')
        elif self.stack[-1][0] != tag:
            self.errors.append(f'</{tag}> at line {self.getpos()[0]} closes <{self.stack[-1][0]}> from line {self.stack[-1][1][0]}')
        else:
            self.stack.pop()


def check(path, serve):
    src = open(path).read()
    problems = []
    if '<script src="./support.js"></script>' not in src:
        problems.append('missing <script src="./support.js"></script>')
    m = re.search(r'<script type="text/x-dc"[^>]*>(.*?)</script>', src, re.S)
    if not m:
        problems.append('missing the text/x-dc script block')
    if '"$preview"' not in src:
        problems.append('missing $preview size')
    body = src.split('<script type="text/x-dc"')[0]
    t = Tags()
    t.feed(body)
    problems += t.errors[:5]
    problems += [f'unclosed <{tag}> from line {pos[0]}' for tag, pos in t.stack if tag not in ('html', 'body')][:5]
    if m:
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as f:
            f.write('class DCLogic {}\n' + m.group(1))
        r = subprocess.run(['node', '--check', f.name], capture_output=True, text=True)
        os.unlink(f.name)
        if r.returncode:
            problems.append('script does not parse: ' + r.stderr.strip().splitlines()[-1])
    bad = [h for h in set(re.findall(r'\{\{\s*([^}]+?)\s*\}\}', body)) if not re.fullmatch(r'[\w$.]+', h)]
    if bad:
        problems.append(f'holes must be dotted lookups: {bad}')
    if 'href="#"' in src:
        problems.append('dead link href="#"')
    text = re.sub(r'<[^>]+>', ' ', body)
    if '—' in src:
        problems.append('em dash')
    words = re.findall(BANNED, text, re.I) + (re.findall(SERVE_BANNED, text, re.I) if serve else [])
    if words:
        problems.append('banned words: ' + ', '.join(sorted({w[0] if isinstance(w, tuple) else w for w in words})))
    return problems


if __name__ == '__main__':
    args = sys.argv[1:]
    serve = '--serve' in args
    files = [a for a in args if a != '--serve']
    if not files:
        sys.exit(__doc__)
    failed = False
    for f in files:
        p = check(f, serve)
        print(os.path.basename(f), 'ok' if not p else '')
        for x in p:
            print('  ' + x)
        failed |= bool(p)
    sys.exit(1 if failed else 0)
