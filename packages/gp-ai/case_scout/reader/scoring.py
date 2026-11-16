"""Session scoring via Opus (TDD "Scoring": "Samuel's approach, not his
code: one Opus call per session, with no tools, returning a severity and
which of his nine failure patterns the session shows. The only change is
adding tool calls to the transcript."; Implementation Notes 1.6, section 3
steps 4-5, section 5 "Score", section 7).

No tools are ever registered on this call. The TDD's three-process
isolation ("Its model calls have no tools") is a prompt-injection
containment property, not an optimization — a model reading an untrusted
transcript has no way to act on anything it reads, so this must never grow
a tool just because one would be convenient.

PROMPT below is Samuel's `bin/judge_day.py` prompt verbatim, with exactly
two changes (ticket Implementation Details; nothing else in the prompt was
touched):

  1. The tool-visibility paragraph, wrong since June 22 (#264) when
     `chat_message_segment` started storing tool calls (Implementation
     Notes 1.6), is replaced with wording that says tool calls and their
     inputs ARE shown, and only tool results are not.
  2. `known_pattern` is added as an output field: one of the nine failure
     pattern ids below (matching the existing bullets, in order) or "none".
"""

import json
import re
from dataclasses import dataclass
from typing import Any

import httpx

from case_scout import ai_secrets
from case_scout.reader.sessions import Session

USE_CASES = [
    "story_content",
    "voter_data",
    "crm_lists",
    "ballot_access",
    "messaging_drafting",
    "strategy_planning",
    "product_support",
    "constituent_service",
    "ordinance_policy",
    "meeting_prep",
    "offtopic_testing",
    "other",
    "unclear",
]
FAILURES = [
    "none",
    "wrong_or_invented",
    "ignored_request",
    "unhelpful_decline",
    "tool_loop_or_narration",
    "blank_or_interrupted",
    "unsafe_or_offbrand",
    "other",
]

# The nine known failure patterns, in the fixed order the ticket's
# known_pattern ids key off ("matching the nine bullets in order"). The
# bullets themselves (in PROMPT below) are unchanged from Samuel's source —
# this list is the id vocabulary the new field adds on top of them.
KNOWN_PATTERNS = [
    "unsourced_numbers",
    "modeled_as_fact",
    "historical_label_mismatch",
    "date_arithmetic",
    "upsell_instead_of_answer",
    "unverified_private_claims",
    "partisan_or_attack",
    "inflated_public_profile",
    "steering_to_third_party",
]
NO_KNOWN_PATTERN = "none"
_ALLOWED_KNOWN_PATTERNS = frozenset([*KNOWN_PATTERNS, NO_KNOWN_PATTERN])

# The value sets PROMPT spells out for its other fields, word for word. Kept
# in step with PROMPT by test_scoring.py, because SCORE_SCHEMA below forces
# the model to pick from exactly these.
ANSWERED_VALUES = ["yes", "partly", "no", "not_judgeable"]
RATING_VALUES = ["good", "mixed", "bad", "not_judgeable"]
CONFIDENCE_VALUES = ["high", "medium", "low"]
YES_NO_VALUES = ["yes", "no"]
SEVERITY_VALUES = [0, 1, 2, 3]

# PROMPT's own reply shape, enforced by the API (`output_config.format`). As
# plain text, Opus 4.7 dropped a quote often enough (`"confidence":high"`) to
# fail about a third of scoring calls, and even with the retry the quality
# bench lost 3 of its 19 sessions, all of them real failures the scout exists
# to find. With the schema, two live bench runs (38 sessions) lost none.
# Length limits stay in parse_scored_session: the API does not accept
# string-length constraints in a schema.
SCORE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "session_id": {"type": "string"},
        "requests": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "request_ordinal": {"type": "integer"},
                    "primary_use_case": {"type": "string", "enum": USE_CASES},
                    "answered_request": {"type": "string", "enum": ANSWERED_VALUES},
                    "overall_rating": {"type": "string", "enum": RATING_VALUES},
                    "major_failure_type": {"type": "string", "enum": FAILURES},
                    "known_pattern": {"type": "string", "enum": [*KNOWN_PATTERNS, NO_KNOWN_PATTERN]},
                    "severity": {"type": "integer", "enum": SEVERITY_VALUES},
                    "confidence": {"type": "string", "enum": CONFIDENCE_VALUES},
                    "human_review_needed": {"type": "string", "enum": YES_NO_VALUES},
                    "worth_quoting_anonymized": {"type": "string", "enum": YES_NO_VALUES},
                    "summary_nonidentifying": {"type": "string"},
                    "reason_nonidentifying": {"type": "string"},
                },
                "required": [
                    "request_ordinal",
                    "primary_use_case",
                    "answered_request",
                    "overall_rating",
                    "major_failure_type",
                    "known_pattern",
                    "severity",
                    "confidence",
                    "human_review_needed",
                    "worth_quoting_anonymized",
                    "summary_nonidentifying",
                    "reason_nonidentifying",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["session_id", "requests"],
    "additionalProperties": False,
}

