#!/usr/bin/env python3
"""Offline external-faithfulness checker for meeting_briefing artifacts (candidate Gate B3).

The rubric's Gate B2 compares each claim only to its *own embedded* `source_extract` —
internal grounding an optimizer can fake on both sides. This checks each claim's identity
figures (money, percent, legal citation, date) against the *cited source's captured text*,
deterministically and with no live fetch.

Two source-text modes:
  - default: the artifact's own `sources[].retrieved_text_or_snapshot` (cheap, always
    present; catches naive fabrication where the claim was altered but the snapshot was not).
  - gaming-resistant: pass `source_text_for=resolver`, where `resolver(source_id)` returns
    the runner-persisted raw download text (agent-uncontrolled), so an optimizer that also
    rewrites the embedded snapshot is still caught.

Usage (coverage over a directory of artifacts):
  uv run scripts/python/faithfulness_check.py <dir-of-artifact-json> [--gate-source-type agenda_packet]
"""
import json
import re
import sys
import glob

# Identity figures the rubric calls out: dollar amounts, dates, vote counts, legal citations.
_MONEY = re.compile(r"\$\s?\d[\d,]*(?:\.\d+)?")
_PERCENT = re.compile(r"\d+(?:\.\d+)?\s?%")
_MONTHS = (
    "January|February|March|April|May|June|July|August|"
    "September|October|November|December"
)
_DATE_NAMED = re.compile(rf"\b(?:{_MONTHS})\s+\d{{1,2}}(?:st|nd|rd|th)?,?\s+\d{{4}}")
_DATE_ISO = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
# A hyphenated number sequence (e.g. 54-17-903(3)) counts as a legal citation ONLY when a
# legal cue precedes it; otherwise it is a vote tally (15-9-1) or a date and must not be pulled.
_LEGAL_NUM = re.compile(r"\d{1,4}(?:-\d{1,4}){1,3}(?:\(\w+\))?")
_LEGAL_CUE = re.compile(
    r"(?i)(?:§|sec(?:tion)?\.?|code|chapter|article|title|ordinance|statute|u\.?s\.?c\.?|rev\.?\s*stat)\s*§?\s*$"
)


def normalize(text: str) -> str:
    """Lowercase, drop ordinal suffixes (13th->13) and whitespace + thousands separators."""
    text = re.sub(r"(?i)(\d+)(?:st|nd|rd|th)\b", r"\1", text or "")
    return re.sub(r"[\s,]", "", text).lower()


def extract_identity_tokens(claim_text: str) -> list[str]:
    """Pull the verifiable identity figures out of a claim's prose."""
    text = claim_text or ""
    tokens: list[str] = []
    for rx in (_MONEY, _PERCENT, _DATE_NAMED, _DATE_ISO):
        tokens.extend(m.group(0) for m in rx.finditer(text))
    # Legal citations: a hyphenated number only counts if a legal cue word precedes it.
    for m in _LEGAL_NUM.finditer(text):
        if _LEGAL_CUE.search(text[: m.start()]):
            tokens.append(m.group(0))
    # De-dup, preserve order.
    seen, out = set(), []
    for t in tokens:
        key = normalize(t)
        if key and key not in seen:
            seen.add(key)
            out.append(t)
    return out


_NUM_IN_TEXT = re.compile(r"\d[\d,]*(?:\.\d+)?")
_VALUE_MATCH_FLOOR = 1000  # only match money by numeric value above this, to avoid matching
#                            an incidental small bare number (a page no., a count) as a figure.


def _money_value(token: str):
    try:
        return float(re.sub(r"[^\d.]", "", token))
    except ValueError:
        return None


def verify_claim(claim_text: str, source_text: str) -> dict:
    """Each identity token in claim_text must be supported by source_text.

    Money tokens match by normalized string, OR (for substantial figures) by numeric value,
    so "$950,000" is supported by a packet that writes it bare as "950000.00". Dates and
    legal citations match by normalized string.
    """
    tokens = extract_identity_tokens(claim_text)
    nsrc = normalize(source_text)
    src_values = set()
    for m in _NUM_IN_TEXT.finditer(source_text or ""):
        try:
            src_values.add(float(m.group(0).replace(",", "")))
        except ValueError:
            pass

    found, missing = [], []
    for t in tokens:
        nt = normalize(t)
        # Tokens with a left anchor ($, month name) may match by containment; a token
        # starting with a digit (percent, ISO date, citation) must not match inside a
        # larger figure ("2.5%" inside "12.5%"), so its match cannot be immediately
        # preceded by a digit or decimal point in the normalized source.
        if nt[:1].isdigit():
            ok = re.search(rf"(?<![0-9.]){re.escape(nt)}", nsrc) is not None
        else:
            ok = nt in nsrc
        if not ok and t.startswith("$"):
            v = _money_value(t)
            ok = v is not None and v >= _VALUE_MATCH_FLOOR and v in src_values
        (found if ok else missing).append(t)
    return {"tokens": tokens, "found": found, "missing": missing, "verified": not missing}


