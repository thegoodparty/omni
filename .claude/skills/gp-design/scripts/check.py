#!/usr/bin/env python3
"""Catch what review misses: banned words, dead links, external requests, design
system rules in the flows, and a missing brief, open questions list, Sends line,
flow, Other states, Built from, What changes from today or Mutations list.

Usage: check.py [--skip-build-shape] <index.html>
Exits 1 and lists problems if any are found.

A page whose <main> carries data-design="one" (from page-template-one.html) is
one design: only #option-a is checked, any other option fails, and the
no-recommendation words are allowed. data-picked="x" (a revision round) checks
only #option-x.

Each option is drawn in <work>/flow/<option-id>.tsx with the real styleguide
components (assets/flow-template.tsx) and rendered by build.py. The section needs
its mounts (data-gp-head, data-gp-flow, data-gp-states), and index.html must be
built from the current flow file. scripts/flow/lint.mjs checks each flow file:
imports, raw elements, restyled components (data-mutation), hand-drawn looks
(data-source or data-gap), hardcoded colors, style={}, shrinking, odd spacing,
unearned muted text and banners, data-go targets, an entry screen and at least
one state. Each data-mutation and data-gap marker needs a row in the option's
#<x>-mutations block quoting the marker's text after its kind.

Copy is read from the page and from build.py's snapshot of every screen and
state (<template data-gp-snapshot>). Banned words are read at run time from "##
Words we do not use" in docs/product-copy.md, found by walking up from this
script; the check fails if the doc or the list is missing. Banned words, the
Serve vocabulary and bare "...ing..." loading lines are not checked inside
#questions, #<x>-drops or <code>, so old shipped strings and real prop names
can be quoted there. aria-label, placeholder, title and alt values are scanned
like visible text. Sample strings left from the templates
(assets/page-template*.html, assets/flow-template.tsx) and any {{...}} fail.

The page's own CSS is every <style> rule outside the blocks build.py inlines and
outside the template's scaffold, which must match a template's byte for byte
(whitespace aside). It lays out the page around the design and never reaches
into a frame. Every var(--x) with no fallback it uses must be defined.

<main> carries data-product="win", "serve" or "both". Every data-inert="<name>"
(a control the change doesn't touch) is named in a #<x>-sources row that says
"Not part of this change". data-earned="shipped <path>:<line>" must point at a
real line.

--skip-build-shape is for the check before review, while build-shape has not run
yet. The check before publishing runs without it.

Build shapes are required. Fails when <work>/build/ is missing, unless
<work>/no-build-shape.txt gives a one-line reason to skip. When <work>/build/
exists, also fails when an option has no build-shape fragment, when a fragment's
hash no longer matches its section in <work>/page/src.html and its flow file, or
when index.html was built without the current fragment or without the switch
that hides build shapes by default.
"""
import hashlib
import html as htmllib
import json
import re
import shutil
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

sys.dont_write_bytecode = True
from option_section import FRAGMENT_HEADER, OPTION_IDS, flow_file, option_hash, section_span

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
    words += [' '.join(q.split()) for q in re.findall(r'"([^"]+)"', m.group(1))]
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


ALLOWED_TEMPLATE_TEXT = {'Back', 'Office', 'Other states', 'Built from', 'What changes from today', 'Mutations'}


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
    flow = (Path(__file__).resolve().parent.parent / 'assets/flow-template.tsx').read_text()
    for line in re.findall(r'>\s*([A-Z][^<>{}\n]*?)\s*<', flow) + re.findall(r'\b(?:title|body|label)[=:]\s*["\']([^"\']+)["\']', flow):
        line = ' '.join(line.split())
        if line and line not in ALLOWED_TEMPLATE_TEXT:
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
    # A "Today: ..." state shows a shipped screen as it ships, so its words are quoted too.
    return (a.get('id') == 'questions' or re.fullmatch(r'[a-c]-drops', a.get('id') or '') is not None
            or (a.get('data-gp-label') or '').startswith('Today:'))


class TextParser(HTMLParser):
    def __init__(self, skip_win, skip_quoted, skip_copied=False):
        super().__init__()
        self.skip_win = skip_win
        self.skip_quoted = skip_quoted
        self.skip_copied = skip_copied
        self.stack = []
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        a = dict(attrs)
        hidden = tag in ('script', 'style') or (
            self.skip_win and (a.get('data-product') == 'win' or 'build-shape' in (a.get('class') or '').split())
        ) or (self.skip_quoted and (tag == 'code' or quoted(a))) or (
            self.skip_copied and ('data-source' in a or 'data-earned' in a)
        )
        self.stack.append(hidden or (bool(self.stack) and self.stack[-1]))

    def handle_endtag(self, tag):
        if tag not in VOID and self.stack:
            self.stack.pop()

    def handle_data(self, data):
        if not (self.stack and self.stack[-1]):
            self.parts.append(data)


