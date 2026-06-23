"""meeting_briefing deep QA check library — schema + deterministic checks the runner's shim can't express.

This is the SINGLE SOURCE OF TRUTH for the meeting_briefing checks, and a pure
CHECK LIBRARY: it exposes `validate_schema`, the ten `check_*` functions, the
`CHECKS` list, and the `Finding`/`Report` dataclasses. It has no entrypoint and
runs nothing on import. `qa/main.py` (the sole deterministic QA-gate entrypoint)
imports this module and drives it; the agent does NOT run these checks itself.

This file lives in the experiment's `qa/` folder
(`experiments/meeting_briefing/qa/qa_checks.py`) alongside `main.py`. The PMF QA
gate runs `qa/main.py` deterministically after the primary agent finishes, and
`main.py` imports `validate_schema` + `CHECKS` from here, then emits the
contract-C fragment array.

Experiment-specific deterministic QA — cross-reference integrity, required_data_points
coverage, discovery-channel depth for awaiting_agenda, etc. — is the kind of check the
runner's generic schema-only validator (pmf_engine/runner/main.py:_VALIDATOR_SCRIPT)
cannot express, which is why it lives here as its own module.

Two phases (orchestrated by main.py):
  1. JSON Schema validation (`validate_schema`) — re-runs the generic check so this
     file is sufficient on its own.
  2. Deterministic QA checks the schema cannot express (`CHECKS`):
       - cross-reference integrity (claim.item_id ↔ items[], source_ids ↔ sources[])
       - required_data_points coverage (every required: true point produced a value)
       - tier_reason / display consistency (budget_threshold → budget_impact non-null, etc.)
       - briefing_status / content consistency (awaiting_agenda → claims empty, etc.)
       - source_extract presence-in-source (substring check, not LLM)
       - awaiting_agenda / no_meeting_found: all 4 discovery channels attempted (channel_<N>_ prefixes)

No LLM calls. No external API requirements. Runs in well under a second on a typical artifact.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from typing import Any

try:
    import jsonschema
except ImportError:
    print("FATAL: jsonschema not installed. Run: uv add jsonschema", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Finding / Report dataclasses
# ---------------------------------------------------------------------------


@dataclass
class Finding:
    check: str
    severity: str  # "error" or "warning"
    message: str
    detail: Any = None


@dataclass
class Report:
    artifact_path: str
    schema_valid: bool
    schema_errors: list[str] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "error"]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "warning"]

    @property
    def passed(self) -> bool:
        return self.schema_valid and not self.errors


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------


def validate_schema(artifact: dict, schema: dict) -> list[str]:
    """Return a list of human-readable schema error messages. Empty list = valid."""
    validator = jsonschema.Draft7Validator(schema)
    errors = sorted(validator.iter_errors(artifact), key=lambda e: list(e.path))
    return [_format_schema_error(e) for e in errors]


def _format_schema_error(e: jsonschema.ValidationError) -> str:
    path = "$" + "".join(f"[{p!r}]" if isinstance(p, str) else f"[{p}]" for p in e.path)
    return f"{path}: {e.message}"


# ---------------------------------------------------------------------------
# Deterministic QA checks
# ---------------------------------------------------------------------------


def check_briefing_status_consistency(artifact: dict, findings: list[Finding]) -> None:
    """briefing_status should match the content shape."""
    status = artifact.get("briefing_status")
    items = artifact.get("items", [])
    claims = artifact.get("claims", [])
    featured = [it for it in items if it.get("tier") == "featured"]

    if status == "briefing_ready":
        if not featured:
            findings.append(Finding(
                "briefing_status.consistency",
                "error",
                "briefing_status='briefing_ready' but no items are tiered 'featured'. "
                "Either downgrade status to 'awaiting_agenda' or tier at least one item.",
            ))
    elif status == "awaiting_agenda":
        if claims:
            findings.append(Finding(
                "briefing_status.consistency",
                "error",
                f"briefing_status='awaiting_agenda' but claims[] has {len(claims)} entries. "
                "When agenda is awaiting, no factual claims should be present.",
            ))
        if featured:
            findings.append(Finding(
                "briefing_status.consistency",
                "warning",
                f"briefing_status='awaiting_agenda' but {len(featured)} items are tiered 'featured'. "
                "Featured items imply substantive content; verify the status is correct.",
            ))


def check_cross_reference_integrity(artifact: dict, findings: list[Finding]) -> None:
    """Every id reference resolves to an entry in the corresponding array."""
    item_ids = {it.get("id") for it in artifact.get("items", []) if it.get("id")}
    source_ids = {src.get("id") for src in artifact.get("sources", []) if src.get("id")}

    # claims[].item_id → items[]
    for claim in artifact.get("claims", []):
        cid = claim.get("claim_id")
        if claim.get("item_id") not in item_ids:
            findings.append(Finding(
                "claim.item_id_unresolved",
                "error",
                f"Claim {cid} references item_id='{claim.get('item_id')}' but no such item exists.",
            ))
        for sid in claim.get("source_ids", []):
            if sid not in source_ids:
                findings.append(Finding(
                    "claim.source_id_unresolved",
                    "error",
                    f"Claim {cid} references source_id='{sid}' but no such source exists.",
                ))

    # items[].display.source_ids → sources[]
    for item in artifact.get("items", []):
        iid = item.get("id")
        for sid in (item.get("display", {}).get("source_ids") or []):
            if sid not in source_ids:
                findings.append(Finding(
                    "item.display.source_id_unresolved",
                    "error",
                    f"Item {iid} display.source_ids references '{sid}' but no such source exists.",
                ))

    # items[].research.raw_context[].source_id → sources[]
    for item in artifact.get("items", []):
        iid = item.get("id")
        for chunk in (item.get("research", {}).get("raw_context") or []):
            cid = chunk.get("chunk_id")
            if chunk.get("source_id") not in source_ids:
                findings.append(Finding(
                    "raw_context.source_id_unresolved",
                    "error",
                    f"Item {iid} chunk {cid} references source_id='{chunk.get('source_id')}' but no such source exists.",
                ))

    # items[].display.budget_impact.figures[].source_id → sources[]
    for item in artifact.get("items", []):
        iid = item.get("id")
        bi = item.get("display", {}).get("budget_impact")
        if not bi:
            continue
        for fig in bi.get("figures", []):
            if fig.get("source_id") not in source_ids:
                findings.append(Finding(
                    "budget_impact.source_id_unresolved",
                    "error",
                    f"Item {iid} budget figure '{fig.get('label')}' references source_id='{fig.get('source_id')}' "
                    f"but no such source exists.",
                ))


def check_tier_reason_consistency(artifact: dict, findings: list[Finding]) -> None:
    """tier_reason content should be consistent with what's in display.*.

    Reasons are free-form strings (no enum). We use substring patterns so the check
    works for both the preferred values and any domain-specific reasons the agent
    coins. Pattern is: if reason text contains '<topic>', the corresponding display
    field is expected to be non-null.
    """
    for item in artifact.get("items", []):
        if item.get("tier") not in ("featured", "queued"):
            continue
        reasons_text = " ".join(r.lower() for r in (item.get("tier_reason") or []))
        display = item.get("display") or {}
        iid = item.get("id")

        if "budget" in reasons_text and not display.get("budget_impact"):
            findings.append(Finding(
                "tier_reason.budget_unbacked",
                "warning",
                f"Item {iid} has a tier_reason mentioning 'budget' but display.budget_impact is null.",
            ))
        if ("constituent" in reasons_text or "alignment" in reasons_text or "resonance" in reasons_text) \
                and not display.get("constituent_sentiment"):
            findings.append(Finding(
                "tier_reason.constituent_unbacked",
                "warning",
                f"Item {iid} has a tier_reason mentioning constituent alignment/resonance "
                f"but display.constituent_sentiment is null.",
            ))
        if "vote_required" in reasons_text and not item.get("vote_required"):
            findings.append(Finding(
                "tier_reason.vote_required_inconsistent",
                "error",
                f"Item {iid} has tier_reason 'vote_required' but vote_required field is false.",
            ))


def check_featured_item_completeness(artifact: dict, findings: list[Finding]) -> None:
    """Featured items should have talking_points and an overview, at minimum."""
    for item in artifact.get("items", []):
        if item.get("tier") != "featured":
            continue
        iid = item.get("id")
        display = item.get("display") or {}
        if not display.get("summary"):
            findings.append(Finding(
                "featured_item.missing_summary",
                "error",
                f"Featured item {iid} has empty display.summary.",
            ))
        tp = display.get("talking_points")
        if not tp:
            findings.append(Finding(
                "featured_item.missing_talking_points",
                "error",
                f"Featured item {iid} has no talking_points; the spec requires them on every featured item.",
            ))


def check_required_data_points_coverage(artifact: dict, findings: list[Finding]) -> None:
    """If a required_data_point is required=true, verify each in-scope item produced it."""
    status = artifact.get("briefing_status")
    if status in ("awaiting_agenda", "no_meeting_found", "error"):
        # No coverage expected — agent skipped the pipeline by design.
        return

    items = artifact.get("items", [])
    rdps = artifact.get("required_data_points", [])

    for rdp in rdps:
        if not rdp.get("required"):
            continue
        name = rdp.get("name")
        scope = rdp.get("scope")

        def in_scope(item: dict) -> bool:
            tier = item.get("tier")
            if scope == "all_items":
                return True
            if scope == "featured_queued":
                return tier in ("featured", "queued")
            if scope == "featured":
                return tier == "featured"
            return False

        # Map data-point name to which artifact field carries it.
        for item in items:
            if not in_scope(item):
                continue
            iid = item.get("id")
            display = item.get("display") or {}
            value = None
            if name == "summary":
                value = display.get("summary")
            elif name == "talking_points":
                value = display.get("talking_points")
            elif name == "raw_context":
                value = (item.get("research") or {}).get("raw_context")
            elif name == "constituent_sentiment":
                value = display.get("constituent_sentiment")
            elif name == "recent_news":
                value = display.get("recent_news")
            elif name == "budget_impact":
                value = display.get("budget_impact")
            else:
                # Unknown data point name — not our responsibility, skip.
                continue

            if not value:
                findings.append(Finding(
                    "required_data_point.missing",
                    "error",
                    f"Item {iid} (tier={item.get('tier')}) is in scope for required data point "
                    f"'{name}' but the value is missing or null.",
                ))


def check_source_extracts_in_source(artifact: dict, findings: list[Finding]) -> None:
    """Each claim.source_extracts entry should appear in at least one cited source's retrieved_text_or_snapshot.

    Substring match with whitespace normalization. Not a verbatim guarantee — designed to catch fabricated
    extracts and gross mis-citations, not subtle paraphrase issues (that's the LLM-adjudicated layer's job).
    """
    sources_by_id = {src.get("id"): src for src in artifact.get("sources", []) if src.get("id")}

    def normalize(s: str) -> str:
        return re.sub(r"\s+", " ", s).strip().lower()

    # Normalize each source's retrieved text ONCE, not per citing claim.
    normalized_by_id = {
        sid: normalize(src.get("retrieved_text_or_snapshot", ""))
        for sid, src in sources_by_id.items()
    }

    for claim in artifact.get("claims", []):
        cid = claim.get("claim_id")
        cited_ids = claim.get("source_ids") or []
        cited_texts = [normalized_by_id[sid] for sid in cited_ids if sid in normalized_by_id]
        for extract in claim.get("source_extracts") or []:
            if not extract:
                continue
            needle = normalize(extract)
            if not needle:
                continue
            # Try full match first.
            if any(needle in haystack for haystack in cited_texts):
                continue
            # Fall back: try the first ~60 chars (handles long extracts with trivial drift).
            head = needle[:60]
            if len(head) >= 20 and any(head in haystack for haystack in cited_texts):
                findings.append(Finding(
                    "source_extract.partial_match_only",
                    "warning",
                    f"Claim {cid}: extract matched on first 60 chars but not in full. "
                    f"Possible verbatim drift. Extract starts: {extract[:80]!r}",
                ))
                continue
            findings.append(Finding(
                "source_extract.not_found_in_source",
                "error",
                f"Claim {cid}: source_extract not found in any cited source's retrieved_text_or_snapshot. "
                f"Extract starts: {extract[:80]!r}. Cited source_ids: {cited_ids}",
            ))


def check_disclosure_present(artifact: dict, findings: list[Finding]) -> None:
    """Disclosure must include the canonical phrases. Substring check, not exact match."""
    disclosure = artifact.get("disclosure") or ""
    required_phrases = [
        "AI assistance",
        "may contain errors",
        "modeled estimate",
    ]
    missing = [p for p in required_phrases if p.lower() not in disclosure.lower()]
    if missing:
        findings.append(Finding(
            "disclosure.missing_required_phrases",
            "error",
            f"disclosure is missing required phrases: {missing}. "
            f"See required_disclosure.md for the canonical text.",
        ))


def check_run_decisions_meaningful(artifact: dict, findings: list[Finding]) -> None:
    """run_decisions should explain anything unusual — surface specific patterns."""
    status = artifact.get("briefing_status")
    decisions = (artifact.get("run_metadata") or {}).get("run_decisions") or []
    if status in ("awaiting_agenda", "no_meeting_found", "agenda_provided_by_user", "error") and not decisions:
        findings.append(Finding(
            "run_decisions.missing_for_nondefault_status",
            "error",
            f"briefing_status='{status}' but run_metadata.run_decisions[] is empty. "
            f"Status transitions away from briefing_ready must be explained.",
        ))


_CHANNEL_PREFIX_RE = re.compile(r"^channel_([1-4])_")
_REQUIRED_CHANNELS = frozenset(range(1, 5))
# When `no_meeting_found` is recorded as a stale-schedule signal (the agent
# verified the caller-supplied date and the platform showed no meeting on
# that date), the agent emits a single decision with the
# `no_meeting_on_target_date` reason instead of exhausting the 4-channel
# packet discovery. Packet discovery only applies when a target meeting was
# confirmed but the packet may or may not exist yet (the `awaiting_agenda`
# path).
_STALE_SCHEDULE_REASONS = frozenset({"no_meeting_on_target_date"})


def check_awaiting_agenda_discovery_depth(artifact: dict, findings: list[Finding]) -> None:
    """awaiting_agenda requires all 4 discovery channels attempted.

    The packet-discovery procedure has 4 distinct channels (instruction.md). Each
    attempted channel must produce a run_decisions[] entry whose `decision`
    begins with `channel_<N>_` for N in 1-4. Channel 1's per-platform sub-attempts
    are grouped under a single channel_1_* entry (in its `reason`); they do NOT
    each get their own top-level entry — otherwise a 10-platform channel-1 run
    could falsely clear a numeric-only count gate without touching channels 2-4.

    This check is the teeth behind the instruction's claim that the validator
    rejects awaiting_agenda artifacts that skip channels — without it, the
    instruction's enforcement promise was vacuous.

    `no_meeting_found` artifacts that record `no_meeting_on_target_date`
    (the stale-schedule signal path) are exempt from the 4-channel
    requirement: the agent never reached packet discovery because the
    target meeting did not exist on the platform.
    """
    status = artifact.get("briefing_status")
    if status not in ("awaiting_agenda", "no_meeting_found"):
        return
    decisions = (artifact.get("run_metadata") or {}).get("run_decisions") or []
    if status == "no_meeting_found" and any(
        (d.get("reason") or "") in _STALE_SCHEDULE_REASONS for d in decisions
    ):
        return
    channels_seen: set[int] = set()
    for d in decisions:
        m = _CHANNEL_PREFIX_RE.match((d.get("decision") or ""))
        if m:
            channels_seen.add(int(m.group(1)))
    missing = sorted(_REQUIRED_CHANNELS - channels_seen)
    if missing:
        findings.append(Finding(
            "run_decisions.discovery_channels_incomplete",
            "error",
            f"briefing_status='{status}' but run_metadata.run_decisions[] is missing "
            f"channel attempts for {missing}. Each of the 4 discovery channels "
            f"requires a run_decisions[] entry whose decision begins with "
            f"`channel_<N>_<short-label>` (N=1-4). Saw channels: {sorted(channels_seen) or 'none'}.",
        ))


_PLACEHOLDER_LOCATIONS = frozenset({"tbd", "unknown", "n/a", "na", "none", "?", "-"})
# Per-meeting deep-link signals. Kept in sync with the schedule checker
# (experiments/meeting_schedule/attachments/qa_checks.py). The briefing
# checker additionally treats a bare `.pdf` suffix as a deep link (see
# .endswith check below) because a `.pdf` URL recorded for an agenda hint
# is almost always one specific meeting's packet — unlike for schedules,
# where municipal-code PDFs are legitimate parent docs.
_DEEP_LINK_HINTS = (
    "metaviewer.php",
    "meta_id=",
    "matters/",
    "/file/",
    ".pdf?",
    "legislationdetail.aspx",
    "eventitems",
    "meetingdetail.aspx",
    "/event/",
)


def check_discovered_agenda_location(artifact: dict, findings: list[Finding]) -> None:
    """run_metadata.discovered_agenda_location is the hint gp-api hands to the
    next run for the same body. It's optional, but worth nudging when it looks
    wrong: missing on a briefing_ready run, placeholder text, or a deep link
    to one packet instead of a parent page that lists meetings.
    """
    status = artifact.get("briefing_status")
    location = (artifact.get("run_metadata") or {}).get("discovered_agenda_location")

    if location is None:
        if status == "briefing_ready":
            findings.append(Finding(
                "discovered_agenda_location.missing",
                "warning",
                "briefing_status='briefing_ready' but run_metadata.discovered_agenda_location is null. "
                "Subsequent runs for this body will start from scratch. Set it to the parent page "
                "where future packets will likely be found (calendar, meetings index, CDN directory).",
            ))
        return

    if not isinstance(location, str):
        return

    stripped = location.strip()
    if stripped.lower() in _PLACEHOLDER_LOCATIONS or len(stripped) < 8:
        findings.append(Finding(
            "discovered_agenda_location.placeholder",
            "warning",
            f"run_metadata.discovered_agenda_location looks like a placeholder ('{stripped[:50]}'). "
            f"Either provide a real URL/prose or set it to null.",
        ))
        return

    low = stripped.lower()
    if any(hint in low for hint in _DEEP_LINK_HINTS) or low.endswith(".pdf"):
        findings.append(Finding(
            "discovered_agenda_location.deep_link",
            "warning",
            f"run_metadata.discovered_agenda_location looks like a deep link to one packet "
            f"('{stripped[:120]}'). Prefer the parent page that LISTS meetings (calendar, "
            f"agendas index, CDN directory) so the next run can find a different meeting's packet.",
        ))


CHECKS = [
    check_briefing_status_consistency,
    check_cross_reference_integrity,
    check_tier_reason_consistency,
    check_featured_item_completeness,
    check_required_data_points_coverage,
    check_source_extracts_in_source,
    check_disclosure_present,
    check_run_decisions_meaningful,
    check_awaiting_agenda_discovery_depth,
    check_discovered_agenda_location,
]