def faithfulness_gate(artifact: dict, source_text_for=None, gate_source_type="agenda_packet") -> dict:
    """Gate a briefing on external faithfulness of its packet-sourced identity claims.

    Returns {verdict, unverified[], checked, coverage}. `verdict` is DQ-faithfulness if any
    checked claim has an identity figure absent from its cited source text, else PASS.
    Only claims with `required_source_type == gate_source_type` and at least one identity
    token are checked (these are the figures presented as packet fact).
    """
    sources = {s.get("id"): s for s in artifact.get("sources", [])}

    def resolve(source_id: str) -> str:
        if source_text_for is not None:
            return source_text_for(source_id) or ""
        return (sources.get(source_id) or {}).get("retrieved_text_or_snapshot", "") or ""

    checked, unverified = [], []
    for claim in artifact.get("claims", []):
        if claim.get("required_source_type") != gate_source_type:
            continue
        if not extract_identity_tokens(claim.get("claim_text", "")):
            continue
        cited_text = " ".join(resolve(sid) for sid in claim.get("source_ids", []))
        res = verify_claim(claim.get("claim_text", ""), cited_text)
        checked.append(claim.get("claim_id"))
        if not res["verified"]:
            unverified.append(
                {"claim_id": claim.get("claim_id"), "missing": res["missing"]}
            )

    coverage = (len(checked) - len(unverified)) / len(checked) if checked else 1.0
    return {
        "verdict": "DQ-faithfulness" if unverified else "PASS",
        "unverified": unverified,
        "checked": len(checked),
        "coverage": coverage,
    }


def _main(argv):
    if not argv:
        print(__doc__)
        sys.exit(2)
    def _flag(name, default):
        if name in argv:
            i = argv.index(name)
            if i + 1 >= len(argv):
                print(__doc__)
                sys.exit(2)
            val = argv[i + 1]
            del argv[i:i + 2]
            return val
        return default

    gate_type = _flag("--gate-source-type", "agenda_packet")
    # The ready-filter is experiment-shaped (meeting_briefing: briefing_status ==
    # briefing_ready; meeting_schedule: status == found). Without these flags a
    # mismatched field would skip every artifact and report a vacuous PASS.
    status_field = _flag("--status-field", "briefing_status")
    ready_value = _flag("--ready-value", "briefing_ready")
    target = argv[0]
    files = sorted(glob.glob(f"{target}/*.json")) if target and not target.endswith(".json") else [target]

    total_checked = total_unverified = dq = passed = skipped = load_failed = 0
    for f in files:
        try:
            art = json.load(open(f))
        except (OSError, json.JSONDecodeError) as e:
            load_failed += 1
            print(f"  unreadable artifact: {f} ({e})", file=sys.stderr)
            continue
        if art.get(status_field) != ready_value:
            skipped += 1
            continue
        res = faithfulness_gate(art, gate_source_type=gate_type)
        total_checked += res["checked"]
        total_unverified += len(res["unverified"])
        dq += res["verdict"] == "DQ-faithfulness"
        passed += res["verdict"] == "PASS"
        if res["unverified"]:
            short = f.split("/")[-1][:13]
            for u in res["unverified"]:
                print(f"  {short}  {u['claim_id']}  missing: {u['missing']}")

    if not (passed + dq):
        # Nothing was assessed — empty dir, all skipped by the filter, or all unreadable.
        # Exit non-zero in every case: a vacuous "gate: PASS 0" is indistinguishable from
        # a genuine all-verified run to anything checking the exit code.
        print(
            f"error: zero artifacts assessed ({skipped} skipped by status filter "
            f"{status_field!r} != {ready_value!r}, {load_failed} unreadable, "
            f"{len(files)} file(s) found) — refusing to report a vacuous PASS",
            file=sys.stderr,
        )
        sys.exit(2)
    cov = (total_checked - total_unverified) / total_checked if total_checked else 1.0
    print("-" * 56)
    print(
        f"briefing_ready artifacts:   {passed + dq}"
        f"  (skipped {skipped} non-ready, {load_failed} unreadable)"
    )
    print(f"packet identity claims:     {total_checked}")
    print(f"  verified:                 {total_checked - total_unverified}")
    print(f"  unverified:               {total_unverified}")
    print(f"claim-level coverage:       {cov:.1%}")
    print(f"gate: PASS {passed}  |  DQ-faithfulness {dq}")


if __name__ == "__main__":
    _main(sys.argv[1:])
