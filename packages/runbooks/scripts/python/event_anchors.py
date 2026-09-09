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
from typing import Mapping

_LEAF = re.compile(r"([A-Za-z0-9_]+)\s*:\s*'([^']*)'")
_OPEN = re.compile(r"([A-Za-z0-9_]+)\s*:\s*\{")


def _strip_comments(text: str) -> str:
    """Remove // line comments and /* block comments */ from text with a proper state
    machine. Handles strings (single, double, template literals) and comments correctly:
    - Quotes inside comments are inert characters (not state changes)
    - Comments inside strings are code (not comment starts)
    - Preserves newlines and string content exactly
    - Replaces comment content with spaces (preserving offsets)
    """
    out = []
    i = 0
    while i < len(text):
        ch = text[i]

        if ch == "'":
            out.append(ch)
            i += 1
            while i < len(text):
                ch = text[i]
                if ch == '\\' and i + 1 < len(text):
                    out.append(text[i:i + 2])
                    i += 2
                    continue
                out.append(ch)
                if ch == "'":
                    i += 1
                    break
                i += 1
            continue

        if ch == '"':
            out.append(ch)
            i += 1
            while i < len(text):
                ch = text[i]
                if ch == '\\' and i + 1 < len(text):
                    out.append(text[i:i + 2])
                    i += 2
                    continue
                out.append(ch)
                if ch == '"':
                    i += 1
                    break
                i += 1
            continue

        if ch == '`':
            out.append(ch)
            i += 1
            while i < len(text):
                ch = text[i]
                if ch == '\\' and i + 1 < len(text):
                    out.append(text[i:i + 2])
                    i += 2
                    continue
                out.append(ch)
                if ch == '`':
                    i += 1
                    break
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
            out.append(' ')
            i += 2
            while i + 1 < len(text):
                if text[i:i + 2] == '*/':
                    out.append(' ')
                    out.append(' ')
                    i += 2
                    break
                out.append(' ' if text[i] != '\n' else '\n')
                i += 1
            continue

        out.append(ch)
        i += 1

    return ''.join(out)


def _skip_quoted_string(text: str, start_idx: int) -> int:
    """Skip over a quoted string (single, double, or template literal) with escape handling.
    Returns the index after the closing quote. If not at a quote, returns start_idx unchanged."""
    if start_idx >= len(text):
        return start_idx

    ch = text[start_idx]
    if ch not in ("'", '"', '`'):
        return start_idx

    quote = ch
    i = start_idx + 1
    while i < len(text):
        ch = text[i]
        if ch == '\\' and i + 1 < len(text):
            i += 2
            continue
        if ch == quote:
            return i + 1
        i += 1

    return i


def _find_events_block_end(text: str, start_pos: int) -> int:
    """Find the actual closing brace of the EVENTS block using depth counting that skips
    quoted spans. Braces inside strings do not affect depth. Returns the index of the
    closing brace, or -1 if block is malformed."""
    depth = 0
    i = start_pos
    while i < len(text):
        ch = text[i]

        after_skip = _skip_quoted_string(text, i)
        if after_skip > i:
            i = after_skip
            continue

        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return i

        i += 1

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


REGISTRY_FILE = "packages/gp-webapp/helpers/analyticsHelper.ts"


def _is_identifier_char(ch: str) -> bool:
    """Check if a character is part of a TypeScript/JS identifier."""
    return ch.isalnum() or ch in '_.'


def find_call_sites(event_name: str, key_path: str | None,
                    files: Mapping[str, str]) -> list[dict]:
    """Every reference to an event, by literal string and by EVENTS key-path.

    Literals are matched only in quoted form ('...' or "..." or `...`) to avoid
    substring over-matching between sibling event names. Key-paths require word
    boundaries (no alphanumeric, _, or . before/after).

    A hit inside the EVENTS block literal in the registry file is the declaration,
    not a call site: an event with only declaration hits is dispatched dynamically
    (or dead), and the judge needs to tell those apart from normal call sites.
    """
    hits: list[dict] = []

    for path, text in files.items():
        # For registry file, find the EVENTS block boundaries to classify hits
        registry_block_start = -1
        registry_block_end = -1
        block_found = False
        if path == REGISTRY_FILE:
            text_stripped = _strip_comments(text)
            start = text_stripped.find("EVENTS = {")
            if start != -1:
                open_brace_pos = text_stripped.index("{", start)
                block_end_pos = _find_events_block_end(text_stripped, open_brace_pos)
                if block_end_pos != -1:
                    registry_block_start = open_brace_pos
                    registry_block_end = block_end_pos
                    block_found = True
            else:
                # Registry file found but EVENTS block not locatable — warn like load_event_registry does
                print(
                    f"event-anchors: WARNING — EVENTS block not locatable in {REGISTRY_FILE}, "
                    f"call sites in this file cannot be distinguished from declarations",
                    file=sys.stderr,
                )

        # Process each line with character offset tracking
        char_offset = 0
        for lineno, line in enumerate(text.splitlines(), start=1):
            # Check for quoted literal matches (single, double, or backtick)
            literal_found = False
            for quote in ("'", '"', "`"):
                quoted_needle = quote + event_name + quote
                if quoted_needle in line:
                    hit_char_offset = char_offset + line.index(quoted_needle)
                    # Only classify as declaration if inside the located block
                    is_declaration = (path == REGISTRY_FILE and block_found and
                                      registry_block_start <= hit_char_offset <= registry_block_end)
                    kind = "declaration" if is_declaration else "literal"
                    hits.append({
                        "path": path,
                        "line": lineno,
                        "kind": kind,
                    })
                    literal_found = True
                    break

            # If no literal found, check for key_path with word boundary
            if not literal_found and key_path:
                idx = line.find(key_path)
                if idx != -1:
                    # Word boundary check: chars before and after must not be identifier chars
                    before_ok = (idx == 0 or not _is_identifier_char(line[idx - 1]))
                    after_idx = idx + len(key_path)
                    after_ok = (after_idx >= len(line) or not _is_identifier_char(line[after_idx]))

                    if before_ok and after_ok:
                        hit_char_offset = char_offset + idx
                        # Only classify as declaration if inside the located block
                        is_declaration = (path == REGISTRY_FILE and block_found and
                                          registry_block_start <= hit_char_offset <= registry_block_end)
                        kind = "declaration" if is_declaration else "key_path"
                        hits.append({
                            "path": path,
                            "line": lineno,
                            "kind": kind,
                        })

            char_offset += len(line) + 1  # +1 for the newline character

    return sorted(hits, key=lambda h: (h["path"], h["line"]))
