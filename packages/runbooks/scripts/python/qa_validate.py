"""
qa_validate.py — Validate a generated output/ folder against the QA protocol.

Runs in order:
  1. Schema check      — required files exist and are valid JSON
  2. Deterministic     — rule-based checks (no LLM); hard blocks and annotations
  3. Phase 1 (Anthropic) — triage all claims in parallel
  4. Phase 2 (Gemini)  — escalate high-weight Phase-1-not-OK claims only
  5. Route             — Block / OK
  6. Write qa_bundle.json

Usage:
    uv run python qa_validate.py --output-dir output/run/
    uv run python qa_validate.py --output-dir output/run/ --no-llm   (deterministic only)
    uv run python qa_validate.py --output-dir output/run/ \\
        --product-spec path/to/meeting_briefing_product_spec.json

Loads credentials from ~/Research/.env:
  ANTHROPIC_API_KEY — Phase 1 triage judge
  GEMINI_API_KEY    — Phase 2 escalation judge

Product spec default: meeting_briefing_product_spec.json (same directory as this script).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from dotenv import load_dotenv
from pydantic import BaseModel


# ── Environment ───────────────────────────────────────────────────────────────

def _load_env() -> None:
    research_env = Path(__file__).resolve().parents[3] / ".env"
    load_dotenv(research_env)


# ── Product spec ──────────────────────────────────────────────────────────────

def load_product_spec(spec_path: Optional[Path] = None) -> dict:
    if spec_path is None:
        spec_path = Path(__file__).parent / "meeting_briefing_product_spec.json"
    if not spec_path.exists():
        sys.exit(f"ERROR: Product spec not found: {spec_path}")
    return json.loads(spec_path.read_text())


def blockable_types(spec: dict) -> set[str]:
    return {k for k, v in spec["claim_types"].items() if v.get("blockable")}


def ok_categories(spec: dict) -> set[str]:
    return set(spec["accuracy_categories"]["ok"])


# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class DeterministicCheck:
    check_id: str
    status: Literal["pass", "fail", "warning"]
    severity: str
    message: str
    route: Literal["block", "annotate", "pass"]
    offending: str = ""


@dataclass
class Phase1Result:
    claim_id: str
    accuracy_category: str
    reasoning: str
    is_ok: bool


@dataclass
class Phase2Result:
    claim_id: str
    accuracy_category: str
    reasoning: str
    is_ok: bool


@dataclass
class ClaimTrace:
    claim: dict
    phase1: Optional[Phase1Result] = None
    phase2: Optional[Phase2Result] = None
    final_route: str = "ok"


# ── Schema check ──────────────────────────────────────────────────────────────

def check_schema(output_dir: Path) -> tuple[dict, list[dict], list[dict], list[DeterministicCheck]]:
    results: list[DeterministicCheck] = []
    briefing, claims, sources = {}, [], []

    for fname, default in [("briefing.json", {}), ("claims.json", []), ("sources.json", [])]:
        path = output_dir / fname
        if not path.exists():
            results.append(DeterministicCheck(
                check_id=f"schema_{fname}",
                status="fail", severity="high",
                message=f"{fname} not found in {output_dir}",
                route="block",
            ))
        else:
            try:
                data = json.loads(path.read_text())
                if fname == "briefing.json":
                    briefing = data
                elif fname == "claims.json":
                    claims = data if isinstance(data, list) else []
                elif fname == "sources.json":
                    sources = data if isinstance(data, list) else []
            except json.JSONDecodeError as e:
                results.append(DeterministicCheck(
                    check_id=f"schema_{fname}",
                    status="fail", severity="high",
                    message=f"{fname} is invalid JSON: {e}",
                    route="block",
                ))

    return briefing, claims, sources, results


# ── Deterministic checks ──────────────────────────────────────────────────────

_PROHIBITED_PATTERNS = [
    r"\bPush for\b", r"\bEnsure that\b", r"\bMake clear that\b",
    r"\bDemand\b", r"\bInsist\b", r"\bFrame your\b",
    r"Look at the map", r"Don't commit", r"Walk in with",
]


def run_deterministic(
    briefing: dict,
    claims: list[dict],
    sources: list[dict],
    output_dir: Path,
    spec: dict,
) -> list[DeterministicCheck]:
    results: list[DeterministicCheck] = []

    # identity fields
    meeting = briefing.get("meeting", {})
    missing = [f for f in ("title", "date", "citySlug") if not meeting.get(f)]
    if missing:
        results.append(DeterministicCheck(
            check_id="identity_fields_present",
            status="fail", severity="high",
            message=f"Meeting identity fields missing: {missing}",
            route="block",
        ))
    else:
        results.append(DeterministicCheck(
            check_id="identity_fields_present",
            status="pass", severity="info",
            message="Meeting title, date, and citySlug present",
            route="pass",
        ))

    # at least one priority issue
    priority_issues = briefing.get("priorityIssues", [])
    if not priority_issues:
        results.append(DeterministicCheck(
            check_id="priority_count_nonzero",
            status="fail", severity="high",
            message="briefing.json has no priorityIssues",
            route="block",
        ))
    else:
        results.append(DeterministicCheck(
            check_id="priority_count_nonzero",
            status="pass", severity="info",
            message=f"{len(priority_issues)} priority issue(s) present",
            route="pass",
        ))

    # high-weight claims have extracts
    high_types = blockable_types(spec)
    no_extract = [
        c["claim_id"] for c in claims
        if (c.get("claim_type") in high_types or c.get("claim_weight") == "high")
        and not any(e.get("text") for e in c.get("source_extracts", []))
    ]
    if no_extract:
        results.append(DeterministicCheck(
            check_id="high_weight_claims_have_extracts",
            status="fail", severity="high",
            message=f"High-weight claims with no source extract: {no_extract}",
            route="block",
            offending=", ".join(no_extract),
        ))
    else:
        results.append(DeterministicCheck(
            check_id="high_weight_claims_have_extracts",
            status="pass", severity="info",
            message="All high-weight claims have source extracts",
            route="pass",
        ))

    # citation IDs resolve
    source_ids = {s.get("source_id") for s in sources if s.get("source_id")}
    broken_citations = [
        f"{c['claim_id']}→{sid}"
        for c in claims
        for sid in c.get("citation_ids", [])
        if sid not in source_ids
    ]
    if broken_citations:
        results.append(DeterministicCheck(
            check_id="citation_ids_resolve",
            status="fail", severity="high",
            message=f"Broken citation references: {broken_citations}",
            route="block",
            offending=", ".join(broken_citations),
        ))
    else:
        results.append(DeterministicCheck(
            check_id="citation_ids_resolve",
            status="pass", severity="info",
            message="All claim citations resolve to known sources",
            route="pass",
        ))

    # snapshot files exist
    missing_snapshots = [
        s["source_id"]
        for s in sources
        if s.get("snapshot_path") and not Path(s["snapshot_path"]).exists()
    ]
    if missing_snapshots:
        results.append(DeterministicCheck(
            check_id="snapshot_files_exist",
            status="warning", severity="medium",
            message=f"Declared snapshots not found on disk: {missing_snapshots}",
            route="annotate",
            offending=", ".join(missing_snapshots),
        ))
    else:
        results.append(DeterministicCheck(
            check_id="snapshot_files_exist",
            status="pass", severity="info",
            message="All declared snapshot files exist",
            route="pass",
        ))

    # prohibited phrases
    all_text = " ".join(
        " ".join(str(v) for v in issue.get("detail", {}).values())
        for issue in priority_issues
    )
    found_phrases = [p for p in _PROHIBITED_PATTERNS if re.search(p, all_text, re.IGNORECASE)]
    if found_phrases:
        results.append(DeterministicCheck(
            check_id="prohibited_phrases",
            status="warning", severity="low",
            message=f"Directive language detected in briefing text",
            route="annotate",
            offending="; ".join(found_phrases),
        ))
    else:
        results.append(DeterministicCheck(
            check_id="prohibited_phrases",
            status="pass", severity="info",
            message="No prohibited phrases detected",
            route="pass",
        ))

    # constituent data labeled
    for issue in priority_issues:
        sentiment = issue.get("constituentSentiment", {})
        if sentiment.get("available") and not sentiment.get("provenance_note"):
            results.append(DeterministicCheck(
                check_id="constituent_data_labeled",
                status="warning", severity="low",
                message=f"Constituent sentiment in '{issue.get('agendaItemTitle', '?')}' has no provenance note",
                route="annotate",
                offending=issue.get("slug", ""),
            ))
            break
    else:
        results.append(DeterministicCheck(
            check_id="constituent_data_labeled",
            status="pass", severity="info",
            message="Constituent sentiment sections are labeled",
            route="pass",
        ))

    return results


# ── LLM clients ───────────────────────────────────────────────────────────────

class _AdjudicationOutput(BaseModel):
    accuracy_category: Literal[
        "Accurate",
        "Directionally Consistent",
        "Extrapolating",
        "Modeled",
        "Not in Source — Verified Elsewhere",
        "Not in Source — Unresolved",
        "Incorrect",
        "Unverifiable",
    ]
    reasoning: str


_TRIAGE_SYSTEM = """You are a factual accuracy reviewer for civic briefing documents.

