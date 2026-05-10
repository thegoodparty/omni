# Meeting Briefing — Context for Agents and Contributors

This file provides context for working on the meeting briefing feature. It supplements the root `CLAUDE.md`, which governs all repo-wide conventions.

## What the meeting briefing command does

`commands/meeting-briefing.md` is a slash-command runbook that produces a structured meeting briefing for an elected official preparing for a city council or municipal meeting. An agent follows the runbook, which drives an instruction file and a Python rendering utility.

## How it works

```
params.json
    ↓ Generation agent (books/instructions/meeting_briefing.md)
    — web search for council member, meeting platform, agenda
    — staff report PDF downloads
    — Haystaq constituent data via databricks_query.py
    — local news and fiscal research
briefing.json + claims.json + sources.json + source_snapshots/
    ↓ briefing_to_pdf.py
briefing.md
```

## Key design decisions

**Agent-driven generation.** The executing agent IS the intelligence — it researches, reasons, and writes. There is no Python script making LLM API calls for generation. `generate_meeting_briefing.py` was an earlier prototype that followed the wrong pattern and has been removed.

**LLM-agnostic instruction file.** `books/instructions/meeting_briefing.md` does not reference any specific model or provider. Any agent capable of web search, file read/write, and Bash can execute it.

**Voice and register are prescribed in the instruction.** The generation instruction explicitly requires second-person direct voice, specific talking points naming council members, and per-household budget framing — matching the reference output in `project_files/city-council-member-briefing-copy.md`. This is not left to the model's default behavior.

**Constituent data is Haystaq-sourced and labeled as modeled.** The instruction requires all sentiment figures to carry a provenance note. City-wide scope is the default. District-level data is available if the Haystaq query is extended with district filters.

**Naive subagents for testing.** When running experiments, the generation agent should be a fresh subagent with no context from the development session. This tests whether the instruction is self-sufficient — if a naive agent can follow it cold, it is production-ready.

## Output schema (`briefing.json`)

```
meeting.{title, date, citySlug, body, time}
executiveSummary.{totalAgendaItems, priorityItemCount}
priorityIssues[].{
  agendaItemTitle, itemNumber, actionType,
  detail.{whatIsHappening, whatDecision, whyItMatters, budgetImpact, whoIsPresenting},
  talkingPoints[],
  actionItem,
  sourceCitations[].{field, quote},
  constituentSentiment.{available, issue_label, aligned_voter_percentage, provenance_note}
}
constituentData.{available, provenance_note, voter_count, top_issues[]}
sources[]
```

## Scripts

| Script | What it does |
|--------|-------------|
| `scripts/python/briefing_to_pdf.py` | Renders `briefing.json` to human-readable Markdown. No LLM calls. Resolves string source IDs from `sources.json` if needed. |
| `scripts/python/databricks_query.py` | SQL query runner against Databricks — used by the generation agent for Haystaq queries. Uses `find_dotenv()` to locate credentials; expects `DATABRICKS_HOST`, `DATABRICKS_HTTP_PATH`, `DATABRICKS_TOKEN`. |

## Experiment results (as of 2026-05-10)

Two experiments run against the Alvin TX April 16 2026 agenda using naive Claude subagents:

- **exp2** (generation only): 5 priority items, 20 claims, personalized for Keko Moore (At-Large P1). Haystaq not used — credentials were not resolving correctly at the time.
- **exp2_qa** (generation + QA, on qa-spine branch): 5 priority items, 23 claims, personalized for Chris Vaughn (District B). Gate 2: 25 passed / 1 failed (colon inserted in section heading — formatting artifact, not fabrication). Gate 3: OK, 0 blocked, 1 annotated.

Databricks credentials are now confirmed working (`DATABRICKS_HOST`, `DATABRICKS_TOKEN` in `~/Research/.env`, resolved via `find_dotenv()`). **Experiment 3 should be the first run with live Haystaq data.**

## Known gap: briefing anatomy does not match the reference

The reference output (`project_files/city-council-member-briefing-copy.md`) defines the expected anatomy. The current renderer and generation instruction do not match it.

**Reference anatomy per agenda item:**
```
## Agenda Item: [Title]
### Overview          — 2nd person narrative
### Constituent Sentiment — shown even when unavailable ("No sentiment data yet")
### Constituent Quote — not in schema yet
### Budget Impact     — section header, not bold label
### Talking Points    — bullet list
Was this summary helpful?
```

**Then a full-briefing deep-dive section per item:**
```
# Full Briefing: [Title]
## Decisions You Are Being Asked To Make
## Why It Matters
## Talking Points For The Meeting
## Action Item
## Additional Context (expandable)
```

**Specific fixes needed (in priority order):**

1. `briefing_to_pdf.py` does not render `talkingPoints` or `actionItem` — both fields exist in `briefing.json` but the renderer ignores them. **Most important fix.**
2. Section headers — renderer uses `**bold labels**` instead of `### Section Name` headers.
3. Constituent sentiment — renderer omits the section entirely when unavailable; reference shows "No sentiment data yet for [item]."
4. Constituent quote — not in the schema or instruction at all. Needs a `constituentQuote` field added to the instruction and renderer.
5. Two-section structure — reference has a card summary + full briefing deep-dive. Renderer produces one merged view.

## Production path (PMF experiment)

The meeting briefing has a natural path to production via the PMF experiment system (`experiments/`). The pattern maps — web + Databricks + JSON artifact — but requires meaningful adaptation. See `project_files/pmf-fit-assessment.md` for the full assessment.

**Short version — five friction points:**
1. Local PDF path doesn't exist in Fargate. Web discovery becomes the only agenda-fetch path.
2. Multiple output files collapse to one `artifact.json`. Claims and sources embed inline.
3. Council member identity should come from params (gp-api injects from user profile), not be web-discovered.
4. The QA spine does not translate to PMF's single-agent model. See `books/CLAUDE.md` for QA accommodation options.
5. High turn budget — needs `max_turns: 100`, `timeout_seconds: 3000`.

**Prerequisites before translating to an experiment:**
- Briefing anatomy matches the reference output (talking points, action item, section headers, sentiment no-data state)
- Haystaq data appears correctly in at least one successful end-to-end run
- gp-api confirmed willing to inject `official_name`, `official_district`, `body` at dispatch time

## What's not yet built

- `# TODO:` Fix `briefing_to_pdf.py` — render talking points, action item, section headers, sentiment no-data state
- `# TODO:` Add `constituentQuote` to schema and instruction
- `# TODO:` Run experiment 3 with live Haystaq data
- `# TODO:` District-level Haystaq scope — add district type and name filters to the Haystaq query in the instruction
- `# TODO:` Legistar API direct integration — agent currently discovers platform via web search; a direct Legistar client would be more reliable for cities that use it
- `# TODO:` OCR fallback — `pdftotext` returns empty for scanned PDFs; the instruction should include a fallback path (pdfplumber is the working alternative)

## Prior art

- `project_files/city-council-member-briefing-copy.md` — the reference output; all generation must match this voice and structure
- `project_files/deliverable_1_meeting_briefing.md` — generation rules spec; non-negotiable constraints
- `project_files/pmf-fit-assessment.md` — detailed PMF experiment translation assessment
- `remotes/origin/add-meeting-briefing-runbook` — prior branch; shows the original agent-driven architecture this build aligns with
