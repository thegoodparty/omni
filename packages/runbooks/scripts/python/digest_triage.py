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


# --- judge: schema + prompt (pure) ---------------------------------------------


class TriageVerdict(BaseModel):
    id: str = Field(description="Item id, copied verbatim from the input.")
    tier: Literal["red", "yellow", "fyi"] = Field(
        description="Final tier per the rubric; at most one step from rules_tier."
    )
    headline: str = Field(description="One line: what happened, with the key numbers.")
    action: str = Field(description="One line: the next concrete step; empty if none.")
    reason: str = Field(description="Why this tier, especially when moved from rules_tier.")


class TriageBatch(BaseModel):
    results: list[TriageVerdict]


TRIAGE_TOOL = {
    "name": "report_digest_triage",
    "description": "Return one triage verdict per digest item, applying the tier rubric.",
    "input_schema": TriageBatch.model_json_schema(),
}

_TRIAGE_INSTRUCTIONS = (
    "You are triaging analytics event-health items for a governance Slack digest. The "
    "rubric above is authoritative. Each item carries rules_tier — the deterministic "
    "baseline; keep it unless the facts clearly warrant moving ONE tier, and never demote "
    "a red item that has an okr value. For every item write the headline and action per "
    "the rubric's editorial rules, using only the facts provided. Copy each id verbatim. "
    "Return exactly one verdict per item via the tool."
)


def triage_system_prompt(rubric: str) -> str:
    return f"{rubric}\n\n---\n\n{_TRIAGE_INSTRUCTIONS}"


def build_triage_messages(items: Sequence[Mapping[str, Any]]) -> list[dict]:
    """One user turn carrying the item set as JSON (dates stringified)."""
    content = "Digest items to triage:\n\n" + json.dumps(list(items), indent=2, default=str)
    return [{"role": "user", "content": content}]


def clamp_tier(rules: str, judged: str, *, red_floor: bool) -> str:
    """Bound the judge to one tier of movement; the red floor pins OKR breaks."""
    if red_floor and rules == "red":
        return "red"
    rules_i, judged_i = _TIER_INDEX[rules], _TIER_INDEX[judged]
    if abs(judged_i - rules_i) > 1:
        judged_i = rules_i + (1 if judged_i > rules_i else -1)
    return TIERS[judged_i]


def has_red(items: Sequence[Mapping[str, Any]]) -> bool:
    """Red on the RULES tier — decidable before (and without) the API call, so the quiet
    gate can use it."""
    return any(rules_tier(i) == "red" for i in items)


# --- judge: call + never-raise wrapper ------------------------------------------


def make_anthropic_client(api_key: str):
    """Local import so the module still imports when the dependency is absent."""
    import anthropic

    return anthropic.Anthropic(api_key=api_key)


def _judge_items(items: Sequence[dict], rubric: str, *, client, model: str,
                 max_tokens: int = 4096) -> dict[str, dict]:
    resp = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=triage_system_prompt(rubric),
        tools=[TRIAGE_TOOL],
        tool_choice={"type": "tool", "name": TRIAGE_TOOL["name"]},
        messages=build_triage_messages(items),
    )
    block = next((b for b in resp.content if getattr(b, "type", None) == "tool_use"), None)
    if block is None:
        raise RuntimeError("no tool_use block in triage response")
    batch = TriageBatch.model_validate(block.input)
    allowed = {i["id"] for i in items}
    return {v.id: v.model_dump() for v in batch.results if v.id in allowed}


def run_triage(
    items: list[dict],
    *,
    api_key: str | None,
    model: str = DEFAULT_MODEL,
    rubric_path: Path = DEFAULT_RUBRIC_PATH,
    client_factory=make_anthropic_client,
) -> dict:
    """Never raises. Returns {"status", "items"} — every item stamped with rules_tier,
    tier, headline, action; the judge refines them when available, the deterministic
    fallback stands when it is not (status says which)."""
    for item in items:
        item["rules_tier"] = rules_tier(item)
        item["tier"] = item["rules_tier"]
        item["headline"] = _fallback_headline(item)
        item["action"] = ""
    if not items:
        return {"status": "no-items", "items": []}
    if not api_key:
        return {"status": "skipped: ANTHROPIC_API_KEY unset", "items": items}
    try:
        rubric = rubric_path.read_text()
    except OSError:
        return {"status": "skipped: rubric unavailable", "items": items}
    try:
        client = client_factory(api_key)
        verdicts = _judge_items(items, rubric, client=client, model=model)
    except Exception as exc:  # noqa: BLE001 — triage must never break the governance run
        return {"status": f"failed: {exc}", "items": items}
    for item in items:
        verdict = verdicts.get(item["id"])
        if not verdict:
            continue
        item["tier"] = clamp_tier(item["rules_tier"], verdict["tier"],
                                  red_floor=bool(item.get("okr")))
        if verdict.get("headline"):
            item["headline"] = _sanitize(verdict["headline"])
        if verdict.get("action"):
            item["action"] = _sanitize(verdict["action"])
        if verdict.get("reason"):
            item["judge_reason"] = _sanitize(verdict["reason"])
    return {"status": "ok", "items": items}