def visible_parts(html, skip_win=False, skip_quoted=False, skip_copied=False):
    p = TextParser(skip_win, skip_quoted, skip_copied)
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


INLINED = re.compile(r'/\*GP_(FLOW_CSS|FLOW_JS|BUILD_SHAPE)\*/.*?/\*GP_\1 end\*/', re.S)
SCAFFOLD = re.compile(r'/\*\s*scaffold:start\b.*?\*/(.*?)/\*\s*scaffold:end\s*\*/', re.S)
TEMPLATE = re.compile(r'<template\b[^>]*\bdata-gp-snapshot="([^"]*)"[^>]*>(.*?)</template>', re.S)


def repo_root():
    for d in Path(__file__).resolve().parents:
        if (d / 'docs/product-design.md').exists():
            return d
    sys.exit('check.py: docs/product-design.md not found above ' + str(Path(__file__).resolve()))


def product_file(root, path, line):
    """True when path:line is a real line in the repo (paths may be relative to gp-webapp or its app/)."""
    for base in (root, root / 'packages/gp-webapp', root / 'packages/gp-webapp/app'):
        f = base / path
        if f.is_file():
            return line <= len(f.read_text(errors='ignore').splitlines())
    return False


def lint(flow):
    """scripts/flow/lint.mjs on one flow file: (problems, markers)."""
    if not shutil.which('node'):
        return [f'{flow.name}: node not found, so the flow was not checked'], []
    run = subprocess.run(['node', str(Path(__file__).resolve().parent / 'flow/lint.mjs'), str(flow)], capture_output=True, text=True)
    if run.returncode:
        return [f'{flow.name}: lint.mjs failed: {run.stderr.strip()[:300]}'], []
    out = json.loads(run.stdout)
    return [f'flow/{flow.name}:{p["line"]}: {p["message"]}' for p in out['problems']], out['markers']


