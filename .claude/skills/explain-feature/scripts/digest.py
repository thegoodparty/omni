#!/usr/bin/env python3
"""Extract the bounded lists a scope pass must cover, from a Claude Design file.

The reasoning in /create-scope is unbounded — an agent finds four interesting
things and stops. These lists are what the reasoning gets checked against: every
entry must appear in the model or be explicitly excused.

Deliberately keyed on Claude Design conventions (the x-dc script, React
createElement, DS.* components, var(--token)) rather than on any one designer's
idioms, so it works across designs. Anything design-specific is surfaced as raw
vocabulary for the agent to interpret, never hardcoded here.

Usage: digest.py <design.dc.html> [--focus <prefix>[,<prefix>...]] [--json]

A feature usually spans several prefix groups (flow,rec). Pass them comma-separated.
"""
import json
import re
import sys
from collections import Counter

# ---------------------------------------------------------------- extraction

DC_SCRIPT = re.compile(r'<script[^>]*data-dc-script[^>]*>(.*?)</script>', re.S)


def source_of(path):
    raw = open(path, encoding='utf-8').read()
    m = DC_SCRIPT.search(raw)
    return m.group(1) if m else raw


def components(src):
    """DS components the design composes, with how often."""
    return Counter(re.findall(r'\bDS\.([A-Z]\w+)', src))


def tokens(src):
    """Design-system tokens referenced."""
    return Counter(re.findall(r'var\(\s*(--[a-z0-9-]+)\s*\)', src))


def methods(src):
    """The design's own vocabulary — its method names. Design-specific by
    nature, which is why they are surfaced rather than interpreted."""
    return sorted(set(re.findall(r'^\s{2}([a-z]\w{2,})\s*\(', src, re.M)))


def focus_src(src, focus):
    """Narrow the source to methods matching a focus prefix, so the coverage lists
    describe the feature rather than the whole file. Method bodies are delimited by
    the next two-space-indented method definition."""
    if not focus:
        return src
    prefixes = [f.strip().lower() for f in focus.split(',') if f.strip()]
    starts = [(m.start(), m.group(1)) for m in
              re.finditer(r'^\s{2}([a-z]\w{2,})\s*\(', src, re.M)]
    if not starts:
        return src
    keep = []
    for i, (pos, name) in enumerate(starts):
        if any(name.lower().startswith(p) for p in prefixes):
            end = starts[i + 1][0] if i + 1 < len(starts) else len(src)
            keep.append(src[pos:end])
    return '\n'.join(keep) if keep else src


def state_fields(src):
    """Everything the feature tracks. The finest-grained coverage list, and the
    one that catches internal work that boundary-first reasoning misses.

    Narrowed by --focus to the methods of one feature. Constants and literals stay
    file-wide, since top-level data lives outside any method."""
    # UNION across every state write, not just the largest one. State introduced
    # later via fset (paidFor, paidConfirm) is exactly the load-bearing kind, and
    # reading only the initialiser silently drops it.
    seen = []
    for m in re.finditer(r'(?:setState|this\.fset)\(\s*\{(.{10,3000}?)\}\s*\)', src, re.S):
        for k in re.findall(r'(?:^|[\s,{])([a-zA-Z_]\w*)\s*:', m.group(1)):
            if k not in seen:
                seen.append(k)
    return seen


def top_consts(src):
    """Top-level constants — the design's declared data and configuration."""
    return sorted(set(re.findall(r'^const ([A-Z][A-Z0-9_]{2,})\s*=', src, re.M)))


def feature_groups(src):
    """A design file usually holds several features. Method-name prefixes reveal
    the groupings, so a scope pass can be aimed at one of them rather than
    treating the whole file as a single feature."""
    names = methods(src)
    groups = Counter()
    for n in names:
        m = re.match(r'^([a-z]{2,8}?)(?=[A-Z])', n)
        groups[m.group(1) if m else n] += 1
    return [(k, v) for k, v in groups.most_common() if v >= 3]


