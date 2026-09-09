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
import sys

_LEAF = re.compile(r"([A-Za-z0-9_]+)\s*:\s*'([^']*)'")
_OPEN = re.compile(r"([A-Za-z0-9_]+)\s*:\s*\{")


def _strip_comments(text: str) -> str:
    """Remove // line comments and /* block comments */ from text, preserving string
    content inside single-quoted strings and overall structure. String-aware to avoid
    breaking event literals that contain comment-like patterns."""
    out = []
    i = 0
    while i < len(text):
        if text[i] == "'":
            out.append(text[i])
            i += 1
            while i < len(text):
                if text[i] == '\\' and i + 1 < len(text):
                    out.append(text[i])
                    out.append(text[i + 1])
                    i += 2
                    continue
                if text[i] == "'":
                    out.append(text[i])
                    i += 1
                    break
                out.append(text[i])
                i += 1
            continue
        if i + 1 < len(text) and text[i:i + 2] == '//':
            while i < len(text) and text[i] != '\n':
                out.append(' ')
                i += 1
            if i < len(text):
                out.append('\n')
                i += 1
            continue
        if i + 1 < len(text) and text[i:i + 2] == '/*':
            out.append(' ')
            i += 1
            out.append(' ')
            i += 1
            while i + 1 < len(text):
                if text[i:i + 2] == '*/':
                    out.append(' ')
                    i += 1
                    out.append(' ')
                    i += 1
                    break
                out.append(' ' if text[i] != '\n' else '\n')
                i += 1
            continue
        out.append(text[i])
        i += 1
    return ''.join(out)


def _find_events_block_end(text: str, start_pos: int) -> int:
    """Find the actual closing brace of the EVENTS block using simple depth counting.
    Returns the index of the closing brace, or -1 if block is malformed."""
    depth = 0
    for idx in range(start_pos, len(text)):
        if text[idx] == '{':
            depth += 1
        elif text[idx] == '}':
            depth -= 1
            if depth == 0:
                return idx
    return -1


def load_event_registry(text: str, root: str = "EVENTS") -> dict[str, str]:
    """{event-name literal -> dotted key-path} from the nested object literal in
    analyticsHelper.ts. A regex walk rather than a TS parse: the shape is a fixed nesting
    of string leaves, and a miss only costs that event its key-path search."""
    text = _strip_comments(text)
    start = text.find(f"{root} = {{")
    if start == -1:
        return {}
    out: dict[str, str] = {}
    stack = [root]
    open_brace = text.index("{", start)
    i = open_brace + 1

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

    actual_block_end = _find_events_block_end(text, open_brace)
    if actual_block_end == -1:
        print(
            f"event-anchors: WARNING — registry block malformed, could not find closing brace",
            file=sys.stderr,
        )
        return out

    walk_terminated_early = i < actual_block_end and not stack
    stack_not_empty_at_end = bool(stack)

    if walk_terminated_early or stack_not_empty_at_end:
        print(
            f"event-anchors: WARNING — registry walk desynced, stopped at offset {i} of {actual_block_end}; "
            f"mapped {len(out)} literals, expect the locator to miss events",
            file=sys.stderr,
        )

    return out
