#!/usr/bin/env python3
"""Compute a GO / NO-GO reliability verdict for a quality rubric from held-out cold-judge scores.

Reliability (not validity) is what this checks: do independent judges, who never saw the
rubric being tuned, land on the same answer on briefings the rubric was never tuned against.
A rubric that passes here is safe to use as a regression GATE for prompt changes. It does NOT
establish that the scores match true human quality — that needs an external referent.

Input: a TSV with columns  uuid_short  batch  judgeA  judgeB
  - integer totals (0-30) for graded briefings
  - the literal "DQ" when a judge disqualified the briefing at a gate
    (gate-named variants like "DQ-faithfulness" are normalized to "DQ")
Blank lines and #-comments are ignored; ONE other non-data line (an uncommented
header) is tolerated with a stderr warning. Any further unparseable line is data
loss: the script reports it on stderr and exits 2 without computing a verdict.

GO criteria (all must hold):
  - no faithfulness/gate disagreement that isn't a clean DQ-vs-DQ agreement
  - every disqualified briefing is disqualified by BOTH judges (gate decisions are reproducible)
  - max inter-judge spread on graded briefings <= MAX_SPREAD
  - zero "blowouts" (graded spread >= BLOWOUT)

Usage:  uv run scripts/python/rubric_verdict.py experiment-evals/<exp>/rubric_scores.tsv
"""
import sys
import statistics

MAX_SPREAD = 2      # largest acceptable judge-to-judge gap on a graded briefing
BLOWOUT = 5         # a gap this large is a structural failure (the cap-cliff symptom)


def _norm(cell):
    # The system's own judges emit gate-named verdicts ("DQ-faithfulness",
    # "DQ-eligibility", ...). They are all disqualifications: normalize to "DQ"
    # so a 1-of-2 gate split is counted instead of silently dropped (false GO).
    cell = cell.strip()
    return "DQ" if cell.startswith("DQ-") else cell


def load(path):
    """Parse the scores TSV. Returns (rows, skipped).

    Blank lines and #-comments are free. Every OTHER line that fails to parse
    as data (header, short line, non-integer score, ...) is counted in
    `skipped` so the caller can refuse to gate on a silently-shrunken sample.
    """
    rows, skipped = [], 0
    with open(path) as f:
        for line in f:
            line = line.rstrip("\n")
            if not line.strip() or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 4:
                skipped += 1
                continue
            uuid, batch, a, b = parts[0], parts[1], _norm(parts[2]), _norm(parts[3])
            # Skip a header row (e.g. "uuid batch judgeA judgeB") or any non-data line:
            # the judge columns must be "DQ" or an integer, else main() would crash on int().
            if not all(v == "DQ" or v.lstrip("-").isdigit() for v in (a, b)):
                skipped += 1
                continue
            rows.append((uuid, batch, a, b))
    return rows, skipped


def verdict(rows) -> dict:
    """Pure GO/NO-GO derivation from loaded score rows (no I/O).

    GO requires: gate decisions reproducible (no 1-of-2 DQ split), max graded
    spread <= MAX_SPREAD, and zero blowouts (spread >= BLOWOUT).
    """
    graded, disq, split_gate = [], [], []
    for uuid, _batch, a, b in rows:
        a_dq, b_dq = a == "DQ", b == "DQ"
        if a_dq or b_dq:
            if a_dq and b_dq:
                disq.append(uuid)
            else:
                split_gate.append((uuid, a, b))  # one judge graded, one disqualified
            continue
        spread = abs(int(a) - int(b))
        graded.append((uuid, int(a), int(b), spread))

    spreads = [g[3] for g in graded]
    blowouts = [g for g in graded if g[3] >= BLOWOUT]
    max_spread = max(spreads) if spreads else 0
    mean_spread = round(statistics.mean(spreads), 2) if spreads else 0.0
    checks = {
        "gate decisions reproducible (no 1-of-2 split)": len(split_gate) == 0,
        f"max graded spread <= {MAX_SPREAD}": max_spread <= MAX_SPREAD,
        f"zero blowouts (>= {BLOWOUT})": len(blowouts) == 0,
    }
    return {
        "graded": graded, "disq": disq, "split_gate": split_gate,
        "max_spread": max_spread, "mean_spread": mean_spread,
        "blowouts": blowouts, "checks": checks, "go": all(checks.values()),
    }


def main():
    if len(sys.argv) < 2:
        print("usage: rubric_verdict.py <scores.tsv>")
        sys.exit(2)
    rows, skipped = load(sys.argv[1])
    if not rows:
        # Zero briefings assessed is categorically different from unanimous DQ:
        # nothing was validated, so a GO here would approve an unvalidated rubric.
        print(f"error: zero data rows in {sys.argv[1]} — refusing to gate on an empty sample",
              file=sys.stderr)
        sys.exit(2)
    if skipped:
        print(f"warning: skipped {skipped} non-data line(s) in {sys.argv[1]}", file=sys.stderr)
    if skipped > 1:
        # One skip is tolerated (an uncommented header line). More than that is
        # data loss — refuse to compute a gate verdict on a shrunken sample.
        print("error: more than the single tolerated header was skipped; "
              "fix the TSV before gating", file=sys.stderr)
        sys.exit(2)
    v = verdict(rows)
    if not v["graded"]:
        # Every row was disqualified at a gate -> zero graded briefings. The GO checks
        # pass vacuously (no spread to measure, no blowouts, no splits), so verdict()
        # reports GO — but a rubric that DQ's everything had its inter-judge reliability
        # tested on nothing. Refuse to gate (exit 2, cannot-assess), never a vacuous GO.
        print(f"error: zero graded briefings in {sys.argv[1]} — all rows were DQ'd; "
              "cannot assess inter-judge spread on an all-DQ sample", file=sys.stderr)
        sys.exit(2)
    graded, disq, split_gate = v["graded"], v["disq"], v["split_gate"]
    max_spread, mean_spread, blowouts = v["max_spread"], v["mean_spread"], v["blowouts"]

    print("=" * 56)
    print("  RUBRIC RELIABILITY VERDICT (held-out cold judges)")
    print("=" * 56)
    print(f"briefings scored:        {len(rows)}")
    print(f"  graded (passed gates): {len(graded)}")
    print(f"  disqualified (unanim): {len(disq)}")
    print(f"  gate SPLIT (1 of 2):   {len(split_gate)}")
    print(f"graded inter-judge spread: max={max_spread}  mean={mean_spread}")
    print(f"blowouts (spread>={BLOWOUT}):     {len(blowouts)}")
    if graded:
        lo = min(min(a, b) for _, a, b, _ in graded)
        hi = max(max(a, b) for _, a, b, _ in graded)
        print(f"graded score range:        {lo}-{hi}")
    print("-" * 56)

    for name, ok in v["checks"].items():
        print(f"  [{'PASS' if ok else 'FAIL'}]  {name}")
    print("-" * 56)
    go = v["go"]
    print(f"  VERDICT: {'GO — reliable enough to gate prompt changes' if go else 'NO-GO — fix reliability before gating'}")
    print("  (reliability only; validity vs human truth NOT established here)")
    print("=" * 56)
    sys.exit(0 if go else 1)


if __name__ == "__main__":
    main()
