---
name: bug-analysis
description: Analyze a bug and present a one-page root cause and proposed fix for human review. Use when asked for bug analysis or RCA, before implementing a fix.
---

Read the ticket and relevant discussion. Check related tickets, deployed code, and available evidence. Distinguish confirmed impact from estimates, and stop causal claims where the evidence stops. Do not implement the fix or change production state.

Create a private, single-page HTML artifact using the Omni `artifacts` skill. Aim for a two-minute read. Link to evidence rather than pasting logs or duplicating the analysis in ClickUp.

## 1. Impact

Lead with severity, confirmed affected user count, and total affected if known. Say unknown when you cannot establish the total. Describe the user-facing harm in one sentence.

Show three severity cards side by side on wide screens, stacked as needed on narrow screens. Highlight the selected card with color and the label “Applies here.” Keep these definitions fixed:

- **High:** Financial harm or a core task blocked with no workaround.
- **Medium:** A task is disrupted, but a workaround exists.
- **Low:** Minor friction; users can still finish the task.

## 2. Five whys

Use five short numbered questions and answers. Start at the symptom and trace the relevant system boundaries, fields, and failed checks. Label unknowns and say what evidence would resolve them. Do not invent a cause to fill a slot. Add a small inline flow diagram only if it clarifies the cause. Show the relevant handoff and mark where it failed; omit unrelated steps.

## 3. Proposed solution

Name the behavior to change, where the change belongs, and how to verify normal and failure paths. Include a cleanup proposal owned by the bug responder: how to identify affected records, what to repair, and how to verify the repair. If no cleanup is needed, explain why. Call out any actions another team must perform; the responder still owns coordination and verification.

End by asking reviewers for a thumbs up or a pinned comment on what to change.