Given a factual claim and a source extract from a government agenda document, classify the claim's accuracy.

Categories:
- Accurate: The claim matches the source extract precisely.
- Directionally Consistent: The claim is generally aligned with the source but not verbatim.
- Extrapolating: The claim goes slightly beyond the source but is a reasonable inference from it.
- Modeled: The claim is explicitly based on modeled or estimated data (e.g., constituent sentiment scores).
- Not in Source — Verified Elsewhere: The claim cannot be found in this extract but may be correct from another source.
- Not in Source — Unresolved: The claim cannot be substantiated from the provided source.
- Incorrect: The claim contradicts the source extract.
- Unverifiable: The source exists but the claim cannot be verified against it as written.

Be direct. Do not hedge. If the extract is empty, classify as Not in Source — Unresolved."""


_ESCALATION_SYSTEM = """You are a senior fact-checker performing a thorough independent review of a civic briefing claim.

A first-pass review flagged this claim as potentially unsupported. Your task is to independently assess whether the claim is factually supported by the source passage provided.

Apply the same accuracy categories as the first reviewer. Do not simply defer to the first reviewer's judgment — form your own conclusion from the source text.

Categories:
- Accurate: Claim matches the source precisely.
- Directionally Consistent: Claim is generally aligned with the source but not verbatim.
- Extrapolating: Reasonable inference from the source.
- Modeled: Based on modeled/estimated data.
- Not in Source — Verified Elsewhere: Not in this source but may be correct.
- Not in Source — Unresolved: Cannot be substantiated.
- Incorrect: Contradicts the source.
- Unverifiable: Cannot be assessed from the source as written."""


def _anthropic_adjudicate(claim: dict, api_key: str, model: str = "claude-sonnet-4-6") -> _AdjudicationOutput:
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)

    extracts = claim.get("source_extracts", [])
    extract_text = extracts[0].get("text", "") if extracts else ""

    tool_def = {
        "name": "classify",
        "description": "Classify claim accuracy",
        "input_schema": _AdjudicationOutput.model_json_schema(),
    }
    prompt = (
        f"Claim: {claim['claim_text']}\n\n"
        f"Claim type: {claim.get('claim_type', 'unknown')}\n\n"
        f"Source extract:\n{extract_text or '(no extract provided)'}"
    )
    resp = client.messages.create(
        model=model,
        max_tokens=1024,
        system=_TRIAGE_SYSTEM,
        tools=[tool_def],
        tool_choice={"type": "tool", "name": "classify"},
        messages=[{"role": "user", "content": prompt}],
    )
    block = next((b for b in resp.content if b.type == "tool_use"), None)
    if block is None:
        raise RuntimeError("No tool_use block from Anthropic")
    return _AdjudicationOutput.model_validate(block.input)


def _gemini_adjudicate(claim: dict, phase1: Phase1Result, source_passage: str, api_key: str) -> _AdjudicationOutput:
    import google.generativeai as genai
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.0-flash")

    prompt = (
        f"{_ESCALATION_SYSTEM}\n\n"
        f"Claim: {claim['claim_text']}\n"
        f"Claim type: {claim.get('claim_type', 'unknown')}\n\n"
        f"First reviewer verdict: {phase1.accuracy_category}\n"
        f"First reviewer reasoning: {phase1.reasoning}\n\n"
        f"Full source passage:\n{source_passage or '(no source passage available)'}\n\n"
        f"Respond in JSON with exactly two fields: "
        f'"accuracy_category" (one of the eight categories) and "reasoning" (one sentence).'
    )
    resp = model.generate_content(prompt)
    raw = resp.text.strip()
    # Strip markdown code fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        data = json.loads(raw)
        return _AdjudicationOutput.model_validate(data)
    except Exception:
        # Fall back to extracting fields from text
        cat_match = re.search(
            r'"accuracy_category"\s*:\s*"([^"]+)"', raw
        )
        reason_match = re.search(r'"reasoning"\s*:\s*"([^"]+)"', raw)
        return _AdjudicationOutput(
            accuracy_category=cat_match.group(1) if cat_match else "Unverifiable",
            reasoning=reason_match.group(1) if reason_match else "Could not parse Gemini response",
        )


# ── Phase 1 — triage (Anthropic, all claims) ─────────────────────────────────

def phase1_triage(
    claims: list[dict],
    api_key: str,
) -> list[Phase1Result]:
    ok_cats = {
        "Accurate", "Directionally Consistent", "Extrapolating", "Modeled"
    }
    results: list[Phase1Result] = []
    for i, claim in enumerate(claims):
        cid = claim.get("claim_id", f"claim_{i}")
        try:
            out = _anthropic_adjudicate(claim, api_key)
            results.append(Phase1Result(
                claim_id=cid,
                accuracy_category=out.accuracy_category,
                reasoning=out.reasoning,
                is_ok=out.accuracy_category in ok_cats,
            ))
        except Exception as e:
            results.append(Phase1Result(
                claim_id=cid,
                accuracy_category="Unverifiable",
                reasoning=f"Phase 1 adjudication failed: {e}",
                is_ok=False,
            ))
    return results


# ── Phase 2 — escalation (Gemini, high-weight Phase-1-not-OK only) ────────────

def phase2_escalate(
    traces: list[ClaimTrace],
    sources: list[dict],
    api_key: str,
    blockable: set[str],
    ok_cats: set[str],
) -> None:
    """Mutates traces in-place, adding phase2 result for escalated claims."""
    source_map = {s["source_id"]: s for s in sources}

    for trace in traces:
        claim = trace.claim
        p1 = trace.phase1
        if p1 is None or p1.is_ok:
            continue
        if claim.get("claim_type") not in blockable and claim.get("claim_weight") != "high":
            continue

        # Gather source passage from snapshot
        source_passage = ""
        for sid in claim.get("citation_ids", []):
            src = source_map.get(sid, {})
            snap = src.get("snapshot_path")
            if snap and Path(snap).exists():
                source_passage = Path(snap).read_text(encoding="utf-8")[:4000]
                break

        try:
            out = _gemini_adjudicate(claim, p1, source_passage, api_key)
            trace.phase2 = Phase2Result(
                claim_id=claim.get("claim_id", ""),
                accuracy_category=out.accuracy_category,
                reasoning=out.reasoning,
                is_ok=out.accuracy_category in ok_cats,
            )
        except Exception as e:
            trace.phase2 = Phase2Result(
                claim_id=claim.get("claim_id", ""),
                accuracy_category="Unverifiable",
                reasoning=f"Phase 2 adjudication failed: {e}",
                is_ok=False,
            )


# ── Routing ───────────────────────────────────────────────────────────────────

def route(
    det_checks: list[DeterministicCheck],
    traces: list[ClaimTrace],
    blockable: set[str],
) -> tuple[str, str]:
    """Return (status, reason) — 'Block' or 'OK'."""
    # Deterministic hard blocks first
    for chk in det_checks:
        if chk.route == "block" and chk.status == "fail":
            return "Block", f"Deterministic check failed: {chk.check_id} — {chk.message}"

    # Claim adjudication blocks
    for trace in traces:
        claim = trace.claim
        if claim.get("claim_type") not in blockable and claim.get("claim_weight") != "high":
            continue
        if trace.phase2 is not None and not trace.phase2.is_ok:
            return (
                "Block",
                f"High-weight claim {claim.get('claim_id')} not supported after Phase 2 review "
                f"({trace.phase2.accuracy_category}): {trace.phase2.reasoning}"
            )

    return "OK", "All deterministic checks passed and no blockable claim failed Phase 2"


# ── Output ────────────────────────────────────────────────────────────────────

def write_bundle(
    output_dir: Path,
    briefing: dict,
    claims: list[dict],
    sources: list[dict],
    det_checks: list[DeterministicCheck],
    traces: list[ClaimTrace],
    status: str,
    reason: str,
    run_ts: str,
) -> Path:
    meeting = briefing.get("meeting", {})
    product_id = f"{meeting.get('citySlug', 'unknown')}_{meeting.get('date', 'unknown')}"

    bundle = {
        "product_id": product_id,
        "briefing_type": "meeting_briefing",
        "run_timestamp": run_ts,
        "final_status": status,
        "block_reason": reason if status == "Block" else None,
        "deterministic_checks": [
            {
                "check_id": c.check_id,
                "status": c.status,
                "severity": c.severity,
                "message": c.message,
                "route": c.route,
                "offending": c.offending or None,
            }
            for c in det_checks
        ],
        "sources": sources,
        "claims": [
            {
                **trace.claim,
                "phase1": {
                    "accuracy_category": trace.phase1.accuracy_category,
                    "reasoning": trace.phase1.reasoning,
                    "is_ok": trace.phase1.is_ok,
                } if trace.phase1 else None,
                "phase2": {
                    "accuracy_category": trace.phase2.accuracy_category,
                    "reasoning": trace.phase2.reasoning,
                    "is_ok": trace.phase2.is_ok,
                } if trace.phase2 else None,
                "final_route": trace.final_route,
            }
            for trace in traces
        ],
    }

    bundle_path = output_dir / "qa_bundle.json"
    bundle_path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False))
    return bundle_path


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output-dir", required=True, help="Output directory to validate")
    parser.add_argument("--product-spec", default="", help="Path to product spec JSON (default: meeting_briefing_product_spec.json)")
    parser.add_argument("--no-llm", action="store_true", help="Run deterministic checks only, skip LLM adjudication")
    args = parser.parse_args()

    _load_env()

    output_dir = Path(args.output_dir)
    if not output_dir.exists():
        sys.exit(f"ERROR: Output directory not found: {output_dir}")

    spec_path = Path(args.product_spec) if args.product_spec else None
    spec = load_product_spec(spec_path)
    blockable = blockable_types(spec)
    ok_cats = ok_categories(spec)

    run_ts = datetime.now(timezone.utc).isoformat()

    print(f"\n{'='*60}")
    print(f"QA VALIDATION — {output_dir}")
    print(f"{'='*60}")

    # 1. Schema
    print("\n[1/4] Schema check...")
    briefing, claims, sources, schema_checks = check_schema(output_dir)

    # Halt early if core files are missing
    if any(c.route == "block" and c.status == "fail" for c in schema_checks):
        print("  HALT: Required files missing — cannot continue validation")
        write_bundle(output_dir, {}, [], [], schema_checks, [], "Block",
                     "Required output files missing", run_ts)
        print(f"\nStatus: BLOCK")
        sys.exit(1)

    # 2. Deterministic
    print("[2/4] Deterministic checks...")
    det_checks = schema_checks + run_deterministic(briefing, claims, sources, output_dir, spec)

    det_fails = [c for c in det_checks if c.status == "fail"]
    det_warns = [c for c in det_checks if c.status == "warning"]
    print(f"  {len(det_fails)} failures, {len(det_warns)} warnings")

    # Build traces
    traces = [ClaimTrace(claim=c) for c in claims]

    # 3. Phase 1
    if not args.no_llm and claims:
        anthropic_key = os.getenv("ANTHROPIC_API_KEY")
        if not anthropic_key:
            print("[3/4] Phase 1 skipped — ANTHROPIC_API_KEY not set")
        else:
            print(f"[3/4] Phase 1 triage — {len(claims)} claims (Anthropic)...")
            p1_results = phase1_triage(claims, anthropic_key)
            p1_map = {r.claim_id: r for r in p1_results}
            for trace in traces:
                trace.phase1 = p1_map.get(trace.claim.get("claim_id", ""))

            not_ok = sum(1 for r in p1_results if not r.is_ok)
            print(f"  Phase 1 done: {not_ok}/{len(p1_results)} claims not-OK")
    else:
        print("[3/4] Phase 1 skipped (--no-llm or no claims)")

    # 4. Phase 2
    high_not_ok = [
        t for t in traces
        if t.phase1 and not t.phase1.is_ok
        and (t.claim.get("claim_type") in blockable or t.claim.get("claim_weight") == "high")
    ]

    if not args.no_llm and high_not_ok:
        gemini_key = os.getenv("GEMINI_API_KEY")
        if not gemini_key:
            print(f"[4/4] Phase 2 skipped — GEMINI_API_KEY not set ({len(high_not_ok)} claims need escalation)")
        else:
            print(f"[4/4] Phase 2 escalation — {len(high_not_ok)} high-weight not-OK claims (Gemini)...")
            phase2_escalate(traces, sources, gemini_key, blockable, ok_cats)
            blocked = sum(1 for t in traces if t.phase2 and not t.phase2.is_ok)
            print(f"  Phase 2 done: {blocked}/{len(high_not_ok)} claims still not-OK after escalation")
    else:
        reason = "--no-llm" if args.no_llm else "no high-weight not-OK claims"
        print(f"[4/4] Phase 2 skipped ({reason})")

    # Assign final_route per claim
    for trace in traces:
        claim = trace.claim
        ctype = claim.get("claim_type", "")
        is_blockable = ctype in blockable or claim.get("claim_weight") == "high"

        if trace.phase2 is not None and not trace.phase2.is_ok and is_blockable:
            trace.final_route = "block"
        elif trace.phase1 is not None and not trace.phase1.is_ok:
            trace.final_route = "annotate"
        else:
            trace.final_route = "ok"

    # 5. Route
    status, reason = route(det_checks, traces, blockable)

    # 6. Write
    bundle_path = write_bundle(
        output_dir, briefing, claims, sources, det_checks, traces, status, reason, run_ts
    )

    # Summary
    print(f"\n{'='*60}")
    print(f"Status: {status.upper()}")
    if status == "Block":
        print(f"Reason: {reason}")
    blocked_claims = sum(1 for t in traces if t.final_route == "block")
    annotated_claims = sum(1 for t in traces if t.final_route == "annotate")
    print(f"Claims: {len(traces)} total — {blocked_claims} blocked, {annotated_claims} annotated")
    det_block_count = sum(1 for c in det_checks if c.route == "block" and c.status == "fail")
    det_warn_count = sum(1 for c in det_checks if c.status in ("fail", "warning") and c.route == "annotate")
    print(f"Deterministic: {det_block_count} block-level, {det_warn_count} annotation-level")
    print(f"\nFull trace: {bundle_path}")
    sys.exit(0 if status == "OK" else 1)


if __name__ == "__main__":
    main()
