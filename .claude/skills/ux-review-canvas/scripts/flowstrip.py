#!/usr/bin/env python3
"""Build each option's flow board (Flow-<ID>.dc.html) from its spec.

The flow sits above the option's clickable wireframe: the ways in across the top,
the numbered main path left to right, and each step's branches stacked under it.
It is generated, never hand-drawn, so it can't drift from the spec, and the spec is
checked against the wireframe in every review round.

Usage: .claude/skills/ux-review-canvas/scripts/flowstrip.py <work> [ID ...]

Reads <work>/specs/<ID>.json (format: reference/flow-spec.md) and <work>/doors.json,
writes <work>/project/Flow-<ID>.dc.html, then measures each board and sets its
height. Without IDs it builds every spec.
"""
import html
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import render  # noqa: E402

e = lambda s: html.escape(str(s), quote=True)
W = 1280
KIND = {
    'ask': ('They answer', 'background: #ffffff; border: 1.5px solid #171717; color: #171717'),
    'commit': ('They commit', 'background: #ffffff; border: 4px double #171717; color: #171717'),
    'value': ('They get value', 'background: #e5e5e5; border: 1.5px solid #e5e5e5; color: #171717'),
    'info': ('They read or approve', 'background: #ffffff; border: 1.5px dashed #737373; color: #404040'),
    'land': ('Where it ends', 'background: #171717; border: 1.5px solid #171717; color: #ffffff'),
}
SR = 'position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap'
H2 = 'margin: 0; font-size: 14px; font-weight: 700; color: #262626'