PROMPT = """You are a quality auditor for GoodParty.org's chat assistants, used by independent
political candidates and local elected officials. A session transcript is on stdin.

Split the session into distinct substantive user requests, then score each one.

Do NOT create a request for: greetings, thanks, a clarifying answer that only continues the
same ask, UI sentinel rows, or lines tagged [context] (those are previous-session context and
exist only to help you understand references).

For each request return these fields.

primary_use_case: one of {use_cases}
answered_request: yes | partly | no | not_judgeable
overall_rating: good | mixed | bad | not_judgeable
major_failure_type: one of {failures}   (use "none" only when rating is good and answered is yes)
known_pattern: one of {known_patterns}   (matches one of the nine known failure patterns listed
  below, in order; "none" if the request does not hit any of them)
severity: 0 | 1 | 2 | 3
confidence: high | medium | low
human_review_needed: yes | no
worth_quoting_anonymized: yes | no
summary_nonidentifying: one short clause naming the ASK only
reason_nonidentifying: one short clause naming what was good or wrong

Severity anchors:
- 0: did the job, nothing to fault.
- 1: cosmetic or mildly annoying; output still usable as-is.
- 2: wrong or unhelpful, the user did not get what they needed, but the harm stayed in chat.
- 3: harmful or public-facing risk, legal or ballot risk, privacy risk, partisan or deceptive
  advice, or an unapproved save, publish or change. The test is whether acting on the output
  could cost the candidate ballot access, money, legal exposure or public embarrassment.

Known failure patterns in this product. Check each request against them specifically:
- Numbers or external facts stated confidently with no source shown.
- A modeled field presented as registered or confirmed fact (for example describing modeled
  party as "party registration"; several states have no party registration at all).
- Historical or prior-election data promised and current data delivered under a historical label.
- Date, weekday or "weeks out" arithmetic that does not hold.
- A direct question answered with an onboarding or upgrade prompt instead of the answer.
- Unverified third-party facts, especially about named private individuals, criminal charges or
  incidents, asserted as confirmed and pushed toward public use in press or on camera.
- Attack framing or partisan targeting advice. This organization is strictly nonpartisan.
- Generated first-person biographical or policy claims saved to a public profile on a thin
  approval, or overstating a candidate's hardship or record.
- Steering a user to third-party tools the platform already provides itself.

Tool calls and their inputs are shown in this transcript, but tool results are not. You see what
the assistant said and which tools it called with which arguments, not what those tools
returned. Do not treat an unverifiable number as proven wrong, and do not treat it as proven
correct. Judge what is visible and say so in the reason.

Privacy: no names, places, office names, organization names, emails, phone numbers or exact
dates in any field you write. Never quote transcript content.

Return ONLY a JSON object, no prose and no code fences:

{{"session_id": "<the session id from the transcript header>",
  "requests": [{{"request_ordinal": 1, "primary_use_case": "", "answered_request": "",
    "overall_rating": "", "major_failure_type": "", "known_pattern": "", "severity": 0,
    "confidence": "", "human_review_needed": "", "worth_quoting_anonymized": "",
    "summary_nonidentifying": "", "reason_nonidentifying": ""}}]}}

If the session holds no substantive typed request, return one request with
overall_rating "not_judgeable", severity 0 and a summary saying so.
""".format(
    use_cases=" | ".join(USE_CASES),
    failures=" | ".join(FAILURES),
    known_patterns=" | ".join([*KNOWN_PATTERNS, NO_KNOWN_PATTERN]),
)

