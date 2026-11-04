import html
import re
import sys

BANNED = [
    'robust', 'seamless', 'seamlessly', 'leverage', 'leverages', 'ensure', 'ensures',
    'streamline', 'scalable', 'comprehensive', 'critical', 'key', 'effectively',
    'simply', 'just', 'delve', 'utilize', 'utilizes', 'facilitate', 'holistic',
]
TAGS = ['acceptable?', 'close enough?', 'worth it?', 'ok?', 'fine?']

path = sys.argv[1]
page = open(path).read()
problems = []

if '\u2014' in page:
    problems.append('em dash on the page')
if re.search(r'<script|https?://(?!www\.w3\.org)', page):
    problems.append('script or external URL on the page')

fragment = page.lstrip().startswith('<!-- build-shape-for:')
if not fragment and not re.search(r'<span class="lbl">Today\.</span>', page):
    problems.append('missing the "Today" paragraph at the top')
sections = len(re.findall(r'<section (?:id="option-|class="build-shape")', page))
if len(re.findall(r'<span class="lbl">The change\.</span>', page)) < sections:
    problems.append('each option needs a "The change" sentence')
if len(re.findall(r'<p class="count">', page)) < sections:
    problems.append('each option needs a change count line')
if len(re.findall(r'<strong>(?:Two|One)-way door\.?</strong>', page)) < sections:
    problems.append('each "Cost to back out" must start with Two-way door or One-way door')
if 'stroke-dasharray' in page:
    problems.append('dashed strokes on the map; show states by color and title prefix')

rails = re.findall(r'<aside class="rail">(.*?)</aside>', page, re.S)
if not rails:
    problems.append('no rail found; did you use the template?')

for n, rail in enumerate(rails):
    option = 'ABC'[n] if n < 3 else str(n)
    items = re.findall(r'<(?:li|p)>(.*?)</(?:li|p)>', rail, re.S)
    for raw in items:
        text = html.unescape(re.sub(r'<[^>]+>', '', raw)).strip()
        low = text.lower()
        where = f'option {option}: "{text[:70]}"'
        words = len(text.split())
        if words > 22:
            problems.append(f'{where} has {words} words; keep bullets to about 20')
        if raw.count('<strong>') > 1:
            problems.append(f'{where} bolds more than one phrase')
        if ';' in text:
            problems.append(f'{where} uses a semicolon; split it')
        if re.match(r'^(low|medium|high|lowest|highest)\b\s*[:,]', low):
            problems.append(f'{where} starts with a rating; say what you would lose instead')
        for tag in TAGS:
            if low.endswith(tag):
                problems.append(f'{where} ends with a tacked-on question')
        for word in BANNED:
            if re.search(rf'\b{word}\b', low):
                problems.append(f'{where} uses "{word}"')
        codes = re.findall(r'<code>(.*?)</code>', raw) + re.findall(
            r'\b(?:[A-Z][A-Z0-9]+_[A-Z0-9_]+|[a-z]+[A-Z][A-Za-z0-9]+|\w+\.(?:ts|tsx|py|js))\b', text
        )
        if len(codes) > 1:
            problems.append(f'{where} has {len(codes)} code names; describe what they do instead')

for p in problems:
    print(p)
print(f'{len(problems)} problem(s)')
sys.exit(1 if problems else 0)