def board(spec, doors):
    n = len(spec['steps'])
    cols = ' '.join(['minmax(0, 1fr)' if i % 2 == 0 else '20px' for i in range(2 * n - 1)])
    tag = "Close to today's product" if spec['layout'] == 'close' else 'New layout'
    wire = spec['file']
    ways = ''
    for en in spec['entries']:
        d = doors[en['key']]
        ways += (f'<li style="flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border-radius: 10px; background: #ffffff; border: 1px solid #d4d4d4">'
                 f'<a href="{e(d["board"])}" style="font-size: 13px; font-weight: 600; color: #171717; text-decoration: underline">{e(d["name"])}</a>'
                 f'<span style="font-size: 12px; line-height: 1.4; color: #525252">{e(en["knows"])}</span>'
                 f'<a href="{e(wire)}#from={e(en["key"])}" style="align-self: flex-start; min-height: 44px; display: inline-flex; align-items: center; font-size: 12px; font-weight: 600; color: #3d5a80">Starts at step {en["lands"]}: try it</a></li>')
    nodes = ''
    for i, s in enumerate(spec['steps']):
        name, style = KIND[s['kind']]
        dark = s['kind'] == 'land'
        nodes += (f'<li style="grid-column: {2 * i + 1}; display: flex; flex-direction: column; gap: 6px; padding: 10px 10px 12px; border-radius: 10px; box-sizing: border-box; {style}">'
                  f'<span style="display: flex; align-items: center; gap: 6px"><span style="flex: none; width: 22px; height: 22px; border-radius: 999px; background: {"#ffffff" if dark else "#171717"}; color: {"#171717" if dark else "#ffffff"}; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center">{s["n"]}</span>'
                  f'<span style="{SR}">{name}: </span><span style="font-size: 13px; font-weight: 700; line-height: 1.25">{e(s["label"])}</span></span>'
                  f'<span style="font-size: 12px; line-height: 1.35; opacity: 0.85">{e(s.get("screen", ""))}</span></li>')
        if i < n - 1:
            nodes += f'<li aria-hidden="true" style="grid-column: {2 * i + 2}; align-self: center; display: flex; justify-content: center"><svg width="18" height="12" viewBox="0 0 18 12" fill="none" stroke="#737373" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6h15M12 2l4 4-4 4"></path></svg></li>'
    by = {}
    for b in spec.get('branches', []):
        by.setdefault(b['from'], []).append(b)
    branches = ''
    for i, s in enumerate(spec['steps']):
        bl = by.get(s['n'], [])
        if not bl:
            continue
        items = ''.join(
            f'<li style="display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; border-radius: 10px; border: 1.5px dashed #737373; background: #fafafa">'
            f'<span style="font-size: 12px; font-weight: 700; color: #171717">{e(b["label"])}</span>'
            f'<span style="font-size: 12px; line-height: 1.35; color: #404040">{e(b["result"])}</span>'
            f'<span style="font-size: 12px; font-weight: 600; color: #525252">{(("Goes to step " if b["rejoins"] > b["from"] else "Back to step ") + str(b["rejoins"])) if b.get("rejoins") else "Doesn’t rejoin"}</span></li>' for b in bl)
        branches += (f'<div style="grid-column: {2 * i + 1}; display: flex; flex-direction: column; align-items: stretch">'
                     f'<svg aria-hidden="true" width="12" height="18" viewBox="0 0 12 18" fill="none" stroke="#737373" stroke-width="1.5" stroke-dasharray="3 3" style="align-self: center"><path d="M6 0v18"></path></svg>'
                     f'<ul aria-label="Branches from step {s["n"]}" style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px">{items}</ul></div>')
    used = {s['kind'] for s in spec['steps']}
    legend = ''.join(f'<span style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #404040"><span aria-hidden="true" style="width: 18px; height: 12px; border-radius: 3px; box-sizing: border-box; {st}"></span>{spec.get("landName", nm) if k == "land" else nm}</span>'
                     for k, (nm, st) in KIND.items() if k in used)
    lid = e(spec['id'])
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{lid} flow</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,600&amp;display=swap" rel="stylesheet">
<style>
body{{margin:0;background:#f5f5f5}}
a{{color:#3d5a80}}a:hover{{color:#3d5a80}}
</style>
</helmet>
<main style="width: 100%; max-width: {W}px; min-height: __H__px; box-sizing: border-box; padding: 24px 24px 28px; font-family: Open Sans, system-ui, sans-serif; color: #171717; background: #f5f5f5; display: flex; flex-direction: column; gap: 18px">
<header style="display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 16px">
<h1 style="margin: 0; flex-basis: 100%; font-size: 26px; line-height: 1.2; font-weight: 700">{e(spec["name"])}</h1>
<p style="margin: 0; flex: 1 1 520px; font-size: 15px; line-height: 1.5; color: #404040">{e(spec["short"])} <span style="color: #525252">{e(spec["family"])} · {tag}</span></p>
<a href="{e(wire)}" style="font-size: 14px; font-weight: 600">Open the clickable wireframe below</a>
</header>
<section aria-labelledby="in-{lid}" style="display: flex; flex-direction: column; gap: 8px">
<h2 id="in-{lid}" style="{H2}">Ways in</h2>
<ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px">{ways}</ul>
</section>
<section aria-labelledby="path-{lid}" style="display: flex; flex-direction: column; gap: 8px">
<h2 id="path-{lid}" style="{H2}">Main path, with branches under each step</h2>
<ol style="margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: {cols}; align-items: stretch">{nodes}</ol>
<div style="display: grid; grid-template-columns: {cols}; align-items: start">{branches}</div>
</section>
<footer style="display: flex; flex-wrap: wrap; gap: 8px 14px; padding-top: 12px; border-top: 1px solid #e5e5e5">{legend}</footer>
</main>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{W},"height":__H__}}}}'>
class Component extends DCLogic {{
renderVals() {{
return {{}};
}}
}}
</script>
</body>
</html>
'''


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    work = sys.argv[1]
    doors = {d['key']: d for d in json.load(open(os.path.join(work, 'doors.json')))}
    specs = os.path.join(work, 'specs')
    ids = sys.argv[2:] or [f[:-5] for f in sorted(os.listdir(specs)) if f.endswith('.json')]
    for i in ids:
        spec = json.load(open(os.path.join(specs, i + '.json')))
        out = os.path.join(work, 'project', f'Flow-{spec["id"]}.dc.html')
        src = board(spec, doors)
        open(out, 'w').write(src.replace('__H__', '600'))
        h = render.measure(work, [out])[out]
        if h:
            open(out, 'w').write(src.replace('__H__', str(h + 32)))
        print('wrote', os.path.basename(out), h + 32 if h else 'unmeasured, frame left at 600')
