"""The PII gate (TDD "Keep PII out of GitHub"; Implementation Notes section
4 "PII gate rules", section 5's second-read prompt, section 3 step 7; ticket
Implementation Details' "Four layers, run against every draft in order").

omni is public, so a case must never identify a real user. Four checks, run
in order, first failure wins — the gate is never loosened to let a draft
through once gated (TDD: "a hard product requirement from the TDD, not a
tunable threshold"):

  1. Denylist          (check_denylist)       — code, no model call
  2. Copied text        (check_copied_text)    — code, no model call
  3. Contact patterns    (check_contact_patterns) — code, no model call
  4. Second read        (run_second_read)      — one model call that sees
     ONLY the draft text, never the transcript, the denylist, or anything
     else about the session (ticket Acceptance Criteria) — the same shape
     as the digest's own sentence-writing call (the workspace note's
     "Samuel's Slack scrub"): a small, non-identifying payload in, a
     validated answer out, fails closed on anything it can't parse.

A fifth check, schema validation against the Pydantic mirror of
`ChatCaseSchema` (case_schema.py), runs last — it's not "PII" in the sense
of the four above, but the ticket's Implementation Details list it as part
of the same gate, and a schema-invalid draft must be dropped exactly like a
PII-flagged one (logged as "gated", never partially reaching the bundle).

`gate_draft` is the one entry point drafting.py calls. Every check function
below also stands on its own — this ticket's Test Plan tests each layer in
isolation.
"""

import json
import re
from dataclasses import dataclass
from typing import Any

import httpx

from case_scout import ai_secrets
from case_scout.reader.case_schema import validate_against_schema
from case_scout.reader.sessions import Session

# Implementation Details: "Skip denylist terms under 3 characters (avoids
# false-positive matches on 'a' or 'Mo')."
MIN_DENYLIST_TERM_LENGTH = 3

# Implementation Details: "block if any contiguous 8-word run... appears in
# the draft."
COPIED_TEXT_RUN_LENGTH = 8

# Samuel's own EMAIL pattern (workspace note's "Samuel's Slack scrub"),
# reused rather than re-invented — the gate's version of the same belt.
_EMAIL_PATTERN = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
# US-format phone numbers: optional country code, optional parens/dashes/dots/
# spaces as separators, with lookaround so this doesn't also match the middle
# of a longer digit run (e.g. an order id).
_PHONE_PATTERN = re.compile(r"(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)")
_URL_PATTERN = re.compile(r"\b(?:https?://|www\.)\S+", re.IGNORECASE)

# Implementation Notes section 5, quoted close to verbatim per the ticket.
SECOND_READ_PROMPT = (
    "Here is a test case for a chat assistant. List any string that looks like a real "
    "private person, a real organization, or a real local place smaller than a state. "
    "Office titles and states are fine."
)

_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_VERSION = "2023-06-01"
_API_KEY_ENV = "ANTHROPIC_API_KEY"
_MODEL = "claude-opus-4-7"  # same seat as scoring.py/drafting.py (TDD: "the scout scores on Opus")
_MAX_TOKENS = 512
_TIMEOUT_SECONDS = 60

# Ticket Acceptance Criteria: "an error or unparseable answer after one
# retry blocks" — one initial attempt plus one retry.
_SECOND_READ_MAX_ATTEMPTS = 2


@dataclass(frozen=True)
class GateResult:
    """What one draft's run through the gate decided. `rule` and `reason`
    are both None exactly when `passed` is True. `reason` is always a short,
    non-identifying clause naming the rule that fired — never the matched
    text itself and never anything from the source conversation (ticket
    Acceptance Criteria: "no raw matched text, no conversation id in
    anything that could reach a PR"; this applies to the ledger too, since
    the ledger line this reason feeds is logged, not posted, but is still
    held to the same non-identifying bar)."""

    passed: bool
    rule: str | None = None
    reason: str | None = None


class SecondReadError(Exception):
    """The second-read call itself could not be completed (no API key, a
    network error, a non-2xx status). `run_second_read` treats this as an
    immediate block with no retry (ticket Test Plan: "a model error
    blocks") — distinct from an unparseable reply, which gets one retry."""


