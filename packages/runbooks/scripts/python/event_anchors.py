"""Draft a where-it-fires anchor for every recently-firing analytics event (DATA-2426,
slice 3).

Locates each event's call site by literal string *and* EVENTS key-path — the literal
search is what sees the raw-string and dynamically-dispatched events the provenance walk
is blind to — derives the product URL from the enclosing Next.js route file, and has an
LLM draft only the plain-English line. Output is a review queue, never a direct write:
nothing reaches Amplitude Govern from this module.
"""

from __future__ import annotations

import json
import os
import posixpath
import re
import sys
from typing import Callable, Mapping, Sequence

import instrumentation_gaps as ig
import llm_judge

DEFAULT_MODEL = os.environ.get("ANCHOR_JUDGE_MODEL", "claude-sonnet-5")

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


def derive_url(hit_path: str, page_paths: Sequence[str]) -> str | None:
    """The product route a call site sits under, app-qualified when it is not the
    candidate webapp. None when the file is not under an app router at all — a gp-api
    service has no URL, and inventing one would be exactly the confident-but-wrong anchor
    this whole slice exists to avoid."""
    best: str | None = None
    for page in page_paths:
        page_dir = posixpath.dirname(page)
        if hit_path == page or hit_path.startswith(page_dir + "/"):
            if best is None or len(page_dir) > len(posixpath.dirname(best)):
                best = page
    if best is None:
        return None

    # Normalize the page path to the form route_pattern_from_page_path expects.
    # route_pattern_from_page_path hardcodes slicing off "packages/gp-webapp/app",
    # which is 22 characters. Different app structures (e.g., packages/gp-admin/src/app)
    # have the /app segment at different offsets, so we normalize by locating /app/ and
    # reconstructing as "packages/gp-webapp/app/..." before calling the helper.
    app_marker = "/app/"
    if app_marker not in best:
        return None
    app_root_end = best.index(app_marker) + len(app_marker)
    remainder = best[app_root_end:]
    normalized = "packages/gp-webapp/app/" + remainder

    route = ig.route_pattern_from_page_path(normalized)

    # Extract the package name (e.g., "gp-admin" from "packages/gp-admin/...").
    parts = best.split("/")
    if len(parts) < 2 or not parts[1].startswith("gp-"):
        return None
    app_name = parts[1]
    return route if app_name == "gp-webapp" else f"{route} ({app_name})"


# --- LLM judge pass -------------------------------------------------------------

CONFIDENCE_CLASSES = ("global_chrome", "dynamic_dispatch", "no_call_site")

ANCHOR_TOOL = {
    "name": "report_anchors",
    "description": "Return one anchor per event: where it fires, and at what URL.",
    "input_schema": {
        "type": "object",
        "properties": {
            "verdicts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "fires_on": {"type": "string"},
                        "url": {"type": "string"},
                        "confidence": {"type": "string", "enum": ["high", "low"]},
                        # Optional — a high-confidence verdict legitimately has none — but
                        # once present it must be one of CONFIDENCE_CLASSES, sourced here so
                        # the schema and the constant cannot drift apart.
                        "flag_reason": {"type": "string", "enum": list(CONFIDENCE_CLASSES)},
                    },
                    "required": ["id", "fires_on", "url", "confidence"],
                },
            }
        },
        "required": ["verdicts"],
    },
}

_ANCHOR_INSTRUCTIONS = (
    "You are writing the line that lets a non-engineer confirm an analytics event is the "
    "one they mean. For each event you get its name, its description, the code around its "
    "call site, and a url already derived from the enclosing route file.\n\n"
    "fires_on: ONE plain-English line naming the surface and the trigger, as a person "
    "using the product would describe it — 'Admin SMS outreach queue, Approve & book send "
    "on a campaign detail page.' Name the button or control if you can see it. Never "
    "describe the code: no function names, no file names, no 'trackEvent is called when'.\n"
    "url: confirm the derived url by returning it verbatim, or correct it if the code "
    "shows the action happens elsewhere. When there is no single URL because the event "
    "fires from global chrome, return a short reason instead, like 'n/a (global nav)'. "
    "Never invent a path you have not seen.\n"
    "confidence: 'low' whenever you are guessing — no call site was found, the event is "
    "dispatched dynamically so no call site reveals the surface, or it fires from "
    "everywhere. Set flag_reason to one of: global_chrome, dynamic_dispatch, "
    "no_call_site. A flagged anchor is useful; a confident wrong one is worse than none.\n"
    "hint: when an event's hint is non-empty, it is a fact already derived from the "
    "codebase, not a suggestion to weigh — no_call_site means the code search found no "
    "reference at all, dynamic_dispatch means every reference is the registry "
    "declaration itself, and no call site was there to inspect. Set confidence to low "
    "and copy hint verbatim into flag_reason rather than re-deriving it. global_chrome "
    "carries no hint — that class is yours to judge from the code alone.\n"
    "Copy each id verbatim. Return exactly one verdict per event via the tool."
)


def anchor_system_prompt() -> str:
    return _ANCHOR_INSTRUCTIONS


def build_candidate(event: Mapping, hits: Sequence[dict], url: str | None,
                    files: Mapping[str, str]) -> dict:
    """One judge input: what the event is, where it appears in code, and the route we
    already derived. `hint` pre-classifies the two low-confidence shapes the code can
    prove, so the judge confirms rather than discovers them."""
    call_sites = [h for h in hits if h["kind"] != "declaration"]
    if not hits:
        hint = "no_call_site"
    elif not call_sites:
        hint = "dynamic_dispatch"
    else:
        hint = ""
    primary = (call_sites or hits or [None])[0]
    code = ""
    if primary is not None:
        text = files.get(primary["path"], "")
        # Anchor the window on the hit's own line, not on searching for event_type —
        # a key_path or declaration hit's line contains the key-path text, not the
        # event-name string literal, so a search for event_type would miss it and
        # silently fall back to the file head instead of the actual call site.
        lines = text.splitlines()
        hit_idx = primary["line"] - 1
        anchor = lines[hit_idx] if 0 <= hit_idx < len(lines) else ""
        pattern = re.compile(re.escape(anchor)) if anchor.strip() else None
        code = ig.extract_context(text, pattern)
    return {
        "id": event["event_type"],
        "family": event.get("family") or "",
        "description": event.get("description") or "",
        "derived_url": url or "",
        "evidence": f"{primary['path']}:{primary['line']}" if primary else "",
        "hint": hint,
        "code": code,
    }


def build_anchor_messages(candidates: Sequence[dict]) -> list[dict]:
    """One user turn carrying the batch as JSON."""
    return [{"role": "user", "content": json.dumps(list(candidates), indent=2)}]


def judge_anchors(candidates: Sequence[dict], *, api_key: str | None, model: str = DEFAULT_MODEL,
                  client_factory: Callable[[str], object] = llm_judge.make_anthropic_client
                  ) -> tuple[dict[str, dict], str]:
    return llm_judge.run_graceful(
        candidates, api_key=api_key, model=model, tool=ANCHOR_TOOL,
        message_builder=build_anchor_messages,
        system_factory=anchor_system_prompt,
        unavailable_status="skipped: prompt unavailable",
        client_factory=client_factory,
    )
