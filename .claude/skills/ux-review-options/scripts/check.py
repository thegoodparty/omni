#!/usr/bin/env python3
"""Catch what review misses: banned words, dead links, external requests, and a
missing brief, open questions list, entry screen, Sends line, phone frame,
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

Each option has a phone flow (data-flow="phone") and a desktop flow
(data-flow="desktop") with a screen for every data-step of the phone flow. The
desktop flow is never embedded in the page: it sits inside an element with
class "desktop-flow", which the template hides on the page. Each option has a
"Desktop preview" link to ?view=desktop (?view=desktop&option=x on the options
page) with target="_blank". None of these checks depend on where the brief sits
on the page.

Mutations and hardcode (reference/wireframe-build.md, "Mutations"; the
plain-HTML side of check:design-system in packages/gp-webapp). The page's own
CSS is every <style> rule outside the blocks build.py inlines and outside the
template's scaffold, which must match a template's byte for byte (whitespace
aside). A page rule or style="" that sets a visual property (color,
background, border, radius, shadow, type, opacity; height and padding on a
sized control) on a gp-* element, or overrides a gp-* selector, needs a
/* mutation: product <path>:<line> */ or /* mutation: no-component
<closest>; proposes <what> */ marker (data-mutation="..." on a style=""
element), and each marker needs a row in its option's #<x>-mutations block
quoting the marker after its kind. A gp-* class gp-ui.css doesn't have is a
port: its visual rules carry /* port: <styleguide .tsx path> */, and any text
after the path and a space is a note. A page rule or style="" that sets a
visual property on an element inside an option's frame with no gp-* class
needs a marker too: /* mutation: product <path>:<line> */, /* port: <styleguide
.tsx path> */ or /* gap: <what>; proposes <component or C-xx> */ (on a
style="", data-mutation="product ...", "port ..." or "gap ..."); product and
gap markers need a Mutations row. Layout-only rules, the scaffold and content
rules (below) are free. In the page's
own CSS and in any style="", hex, rgb(), hsl() and named colors, a font size
off the "One type scale" line in docs/product-design.md section 8, and a radius
that isn't a radius token, 0, 9999px or 50% always fail, mutation marker or not.
The one exception is rendered content a look-and-feel ticket is about (an email
canvas): inside an element marked data-content="<what>", with no gp-* element
from that region down, a rule carrying /* content: <repo path>:<line> */ (or a
style="" whose element carries data-content-source="<path>:<line>") may use a
literal color, font size or radius when that line's text contains the value
(case-insensitive; sizes and radii match as whole numbers). Product chrome and
gp-* components never qualify. Inside an option, every <svg> carries data-icon="<Name>" from the styleguide's icons.tsx
(the heart logo carries data-logo="heart"), and every <button>, <input>,
<select> and <textarea> carries a gp-* class (a radio or checkbox inside
gp-choice is exempt).

<main> carries data-product="win", "serve" or "both". Every data-inert="<name>"
(a control the change doesn't touch) is named in a #<x>-sources row that says
"Not part of this change". data-earned="shipped <path>:<line>" must point at a
real line.

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


ALLOWED_TEMPLATE_TEXT = {'Restart', 'Phone', 'Desktop preview', 'Back', 'Office', 'Other states', 'Built from', 'What changes from today', 'Mutations'}


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


INLINED = re.compile(r'/\*GP_(TOKENS|UI|BUILD_SHAPE)\*/.*?/\*GP_\1 end\*/', re.S)
SCAFFOLD = re.compile(r'/\*\s*scaffold:start\b.*?\*/(.*?)/\*\s*scaffold:end\s*\*/', re.S)
MUTATION = re.compile(r'/\*\s*mutation:(.*?)\*/', re.S)
CONTENT = re.compile(r'/\*\s*content:\s*(\S+?):(\d+)\s*\*/')
# The path, then any note after whitespace: /* port: <path> - <note> */.
PORT = re.compile(r'/\*\s*port:\s*([^\s*]+)[^*]*\*/')
GAP = re.compile(r'/\*\s*gap:(.*?)\*/', re.S)
VISUAL_PROP = re.compile(r'(?:color|background(?:-[a-z]+)?|border(?!-collapse|-spacing)(?:-[a-z-]+)?|outline(?:-[a-z]+)?|box-shadow|text-shadow'
                         r'|font(?:-[a-z]+)?|line-height|letter-spacing|text-transform|text-decoration(?:-[a-z]+)?|opacity|fill|stroke)')
SIZE_PROP = re.compile(r'(?:height|min-height|padding(?:-[a-z]+)?)')
# The gp-ui.css twins of check:design-system's SIZED_COMPONENTS, plus the pill and tab controls with a fixed height.
SIZED = {'gp-btn', 'gp-input', 'gp-textarea', 'gp-select', 'gp-badge', 'gp-pill', 'gp-filter-pill',
         'gp-toggle-group__item', 'gp-tabs__trigger'}
COLOR_PROP = re.compile(r'color|background|border|outline|shadow|fill|stroke|decoration|column-rule')
NAMED_COLORS = ('white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|navy|teal|maroon|olive|lime|aqua'
                '|fuchsia|brown|gold|beige|ivory|indigo|violet|cyan|magenta|coral|salmon|tomato|crimson|khaki|lavender'
                '|plum|orchid|tan|turquoise|wheat|snow|linen|whitesmoke|gainsboro|lightgray|lightgrey|darkgray|darkgrey'
                '|dimgray|dimgrey|slategray|slategrey|skyblue|steelblue|royalblue|dodgerblue|tomato|firebrick|seagreen')
RADIUS_OK = {'0', '0px', '9999px', '50%', 'inherit', 'initial', 'unset'}


def repo_root():
    for d in Path(__file__).resolve().parents:
        if (d / 'docs/product-design.md').exists():
            return d
    sys.exit('check.py: docs/product-design.md not found above ' + str(Path(__file__).resolve()))


def type_scale(root):
    """The px sizes on the "One type scale" line of docs/product-design.md section 8."""
    m = re.search(r'One type scale: ([\d, and]+)px', (root / 'docs/product-design.md').read_text())
    if not m:
        sys.exit('check.py: no "One type scale: ...px" line in docs/product-design.md section 8')
    return {float(n) for n in re.findall(r'\d+', m.group(1))}


def approved_icons(root):
    """Every name icons.tsx exports, both the lucide name and its Icon alias, plus AiIcon."""
    ui = root / 'packages/styleguide/src/components/ui'
    names = {n for pair in re.findall(r'\b(\w+)\s+as\s+(\w+Icon)\b', (ui / 'icons.tsx').read_text()) for n in pair}
    if (ui / 'ai-icon.tsx').exists():
        names.add('AiIcon')
    return names


def decls(body):
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
    return [(p.lower(), v.replace('!important', '').strip()) for p, v in re.findall(r'([a-zA-Z-]+)\s*:\s*([^;]+)', body)]


def hardcoded(prop, val, scale):
    """(why this declaration hardcodes a value a token or the type scale owns, the literal values a
    content marker's line must contain to excuse it), or None."""
    colors = re.findall(r'#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^)]*\)', val)
    if colors:
        return 'hardcoded color (use a var(--token))', colors
    named = re.findall(rf'(?<![-\w])(?:{NAMED_COLORS})(?![-\w])', val, flags=re.I) if COLOR_PROP.search(prop) else []
    if named:
        return 'named color (use a var(--token))', named
    if prop in ('font-size', 'font') and 'var(' not in val:
        size = val if prop == 'font-size' else val.split('/')[0]
        for n, unit in re.findall(r'(\d*\.?\d+)(px|rem|em|%)', size):
            px = float(n) * (16 if unit == 'rem' else 1)
            if (unit in ('px', 'rem') and px not in scale) or (unit in ('em', '%') and float(n) not in (1, 100)):
                return f'font size {n}{unit} is off the type scale (docs/product-design.md section 8)', [n]
    if re.fullmatch(r'border(?:-[a-z]+)*-radius', prop):
        for part in re.findall(r'var\([^)]*\)|[^\s/]+', val):
            if not ((part.startswith('var(') and 'radius' in part) or part in RADIUS_OK):
                return f'radius {part} (use a radius token, 0, 9999px or 50%)', [re.sub(r'px$', '', part)]
    return None


def source_line(root, path, line):
    """The text of path:line in the repo (paths may be relative to gp-webapp or its app/), or None."""
    for base in (root, root / 'packages/gp-webapp', root / 'packages/gp-webapp/app'):
        f = base / path
        if f.is_file():
            lines = f.read_text(errors='ignore').splitlines()
            return lines[line - 1] if 1 <= line <= len(lines) else None
    return None


def content_excuses(root, refs, needles):
    """Why the content markers refs [(path, line)] fail to cover needles, or None when every literal
    value sits on one of their lines (case-insensitive; numbers match as whole numbers)."""
    texts = [source_line(root, p, int(n)) for p, n in refs]
    for (p, n), t in zip(refs, texts):
        if t is None:
            return f'content marker points at {p}:{n}, which is not a line in the repo'
    for needle in needles:
        pat = rf'(?<![\d.]){re.escape(needle)}(?![\d.])' if re.fullmatch(r'[\d.]+', needle) else re.escape(needle)
        if not any(re.search(pat, t, flags=re.I) for t in texts):
            return f'{needle} is not on {", ".join(f"{p}:{n}" for p, n in refs)}'
    return None


def in_content(path):
    """True when the element sits inside a data-content region with no gp-* element from the region down."""
    start = next((i for i, n in enumerate(path) if 'data-content' in n[3]), None)
    return start is not None and not any(c.startswith('gp-') for n in path[start:] for c in n[1])


def parse_mutation(text):
    """(kind, what the Mutations row must quote, product path or None), or None when malformed."""
    text = ' '.join(text.split())
    m = re.fullmatch(r'product (\S+):(\d+)', text)
    if m:
        return 'product', f'{m.group(1)}:{m.group(2)}', (m.group(1), int(m.group(2)))
    m = re.fullmatch(r'no-component (\S.*?); proposes (\S.*)', text)
    if m:
        return 'no-component', text[len('no-component '):], None
    m = re.fullmatch(r'gap:? ?(\S.*?; proposes \S.*)', text)
    if m:
        return 'gap', m.group(1), None
    return None


def port_ok(root, text):
    """True when text carries a port marker naming a styleguide component file."""
    port = PORT.search(text)
    path = port and port.group(1).rstrip(',;:')
    return bool(path and 'packages/styleguide/src/components' in path and (root / path).is_file())


def product_file(root, path, line):
    """True when path:line is a real line in the repo (paths may be relative to gp-webapp or its app/)."""
    for base in (root, root / 'packages/gp-webapp', root / 'packages/gp-webapp/app'):
        f = base / path
        if f.is_file():
            return line <= len(f.read_text(errors='ignore').splitlines())
    return False


class Tree(HTMLParser):
    """Every element as its path from the root: a list of (tag, classes, id, attrs)."""
    def __init__(self):
        super().__init__()
        self.stack = []
        self.paths = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        node = (tag, set((a.get('class') or '').split()), a.get('id'), a)
        self.paths.append(self.stack + [node])
        if tag not in VOID:
            self.stack.append(node)

    def handle_endtag(self, tag):
        if any(n[0] == tag for n in self.stack):
            while self.stack and self.stack.pop()[0] != tag:
                pass


def element_paths(markup):
    t = Tree()
    t.feed(markup)
    return t.paths


def compound(token):
    tag = re.match(r'[a-zA-Z][\w-]*', token)
    eid = re.findall(r'#([\w-]+)', token)
    return (tag.group(0).lower() if tag else None, set(re.findall(r'\.([\w-]+)', token)), eid[0] if eid else None)


def selector_chains(sel):
    """Each comma part of a selector as [(combinator, compound)], the styled element last. Context
    before a sibling combinator is dropped; attribute and pseudo parts match anything."""
    sel = re.sub(r'\[[^\]]*\]', '*', sel)
    while re.search(r'\([^()]*\)', sel):
        sel = re.sub(r'\([^()]*\)', '', sel)
    for part in sel.split(','):
        part = re.sub(r'\s*([>+~])\s*', r' \1 ', re.sub(r'::?[\w-]+', '', part).strip())
        chain, comb = [], ' '
        for tok in part.split():
            if tok in ('>', '+', '~'):
                comb = tok
                continue
            if comb in ('+', '~'):
                chain = []
            chain.append((comb if chain else None, compound(tok)))
            comb = ' '
        if chain:
            yield chain


def matches(node, comp):
    tag, classes, eid = comp
    return (not tag or tag == node[0]) and classes <= node[1] and (not eid or eid == node[2])


def chain_matches(path, chain):
    def at(ci, pi):
        comb, comp = chain[ci]
        if not matches(path[pi], comp):
            return False
        if ci == 0:
            return True
        if comb == '>':
            return pi > 0 and at(ci - 1, pi - 1)
        return any(at(ci - 1, k) for k in range(pi - 1, -1, -1))
    tag, classes, eid = chain[-1][1]
    return bool(tag or classes or eid) and at(len(chain) - 1, len(path) - 1)


class RawControls(HTMLParser):
    """<button>, <input>, <select> and <textarea> with no gp-* class, outside a gp-choice row's own input."""
    def __init__(self):
        super().__init__()
        self.stack = []
        self.found = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = (a.get('class') or '').split()
        if tag in ('button', 'input', 'select', 'textarea') and not any(c.startswith('gp-') for c in cls):
            in_choice = any('gp-choice' in s for s in self.stack)
            if not (a.get('type') == 'hidden' or (in_choice and a.get('type') in ('radio', 'checkbox'))):
                self.found.append(self.get_starttag_text())
        if tag not in VOID:
            self.stack.append(cls)

    def handle_endtag(self, tag):
        if tag not in VOID and self.stack:
            self.stack.pop()


def mutation_problems(html, markup, styles, oids):
    root = repo_root()
    scale = type_scale(root)
    icons = approved_icons(root)
    problems = []
    # Every gp-* name gp-ui.css styles or shows in its markup notes is a shipped component class.
    known = set(re.findall(r'(?<![\w-])(gp-[\w-]+)', (Path(__file__).resolve().parent.parent / 'assets/gp-ui.css').read_text()))
    page_css = INLINED.sub('', styles)
    scaffold = SCAFFOLD.search(page_css)
    if scaffold:
        norm = lambda t: ' '.join(t.split())
        templates = (Path(__file__).resolve().parent.parent / 'assets').glob('page-template*.html')
        if norm(scaffold.group(1)) not in {norm(m.group(1)) for t in templates for m in SCAFFOLD.finditer(t.read_text())}:
            problems.append('the page scaffold (/* scaffold:start */ to /* scaffold:end */) differs from the template: '
                            'copy it unchanged and put page rules after it')
        page_css = page_css[:scaffold.start()] + page_css[scaffold.end():]
    else:
        problems.append('no /* scaffold:start */ block: start the page from assets/page-template*.html')
    sections = {}
    for oid in oids:
        span = section_span(html, oid)
        if span:
            sections[oid[-1]] = strip_sections(strip_markup(html[span[0]:span[2]]), 'build-shape')
    paths = element_paths(strip_sections(markup, 'build-shape'))
    option_of = lambda path: next((n[2][-1] for n in path if n[2] in [f'option-{x}' for x in sections]), None)
    needed = {}  # option letter -> [(what the row quotes, where)]

    in_frame = lambda path: option_of(path) and any('frame' in n[1] for n in path)

    def check_plain(text, where, xs, visual, mutation=None):
        """A visual rule on elements inside a frame with no gp-* class: product, port or gap marker."""
        m = MUTATION.search(text)
        mutation = mutation or (m and m.group(1))
        gap = GAP.search(text)
        if mutation and not mutation.strip().startswith('port '):
            if (parse_mutation(mutation) or ('',))[0] == 'no-component':
                problems.append(f'{where} has no gp-* class, so it is not a component mutation: '
                                'mark it product, port or gap (reference/wireframe-build.md, "Mutations")')
            else:
                check_marker(mutation, where, xs)
        elif gap:
            check_marker('gap ' + ' '.join(gap.group(1).split()), where, xs)
        elif not port_ok(root, text if not mutation else '/* port: ' + mutation.strip()[5:] + ' */'):
            problems.append(f'unmarked style: {where} sets {", ".join(visual)} inside the frame with no gp-* class; '
                            'mark it product, port or gap (reference/wireframe-build.md, "Mutations") or drop it')

    def check_marker(text, where, xs):
        parsed = parse_mutation(text)
        if not parsed:
            problems.append(f'malformed mutation marker in {where}: use "product <path>:<line>", '
                            '"no-component <closest component>; proposes <variant, new component or C-xx>" or '
                            '"gap <what>; proposes <component or C-xx>"')
            return
        kind, quote, product = parsed
        if product and not product_file(root, *product):
            problems.append(f'mutation marker in {where} points at {quote}, which is not a line in the repo')
        for x in xs or list(sections)[:1]:
            needed.setdefault(x, []).append((quote, where))

    for sel, body in re.findall(r'([^{}]*)\{([^{}]*)\}', page_css):
        clean = re.sub(r'/\*.*?\*/', '', sel, flags=re.S).strip()
        if not clean or clean.startswith('@') or ':root' in clean:
            continue
        ds = decls(body)
        chains = list(selector_chains(clean))
        hit = [path for path in paths if any(chain_matches(path, c) for c in chains)]
        direct = {c for chain in chains for c in chain[-1][1][1] if c.startswith('gp-')}
        # A rule on a component's plain children (.gp-table th, .gp-dl dt) mutates that component.
        direct |= {c for chain in chains for _, comp in chain[:-1] for c in comp[1] if c in known}
        refs = CONTENT.findall(sel + body)
        content = bool(refs and hit and not direct and all(in_content(path) for path in hit))
        for prop, val in ds:
            found = hardcoded(prop, val, scale)
            if not found:
                continue
            why, needles = found
            if not refs:
                problems.append(f'{why}: "{clean[:50]}" {prop}: {val}')
            elif not content:
                problems.append(f'{why}: "{clean[:50]}" {prop}: {val}; a content marker covers only elements inside a '
                                'data-content region with no gp-* element (reference/wireframe-build.md, "Mutations")')
            else:
                bad = content_excuses(root, refs, needles)
                if bad:
                    problems.append(f'{why}: "{clean[:50]}" {prop}: {val}; {bad}')
        gp = direct | {c for path in hit for c in path[-1][1] if c.startswith('gp-')}
        visual = [p for p, _ in ds if VISUAL_PROP.fullmatch(p) or (SIZE_PROP.fullmatch(p) and gp & SIZED)]
        where = f'"{clean[:50]}"'
        if visual and not gp and not content:
            framed = [path for path in hit if in_frame(path)]
            if framed:
                check_plain(sel + body, where, sorted({option_of(path) for path in framed}), visual)
            continue
        if not (gp and visual):
            continue
        xs = sorted({option_of(path) for path in hit} - {None})
        marker = MUTATION.search(sel + body)
        if gp & known:
            if not marker:
                named = (direct & known) or (gp & known)
                problems.append(f'unmarked mutation: {where} sets {", ".join(visual)} on {", ".join(sorted(named))}; '
                                'mark it (reference/wireframe-build.md, "Mutations") or drop it')
                continue
            check_marker(marker.group(1), where, xs)
        elif marker:
            check_marker(marker.group(1), where, xs)
        else:
            if not port_ok(root, sel + body):
                problems.append(f'{where} styles {", ".join(sorted(gp))}, which gp-ui.css does not have: name the component it '
                                'ports with /* port: packages/styleguide/src/components/ui/<name>.tsx */')

    for path in paths:
        attrs = path[-1][3]
        style = attrs.get('style')
        if not style:
            continue
        src = re.fullmatch(r'\s*(\S+?):(\d+)\s*', attrs.get('data-content-source') or '')
        for prop, val in decls(style):
            found = hardcoded(prop, val, scale)
            if not found:
                continue
            why, needles = found
            if not src:
                problems.append(f'{why}: style="{style[:60]}"')
            elif not in_content(path):
                problems.append(f'{why}: style="{style[:60]}"; data-content-source covers only elements inside a '
                                'data-content region with no gp-* element (reference/wireframe-build.md, "Mutations")')
            else:
                bad = content_excuses(root, [src.groups()], needles)
                if bad:
                    problems.append(f'{why}: style="{style[:60]}"; {bad}')
    for path in paths:
        x, attrs = option_of(path), path[-1][3]
        style = attrs.get('style')
        if not (x and style):
            continue
        gp = sorted(c for c in path[-1][1] if c.startswith('gp-'))
        visual = [p for p, _ in decls(style) if VISUAL_PROP.fullmatch(p) or (SIZE_PROP.fullmatch(p) and set(gp) & SIZED)]
        if not visual:
            continue
        where = f'style="{style[:40]}"'
        if not gp:
            if in_frame(path) and not (attrs.get('data-content-source') and in_content(path)):
                check_plain('', where, [x], visual, attrs.get('data-mutation'))
        elif not attrs.get('data-mutation'):
            problems.append(f'unmarked mutation: style="{style[:50]}" sets {", ".join(visual)} on {", ".join(gp)}; '
                            'add data-mutation (reference/wireframe-build.md, "Mutations") or drop it')
        else:
            check_marker(attrs['data-mutation'], where, [x])
    for x, sec in sections.items():
        for m in re.finditer(r'<svg\b[^>]*>', sec, flags=re.I):
            if 'data-logo="heart"' in m.group(0):
                continue
            name = re.search(r'\bdata-icon="([^"]*)"', m.group(0))
            if not name or name.group(1) not in icons:
                problems.append(f'option-{x}: <svg> needs data-icon="<Name>" from packages/styleguide/src/components/ui/icons.tsx'
                                f' (got {name.group(1) if name else "none"}): {m.group(0)[:60]}')
        raw = RawControls()
        raw.feed(sec)
        for tag in raw.found:
            problems.append(f'option-{x}: raw {tag[:60]} without a gp-* class (use the gp-ui.css component)')

    for x, rows in needed.items():
        block = element_html(html, f'{x}-mutations')
        text = ' '.join(visible_text(block).split()) if block else ''
        for quote, where in rows:
            if ' '.join(quote.split()) not in text:
                problems.append(f'option-{x}: the mutation in {where} has no row in #{x}-mutations quoting "{quote}"')
    return problems


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
        if f'id="{x}-mutations"' not in section:
            problems.append(f'{oid}: no Mutations list id="{x}-mutations" (reference/wireframe-build.md, "Mutations")')
        # Every inert control (data-inert="<name>") is named in a Built from row "Not part of this change".
        rows = re.findall(r'<tr\b[^>]*>(.*?)</tr>', element_html(section, f'{x}-sources') or '', flags=re.S)
        not_part = ' '.join(' '.join(visible_text(r).split()).lower() for r in rows
                            if 'not part of this change' in visible_text(r).lower())
        for name in re.findall(r'\bdata-inert="([^"]*)"', strip_sections(strip_markup(section), 'build-shape')):
            name = ' '.join(name.split())
            if not name:
                problems.append(f'{oid}: data-inert="" needs the control\'s name as its Built from row says it')
            elif name.lower() not in not_part:
                problems.append(f'{oid}: data-inert="{name}" is not named in a Built from row "Not part of this change" '
                                f'in #{x}-sources (reference/wireframe-build.md, "Every option must have")')
        main_flow = strip_markup(section).split(f'id="{x}-appendix"', 1)[0]
        frames = re.findall(r'<div[^>]*class="(?:[^"]*\s)?frame(?:\s[^"]*)?"[^>]*>', main_flow)
        if not frames:
            problems.append(f'{oid}: no wireframe frame')
        for f in frames:
            if 'frame--phone' not in f and 'data-desktop-reason=' not in f:
                problems.append(f'{oid}: desktop frame without data-desktop-reason (phone first)')
        flows = {}
        for m in re.finditer(r'<(\w+)\b[^>]*\bdata-flow="(phone|desktop)"[^>]*>', main_flow):
            flows.setdefault(m.group(2), []).append(element_at(main_flow, m))
        if not flows.get('phone'):
            problems.append(f'{oid}: no data-flow="phone" on the phone frame (?view=phone shows it)')
        if not flows.get('desktop'):
            problems.append(f'{oid}: no data-flow="desktop" flow (every design has one, ?view=desktop shows it)')
        steps = lambda kind: {s for b in flows.get(kind, []) for s in re.findall(r'\bdata-step="([^"]+)"', b)}
        missing = sorted(steps('phone') - steps('desktop'))
        if flows.get('desktop') and missing:
            problems.append(f'{oid}: the desktop flow has no screen for data-step ' + ', '.join(missing))
        # The desktop flow shows only in ?view=desktop: on the page it sits inside .desktop-flow, which is hidden.
        for path in element_paths(strip_sections(main_flow, 'build-shape')):
            if path[-1][3].get('data-flow') == 'desktop' and not any('desktop-flow' in n[1] for n in path):
                problems.append(f'{oid}: the desktop flow is embedded in the page; put it inside <div class="desktop-flow"> '
                                'as the template does, so only ?view=desktop shows it')
        want = '?view=desktop' if one_design else f'?view=desktop&option={x}'
        previews = [a for a, body in re.findall(r'<a\b([^>]*)>(.*?)</a>', strip_sections(strip_markup(section), 'build-shape'), flags=re.S)
                    if ' '.join(visible_text(body).split()) == 'Desktop preview']
        href = lambda a: (re.search(r'\bhref="([^"]*)"', a) or re.search('()', '')).group(1).replace('&amp;', '&')
        if not previews:
            problems.append(f'{oid}: no "Desktop preview" link ({want}) beside Restart')
        elif not any(href(a) == want for a in previews):
            problems.append(f'{oid}: the "Desktop preview" link must open {want}')
        elif not any(href(a) == want and re.search(r'\btarget="_blank"', a) for a in previews):
            problems.append(f'{oid}: the "Desktop preview" link needs target="_blank" rel="noopener" (it opens in a new tab)')
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
    muted_classes = {'muted', 'gp-text--muted', 'gp-caption'}
    for sel, body in re.findall(r'([^{}<>]+)\{([^{}]*)\}', re.sub(r'/\*.*?\*/', '', styles, flags=re.S)):
        for val in re.findall(r'(?<![-\w])color\s*:\s*([^;}]+)', body):
            if resolve(val.replace('!important', '').strip(), defs).lower() == muted:
                muted_classes.update(set(re.findall(r'(?:^|,)\s*\.([\w-]+)\s*(?=,|$)', sel.strip())) - gp_ui_classes)
    # data-earned="shipped <path>:<line>" earns secondary text copied as shipped; the line must exist.
    for earned in re.findall(r'\bdata-earned="shipped\s+(\S+):(\d+)\s*"', markup):
        if not product_file(repo_root(), earned[0], int(earned[1])):
            problems.append(f'data-earned="shipped {earned[0]}:{earned[1]}" is not a line in the repo')
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
    problems += mutation_problems(html, markup, styles, oids)
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
