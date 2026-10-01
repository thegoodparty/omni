"""What a source file references, for the pre-merge governance guard (DATA-2432).

Counts the two ways omni fires an event: the quoted name and the EVENTS key path. Built
from the 2026-10-01 backtest's strict counter. event_anchors.find_call_sites reads line by
line and misses a key path Prettier wraps across lines (8 false blocks at main), and
count_call_sites skips quoted names, so neither is used.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

_TOKEN = re.compile(
    r"//[^\n]*|/\*.*?\*/|'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"|`(?:\\.|[^`\\])*`",
    re.S,
)
_ID = r"[A-Za-z_$][\w$]*"
_CHAIN = re.compile(r"(?<![\w$.])EVENTS((?:\s*\??\.\s*" + _ID + r")+)")
_ALIAS = re.compile(
    r"(?:const|let|var)\s+(" + _ID + r")\s*=\s*EVENTS((?:\s*\.\s*" + _ID + r")+)(?![\w$])(?!\s*\.)"
)
_DESTRUCTURE = re.compile(r"(?:const|let|var)\s*\{([^}]*)\}\s*=\s*EVENTS((?:\s*\.\s*" + _ID + r")*)")
_LITERAL = re.compile(r"'((?:\\.|[^'\\\n])*)'|\"((?:\\.|[^\"\\\n])*)\"|`([^`\\$]*)`")
_IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"\n]+)['"]""")


@dataclass
class FileRefs:
    key_paths: Counter[str] = field(default_factory=Counter)
    literals: Counter[str] = field(default_factory=Counter)
    imports: list[str] = field(default_factory=list)


def strip_comments(text: str) -> str:
    """Blank comments but keep strings and line breaks, so a commented-out call is not a
    call site and a `//` inside a string is not a comment."""
    def blank(m: re.Match[str]) -> str:
        s = m.group(0)
        return re.sub(r"[^\n]", " ", s) if s.startswith(("//", "/*")) else s

    return _TOKEN.sub(blank, text)


def _dotted(chain: str) -> str:
    return "EVENTS" + re.sub(r"\s*\??\.\s*", ".", chain)


def extract(text: str) -> FileRefs:
    src = strip_comments(text)
    out = FileRefs()
    aliases: dict[str, str] = {}
    declared_by_destructure: set[str] = set()
    alias_starts: set[int] = set()
    for m in _ALIAS.finditer(src):
        aliases[m.group(1)] = _dotted(m.group(2))
        alias_starts.add(m.start(2))
    for m in _DESTRUCTURE.finditer(src):
        base = _dotted(m.group(2)) if m.group(2) else "EVENTS"
        for part in m.group(1).split(","):
            key, _, local = part.strip().partition(":")
            key, local = key.strip(), (local.strip() or key.strip())
            if re.fullmatch(_ID, key) and re.fullmatch(_ID, local):
                aliases[local] = f"{base}.{key}"
                declared_by_destructure.add(local)
    for m in _CHAIN.finditer(src):
        # An alias's own assignment names a whole group. Counting it would keep every
        # event under the group alive after its last real use was deleted.
        if m.start(1) not in alias_starts:
            out.key_paths[_dotted(m.group(1))] += 1
    for name, prefix in aliases.items():
        member = re.compile(r"(?<![\w$.])" + re.escape(name) + r"((?:\s*\??\.\s*" + _ID + r")+)")
        for m in member.finditer(src):
            out.key_paths[prefix + _dotted(m.group(1))[len("EVENTS"):]] += 1
        bare = re.compile(r"(?<![\w$.])" + re.escape(name) + r"(?![\w$])(?!\s*\??\.)(?!\s*=[^=>])")
        uses = len(bare.findall(src)) - (1 if name in declared_by_destructure else 0)
        if uses > 0:
            out.key_paths[prefix] += uses
    for m in _LITERAL.finditer(src):
        value = next(g for g in m.groups() if g is not None)
        if 3 <= len(value) <= 160:
            out.literals[value] += 1
    out.imports = _IMPORT.findall(src)
    return out