def parameterisation(src):
    """Values a shared implementation branches on. Where a design serves several
    variants from one flow, each difference is either deliberate or an oversight
    — which is a far easier question than "what is missing?"."""
    hits = Counter(re.findall(r"\b\w*[Cc]hannel\w*\s*===?\s*'([a-z-]+)'", src))
    hits += Counter(re.findall(r"\bch\s*===?\s*'([a-z-]+)'", src))
    return hits


def sibling_diff(src, focus=None):
    """The highest-yield pass in a measured run, and previously unsupported: for a
    design that serves several variants from one implementation, show which
    variants each conditional names. A branch that names five of six siblings and
    omits yours is either deliberate or an oversight, which is a far easier
    question than "what is missing?"."""
    variants = set(re.findall(r"\bch\s*===?\s*'([a-z-]+)'", src))
    variants |= set(re.findall(r"\b\w*[Cc]hannel\w*\s*===?\s*'([a-z-]+)'", src))
    if len(variants) < 2:
        return []
    rows = []
    for m in re.finditer(r'^\s{2}([a-z]\w{2,})\s*\(', src, re.M):
        name, start = m.group(1), m.start()
        nxt = re.search(r'^\s{2}[a-z]\w{2,}\s*\(', src[start + 5:], re.M)
        body = src[start:start + 5 + (nxt.start() if nxt else 3000)]
        named = sorted(v for v in variants
                       if re.search(r"===?\s*'" + re.escape(v) + r"'", body))
        if 1 < len(named) < len(variants):
            rows.append({'method': name, 'names': named,
                         'omits': sorted(variants - set(named))})
    return rows


def literals(src):
    """Values the real product must produce. Most are sample data; the ones that
    matter are placeholders standing in for something with no source."""
    pats = {
        'phone': r'\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b',
        'money': r'\$\d[\d,]*(?:\.\d+)?',
        'email': r'\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b',
        'url': r'https?://[^\s"\'`)]+',
        'id': r'\b\d{2}-\d{7}\b',
    }
    return {k: sorted(set(re.findall(p, src))) for k, p in pats.items()}


def suspect_literals(src):
    """A hardcoded value sitting among interpolated ones, or inside a string
    with legal framing. Both mean: a production value nobody sourced."""
    val = (r'\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b|\$\d[\d,]*(?:\.\d+)?'
           r'|\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b|\b\d{2}-\d{7}\b')
    out = []
    for m in re.finditer(r'`[^`\n]{10,300}`', src):
        t = m.group(0)
        stripped = re.sub(r'\$\{[^}]*\}', '', t)
        found = re.findall(val, stripped)
        if not found:
            continue
        interpolated = '${' in t
        legal = bool(re.search(r'paid for by|required|by law|federal|disclaim|comply',
                               t, re.I))
        if interpolated or legal:
            out.append({
                'literal': found,
                'string': t.strip('`')[:150],
                'why': ('hardcoded among interpolated values' if interpolated
                        else 'inside a string with legal framing'),
            })
    return out


def copy_strings(src, limit=400):
    """User-visible copy — sentences, not identifiers or code fragments."""
    out = []
    for s in re.findall(r"'([^'\\\n]{12,140})'", src):
        if not (' ' in s and re.search(r'[a-z]', s)):
            continue
        if s.startswith(('var(', '--', 'http')):
            continue
        # code fragments leak in through comments and object literals
        if re.search(r'[{}();=<>]|:\s|\bconst\b|\bfunction\b|=>', s):
            continue
        if not re.match(r"^[A-Z0-9]", s):
            continue
        out.append(s)
    seen, uniq = set(), []
    for s in out:
        if s not in seen:
            seen.add(s)
            uniq.append(s)
    return uniq[:limit]


# ------------------------------------------------------------------- report