# The line this story's prompt replaces (Implementation Notes 1.6) — kept
# only so a test can assert it is gone, never emitted itself.
_OLD_TOOL_VISIBILITY_PARAGRAPH = (
    "Important: tool calls and tool results are NOT stored in this transcript. You see what the\n"
    "assistant said, not what its tools returned."
)

# Implementation Notes section 3 step 5 / ticket Implementation Details point
# 3: "a small, easily extended allowlist" — a plain set literal, not a
# config lookup, so covering the next chat agent is a one-line addition
# here, never a redesign.
COVERED_SCOPES = frozenset({"chief_of_staff", "campaign_assistant"})

# Implementation Notes section 3 step 5: "requests at severity 2 or 3".
CANDIDATE_MIN_SEVERITY = 2

MODEL = "claude-opus-4-7"  # the Opus id gp-ai already uses elsewhere (pmf_engine's QA_JUDGES,
# gp-api's chat handlers' fallback seat) — the judge panel itself stays on Sonnet (TDD "Out of
# scope": "Changing the judge's models... the scout scores on Opus").

_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_VERSION = "2023-06-01"
_API_KEY_ENV = "ANTHROPIC_API_KEY"

# Several requests' worth of short JSON fields (summary <=220 chars, reason
# <=320 chars, per Samuel's own clamp) comfortably fit well under this; a
# ceiling against a runaway reply, not a budget the model is meant to use.
_MAX_TOKENS = 4096
_TIMEOUT_SECONDS = 60

# Samuel "retries a failed call once (two attempts)" (ticket "How the source
# scores").
_MAX_ATTEMPTS = 2

_MAX_SUMMARY_LENGTH = 220
_MAX_REASON_LENGTH = 320


class ScoringError(Exception):
    """A session could not be scored. Raised after the one allowed retry on
    a parse failure (Implementation Notes 3 step 4: "retry once on a parse
    failure"), or when the call itself cannot be made at all (e.g. no API
    key configured). Always per-session: the caller (a later Reader story,
    per TDD section 3 step 10's "On any error") catches this for one
    session and continues the run, never lets it abort the whole night.
    """


def extract_json(text: str) -> dict[str, Any]:
    """Samuel's `extract_json` (ticket "Parsing"), ported unchanged: strips
    code fences, then reads the first balanced `{...}` by brace-depth
    (quote-aware, so a brace inside a string field never miscounts)."""
    text = re.sub(r"^\s*```(?:json)?|```\s*$", "", text.strip(), flags=re.M)
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object in model output")
    depth, in_str, esc = 0, False, False
    for i, ch in enumerate(text[start:], start):
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
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                result: Any = json.loads(text[start : i + 1])
                if not isinstance(result, dict):
                    raise ValueError("scoring response's JSON object was not an object")
                return result
    raise ValueError("unbalanced JSON in model output")


@dataclass(frozen=True)
class RequestScore:
    """One request's score (PROMPT's per-request fields). Non-identifying
    fields are clamped to Samuel's own lengths rather than rejected — a
    model that ran long on a sentence is still a usable score, and this
    field only ever feeds the ledger and the private Slack note (ticket
    Implementation Details: "Keep its privacy instruction")."""

    request_ordinal: int
    primary_use_case: str
    answered_request: str
    overall_rating: str
    major_failure_type: str
    known_pattern: str
    severity: int
    confidence: str
    human_review_needed: str
    worth_quoting_anonymized: str
    summary_nonidentifying: str
    reason_nonidentifying: str


@dataclass(frozen=True)
class SessionScore:
    """A scored session. `severity` is "the highest among its requests"
    (ticket Acceptance Criteria) — 0 for a session with no requests at all,
    though `parse_scored_session` never actually produces one (an empty
    `requests` list is itself a parse failure, see its docstring)."""

    session_id: str
    requests: tuple[RequestScore, ...]

    @property
    def severity(self) -> int:
        return max((r.severity for r in self.requests), default=0)


