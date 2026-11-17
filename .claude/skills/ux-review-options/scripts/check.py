#!/usr/bin/env python3
"""Catch what review misses: banned words, dead links, external requests, and a
missing brief, open questions list, entry screen, Sends line, phone frame, fold,
Other states appendix, Built from list or What changes from today list, and text
shrunk below 0.75 with zoom or scale() inside a frame.

Usage: check.py [--skip-build-shape] <index.html>
Exits 1 and lists problems if any are found.

A page whose <main> carries data-design="one" (from page-template-one.html) is
one design: only #option-a is checked, any other option fails, and the
no-recommendation words are allowed. data-picked="x" (a revision round) checks
only #option-x.

Banned words are read at run time from "## Words we do not use" in
docs/product-copy.md, found by walking up from this script; the check fails if
the doc or the list is missing. Banned words, the Serve vocabulary and bare
"...ing..." loading lines are not checked inside #questions, #<x>-drops or
<code>, so old shipped strings and real prop names can be quoted there.

Every var(--x) with no fallback that a property uses, directly or through the
tokens it points at, must be defined in the built page.

The markup scans (muted text, banners, blank icons, duplicate ids, dead links)
skip HTML comments, <style> and <script>. aria-label, placeholder, title and alt
values are scanned for banned words, em dashes and "!" like visible text. Sample
strings left from the templates (assets/page-template*.html) and any {{...}}
fail. A CSS rule carrying a /* tw: p-[3px] */ marker copies a Tailwind arbitrary
value and is exempt from the spacing check.

Each option's phone flow carries data-flow="phone". A desktop flow
(data-flow="desktop") must have a screen for every data-step of the phone flow,
and the page needs its Phone and Desktop links (?view=phone, ?view=desktop): in
the page bar for one design, above the option's frame (&option=x) for options.
A Desktop link with no desktop flow fails too. Folds need the "Show fold" switch
build.py adds. None of these checks depend on where the brief sits on the page.

--skip-build-shape is for the check before review, while build-shape has not run
yet. The check before publishing runs without it.

Build shapes are required. Fails when <work>/build/ is missing, unless
<work>/no-build-shape.txt gives a one-line reason to skip. When <work>/build/
exists, also fails when an option has no build-shape fragment, when a fragment's
hash no longer matches its section in <work>/page/src.html, or when index.html was
built without the current fragment or without the switch that hides build
shapes by default.
"""
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

sys.dont_write_bytecode = True
from option_section import FRAGMENT_HEADER, OPTION_IDS, option_hash, section_span

RECOMMEND_LABELS = ('recommended (no recommendation)', 'best option (no recommendation)', 'star (no ranking)')
BANNED = [
    (r'\u2014', 'em dash'),
    (r'\blorem ipsum\b', 'lorem ipsum'),
    (r'\[[A-Z][A-Z _-]{2,}\]', '[BRACKET] placeholder'),
    (r'\bchatbots?\b', 'chatbot (say agent)'),
    (r'\brecommended\b', 'recommended (no recommendation)'),
    (r'\bbest option\b', 'best option (no recommendation)'),
    (r'\u2605|\u2606', 'star (no ranking)'),
]
SERVE_BANNED = [r'\bvoters?\b', r'\belections?\b', r'\bballots?\b']


VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}


def copy_doc_words():
    """The words and phrases under "## Words we do not use" in docs/product-copy.md."""
    for d in Path(__file__).resolve().parents:
        doc = d / 'docs/product-copy.md'
        if doc.exists():
            break
    else:
        sys.exit('check.py: docs/product-copy.md not found above ' + str(Path(__file__).resolve()))
    m = re.search(r'^## Words we do not use\s*\n(.*?)(?=^## |\Z)', doc.read_text(), flags=re.M | re.S)
    if not m:
        sys.exit(f'check.py: no "## Words we do not use" section in {doc}')
    first = m.group(1).strip().split('\n\n')[0]
    words = [w.strip().rstrip('.') for w in ' '.join(first.split()).split(',')]
    words += re.findall(r'"([^"]+)"', m.group(1))
    words = [w for w in words if w]
    if not words:
        sys.exit(f'check.py: the "Words we do not use" list in {doc} is empty')
    return words