def scaffold_ok(page_css):
    """True when the page's scaffold matches one template's, whitespace aside."""
    mine = SCAFFOLD.search(page_css)
    if not mine:
        return False
    norm = lambda s: ' '.join(s.split())
    for t in (Path(__file__).resolve().parent.parent / 'assets').glob('page-template*.html'):
        theirs = SCAFFOLD.search(t.read_text())
        if theirs and norm(theirs.group(1)) == norm(mine.group(1)):
            return True
    return False


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
    attrs = re.findall(r'\b(?:aria-label|placeholder|title|alt|data-gp-label)="([^"]*)"', attr_html)
    text += ' ' + ' '.join(attrs)
    problems = []
    one_design = re.search(r'<main\b[^>]*\bdata-design="one"', html) is not None

    build = index.resolve().parent.parent / 'build'
    src = index.resolve().parent / 'src.html'
    skip = index.resolve().parent.parent / 'no-build-shape.txt'
    skip_reason = skip.read_text().strip() if skip.exists() else ''
    # An empty build/ (made up front, then skipped) doesn't override the skip note.
    has_build = build.is_dir() and any(build.glob('option-*.html'))
    if not skip_build_shape and not has_build and not skip_reason:
        problems.append(
            f'no build shapes: run build-shape in UX mode, or write {skip} '
            'with one line on why this has no system change'
        )
    if has_build and not skip_build_shape:
        src_html = src.read_text() if src.exists() else ''
        if not src_html:
            problems.append(f'{build} exists but {src} is missing; build shapes are hashed against src.html')
        for oid in OPTION_IDS:
            current = option_hash(src_html, oid, src)
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

    for pat, label in BANNED:
        if one_design and label in RECOMMEND_LABELS:
            continue
        for m in re.finditer(pat, text, flags=re.I):
            ctx = text[max(0, m.start() - 30):m.end() + 30].replace('\n', ' ')
            problems.append(f'{label}: ...{ctx}...')
    for word in copy_doc_words():
        # Inflected forms count: "empowered" is "empower".
        for m in re.finditer(r'\b' + re.escape(word) + r'(?:s|es|d|ed|ing|ment|ments)?\b', text, flags=re.I):
            ctx = text[max(0, m.start() - 30):m.end() + 30].replace('\n', ' ')
            problems.append(f'"{word}" (docs/product-copy.md, Words we do not use): ...{ctx}...')
    serve_text = visible_text(html, skip_win=True, skip_quoted=True)
    for pat in SERVE_BANNED:
        if re.search(pat, serve_text, flags=re.I):
            problems.append(f'found {pat} outside a data-product="win" block; wrong on a Serve screen')
    if '!' in text:
        problems.append('exclamation point in copy')
    # A text node that is only "Drafting your email..." is the bare loading line product-design.md section 6 bans.
    # Text copied from the product (data-source) or earned is the product's own label, not a new line.
    for part in visible_parts(html, skip_quoted=True, skip_copied=True):
        line = part.strip()
        if re.fullmatch(r"[A-Z][a-z]+ing\b[^.!?\n]{0,40}(?:…|\.\.\.)", line):
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

    main_tag = re.search(r'<main\b[^>]*>', markup)
    product = re.search(r'\bdata-product="([^"]*)"', main_tag.group(0)) if main_tag else None
    if not product or product.group(1) not in ('win', 'serve', 'both'):
        problems.append('<main> needs data-product="win", "serve" or "both" (gp-design section 1; '
                        'reference/wireframe-build.md, "Win and Serve")')
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
        for bid, what in (('sends', 'Sends line'), ('appendix', 'Other states appendix'),
                          ('sources', 'Built from list (docs/product-design.md section 7)'),
                          ('drops', 'What changes from today list (docs/product-design.md section 7)'),
                          ('mutations', 'Mutations list (reference/wireframe-build.md, "Mutations")')):
            if f'id="{x}-{bid}"' not in section:
                problems.append(f'{oid}: no {what} id="{x}-{bid}"')
        for mount in ('head', 'flow', 'states'):
            if f'data-gp-{mount}="{oid}"' not in section:
                problems.append(f'{oid}: no <div data-gp-{mount}="{oid}"> where the template has it')
        flow = flow_file(src, oid)
        if not flow.exists():
            problems.append(f'{oid}: no flow file {flow} (copy assets/flow-template.tsx)')
        else:
            built = re.search(rf'data-gp-flow="{oid}"[^>]*\bdata-gp-built="(sha256:[0-9a-f]+)"', section)
            current = 'sha256:' + hashlib.sha256(flow.read_bytes()).hexdigest()
            if not built or built.group(1) != current:
                problems.append(f'{oid}: index.html was not built from the current {flow.name}: rerun build.py')
            if not re.search(rf'data-gp-snapshot="{oid} screen entry"', section):
                problems.append(f'{oid}: no snapshot of the entry screen in index.html: rerun build.py')
            flow_problems, markers = lint(flow)
            problems += [f'{oid}: {p}' for p in flow_problems]
            # Every mutation and gap marker is quoted in the Mutations list.
            listed = ' '.join(visible_text(element_html(section, f'{x}-mutations') or '').split()).lower()
            for m in markers:
                if m['kind'] in ('product', 'no-component', 'gap') and ' '.join(m['text'].split()).lower() not in listed:
                    problems.append(f'{oid}: flow/{flow.name}:{m["line"]}: the {m["kind"]} marker "{m["text"]}" has no row '
                                    f'in #{x}-mutations quoting it')
            # A proposal goes through docs/product-design.md section 7: an existing C-xx entry in
            # docs/product-design-gaps.md, or a question for #tmp-design-agent under Decisions needed.
            asked = ' '.join(visible_text(element_html(html, 'questions') or '').split()).lower()
            gaps_doc = (repo_root() / 'docs' / 'product-design-gaps.md').read_text(encoding='utf-8')
            for m in markers:
                if m['kind'] not in ('no-component', 'gap'):
                    continue
                prop = re.search(r';\s*proposes\s+(.+)$', m['text'], flags=re.S)
                if not prop:
                    continue
                what = ' '.join(prop.group(1).split()).rstrip('.').strip()
                ids = re.findall(r'\bC-\d+\b', what)
                if ids:
                    for cid in ids:
                        if not re.search(rf'\b{cid}\b', gaps_doc):
                            problems.append(f'{oid}: flow/{flow.name}:{m["line"]}: {cid} is not in docs/product-design-gaps.md')
                elif what.lower() not in asked:
                    problems.append(f'{oid}: flow/{flow.name}:{m["line"]}: the proposal "{what}" is not under Decisions '
                                    f'(#questions); a new component goes to #tmp-design-agent first (docs/product-design.md section 7)')
        # Every inert control (data-inert="<name>") is named in a Built from row "Not part of this change".
        rows = re.findall(r'<tr\b[^>]*>(.*?)</tr>', element_html(section, f'{x}-sources') or '', flags=re.S)
        not_part = ' '.join(' '.join(visible_text(r).split()).lower() for r in rows
                            if 'not part of this change' in visible_text(r).lower())
        for name in sorted(set(re.findall(r'\bdata-inert="([^"]*)"', strip_sections(strip_markup(section), 'build-shape')))):
            name = ' '.join(htmllib.unescape(name).split())
            if not name:
                problems.append(f'{oid}: data-inert="" needs the control\'s name as its Built from row says it')
            elif name.lower() not in not_part:
                problems.append(f'{oid}: data-inert="{name}" is not named in a Built from row "Not part of this change" '
                                f'in #{x}-sources (reference/wireframe-build.md, "Every option must have")')

    styles = '\n'.join(re.findall(r'<style\b[^>]*>(.*?)</style>', html, flags=re.S | re.I))
    page_css = INLINED.sub('', styles)
    if not scaffold_ok(page_css):
        problems.append('the scaffold (/* scaffold:start */ to /* scaffold:end */) differs from the template\'s; keep it as the template has it')
    own_css = SCAFFOLD.sub('', page_css)
    for sel, _ in re.findall(r'([^{}<>]+)\{([^{}]*)\}', re.sub(r'/\*.*?\*/', '', own_css, flags=re.S)):
        if re.search(r'data-gp-|gp-frame|\[data-slot', sel):
            problems.append(f'page CSS "{sel.strip()[:60]}" reaches into the design; draw it in the flow file instead')
    own_style_attrs = ';'.join(re.findall(r'\bstyle="([^"]*)"', TEMPLATE.sub('', markup)))
    css_all = re.sub(r'/\*.*?\*/', '', styles, flags=re.S)
    defs = {}
    for name, val in re.findall(r'(--[\w-]+)\s*:\s*([^;{}]*)', css_all):
        defs.setdefault(name, []).append(val)
    todo = [n for prop, val in re.findall(r'(?<![\w-])([a-z][\w-]*)\s*:\s*([^;{}]*)', re.sub(r'/\*.*?\*/', '', page_css, flags=re.S) + ';' + own_style_attrs)
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

    # data-earned="shipped <path>:<line>" earns secondary text copied as shipped; the line must exist.
    for earned in re.findall(r'\bdata-earned="shipped\s+(\S+):(\d+)\s*"', markup):
        if not product_file(repo_root(), earned[0], int(earned[1])):
            problems.append(f'data-earned="shipped {earned[0]}:{earned[1]}" is not a line in the repo')
    for m in re.finditer(r'<svg\b[^>]*>(.*?)</svg>', markup, flags=re.S | re.I):
        if not re.search(r'<(path|circle|rect|line|polyline|polygon|ellipse)\b', m.group(1)):
            problems.append('blank icon: <svg> with no shapes')
    if re.search(r'id="option-d"', html):
        problems.append('more than three options')
    if '<iframe' in markup.lower():
        problems.append('iframe (the Vercel comment toolbar cannot see inside)')
    if re.search(r'href=["\']#["\']', markup):
        problems.append('href="#" dead link')
    if re.search(r'href=["\']mailto:', markup):
        problems.append('mailto link (use an in-page panel)')
    for url in re.findall(r'(?:src|href)=["\'](https?://[^"\']+)', markup):
        problems.append(f'external request: {url}')
    own_js = INLINED.sub('', '\n'.join(re.findall(r'<script\b[^>]*>(.*?)</script>', html, flags=re.S | re.I)))
    if re.search(r'\b(fetch|XMLHttpRequest)\s*\(', own_js):
        problems.append('network call in script')

    page_only = TEMPLATE.sub('', markup)
    ids = re.findall(r'\bid="([^"]+)"', page_only)
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        problems.append(f'duplicate id: {dup}')
    for key, body in TEMPLATE.findall(markup):
        inner = re.findall(r'\bid="([^"]+)"', body)
        for dup in sorted({i for i in inner if inner.count(i) > 1}):
            problems.append(f'duplicate id in {key}: {dup}')
        clash = sorted(set(inner) & set(ids))
        if clash:
            problems.append(f'{key} reuses page ids: {", ".join(clash)}')
    for target in re.findall(r'href="#([^"]+)"', page_only):
        if target not in ids:
            problems.append(f'link to missing id: #{target}')
    if len(html) > 5 * 1024 * 1024:
        problems.append('page over 5 MB')

    if problems:
        # One line per problem, with a count when the same one repeats (a hidden
        # popover rendered on every screen).
        counts = {}
        for p in problems:
            counts[p] = counts.get(p, 0) + 1
        print('\n'.join(f'- {p}' + (f' (x{n})' if n > 1 else '') for p, n in counts.items()))
        sys.exit(1)
    print('ok')


if __name__ == '__main__':
    main()
