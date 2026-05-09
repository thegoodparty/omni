# Meeting Briefing — Context for Agents and Contributors

This file provides context for working on the meeting briefing feature. It supplements the root `CLAUDE.md`, which governs all repo-wide conventions.

## What the meeting briefing command does

`commands/meeting-briefing.md` is a slash-command runbook that produces a structured meeting briefing for an elected official preparing for a city council or municipal meeting. An agent follows the runbook, which drives two instruction files and a Python rendering utility.

## How it works

```
params.json
    ↓ Generation agent (books/instructions/meeting_briefing.md)
    — web search for council member, meeting platform, agenda
    — staff report PDF downloads
    — Haystaq constituent data via databricks_query.py
    — local news and fiscal research
briefing.json + claims.json + sources.json + source_snapshots/
    ↓ Verification agent (books/instructions/meeting_briefing_verify.md)
    — independently confirms every source extract exists verbatim in cited source
verification_report.json
    ↓ qa_validate.py (Gate 3, if QA enabled)
qa_bundle.json (Block/OK verdict + full adjudication trace)
    ↓ briefing_to_pdf.py
briefing.md
```

## Key design decisions

**Agent-driven generation.** The executing agent IS the intelligence — it researches, reasons, and writes. There is no Python script making LLM API calls for generation. `generate_meeting_briefing.py` was an earlier prototype that followed the wrong pattern and has been removed.

**Two-agent pipeline for source integrity.** Gate 2 (verification) is deliberately a separate agent, not a self-check by the generation agent. The generation agent has an incentive to believe its own extracts are correct. A separate agent with no stake in the output catches hallucinated or misattributed quotes before they reach QA.

**LLM-agnostic instruction files.** `books/instructions/meeting_briefing.md` and `books/instructions/meeting_briefing_verify.md` do not reference any specific model or provider. Any agent capable of web search, file read/write, and Bash can execute them.

**Voice and register are prescribed in the instruction.** The generation instruction explicitly requires second-person direct voice, specific talking points naming council members, and per-household budget framing — matching the reference output in `project_files/city-council-member-briefing-copy.md`. This is not left to the model's default behavior.

**Constituent data is Haystaq-sourced and labeled as modeled.** The instruction requires all sentiment figures to carry a provenance note. City-wide scope is the default. District-level data is available if the Haystaq query is extended with district filters.

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
| `scripts/python/briefing_to_pdf.py` | Renders `briefing.json` to human-readable Markdown. No LLM calls. |
| `scripts/python/databricks_query.py` | SQL query runner against Databricks — used by the generation agent for Haystaq queries |

## What's not yet built

- `# TODO:` District-level Haystaq scope — add district type and name filters to the Haystaq query in the instruction
- `# TODO:` Legistar API direct integration — agent currently discovers platform via web search; a direct Legistar client would be more reliable for cities that use it
- `# TODO:` OCR fallback — `pdftotext` returns empty for scanned PDFs; the instruction should include a fallback path
- `# TODO:` No tests for the verification agent logic or the QA loop iteration limit

## Prior art

- `project_files/city-council-member-briefing-copy.md` — the reference output; all generation must match this voice and structure
- `project_files/deliverable_1_meeting_briefing.md` — generation rules spec; non-negotiable constraints
- `remotes/origin/add-meeting-briefing-runbook` — prior branch; shows the original agent-driven architecture this build aligns with