def strip_markup(html):
    """The page without comments, <style> and <script>, for scans that read markup."""
    html = re.sub(r'<!--.*?-->', '', html, flags=re.S)
    return re.sub(r'<(style|script)\b[^>]*>.*?</\1\s*>', '', html, flags=re.S | re.I)


def strip_sections(html, cls):
    """html without every <section class="cls"> through its matching </section>."""
    while True:
        m = re.search(rf'<section\b[^>]*\bclass="{cls}"[^>]*>', html)
        if not m:
            return html
        depth, end = 0, len(html)
        for t in re.finditer(r'<section\b|</section\s*>', html[m.start():]):
            depth += -1 if t.group().startswith('</') else 1
            if depth == 0:
                end = m.start() + t.end()
                break
        html = html[:m.start()] + html[end:]


ALLOWED_TEMPLATE_TEXT = {'Restart', 'Phone', 'Desktop', 'Back', 'Office', 'Other states', 'Built from', 'What changes from today'}


def template_samples():
    """Sample text in #option-a of the templates that a filled page must replace."""
    samples = set()
    for t in (Path(__file__).resolve().parent.parent / 'assets').glob('page-template*.html'):
        html = strip_markup(t.read_text())
        span = section_span(html, 'option-a')
        if not span:
            continue
        sec = html[span[0]:span[2]]
        for part in visible_parts(sec):
            line = ' '.join(part.split())
            if line and '{{' not in line and line not in ALLOWED_TEMPLATE_TEXT:
                samples.add(line)
    return samples


def resolve(val, defs, depth=0):
    """val with each var(--x) replaced by its first definition, recursively."""
    if depth > 20:
        return val
    return re.sub(r'var\(\s*(--[\w-]+)\s*(?:,[^()]*)?\)',
                  lambda m: resolve(defs[m.group(1)][0], defs, depth + 1).strip() if m.group(1) in defs else m.group(0),
                  val)


def quoted(a):
    return a.get('id') == 'questions' or re.fullmatch(r'[a-c]-drops', a.get('id') or '') is not None


class TextParser(HTMLParser):
    def __init__(self, skip_win, skip_quoted):
        super().__init__()
        self.skip_win = skip_win
        self.skip_quoted = skip_quoted
        self.stack = []
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        a = dict(attrs)
        hidden = tag in ('script', 'style') or (
            self.skip_win and (a.get('data-product') == 'win' or 'build-shape' in (a.get('class') or '').split())
        ) or (self.skip_quoted and (tag == 'code' or quoted(a)))
        self.stack.append(hidden or (bool(self.stack) and self.stack[-1]))

    def handle_endtag(self, tag):
        if tag not in VOID and self.stack:
            self.stack.pop()

    def handle_data(self, data):
        if not (self.stack and self.stack[-1]):
            self.parts.append(data)


def visible_parts(html, skip_win=False, skip_quoted=False):
    p = TextParser(skip_win, skip_quoted)
    p.feed(html)
    return p.parts


def visible_text(html, skip_win=False, skip_quoted=False):
    return ' '.join(visible_parts(html, skip_win, skip_quoted))


def element_html(html, eid):
    """The element with this id, through its matching close tag."""
    m = re.search(rf'<(\w+)\b[^>]*\bid="{eid}"[^>]*>', html)
    return element_at(html, m) if m else None


def element_at(html, m):
    """The element whose start tag regex match m found, through its matching close tag."""
    tag, depth = m.group(1), 0
    for t in re.finditer(rf'<(/?){tag}\b[^>]*>', html[m.start():], flags=re.I):
        depth += -1 if t.group(1) else 1
        if depth == 0:
            return html[m.start():m.start() + t.end()]
    return html[m.start():]


