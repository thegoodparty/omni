#!/usr/bin/env python3
"""Lay out the review canvas index (<work>/project/canvas.json).

Every canvas has the same three pages, so a reviewer who has seen one knows where
everything is in the next: Overview, Options (the ways in across the top, then each
option as its flow above its clickable wireframe, grouped close to today's product
first and new layouts second), and Questions. Board sizes come from each board's
`$preview`, so measure first (render.py) or frames will clip.

Usage: .claude/skills/ux-review-canvas/scripts/build_canvas.py <work> "<canvas title>"

Reads <work>/doors.json and <work>/specs/*.json. Keeps createdOnFiles and
designSystems from an existing canvas.json.
"""
import json
import os
import re
import sys

if len(sys.argv) < 3:
    sys.exit(__doc__)
work, title = sys.argv[1], sys.argv[2]
P = os.path.join(work, 'project')
path = os.path.join(P, 'canvas.json')
old = json.load(open(path)) if os.path.exists(path) else {}


def pv(f):
    m = re.search(r'"\$preview"\s*:\s*\{\s*"width"\s*:\s*(\d+)\s*,\s*"height"\s*:\s*(\d+)\s*\}', open(os.path.join(P, f)).read())
    if not m:
        sys.exit(f'{f} has no $preview size')
    return int(m.group(1)), int(m.group(2))


c = {'v': 3, 'createdOnFiles': old.get('createdOnFiles', {'v': 1, 'at': '2026-01-01T00:00:00Z'}), 'title': title,
     'launch': {'view': 'canvas', 'page': 'overview'},
     'pages': [{'id': 'overview', 'name': 'Overview'}, {'id': 'options', 'name': 'Options'}, {'id': 'questions', 'name': 'Questions'}],
     'boards': {}, 'order': [], 'notes': {}, 'designSystems': old.get('designSystems', [])}


def add(f, b):
    c['boards'][f] = b
    c['order'].append(f)


for f, page, name in [('Overview.dc.html', 'overview', 'Overview'), ('Questions.dc.html', 'questions', 'Questions')]:
    add(f, {'x': 0, 'y': 0, 'w': 1280, 'h': pv(f)[1], 'expand': 'fill', 'page': page, 'title': name})

doors = json.load(open(os.path.join(work, 'doors.json')))
c['notes']['ways'] = {'x': 0, 'y': 0, 'text': 'Ways in', 'kind': 'title1', 'maxW': 1360 * len(doors), 'page': 'options'}
tallest = 0
for i, d in enumerate(doors):
    h = pv(d['board'])[1]
    add(d['board'], {'x': i * 1360, 'y': 280, 'w': 1280, 'h': h, 'expand': 'fill', 'page': 'options',
                     'is_interactive': True, 'title': f'Way in: {d["name"]}'})
    tallest = max(tallest, h)

sd = os.path.join(work, 'specs')
specs = sorted((json.load(open(os.path.join(sd, f))) for f in os.listdir(sd) if f.endswith('.json')), key=lambda s: s['id'])
if [s['id'] for s in specs] != ['A', 'B', 'C']:
    sys.exit(f'need exactly three options, A to C; found {[s["id"] for s in specs]}')
y = 280 + tallest + 400
for gi, (group, rows) in enumerate([("Close to today's product", [s for s in specs if s['layout'] == 'close']),
                                    ('New layouts', [s for s in specs if s['layout'] != 'close'])]):
    if not rows:
        continue
    c['notes'][f'g{gi}'] = {'x': 0, 'y': y, 'text': group, 'kind': 'title1', 'maxW': 2400, 'page': 'options'}
    y += 400
    for s in rows:
        c['notes'][f'o{s["id"]}'] = {'x': 0, 'y': y, 'text': s['name'], 'kind': 'title1', 'maxW': 2400, 'page': 'options', 'size': 'l'}
        y += 280
        flow = f'Flow-{s["id"]}.dc.html'
        fh = pv(flow)[1]
        add(flow, {'x': 0, 'y': y, 'w': 1280, 'h': fh, 'expand': 'fill', 'page': 'options', 'title': f'{s["name"]}: flow'})
        y += fh + 80
        ww, wh = pv(s['file'])
        b = {'x': 0, 'y': y, 'w': ww, 'h': wh, 'page': 'options', 'is_interactive': True, 'title': f'{s["name"]}: clickable wireframe'}
        if ww >= 1000:
            b['expand'] = 'fill'
        add(s['file'], b)
        y += wh + 240
    y += 160

json.dump(c, open(path, 'w'), indent=2, ensure_ascii=False)
print(len(c['boards']), 'boards in', path)
