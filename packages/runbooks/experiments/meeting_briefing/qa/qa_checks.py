"""meeting_briefing deep QA check library — schema + deterministic checks the runner's shim can't express.

This is the SINGLE SOURCE OF TRUTH for the meeting_briefing checks, and a pure
CHECK LIBRARY: it exposes `validate_schema`, the twelve `check_*` functions, the
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
       - recent_news recency (publication_date present and within 60 days of meeting_date)
       - source_extract presence-in-source (substring check, not LLM)
       - awaiting_agenda / no_meeting_found: all 4 discovery channels attempted (channel_<N>_ prefixes)

No LLM calls. No external API requirements. Runs in well under a second on a typical artifact.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from datetime import date
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


def check_recent_news_recency(artifact: dict, findings: list[Finding]) -> None:
    """Every recent_news entry must carry a publication_date within 60 days of meeting_date.

    The schema already requires publication_date to be present and non-null (Problem
    Statement 2); this check adds the temporal bound the schema's format:"date" cannot
    express on its own. Pure date arithmetic on data already in the artifact — no network
    calls, consistent with the QA gate's side-effect-free convention.
    """
    meeting_date_str = artifact.get("meeting_date")
    if not meeting_date_str:
        return
    try:
        meeting_date = date.fromisoformat(meeting_date_str)
    except ValueError:
        return  # malformed meeting_date is a schema/consistency problem, not ours to report

    for item in artifact.get("items", []):
        iid = item.get("id")
        display = item.get("display") or {}
        for entry in display.get("recent_news") or []:
            headline = (entry.get("headline") or "")[:80]
            pub_date_str = entry.get("publication_date")
            if not pub_date_str:
                findings.append(Finding(
                    "recent_news.missing_publication_date",
                    "error",
                    f"Item {iid} recent_news entry {headline!r} has no publication_date.",
                ))
                continue
            try:
                pub_date = date.fromisoformat(pub_date_str)
            except ValueError:
                findings.append(Finding(
                    "recent_news.invalid_publication_date",
                    "error",
                    f"Item {iid} recent_news entry {headline!r} has an unparseable "
                    f"publication_date: {pub_date_str!r}.",
                ))
                continue
            age_days = (meeting_date - pub_date).days
            if age_days > 60:
                findings.append(Finding(
                    "recent_news.stale",
                    "error",
                    f"Item {iid} recent_news entry {headline!r} is dated {pub_date_str}, "
                    f"{age_days} days before meeting_date {meeting_date_str} (limit 60).",
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
# A channel-0 POSITIVE read at the known agenda location (the hint passed from a
# prior run) lets the agent bail without exhausting channels 1-4: it already
# confirmed the meeting/agenda state at the authoritative location. Each bail
# label is status-gated to the status it maps to in instruction.md, so a
# mislabeled artifact (e.g. no_meeting_found carrying the awaiting_agenda label)
# is NOT exempted — the decision field is a free-form string with no schema enum,
# so this is the only guard against that contradiction. channel_0_unreachable_or_
# unconfirmed is deliberately absent, so a failure to reach the hint still forces
# full 4-channel discovery. Mirrors the status-gated stale-schedule exemption above.
_CHANNEL_0_BAIL_BY_STATUS = {
    "awaiting_agenda": "channel_0_confirmed_no_agenda_yet",
    "no_meeting_found": "channel_0_confirmed_no_meeting",
}


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

    Both `awaiting_agenda` and `no_meeting_found` artifacts that record a
    channel-0 CONFIRMED bail (`channel_0_confirmed_no_agenda_yet` /
    `channel_0_confirmed_no_meeting`) are likewise exempt: channel 0
    positively confirmed the meeting/agenda state at the known agenda
    location, so the 4-channel sweep is redundant.
    """
    status = artifact.get("briefing_status")
    if status not in ("awaiting_agenda", "no_meeting_found"):
        return
    decisions = (artifact.get("run_metadata") or {}).get("run_decisions") or []
    if status == "no_meeting_found" and any(
        (d.get("reason") or "") in _STALE_SCHEDULE_REASONS for d in decisions
    ):
        return
    expected_bail = _CHANNEL_0_BAIL_BY_STATUS.get(status)
    if expected_bail and any(
        (d.get("decision") or "") == expected_bail for d in decisions
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


# GoodParty/data internals that NEVER legitimately appear anywhere in a briefing —
# our modeled-sentiment column ids, the data table, and the query column. Forbidden
# in every field (including verbatim external snapshots). Regression gate for the
# "Constituent-data framing" rule in instruction.md.
_ALWAYS_INTERNAL_RE = re.compile(
    r"hs_[a-z0-9_]+|goodparty_data_catalog|int__l2\w*|Voters_Active",
    re.IGNORECASE,
)
# Ambiguous terms — forbidden only where WE describe modeled data (constituent-
# sentiment prose and the constituent-data source itself). Agenda/news content can
# legitimately mention "L2" (a route/district code), "Databricks" (an IT vendor),
# "Haystaq", or "voter file", so these are NOT flagged in general item prose or in
# non-constituent (agenda/news) source names and snapshots.
_CONSTITUENT_TERM_RE = re.compile(
    r"\bhaystaq\b|\bdatabricks\b|\bl2\b|\bvoter file\b",
    re.IGNORECASE,
)
_POSTURE_RE = re.compile(r"posture override", re.IGNORECASE)


def _framing_leak(text: str, strict: bool):
    """Return the offending match, or None. `strict` adds the ambiguous constituent
    terms (used for our modeled-data prose + the constituent-data source)."""
    m = _ALWAYS_INTERNAL_RE.search(text)
    if m:
        return m
    return _CONSTITUENT_TERM_RE.search(text) if strict else None


def check_no_data_internals_in_candidate_text(artifact: dict, findings: list[Finding]) -> None:
    """Candidate-facing text must never expose data-source internals, nor the
    instruction's own "posture override" directive. Unambiguous internals (hs_*,
    table, Voters_Active) are forbidden everywhere; the ambiguous terms (L2,
    Databricks, Haystaq, voter file) are forbidden only in our modeled-data prose
    and the constituent-data source, since agenda/news content may legitimately
    use them."""

    def scan(field, text, strict):
        if not text:
            return
        m = _framing_leak(text, strict)
        if m:
            findings.append(Finding(
                "candidate_text.data_source_internal_leak",
                "error",
                f"{field} exposes a data-source internal ('{m.group(0)}') to the official. "
                f"Describe constituent data in plain English as GoodParty.org's data; keep "
                f"hs_*/Haystaq/L2/Databricks/voter-file/table names out of candidate-facing text.",
            ))
        # The posture-override directive is internal authorization, not content, and
        # must not leak into ANY candidate-facing field (instruction.md forbids it globally).
        if _POSTURE_RE.search(text):
            findings.append(Finding(
                "candidate_text.posture_override_leak",
                "error",
                f"{field} contains a 'posture override' directive — internal authorization, "
                f"not content. Text: {text[:120]!r}",
            ))

    es = artifact.get("executive_summary") or {}
    scan("executive_summary.lead_in", es.get("lead_in") or "", False)
    for i, e in enumerate(es.get("items") or []):
        scan(f"executive_summary.items[{i}].overview", e.get("overview") or "", False)
    for it in artifact.get("items") or []:
        iid = it.get("id")
        d = it.get("display") or {}
        scan(f"items[{iid}].display.summary", d.get("summary") or "", False)
        cs = d.get("constituent_sentiment")
        if isinstance(cs, dict):
            for k in ("summary", "detail", "score_direction", "district_note"):
                scan(f"items[{iid}].display.constituent_sentiment.{k}", cs.get(k) or "", True)
        for j, tp in enumerate(d.get("talking_points") or []):
            # talking_points is oneOf legacy array<string> / new array<{text, why}> — scan whichever shape.
            if isinstance(tp, dict):
                scan(f"items[{iid}].display.talking_points[{j}].text", tp.get("text") or "", False)
                scan(f"items[{iid}].display.talking_points[{j}].why", tp.get("why") or "", False)
            else:
                scan(f"items[{iid}].display.talking_points[{j}]", tp or "", False)
        bi = d.get("budget_impact")
        if isinstance(bi, dict):
            scan(f"items[{iid}].display.budget_impact.summary", bi.get("summary") or "", False)
    # Sources: the constituent-data source (source_type 'haystaq') is held to the
    # strict set on both its name and snapshot; other sources (agenda/news/etc.) only
    # to the unambiguous internals, since their names/snapshots quote external text.
    for s in artifact.get("sources") or []:
        strict = s.get("source_type") == "haystaq"
        scan(f"sources[{s.get('id')}].name", s.get("name") or "", strict)
        snap = s.get("retrieved_text_or_snapshot") or ""
        m = _framing_leak(snap, strict) if snap else None
        if m:
            findings.append(Finding(
                "source_snapshot.data_source_internal_leak",
                "error",
                f"sources[{s.get('id')}].retrieved_text_or_snapshot contains a data-source "
                f"internal ('{m.group(0)}'). Keep hs_* columns, table names, and SQL out; "
                f"summarize constituent data as GoodParty.org's data.",
            ))
        if snap and _POSTURE_RE.search(snap):
            findings.append(Finding(
                "source_snapshot.posture_override_leak",
                "error",
                f"sources[{s.get('id')}].retrieved_text_or_snapshot contains a 'posture "
                f"override' directive — internal authorization, not content.",
            ))


CHECKS = [
    check_briefing_status_consistency,
    check_cross_reference_integrity,
    check_tier_reason_consistency,
    check_featured_item_completeness,
    check_required_data_points_coverage,
    check_recent_news_recency,
    check_source_extracts_in_source,
    check_disclosure_present,
    check_run_decisions_meaningful,
    check_awaiting_agenda_discovery_depth,
    check_discovered_agenda_location,
    check_no_data_internals_in_candidate_text,
]