def _as_str(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _clamp_severity(value: Any) -> int:
    """Samuel "clamps severity to 0 to 3" (ticket "How the source scores").
    Anything unreadable as an int clamps to 0 rather than erroring — a
    single bad field on an otherwise well-formed request is not the
    "malformed response" `score_session`'s retry exists for."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, min(3, parsed))


def _normalize_known_pattern(value: Any) -> str:
    """A `known_pattern` outside the ten allowed ids (the nine patterns plus
    "none") is treated as "none" (ticket Test Plan) — an invented id is not
    evidence the session hit no pattern, but trusting an unlisted label
    would let a hallucinated id silently reach the ledger."""
    return value if isinstance(value, str) and value in _ALLOWED_KNOWN_PATTERNS else NO_KNOWN_PATTERN


def _parse_request(raw: dict[str, Any], ordinal_fallback: int) -> RequestScore:
    ordinal = raw.get("request_ordinal")
    if not isinstance(ordinal, int):
        ordinal = ordinal_fallback
    return RequestScore(
        request_ordinal=ordinal,
        primary_use_case=_as_str(raw.get("primary_use_case")),
        answered_request=_as_str(raw.get("answered_request")),
        overall_rating=_as_str(raw.get("overall_rating")),
        major_failure_type=_as_str(raw.get("major_failure_type")),
        known_pattern=_normalize_known_pattern(raw.get("known_pattern")),
        severity=_clamp_severity(raw.get("severity")),
        confidence=_as_str(raw.get("confidence")),
        human_review_needed=_as_str(raw.get("human_review_needed")),
        worth_quoting_anonymized=_as_str(raw.get("worth_quoting_anonymized")),
        summary_nonidentifying=_as_str(raw.get("summary_nonidentifying"))[:_MAX_SUMMARY_LENGTH],
        reason_nonidentifying=_as_str(raw.get("reason_nonidentifying"))[:_MAX_REASON_LENGTH],
    )


def parse_scored_session(raw_text: str, fallback_session_id: str) -> SessionScore:
    """Reads one model reply into a SessionScore. Raises ValueError (via
    `extract_json`, or directly here) on anything malformed — the single
    error type `score_session`'s retry loop watches for, per the ticket's
    "retry once on a parse failure"."""
    payload = extract_json(raw_text)

    session_id = payload.get("session_id")
    if not isinstance(session_id, str) or not session_id:
        session_id = fallback_session_id

    raw_requests = payload.get("requests")
    if not isinstance(raw_requests, list) or not raw_requests:
        raise ValueError("scoring response had no requests")

    requests = tuple(
        _parse_request(item, ordinal_fallback=i + 1) for i, item in enumerate(raw_requests) if isinstance(item, dict)
    )
    if not requests:
        raise ValueError("scoring response's requests were not objects")

    return SessionScore(session_id=session_id, requests=requests)


def render_session_transcript(session: Session) -> str:
    """Renders a Session into the text block PROMPT expects as the user
    message (Implementation Notes 1.6's "transcript the prompt expects").

    Keeps the load-bearing shape that paragraph names — a `# session <id>`
    header, one `**role** (#ordinal, message_id, timestamp)` block per
    message followed by a `---` — and inlines each tool call under the
    message that made it, per the ticket's "add each tool call with its
    inputs inline under the assistant message that made it".

    [empty] is the one message tag derivable from Message alone (blank
    content). [context], [sentinel], [greeting] and [interrupted] all come
    from upstream classification this view does not carry yet (Message has
    no tag field) — a later story adds them once the view does; this
    renderer must not guess at a heuristic for a signal it was never given.
    """
    typed_user_turns = sum(1 for m in session.messages if m.role == "user" and m.content.strip())
    lines = [
        f"# session {session.session_id}",
        f"scope: {session.scope}",
        f"typed user turns: {typed_user_turns}",
        f"started: {session.started_at.isoformat()}",
        "",
    ]
    for ordinal, message in enumerate(session.messages, start=1):
        tag = " [empty]" if not message.content.strip() else ""
        lines.append(f"**{message.role}** (#{ordinal}, {message.message_id}, {message.created_at.isoformat()}){tag}")
        if message.content.strip():
            lines.append(message.content)
        for tool_call in message.tool_calls:
            lines.append(f"tool: {tool_call.tool} input: {tool_call.input}")
        lines.append("---")
    return "\n".join(lines)


def _response_text(payload: Any) -> str:
    content = payload.get("content") if isinstance(payload, dict) else None
    if not isinstance(content, list):
        return ""
    parts = [block.get("text", "") for block in content if isinstance(block, dict) and block.get("type") == "text"]
    return "".join(parts)


def _call_anthropic(system: str, transcript: str) -> str:
    """One Messages API call. NO `tools` key at all — not an empty list,
    not `tool_choice: none` — because this module's one job is to never
    give the model reading an untrusted transcript anything to act on (see
    this module's docstring). Returns the raw text content for
    `extract_json` to parse, matching Samuel's own script, which reads
    plain JSON text rather than a tool-call payload.

    Every way this call can fail — unreachable, timed out, a non-2xx
    status (a 429 or 529 from Anthropic), or a body that isn't JSON —
    becomes a `ScoringError`, same as a missing API key. `score_session`'s
    docstring promises callers a single per-session error type they can
    catch without aborting the whole run; leaving an `httpx` exception to
    escape here would silently break that promise on the first rate limit
    (same shape as `alert_filter.classifier._call_anthropic`'s own
    try/except, which this mirrors)."""
    key = ai_secrets.secret(_API_KEY_ENV)
    if not key:
        raise ScoringError(f"{_API_KEY_ENV} is not configured")

    try:
        response = httpx.post(
            _ANTHROPIC_URL,
            json={
                "model": MODEL,
                "max_tokens": _MAX_TOKENS,
                "system": system,
                "messages": [{"role": "user", "content": transcript}],
                "output_config": {"format": {"type": "json_schema", "schema": SCORE_SCHEMA}},
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
        raise ScoringError(f"Anthropic call failed: {e}") from e


def should_score(session: Session) -> bool:
    """Implementation Notes section 7: "A legacy ai-chat or unknown scope.
    Skipped. It's not a judge agent." Checked BEFORE any model call, so an
    unrecognized scope costs nothing and is never recorded as an error."""
    return session.scope in COVERED_SCOPES


def score_session(session: Session, call: Any = None) -> SessionScore:
    """Scores one session: one Opus call, no tools, retried once on a parse
    failure, then a ScoringError for that session (ticket Acceptance
    Criteria: "not silently dropped and not an infinite retry").

    `call` is injected (defaulting to `_call_anthropic`) so every test here
    runs without an API key and without a network, same pattern as
    `alert_filter.classifier.classify_alert`.
    """
    call = call or _call_anthropic
    transcript = render_session_transcript(session)

    last_error: Exception | None = None
    for _ in range(_MAX_ATTEMPTS):
        raw_text = call(PROMPT, transcript)
        try:
            return parse_scored_session(raw_text, session.session_id)
        except ValueError as e:
            last_error = e

    raise ScoringError(f"session {session.session_id}: scoring response could not be parsed after retry ({last_error})")


def score_session_if_covered(session: Session, call: Any = None) -> SessionScore | None:
    """`score_session`, but first applying `should_score`'s scope gate.
    Returns None (not an error, not a call) for a scope the scout doesn't
    cover yet — the single call site a later Reader story needs for
    "skipped, not scored or errored"."""
    if not should_score(session):
        return None
    return score_session(session, call=call)


@dataclass(frozen=True)
class Candidate:
    """One session selected for drafting (Implementation Notes section 3
    step 6 reads this list)."""

    session: Session
    score: SessionScore


def select_candidates(scored: list[tuple[Session, SessionScore]]) -> list[Candidate]:
    """Implementation Notes section 3 step 5: "Candidates are requests at
    severity 2 or 3 in a judge chat scope the scout covers... Order by
    severity, then by session start."

    Takes (session, score) pairs rather than scores alone because ordering
    needs each session's own start time, and the scope filter here is a
    second, independent check from `should_score` — a caller that scores
    every session it's handed (trusting its own upstream filtering) still
    gets the right candidate list even if that trust turns out to be wrong.
    """
    eligible = [
        Candidate(session=session, score=score)
        for session, score in scored
        if session.scope in COVERED_SCOPES and score.severity >= CANDIDATE_MIN_SEVERITY
    ]
    eligible.sort(key=lambda c: (-c.score.severity, c.session.started_at))
    return eligible
