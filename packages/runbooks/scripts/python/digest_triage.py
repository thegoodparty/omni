"""Priority triage for the governance Slack digest (DATA-2174).

Sits between analytics_event_health's reconcile/diff output and the Slack renderer.
Deterministic first: every digest item gets a rules tier (red / yellow / fyi) from the
OKR flag, watchlist membership, and health rank — auditable and always available. Then
one rubric-guided LLM pass (same harness as instrumentation_gaps.py's judge: Anthropic
SDK, tool-forced, Pydantic-validated, never-raise) may move an item by one tier and
writes the per-item headline/action text. The clamp and the red floor (an OKR break can
never be demoted) keep the judge's latitude bounded; any failure degrades to the rules
tier with templated text, so the digest posts regardless.

Red persistence: an OKR-anchored event in a breaking state is included every run until
it resolves — the DATA-2174 case study broke precisely because a one-time transition
line scrolled away while the OKR sat wrong for a month.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal, Mapping, Sequence

from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
DEFAULT_RUBRIC_PATH = HERE / "digest_triage_rubric.md"
DEFAULT_MODEL = os.environ.get("DIGEST_TRIAGE_MODEL", "claude-sonnet-5")

TIERS = ("red", "yellow", "fyi")
_TIER_INDEX = {t: i for i, t in enumerate(TIERS)}

# Health ranks that count as a breaking signal on an OKR-anchored event. Rank 5 (intent
# divergence) is metadata drift, not a broken pipe, so it stays yellow; 99 is unflagged.
_BREAKING_RANKS = {0, 1, 2, 3, 4, 6, 7}
_HEADLINE_CAP = 200


def _sanitize(text: str | None, cap: int = _HEADLINE_CAP) -> str:
    """One rendering-safe line from judge-authored text: newlines/pipes collapse to
    spaces (they would break the single-line Slack layout), length capped."""
    cleaned = " ".join((text or "").replace("|", " ").split())
    return cleaned[:cap]


def rules_tier(item: Mapping[str, Any]) -> str:
    """Deterministic tier — the auditable baseline the judge adjusts around."""
    if item.get("change") == "resolved":
        return "fyi"
    rank = item.get("rank", 99)
    if item.get("okr") and rank in _BREAKING_RANKS:
        return "red"
    if rank <= 2:
        return "red" if item.get("on_watchlist") else "yellow"
    if item.get("anomaly"):
        return "yellow"
    if item.get("on_watchlist") or item.get("elevated"):
        return "yellow"
    return "fyi"


def _item_from_record(event: str, rec: Mapping[str, Any], change: str | None,
                      prior_status: str | None) -> dict:
    return {
        "id": event,
        "event_type": event,
        "change": change,
        "prior_status": prior_status,
        "status": rec.get("status"),
        "rank": rec.get("rank", 99),
        "okr": rec.get("okr"),
        "on_watchlist": rec.get("on_watchlist", False),
        "elevated": rec.get("elevated", False),
        "anomaly": rec.get("anomaly"),
        "event_count_30d": rec.get("event_count_30d"),
        "last_seen_date": rec.get("last_seen_date"),
        "instrumented_pr": rec.get("instrumented_pr"),
        "divergence": rec.get("divergence"),
        "purpose": (rec.get("gpmeta") or {}).get("purpose"),
    }


def build_items(
    result: Mapping[str, Any],
    changes: Mapping[str, list[str]],
    prior_state: Mapping[str, str] | None = None,
    prior_anomalous: set[str] | None = None,
) -> list[dict]:
    """One triage item per newsworthy event: every transition (new/escalated/resolved),
    every *newly* anomalous flagged event (same prior_anomalous semantics as the quiet
    gate — None suppresses, matching event_state_slack._new_anomalies), and — the
    persistence rule — every OKR-anchored event currently in a breaking state, changed
    or not. Resolved events have left the flagged set, so their item carries only the
    change and prior status."""
    recs = {r["event_type"]: r for r in result.get("flagged", [])}
    prior = dict(prior_state or {})
    changed: dict[str, str] = {}
    for kind in ("escalated", "new", "resolved"):
        for event in changes.get(kind, []):
            changed[event] = kind
    events = dict(changed)
    if prior_anomalous is not None:
        for r in result.get("flagged", []):
            if r.get("anomaly") and r["event_type"] not in prior_anomalous:
                events.setdefault(r["event_type"], "still_open"
                                  if r["event_type"] in prior else None)
    for r in result.get("flagged", []):
        if r.get("okr") and r.get("rank", 99) in _BREAKING_RANKS:
            events.setdefault(r["event_type"], "still_open"
                              if r["event_type"] in prior else None)
    return [
        _item_from_record(e, recs.get(e, {}), change, prior.get(e))
        for e, change in events.items()
    ]


def _fallback_headline(item: Mapping[str, Any]) -> str:
    anomaly = item.get("anomaly")
    if anomaly:
        baseline = anomaly["baseline"]
        pct = (f"{round((anomaly['current'] - baseline) / baseline * 100):+d}%"
               if baseline else "n/a")
        return f"{pct} WoW ({baseline:,.0f} → {anomaly['current']:,})"
    change = item.get("change")
    if change == "resolved":
        return "resolved"
    if change == "new":
        return f"newly flagged ({item.get('status') or '?'})"
    if change == "escalated":
        return f"{item.get('prior_status') or '?'} → {item.get('status') or '?'}"
    return f"still {item.get('status') or 'flagged'}"
