"""Draft a where-it-fires anchor for every recently-firing analytics event (DATA-2426,
slice 3).

Locates each event's call site by literal string *and* EVENTS key-path — the literal
search is what sees the raw-string and dynamically-dispatched events the provenance walk
is blind to — derives the product URL from the enclosing Next.js route file, and has an
LLM draft only the plain-English line. Output is a review queue, never a direct write:
nothing reaches Amplitude Govern from this module.
"""

from __future__ import annotations

import re

_LEAF = re.compile(r"([A-Za-z0-9_]+)\s*:\s*'([^']*)'")
_OPEN = re.compile(r"([A-Za-z0-9_]+)\s*:\s*\{")


def load_event_registry(text: str, root: str = "EVENTS") -> dict[str, str]:
    """{event-name literal -> dotted key-path} from the nested object literal in
    analyticsHelper.ts. A regex walk rather than a TS parse: the shape is a fixed nesting
    of string leaves, and a miss only costs that event its key-path search."""
    start = text.find(f"{root} = {{")
    if start == -1:
        return {}
    out: dict[str, str] = {}
    stack = [root]
    i = text.index("{", start) + 1
    while i < len(text) and stack:
        ch = text[i]
        if ch == "}":
            stack.pop()
            i += 1
            continue
        leaf = _LEAF.match(text, i)
        if leaf:
            out[leaf.group(2)] = ".".join(stack + [leaf.group(1)])
            i = leaf.end()
            continue
        nest = _OPEN.match(text, i)
        if nest:
            stack.append(nest.group(1))
            i = nest.end()
            continue
        i += 1
    return out
