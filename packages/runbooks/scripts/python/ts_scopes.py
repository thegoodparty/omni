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
# Words that open a block but never name a scope. Without this, `if (ready) {` reads as a
# code head (it ends in `)`), so a surface inside a conditional resolves to the conditional
# and is named "if" instead of the component it lives in. Measured 14/270 before the guard.
_CONTROL = {"if", "for", "while", "switch", "catch", "else", "do", "return", "with"}
_CONTROL_HEAD = re.compile(
    r"(?<!\w)(?:if|for|while|switch|catch|else|do)\s*(?:\([^()]*\))?\s*$"
)
_HEAD_LOOKBACK = 220


def _blank_quoted(text: str, out: list, i: int, quote: str) -> int:
    """Blank a '...' or "..." body. Returns the index past the closing quote."""
    n = len(text)
    j = i + 1
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
    return j + 1


def _blank_template(text: str, out: list, i: int) -> int:
    """Blank a template literal's text, leaving the code inside `${...}` intact.

    Tracks interpolation depth and recurses, rather than scanning for the next raw
    backtick. A nested template inside an interpolation — `` `a ${x ? `b${c}` : d} e` `` —
    otherwise ends the outer scan at its opening backtick, leaving the inner `{`/`}`
    un-blanked; brace_pairs then invents a pair that can swallow the enclosing component's
    closing brace and enclosing_scope returns the wrong scope, or None, for a surface that
    really is inside it.
    """
    n = len(text)
    j = i + 1
    while j < n:
        c = text[j]
        if c == "\\":
            for k in (j, j + 1):
                if k < n and out[k] != "\n":
                    out[k] = " "
            j += 2
            continue
        if c == "`":
            return j + 1
        if c == "$" and j + 1 < n and text[j + 1] == "{":
            # Interpolation: real code, so leave it alone and let nested literals recurse.
            depth, j = 0, j + 1
            while j < n:
                cj = text[j]
                if cj == "{":
                    depth += 1
                elif cj == "}":
                    depth -= 1
                    if depth == 0:
                        j += 1
                        break
                elif cj == "`":
                    j = _blank_template(text, out, j)
                    continue
                elif cj in "'\"":
                    j = _blank_quoted(text, out, j, cj)
                    continue
                j += 1
            continue
        if out[j] != "\n":
            out[j] = " "
        j += 1
    return n


def blank_noncode(text: str) -> str:
    """String/template/comment bodies -> spaces, preserving length and newlines."""
    out = list(text)
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "`":
            i = _blank_template(text, out, i)
            continue
        if c in "'\"":
            i = _blank_quoted(text, out, i, c)
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
    if _CONTROL_HEAD.search(head):
        return "other"
    if _CODE_HEAD.search(head):
        return "code"
    return "other"


def scope_name(code: str, open_idx: int) -> str | None:
    """The declaration naming this scope, or None when nothing names it."""
    head = code[max(0, open_idx - 300) : open_idx].replace("\n", " ")
    best = None
    for m in _NAME_RE.finditer(head):
        name = next(g for g in m.groups() if g)
        if name in _CONTROL:
            continue
        best = name
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
        # decisive=True's whole job: a surface is never "inside" an interface or type body,
        # so those are skipped even when the name lookback would happily name them. Without
        # this the loop is indistinguishable from returning spanning[0].
        if scope_kind(code, o) == "type":
            continue
        if scope_kind(code, o) == "code" or scope_name(code, o):
            return (o, c)
    return spanning[-1]