def session_denylist(session: Session) -> tuple[str, ...]:
    """The conversation's denylist terms (Implementation Notes 2.1: "per
    conversation: owner first and last name, organization name, campaign or
    office name, city, district name"). Every message in a session carries
    the same per-conversation list (messages.py's field contract) — the
    union across messages is redundancy insurance against a row that came
    through with an empty list, not an expectation that they differ."""
    terms: set[str] = set()
    for message in session.messages:
        terms.update(message.denylist)
    return tuple(terms)


def session_user_messages(session: Session) -> tuple[str, ...]:
    """The session's own user turns — what `check_copied_text` compares the
    draft against (Implementation Details: "the session's user messages")."""
    return tuple(m.content for m in session.messages if m.role == "user" and m.content.strip())


def _draft_field_values(case: dict[str, Any]) -> list[str]:
    """Every string field a gate check should scan: `condition`,
    `handledWhen`, and whichever of `question`/`turns` the draft set — the
    same fields that reach GitHub (Implementation Notes 10.6)."""
    fields = [str(case.get("condition") or ""), str(case.get("handledWhen") or "")]
    question = case.get("question")
    if question:
        fields.append(str(question))
    turns = case.get("turns")
    if turns:
        fields.extend(str(t) for t in turns)
    return fields


def _normalize(text: str) -> str:
    """Lowercases and collapses punctuation to whitespace (Implementation
    Details: "after normalizing case and punctuation on both sides") — used
    by both the denylist's word-boundary match and the copied-text shingle
    comparison, so a quote mark, a dash, or a capitalization difference on
    either side never lets a match slip past."""
    lowered = text.lower()
    stripped = re.sub(r"[^\w\s]", " ", lowered)
    return re.sub(r"\s+", " ", stripped).strip()


def check_denylist(fields: list[str], denylist: tuple[str, ...]) -> str | None:
    """Implementation Details: "block if any term from the conversation's
    denylist column... appears in any case field, case-insensitive, on word
    boundaries. Skip denylist terms under 3 characters." One `\\b...\\b`
    alternation over every qualifying term, longest first — the same shape
    as the workspace note's Samuel's-scrub `scrubber`, except this blocks
    rather than redacts."""
    terms = sorted({t for t in denylist if len(t) >= MIN_DENYLIST_TERM_LENGTH}, key=len, reverse=True)
    if not terms:
        return None
    # Lookaround rather than \b: a term that itself ends or starts with a
    # non-word character (e.g. "City Council (District 4)") would otherwise
    # break \b's word/non-word transition requirement right at that edge,
    # silently failing to match the term at all.
    pattern = re.compile(
        r"(?<!\w)(?:" + "|".join(re.escape(t) for t in terms) + r")(?!\w)",
        re.IGNORECASE,
    )
    text = " ".join(fields)
    return "a denylist term matched a case field" if pattern.search(text) else None


def _shingles(text: str, run_length: int) -> set[str]:
    words = text.split()
    if len(words) < run_length:
        return set()
    return {" ".join(words[i : i + run_length]) for i in range(len(words) - run_length + 1)}


def check_copied_text(fields: list[str], user_messages: tuple[str, ...]) -> str | None:
    """Implementation Details: "block if any contiguous 8-word run from the
    session's user messages appears in the draft, after normalizing case
    and punctuation on both sides." """
    source_shingles = _shingles(_normalize(" ".join(user_messages)), COPIED_TEXT_RUN_LENGTH)
    if not source_shingles:
        return None
    draft_shingles = _shingles(_normalize(" ".join(fields)), COPIED_TEXT_RUN_LENGTH)
    if source_shingles & draft_shingles:
        return "an 8-word run copied from the user's messages appeared in the draft"
    return None


def check_contact_patterns(fields: list[str]) -> str | None:
    """Implementation Details: "block any email address, US-format phone
    number, or URL appearing anywhere in the draft fields. No allowlist."""
    text = " ".join(fields)
    if _EMAIL_PATTERN.search(text):
        return "an email address appeared in a case field"
    if _PHONE_PATTERN.search(text):
        return "a phone number appeared in a case field"
    if _URL_PATTERN.search(text):
        return "a URL appeared in a case field"
    return None


def _response_text(payload: Any) -> str:
    content = payload.get("content") if isinstance(payload, dict) else None
    if not isinstance(content, list):
        return ""
    parts = [block.get("text", "") for block in content if isinstance(block, dict) and block.get("type") == "text"]
    return "".join(parts)


