

## Deliverable 2: QA spine

### Design intent

A reusable QA harness that any runbook can call — either inline during generation or post-hoc against a completed output. The meeting briefing runbook is the demonstration case, not the only use case.

The spine should live as a book or command in the runbooks repo, following all existing repo conventions. Supporting scripts go in `scripts/` per the repo's language and runtime rules.

### Three-gate model

```
pre-hoc → [generation with inline checks] → post-hoc
```

Pre-hoc is a go/no-go gate before generation begins. Inline catches drift during generation. Post-hoc audits the finished output. Each gate is independently invokable and shares the same check interface and output format.

### Gate 1: Pre-hoc

Runs before generation begins. Determines whether the pipeline has what it needs to produce a valid output. A runbook defines its own pre-hoc requirements; the spine provides the check primitives.

Pre-hoc checks fall into three categories:

**Input completeness** — are the required inputs present and parseable? Examples: required files exist, documents are machine-readable, required fields in the input record are populated. A runbook declares what inputs it requires; the spine verifies them.

**Source sufficiency** — do the available sources support the content types being requested? Some output sections are only valid if specific source types exist. A runbook declares which sections require which source types; the spine checks availability before generation is attempted. Sections without sufficient sourcing should be flagged for omission or degraded treatment before generation, not discovered as errors after.

**what the LLM must not do unassisted**
-- Identity and extraction — never paraphrase, always copy

Don't restate names, dollar amounts, vote counts, dates, or legal citations from memory — extract them directly from the source document at generation time
Don't normalize or clean identity fields (e.g. don't expand abbreviations, don't standardize date formats) unless a script does it first

-- Scope discipline

Don't answer questions outside the provided context — if it's not in the inputs, it doesn't go in the output
Don't fill gaps with plausible-sounding content — an explicit omission is always better than a confident fabrication


**Config and schema validation** — does the input record conform to the expected schema? Required fields present, types correct, no structurally invalid values. Catches malformed inputs before they produce malformed outputs.

Pre-hoc checks produce a **capability map** — a structured assessment of what the pipeline can and cannot produce given the available inputs. Checks run at the section level and the subsection level independently, so a section can be partially supported: some subsections proceed, others are omitted or flagged, without affecting unrelated sections.

Failures have three severity levels:
- **Halt** — a required input or field is missing and no valid output can be produced at all. Stop and surface the reason.
- **Omit** — a specific section or subsection cannot be produced because required inputs are absent. Document the omission explicitly in the output; all other sections proceed normally.
- **Warn** — inputs are present but incomplete or uncertain. Generation proceeds, but the affected section is flagged for human review.

The capability map is passed forward into the generation step, so the pipeline knows before it starts exactly which sections to attempt, which to skip, and which to treat as provisional.

### Gate 2: Inline (called from within a running runbook)

Lightweight checks that run at defined steps during generation. A runbook opts in by adding explicit QA steps at appropriate points in its procedure. Inline checks are fast, targeted, and non-blocking by default — they surface warnings the runbook author can act on without halting generation.

#### Source extract grounding

The most important inline mechanism. Every factual claim generated must be accompanied by a verbatim extract from the source document that supports it. The extract is pulled at generation time, not inferred from memory, and is stored alongside the claim in the output.

Each extract record contains:
- `claim` — the factual statement in the output
- `extract` — the verbatim passage or passages from the source document
- `source_doc` — document name or identifier
- `location` — page number, section heading, or paragraph reference sufficient to locate the passage in the original document
- `verified` — boolean, set by the verification step below

This extract structure serves two purposes: it reduces hallucination during generation by forcing the model to ground each claim in retrieved text, and it enables the downstream UI feature where a user can click a factoid and be pointed to the relevant passage in the source document.

#### Second-agent extract verification

A second agent independently verifies each extract record before the claim is accepted into the output. This agent does not generate — it only checks. It receives the extract record and the source document, then confirms:

1. The extract text exists verbatim (or near-verbatim) at the stated location in the source document
2. The extract actually supports the claim it is paired with
3. The location reference is accurate and sufficient to retrieve the passage

This step is inline because it must run before the claim enters the output — a hallucinated extract that passes into post-hoc QA contaminates the audit. The second agent catches fabricated citations at the source. Where possible, this agent should be from a different LLM family or company than the one that is preparing the briefing. 

#### Retry loop

A failed verification does not immediately reject the claim. The generation agent is given up to two retries before the claim is escalated. On each retry the generation agent is told the specific failure reason so it searches differently — a broader search for "not found", a reconsideration of whether the claim is supportable at all for "doesn't support claim".

The loop:

```
generate claim + extract
        ↓
verify (attempt 1)
        ↓ fail — reason returned to generation agent
re-extract with failure reason as context
        ↓
verify (attempt 2)
        ↓ fail — reason returned to generation agent
re-extract with failure reason as context
        ↓
verify (attempt 3)
        ↓ fail
escalate to human review queue
```

The claim is held out of the output until verification passes. It is never included in a passing or failing state mid-loop.

Failure modes and what triggers each:
- **Extract not found** — the passage does not exist at the stated location. Generation agent re-searches more broadly.
- **Extract does not support claim** — the passage exists but does not substantiate the assertion. Generation agent reconsiders whether the claim is supportable; may revise or narrow the claim before re-extracting.
- **Location reference insufficient** — the passage exists but cannot be reliably located from the reference given. Generation agent corrects the location reference and resubmits.

After three failed attempts, escalation behavior depends on claim type:
- **Identity fields** (names, dates, dollar amounts, vote counts, legal citations) — omitted from output entirely. Omission is documented in the output.
- **Factual claims** — included as `"Inferred:"` with an explicit note that extraction could not be verified. Flagged in qa audit bundle with the full attempt history attached.

The human review queue entry includes every attempt: each extract tried, each verification result, and each failure reason. This makes review actionable rather than a dead end.

#### Other inline checks

Beyond extract verification, inline checks include: prohibited phrase detection, constituent data language validation, identity field exact-match against source, and Tension block source confirmation.

### Gate 3: Post-hoc (run against a completed output)

A full audit suite run after the pipeline completes. Takes the completed output and the input source documents as inputs. Three audit types:

1. **Spec compliance** — validates output against the defined schema and structural rules: required fields present, field types correct, content block ordering enforced, prohibited phrases absent, disclosure present, constituent data language valid.

2. **Rubric scoring** — evaluates output quality against a rubric derived from the generation rules. Produces a score or tier per section (not just pass/fail). Rubric criteria should be discoverable and extensible, not hardcoded.

3. **Source bibliography audit** — reviews the sources cited in a bibliography and determines whether or not they are likely to be reputable

### Architecture principles

- Each check is a discrete, independently runnable function or script.
- The full suite can be run as a batch.
- Output is structured (JSON preferred) so results can be reviewed programmatically or by a human.
- Each failed check surfaces: the rule violated, the offending content, the source location where applicable, and severity (error vs. warning).
- The spine does not know about the meeting briefing specifically — it operates on a schema and a set of rules passed in at call time. Meeting-briefing-specific rules are defined in the meeting briefing runbook and passed to the spine when invoked.