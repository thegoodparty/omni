# Roadmap Scoring Rubric (internal quality aid)

A lightweight, internal way to check a governing roadmap's quality before sending. Used in Step 5 of `books/generate-governing-roadmap.md`. This is a self-check to catch gaps and benchmark against past roadmaps, not a deliverable for the EO and not a number to optimize. Accuracy verification (Step 4) is the real gate; this is the backstop.

## The 12 dimensions

Score each 0-10. Dimensions group into three clusters; each cluster score is the average of its dimensions.

**Context (40%)** — how well we know this EO's situation.
D1 Personal Tailoring, D2 Electoral Context, D3 Voter Intelligence, D4 Gap Analysis, D5 Coalition Mapping.

**Actionability (35%)** — whether the EO can execute from the document.
D6 Strategic Roadmap, D7 Tactical Specificity, D8 Risk Register.

**Credibility (25%)** — whether a skeptical reader would trust the claims.
D9 News / Narrative Context, D10 State Policy Integration, D11 Source Transparency, D12 Accuracy Risk.

## Combined score and verdict

```
Combined = avg(D1..D5) x 0.40 + avg(D6..D8) x 0.35 + avg(D9..D12) x 0.25
```

| Verdict | Combined (0-10) |
|---|---|
| **SEND** | 7.0 and above |
| **REVIEW** | 5.0 to 6.9 |
| **REWRITE** | below 5.0 |

The most common REVIEW driver is thin Context (D2, D5) in small jurisdictions with no published votes or local press. When that happens, deepen research or label the gaps honestly rather than padding the score.

## Benchmark and calibration

A small pilot batch produced a clean SEND/REVIEW split (lowest SEND ~7.4, highest REVIEW ~6.7), which is how the 7.0 threshold was set. Keep one known-good D-Long as a calibration anchor (agreed combined near 7.5). Before a new batch, re-score the anchor; if it drifts more than 0.5 points, tighten the scoring criteria before continuing. A model-version change means recalibrating from scratch.

## What this does not tell you
- Whether the strategic advice is actually good. A well-sourced recommendation can still be politically wrong.
- Readability or tone. Two documents with the same claims score the same.
- How the EO will react. Reception is unmeasured.
- A high Context and Actionability score can mask weak Credibility, so do not send on the combined number alone if any one cluster is below 5.0. The 5.0 floor is per cluster, not per dimension: a single dimension below 5.0 (for example D3 Voter Intelligence with no poll) is fine as long as its cluster still averages 5.0 or above.

> Note: some older `scoring-report.md` files use a legacy Breadth-over-120 formula on a 0-100 scale (SEND at Combined > 55). It is not equivalent to the 0-10 formula above. The 0-10 cluster formula is canonical; check which scale an old report uses before comparing.