def shrink(css):
    """The smallest zoom or transform scale() in a declaration block, or None."""
    vals = []
    for n, pct in re.findall(r'(?<![-\w])zoom\s*:\s*(\d*\.?\d+)(%?)', css):
        vals.append(float(n) / (100 if pct else 1))
    for t in re.findall(r'(?<![-\w])transform\s*:([^;}]*)', css):
        vals += [float(n) for n in re.findall(r'\bscale\(\s*(\d*\.?\d+)', t)]
    vals = [v for v in vals if 0 < v < 0.75]
    return min(vals) if vals else None


def main():
    args = sys.argv[1:]
    skip_build_shape = '--skip-build-shape' in args
    args = [a for a in args if a != '--skip-build-shape']
    if len(args) != 1:
        print(__doc__)
        sys.exit(2)
    index = Path(args[0])
    html = index.read_text()
    markup = strip_markup(html)
    text = visible_text(html, skip_quoted=True)
    attr_html = strip_markup(html)
    for eid in ['questions'] + [f'{x}-drops' for x in 'abc']:
        block = element_html(attr_html, eid)
        if block:
            attr_html = attr_html.replace(block, '')
    attrs = re.findall(r'\b(?:aria-label|placeholder|title|alt)="([^"]*)"', attr_html)
    text += ' ' + ' '.join(attrs)
    problems = []
    one_design = re.search(r'<main\b[^>]*\bdata-design="one"', html) is not None

    build = index.resolve().parent.parent / 'build'
    src = index.resolve().parent / 'src.html'
    skip = index.resolve().parent.parent / 'no-build-shape.txt'
    skip_reason = skip.read_text().strip() if skip.exists() else ''
    if not skip_build_shape and not build.is_dir() and not skip_reason:
        problems.append(
            f'no build shapes: run build-shape in UX mode, or write {skip} '
            'with one line on why this has no system change'
        )
    if build.is_dir() and not skip_build_shape:
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
        if 'class="build-shape"' in html and 'id="build-toggle"' not in html:
            problems.append('build shapes show by default: rerun build.py to add the switch that hides them')

    if 'class="fold"' in markup and 'id="fold-toggle"' not in markup:
        problems.append('folds show by default: rerun build.py to add the "Show fold" switch')

    for pat, label in BANNED:
        if one_design and label in RECOMMEND_LABELS:
            continue
        for m in re.finditer(pat, text, flags=re.I):
            ctx = text[max(0, m.start() - 30):m.end() + 30].replace('\n', ' ')
            problems.append(f'{label}: ...{ctx}...')
    for word in copy_doc_words():
        for m in re.finditer(r'\b' + re.escape(word) + r'\b', text, flags=re.I):
            ctx = text[max(0, m.start() - 30):m.end() + 30].replace('\n', ' ')
            problems.append(f'"{word}" (docs/product-copy.md, Words we do not use): ...{ctx}...')
    serve_text = visible_text(html, skip_win=True, skip_quoted=True)
    for pat in SERVE_BANNED:
        if re.search(pat, serve_text, flags=re.I):
            problems.append(f'found {pat} outside a data-product="win" block; wrong on a Serve screen')
    if '!' in text:
        problems.append('exclamation point in copy')
    # A text node that is only "Drafting your email..." is the bare loading line product-design.md section 6 bans.
    for part in visible_parts(html, skip_quoted=True):
        line = part.strip()
        if re.fullmatch(r"[A-Z][a-z]+ing\b[^.!?\n]{0,40}(?:\u2026|\.\.\.)", line):
            problems.append(f'bare loading line "{line}" (docs/product-design.md sections 6 and 11)')

    for bid in ('brief', 'brief-user', 'brief-problem', 'brief-solution', 'brief-data',
                'brief-measure', 'brief-entry', 'reach', 'feedback-ask', 'questions'):
        if f'id="{bid}"' not in html:
            problems.append(f'missing brief block id="{bid}"')
    if re.search(r'\bopen questions?\b', text, flags=re.I):
        q = element_html(html, 'questions')
        items = re.findall(r'<li\b[^>]*>(.*?)</li>', q or '', flags=re.S)
        if not any(visible_text(i).strip() for i in items):
            problems.append('the page mentions open questions but id="questions" is missing or has no list item')

    for line in sorted(template_samples()):
        if any(' '.join(p.split()) == line for p in visible_parts(markup)):
            problems.append(f'template sample text left on the page: "{line}"')
    for left in sorted(set(re.findall(r'\{\{[^{}]*\}\}', markup))):
        problems.append(f'unfilled placeholder {left}')

    picked = re.search(r'<main\b[^>]*\bdata-picked="([abc])"', html)
    if one_design:
        oids = ['option-a']
        for extra in ('option-b', 'option-c'):
            if f'id="{extra}"' in html:
                problems.append(f'one design (data-design="one") but the page has id="{extra}"')
    elif picked:
        oids = [f'option-{picked.group(1)}']
    else:
        oids = list(OPTION_IDS)
    for oid in oids:
        span = section_span(html, oid)
        if not span:
            problems.append(f'missing section id="{oid}"')
            continue
        x = oid[-1]
        section = html[span[0]:span[2]]
        if f'id="{x}-entry"' not in section:
            problems.append(f'{oid}: no entry screen id="{x}-entry" (start where the user starts)')
        if f'id="{x}-sends"' not in section:
            problems.append(f'{oid}: no Sends line id="{x}-sends"')
        if f'id="{x}-appendix"' not in section:
            problems.append(f'{oid}: no Other states appendix id="{x}-appendix"')
        if f'id="{x}-sources"' not in section:
            problems.append(f'{oid}: no Built from list id="{x}-sources" (docs/product-design.md section 7)')
        if f'id="{x}-drops"' not in section:
            problems.append(f'{oid}: no What changes from today list id="{x}-drops" (docs/product-design.md section 7)')
        main_flow = strip_markup(section).split(f'id="{x}-appendix"', 1)[0]
        today = element_html(main_flow, f'{x}-today')
        if today:
            main_flow = main_flow.replace(today, '')
        frames = re.findall(r'<div[^>]*class="(?:[^"]*\s)?frame(?:\s[^"]*)?"[^>]*>', main_flow)
        if not frames:
            problems.append(f'{oid}: no wireframe frame')
        for f in frames:
            if 'frame--phone' not in f and 'data-desktop-reason=' not in f:
                problems.append(f'{oid}: desktop frame without data-desktop-reason (phone first)')
        if main_flow.count('class="fold"') < len(frames):
            problems.append(f'{oid}: a frame has no fold line')
        flows = {}
        for m in re.finditer(r'<(\w+)\b[^>]*\bdata-flow="(phone|desktop)"[^>]*>', main_flow):
            flows.setdefault(m.group(2), []).append(element_at(main_flow, m))
        if not flows.get('phone'):
            problems.append(f'{oid}: no data-flow="phone" on the phone frame (?view=phone shows it)')
        if one_design:
            nav = re.search(r'<nav\b[^>]*class="page-bar"[^>]*>.*?</nav>', markup, flags=re.S)
            links, where = (nav.group(0) if nav else ''), 'the page bar'
            link = lambda v: f'href="?view={v}"'
        else:
            links, where = strip_markup(section), f'{oid} above its frame'
            link = lambda v: f'href="?view={v}&amp;option={x}"'
        if flows.get('desktop'):
            steps = lambda kind: {s for b in flows.get(kind, []) for s in re.findall(r'\bdata-step="([^"]+)"', b)}
            missing = sorted(steps('phone') - steps('desktop'))
            if missing:
                problems.append(f'{oid}: the desktop flow has no screen for data-step ' + ', '.join(missing))
            for v in ('phone', 'desktop'):
                if link(v) not in links.replace('&option', '&amp;option'):
                    problems.append(f'{oid}: no {v.capitalize()} link ({link(v)[5:]}) in {where}')
        elif link('desktop') in links.replace('&option', '&amp;option'):
            problems.append(f'{oid}: a Desktop link but no data-flow="desktop" flow')
    styles = '\n'.join(re.findall(r'<style\b[^>]*>(.*?)</style>', html, flags=re.S | re.I))
    # Text shrunk with zoom or scale() inside a frame is unreadable at 375 (review-lens.md, preview size).
    # Only rules whose class or id is used inside an option's frames count; page chrome and build shapes don't.
    in_frames = ''
    for oid in oids:
        span = section_span(html, oid)
        if span:
            in_frames += strip_sections(strip_markup(html[span[0]:span[2]]), 'build-shape')
    used = set()
    for tag in re.findall(r'<\w+\b[^>]*>', in_frames):
        if 'data-earned=' in tag:
            continue
        used.update(re.findall(r'\bid="([^"]+)"', tag))
        for c in re.findall(r'\bclass="([^"]*)"', tag):
            used.update(c.split())
    for sel, body in re.findall(r'([^{}<>]+)\{([^{}]*)\}', styles):
        if 'data-earned' in sel + body:
            continue
        sel = re.sub(r'/\*.*?\*/', '', sel, flags=re.S).strip()
        v = shrink(re.sub(r'/\*.*?\*/', '', body, flags=re.S))
        if v is None or re.search(r'build-shape|page-bar', sel):
            continue
        if used.intersection(re.findall(r'[.#]([\w-]+)', sel)):
            problems.append(f'"{sel[:50]}" shrinks to {v:g} inside a frame; keep preview text 12px or larger, or say in #questions why it cannot fit (mark data-earned to keep it)')
    for m in re.finditer(r'<\w+\b[^>]*\bstyle="([^"]*)"[^>]*>', in_frames):
        v = shrink(m.group(1))
        if v is not None and 'data-earned=' not in m.group(0):
            problems.append(f'inline style shrinks to {v:g} inside a frame: {m.group(0)[:60]} (mark data-earned to keep it)')
    # Follow var() from real properties through the tokens they point at. Unused tokens may point at
    # variables only the app defines at run time (next/font), so they don't count.
    css = re.sub(r'/\*.*?\*/', '', styles + ';' + ';'.join(re.findall(r'\bstyle="([^"]*)"', html)), flags=re.S)
    defs = {}
    for name, val in re.findall(r'(--[\w-]+)\s*:\s*([^;{}]*)', css):
        defs.setdefault(name, []).append(val)
    # Classes whose own rule (a plain ".name" selector) sets the muted text color, directly or through
    # any var() that resolves to it. gp-ui.css component classes (a step caption) are the component's own.
    muted = resolve('var(--brand-text-secondary)', defs).lower()
    gp_ui = (Path(__file__).resolve().parent.parent / 'assets/gp-ui.css').read_text()
    gp_ui_classes = set(re.findall(r'\.(gp-[\w-]+)', gp_ui))
    muted_classes = {'muted'}
    for sel, body in re.findall(r'([^{}<>]+)\{([^{}]*)\}', re.sub(r'/\*.*?\*/', '', styles, flags=re.S)):
        for val in re.findall(r'(?<![-\w])color\s*:\s*([^;}]+)', body):
            if resolve(val.replace('!important', '').strip(), defs).lower() == muted:
                muted_classes.update(set(re.findall(r'(?:^|,)\s*\.([\w-]+)\s*(?=,|$)', sel.strip())) - gp_ui_classes)
    for m in re.finditer(r'<(\w+)\b[^>]*\bclass="([^"]*)"[^>]*>', markup):
        tag, cls = m.group(1), m.group(2).split()
        whole = m.group(0)
        if 'data-earned=' in whole:
            continue
        if tag == 'p' and muted_classes.intersection(cls):
            problems.append(f'unearned muted paragraph <p class="{m.group(2)}"> (add data-earned="why" or remove)')
        if any(c in ('banner', 'alert', 'gp-alert', 'callout') for c in cls):
            problems.append(f'unearned banner <{tag} class="{m.group(2)}"> (add data-earned="why" or remove)')
    for m in re.finditer(r'<svg\b[^>]*>(.*?)</svg>', markup, flags=re.S | re.I):
        if not re.search(r'<(path|circle|rect|line|polyline|polygon|ellipse)\b', m.group(1)):
            problems.append('blank icon: <svg> with no shapes')
    # Spacing parity: Tailwind spacing moves in 2px steps at its finest (0.5), so an odd px value is
    # never a real class. A pill, chip or toggle rule at 40px or taller is not the product's 36px.
    tw_styles = re.sub(r'/\*\s*tw:[^*]*\*/', ' TW_ARBITRARY ', styles)
    for sel, body in re.findall(r'([^{}<>]+)\{([^{}]*)\}', re.sub(r'/\*.*?\*/', '', tw_styles, flags=re.S)):
        sel = sel.strip()
        if sel.startswith('@') or ':root' in sel:
            continue
        exempt = 'TW_ARBITRARY' in sel + body
        sel = sel.replace('TW_ARBITRARY', '').strip()
        for prop, val in re.findall(r'\b(gap|row-gap|column-gap|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?)\s*:\s*([^;]+)', body):
            for n in re.findall(r'(?<![\d.#-])(\d+(?:\.\d+)?)px', val):
                if float(n) % 2 and not exempt:
                    problems.append(f'off-scale spacing {prop}: {val.strip()} in "{sel[:50]}" (use real Tailwind steps, see wireframe-build.md "Spacing parity")')
        if re.search(r'pill|chip|toggle', sel, flags=re.I):
            for prop, n in re.findall(r'\b((?:min-)?height)\s*:\s*(\d+)px', body):
                if int(n) >= 40:
                    problems.append(f'"{sel[:50]}" {prop}: {n}px; the product filter pill is 36px (h-9). Use gp-pill or the real height')
    if re.search(r'id="option-d"', html):
        problems.append('more than three options')
    if '<iframe' in html.lower():
        problems.append('iframe (the Vercel comment toolbar cannot see inside)')
    if re.search(r'href=["\']#["\']', markup):
        problems.append('href="#" dead link')
    if re.search(r'href=["\']mailto:', html):
        problems.append('mailto link (use an in-page panel)')

    for url in re.findall(r'(?:src|href)=["\'](https?://[^"\']+)', html):
        if not url.startswith('https://fonts.googleapis.com/'):
            problems.append(f'external request: {url}')
    if re.search(r'\b(fetch|XMLHttpRequest)\s*\(', html):
        problems.append('network call in script')

    todo = [n for prop, val in re.findall(r'(?<![\w-])([a-z][\w-]*)\s*:\s*([^;{}]*)', css)
            for n in re.findall(r'var\(\s*(--[\w-]+)\s*\)', val)]
    seen = set()
    while todo:
        name = todo.pop()
        if name in seen:
            continue
        seen.add(name)
        if name not in defs:
            problems.append(f'var({name}) is never defined in the built page: use a token from design-tokens.css or tailwind-theme.css')
            continue
        for val in defs[name]:
            todo += re.findall(r'var\(\s*(--[\w-]+)\s*\)', val)

    ids = re.findall(r'\bid="([^"]+)"', markup)
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        problems.append(f'duplicate id: {dup}')
    for target in re.findall(r'href="#([^"]+)"', markup):
        if target not in ids:
            problems.append(f'link to missing id: #{target}')
    if len(html) > 5 * 1024 * 1024:
        problems.append('page over 5 MB')

    if problems:
        print('\n'.join(f'- {p}' for p in problems))
        sys.exit(1)
    print('ok')


main()
