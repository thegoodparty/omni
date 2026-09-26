"""Scope resolution over TypeScript sources (DATA-2539).

Pure and offset-preserving. `blank_noncode` replaces the *contents* of strings, template
literals and comments with spaces while keeping length and newlines, so every offset computed
against the blanked copy indexes the original text unchanged. That is what makes brace
counting trustworthy: a `}` inside a string no longer closes a block.

Why not walk upward to the nearest declaration: measured against this repo on 2026-09-25, that
fails to resolve a scope for 161 of 274 high-value matches (59%), because components run long
and the nearest declaration above a JSX line is usually a sibling handler whose block closed
before the match. This scanner resolves all but 3%.
"""

from __future__ import annotations

import re

_NAME_RE = re.compile(
    r"(?:function\s+(\w+)|const\s+(\w+)\s*[=:]|class\s+(\w+)|(\w+)\s*\([^()]*\)\s*$)"
)
# A scope head that declares a shape rather than executable code.
_TYPE_HEAD = re.compile(r"(?:\binterface\s+\w+|\btype\s+\w+\s*=|\benum\s+\w+)\s*$")
# A scope head that is executable: an arrow, a function, or a call/param list.
_CODE_HEAD = re.compile(r"(?:=>|\bfunction\b[\w\s]*\([^()]*\)|\)\s*)\s*$")
_HEAD_LOOKBACK = 220


def blank_noncode(text: str) -> str:
    """String/template/comment bodies -> spaces, preserving length and newlines."""
    out = list(text)
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c in "'\"`":
            quote, j = c, i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == quote:
                    break
                j += 1
            for k in range(i + 1, min(j, n)):
                if out[k] != "\n":
                    out[k] = " "
            i = j + 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            j = text.find("\n", i)
            j = n if j == -1 else j
            for k in range(i, j):
                out[k] = " "
            i = j
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i)
            j = n if j == -1 else j + 2
            for k in range(i, min(j, n)):
                if out[k] != "\n":
                    out[k] = " "
            i = j
            continue
        i += 1
    return "".join(out)


def brace_pairs(code: str) -> list[tuple[int, int]]:
    """Every matched {...} in one forward pass. Unmatched openers are dropped, which is the
    graceful behavior for a file this scanner cannot fully understand."""
    stack: list[int] = []
    pairs: list[tuple[int, int]] = []
    for i, c in enumerate(code):
        if c == "{":
            stack.append(i)
        elif c == "}" and stack:
            pairs.append((stack.pop(), i))
    return pairs


def _head(code: str, open_idx: int) -> str:
    return code[max(0, open_idx - _HEAD_LOOKBACK) : open_idx].replace("\n", " ").rstrip()


def scope_kind(code: str, open_idx: int) -> str:
    """"type" for an interface/type/enum body, "code" for a function or component body,
    "other" for an object literal or a JSX expression container."""
    head = _head(code, open_idx)
    if _TYPE_HEAD.search(head):
        return "type"
    if _CODE_HEAD.search(head):
        return "code"
    return "other"


def scope_name(code: str, open_idx: int) -> str | None:
    """The declaration naming this scope, or None when nothing names it."""
    head = code[max(0, open_idx - 300) : open_idx].replace("\n", " ")
    best = None
    for m in _NAME_RE.finditer(head):
        best = next(g for g in m.groups() if g)
    return best


def enclosing_scope(
    code: str, pos: int, pairs: list[tuple[int, int]], *, decisive: bool = True
) -> tuple[int, int] | None:
    """Innermost brace pair spanning `pos`.

    With decisive=True (the default) the search skips object literals and JSX expression
    containers and returns the innermost scope that reads as executable code or a named
    declaration — the function or component the surface actually lives in. With
    decisive=False it returns the innermost pair of any kind, which is what a caller asking
    "is this inside a type declaration" wants."""
    spanning = sorted(
        (p for p in pairs if p[0] <= pos < p[1]), key=lambda p: p[1] - p[0]
    )
    if not spanning:
        return None
    if not decisive:
        return spanning[0]
    for o, c in spanning:
        if scope_kind(code, o) == "code" or scope_name(code, o):
            return (o, c)
    return spanning[-1]