def _call_second_read_anthropic(draft_text: str) -> str:
    """The second read's own Anthropic call. Takes ONLY the rendered draft
    text — never the session, the transcript, or the denylist (ticket
    Acceptance Criteria) — the same no-tools containment property as
    scoring.py's and drafting.py's own calls (see scoring.py's module
    docstring for why that property matters)."""
    key = ai_secrets.secret(_API_KEY_ENV)
    if not key:
        raise SecondReadError(f"{_API_KEY_ENV} is not configured")
    try:
        response = httpx.post(
            _ANTHROPIC_URL,
            json={
                "model": _MODEL,
                "max_tokens": _MAX_TOKENS,
                "system": SECOND_READ_PROMPT,
                "messages": [{"role": "user", "content": draft_text}],
            },
            headers={
                "content-type": "application/json",
                "x-api-key": key,
                "anthropic-version": _ANTHROPIC_VERSION,
            },
            timeout=_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return _response_text(response.json())
    except (httpx.HTTPError, ValueError) as e:
        raise SecondReadError(f"second read call failed: {e}") from e


def _extract_json_list(text: str) -> list[Any]:
    """Reads the second read's reply as a JSON list. scoring.extract_json
    reads a `{...}` object by quote-aware brace-depth; this is the same
    approach over `[...]` and bracket-depth, since the second read's answer
    is a bare JSON array (Implementation Details: "Output is a JSON list")."""
    stripped = re.sub(r"^\s*```(?:json)?|```\s*$", "", text.strip(), flags=re.M)
    start = stripped.find("[")
    if start < 0:
        raise ValueError("no JSON array in second read output")
    depth, in_str, esc = 0, False, False
    for i, ch in enumerate(stripped[start:], start):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                result: Any = json.loads(stripped[start : i + 1])
                if not isinstance(result, list):
                    raise ValueError("second read output's JSON array was not a list")
                return result
    raise ValueError("unbalanced JSON array in second read output")


def run_second_read(fields: list[str], call: Any = None) -> str | None:
    """Implementation Details: "a separate model call that sees only the
    draft... Output is a JSON list; an empty list passes." It fails closed:
    a call error blocks immediately, with no retry (ticket Test Plan: "a
    model error blocks"); an unparseable reply gets exactly one retry, then
    blocks (Acceptance Criteria: "an error or unparseable answer after one
    retry blocks"). `call` takes the draft text alone and returns raw model
    text, same injection pattern as scoring.py/drafting.py's `call`."""
    call = call or _call_second_read_anthropic
    draft_text = "\n".join(fields)

    try:
        raw_text = call(draft_text)
    except SecondReadError:
        return "the second read call failed"

    attempts = 0
    while True:
        attempts += 1
        try:
            flagged = _extract_json_list(raw_text)
            break
        except ValueError:
            if attempts >= _SECOND_READ_MAX_ATTEMPTS:
                return "the second read returned an unparseable answer after a retry"
            try:
                raw_text = call(draft_text)
            except SecondReadError:
                return "the second read call failed"

    return "the second read flagged a likely real identifier" if flagged else None


def gate_draft(
    case: dict[str, Any],
    denylist: tuple[str, ...],
    user_messages: tuple[str, ...],
    second_read_call: Any = None,
) -> GateResult:
    """The one entry point drafting.py calls. `case` is `DraftedCase.to_json()`'s
    shape. Every layer runs in order; the first failure wins and nothing
    below it runs (TDD: "the gate is never loosened to let one through")."""
    fields = _draft_field_values(case)

    reason = check_denylist(fields, denylist)
    if reason:
        return GateResult(passed=False, rule="denylist", reason=reason)

    reason = check_copied_text(fields, user_messages)
    if reason:
        return GateResult(passed=False, rule="copiedText", reason=reason)

    reason = check_contact_patterns(fields)
    if reason:
        return GateResult(passed=False, rule="contactPattern", reason=reason)

    reason = run_second_read(fields, call=second_read_call)
    if reason:
        return GateResult(passed=False, rule="secondRead", reason=reason)

    reason = validate_against_schema(case)
    if reason:
        return GateResult(passed=False, rule="schema", reason=reason)

    return GateResult(passed=True)
