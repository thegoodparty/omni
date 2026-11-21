---
name: bug-analysis
description: Analyze a bug and present a one-page root cause and proposed fix for human review. Use when asked for bug analysis or RCA, before implementing a fix.
---

Read the ticket and relevant discussion. Check related tickets and the code deployed when the bug occurred. Use all relevant observability tools directly: query Grafana logs, traces, and metrics for the affected environment, time window, and request or record IDs; check frontend errors or session replay for browser symptoms. Use other available read-only system records when telemetry cannot distinguish competing causes. Link the queries and observations that confirm each decisive step. Prior ticket summaries are leads, not fresh evidence. Start by resolving the exact affected record and time window. Query those identifiers first. Broaden only to answer a named scope question, not to substitute similar incidents for evidence about this one. Set per-query timeouts and reserve time to write the artifact. If targeted queries cannot distinguish the remaining causes, name the missing evidence and finish the incomplete investigation rather than searching unrelated records. If a necessary source is unavailable, record what you attempted and what remains unverified. Distinguish confirmed impact from estimates, and stop causal claims where the evidence stops. Do not implement the fix or change production state.

Create a private, single-page HTML artifact using the Omni `artifacts` skill. Aim for a two-minute read. Link to evidence rather than pasting logs or duplicating the analysis in ClickUp.

## 1. Impact

Lead with severity, confirmed affected user count, and total affected if known. Say unknown when you cannot establish the total. Describe the user-facing harm in one sentence.

Always show all three severity cards, even in an incomplete investigation: side by side on wide screens, stacked as needed on narrow screens, each a bordered box. Highlight the selected card with color and the label “Applies here.” Keep these definitions fixed:

- **High:** Financial harm or a core task blocked with no workaround.
- **Medium:** A task is disrupted, but a workaround exists.
- **Low:** Minor friction; users can still finish the task.

## 2. Five whys

Use five short numbered questions and answers. Start at the symptom and trace the relevant system boundaries, fields, and failed checks. Verify the root cause before presenting the analysis for approval. If evidence needed to identify or confirm it is missing, label the analysis incomplete, state exactly what evidence is missing, and do not ask for approval. Do not invent a cause to fill a slot. Add a small flow diagram only if it clarifies the cause. Draw it as real boxes and connecting arrows (inline SVG or CSS flex boxes), never a text or code block. Show only the relevant handoffs, one box per system step, and color the box or arrow where it failed (or where it is unknown).

## 3. Proposed solution

If the investigation is incomplete, this section leads with the exact commands that would settle it, each in a copy-pasteable code block with who can run it and what result means what: the literal read-only SQL (real table and column names from the schema, with placeholders only for the record id), the Stripe CLI or API command, the Grafana/Loki query with labels and time window, and so on. Never write “check the database” or “need breakglass” without the command. Otherwise, name the behavior to change, where the change belongs, and how to verify normal and failure paths. Include a cleanup proposal owned by the bug responder: how to identify affected records, what to repair, and how to verify the repair. If no cleanup is needed, explain why. Call out any actions another team must perform; the responder still owns coordination and verification.

## Self-review before sharing

- Can you state the actual root cause in one sentence and point to evidence that confirms it for this bug, not just a plausible failure mode?
- Does the evidence rule out any competing explanation that would change the fix or cleanup plan? A missing log is not proof of which path ran unless the deployed code always logs the alternative and the relevant logs are complete.
- Does the proposed fix address the confirmed cause, and does the cleanup cover the affected records?

If the cause still needs investigation or confirmation, share only an **Incomplete investigation** if useful. Name the missing evidence and the check that would settle it. Do not call it a finished RCA or request approval. Only a confirmed RCA ends by asking reviewers for a thumbs up or a pinned comment on what to change.