def build(path, focus=None):
    src = source_of(path)
    ms = methods(src)
    if focus:
        prefixes = [f.strip().lower() for f in focus.split(',') if f.strip()]
        ms = [m for m in ms if any(m.lower().startswith(p) for p in prefixes)]
    # Narrow the per-feature lists; keep declarations file-wide since constants and
    # top-level data live outside any method.
    fsrc = focus_src(src, focus)
    return {
        '_focus': focus,
        'source': path,
        'size': {'bytes': len(src), 'lines': src.count('\n') + 1},
        'components': components(fsrc).most_common(),
        'tokens': tokens(src).most_common(),
        'methods': ms,
        'feature_groups': feature_groups(src),
        'state_fields': state_fields(fsrc),
        'top_consts': [c for c in top_consts(src) if (c in fsrc or not focus)],
        'parameterisation': parameterisation(fsrc).most_common(),
        'sibling_diff': sibling_diff(src),
        'literals': literals(src),
        'suspect_literals': suspect_literals(src),
        'copy': copy_strings(fsrc),
    }


def render(d):
    L = []
    add = L.append
    add(f"# Design digest — {d['source']}")
    add(f"{d['size']['bytes']:,} bytes · {d['size']['lines']:,} lines\n")

    add("## Coverage lists — the model must account for every entry, or excuse it\n")

    add(f"### State fields ({len(d['state_fields'])})")
    add("Everything the feature tracks. The list that catches internal work.\n")
    add('  ' + ', '.join(d['state_fields']) + '\n')

    add(f"### Feature groups ({len(d['feature_groups'])})")
    add("A design file usually holds several features. Aim the scope pass at one "
        "group; do not treat the whole file as one feature.\n")
    add('  ' + ', '.join(f'{k}* ({n})' for k, n in d['feature_groups']) + '\n')

    add(f"### The design's own vocabulary ({len(d['methods'])} methods)")
    if d.get('_focus'):
        add(f"Filtered to `{d['_focus']}`.\n")
    add('  ' + ', '.join(d['methods']) + '\n')

    add(f"### Declared constants ({len(d['top_consts'])})")
    add('  ' + ', '.join(d['top_consts']) + '\n')

    if d['parameterisation']:
        add("### Parameterisation — one implementation, several variants")
        add("Each difference between variants is deliberate or an oversight.\n")
        add('  ' + ', '.join(f'{k} ({n})' for k, n in d['parameterisation']) + '\n')

    if d.get('sibling_diff'):
        add("### Sibling diff — where one implementation treats variants differently")
        add("Each omission is deliberate or an oversight. Ask which.\n")
        for r in d['sibling_diff'][:24]:
            add(f"- `{r['method']}` handles {', '.join(r['names'])} "
                f"— **omits {', '.join(r['omits'])}**")
        add("")

    add("## Values the real product must produce\n")
    for k, v in d['literals'].items():
        if v:
            shown = ', '.join(v[:6]) + (' …' if len(v) > 6 else '')
            add(f"- **{k}** — {len(v)} distinct: {shown}")
    add("")

    if d['suspect_literals']:
        add("### ⚠ Placeholders with no source")
        add("A hardcoded value among interpolated ones, or inside a legally framed "
            "string. Each is a production value nobody sourced — ask where it comes "
            "from AND by when it must exist.\n")
        for s in d['suspect_literals']:
            add(f"- `{s['string']}`")
            add(f"  - literal: {s['literal']} — {s['why']}")
        add("")

    add(f"## Components used ({len(d['components'])})")
    add('  ' + ', '.join(f'{k}×{n}' for k, n in d['components'][:40]) + '\n')

    add(f"## Tokens referenced ({len(d['tokens'])})")
    add('  ' + ', '.join(k for k, _ in d['tokens'][:40]) + '\n')

    add(f"## Copy ({len(d['copy'])} strings, truncated)")
    for c in d['copy'][:60]:
        add(f"  - {c}")
    return '\n'.join(L)


if __name__ == '__main__':
    if len(sys.argv) < 2 or sys.argv[1] in ('-h', '--help'):
        sys.exit(__doc__)
    focus = None
    if '--focus' in sys.argv:
        focus = sys.argv[sys.argv.index('--focus') + 1]
    dig = build(sys.argv[1], focus)
    print(json.dumps(dig, indent=2) if '--json' in sys.argv else render(dig))
