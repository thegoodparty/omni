Generate a verified, PDF-ready strategic governing roadmap package for an elected official (EO). The two jobs that matter most are generating the report and getting its facts right; the scoring rubric is an internal aid for the second, not the point of the exercise.

## Who runs this and what you give it

An AI agent does the work by following this book. As the requester (for example an account manager) you provide one thing: the EO's full name, office, and jurisdiction. An intake form helps if you have one. HubSpot and Google Drive are optional connections, not requirements. You get back two EO-facing PDFs plus an internal AM summary that tells you exactly what to confirm before sending.

## What you produce

Three deliverables per EO:

| Deliverable | File | Length | Audience |
|---|---|---|---|
| **D-Long** (Strategic Governing Roadmap) | `[eo-slug]-variant-d-long.md` | All 10 sections | The EO. Full reference document. |
| **D-Short** (Tactical Action Plan) | `[eo-slug]-variant-d-tactical.md` | 4 sections (2-3 pages) | The EO. The "read on your phone" action brief. |
| **AM Summary** (internal handoff) | `am-summary.md` | ~2 pages | The assigned account manager (AM). NOT for the EO. Scoring, verification follow-ups, assumptions, warnings, talking points. |

Both EO-facing documents are written TO the EO in the second person, use inline parenthetical citations, and contain no em dashes and no banned filler words.

## What you must provide

The EO's full name, their office, and their jurisdiction (city or district). Optionally an intake form. That is the only required input; everything else is gathered from public sources.

## Prerequisites

This workflow provisions what it can on its own. The only required input is the EO's name and office; the items below are either automatic or optional.

**Config (all optional, defaults used if unset)**: `$ROADMAP_OUTPUT_DIR` (default `./roadmap-output`), `$COMPLETED_ROADMAPS_DRIVE_FOLDER`, `$CHROME_BIN` (default: macOS Chrome path).
**Tools (automatic)**: web search/fetch (built in); `pandoc` and Google Chrome for the PDF step. Step 0 installs `pandoc` if it is missing. Install `poppler` (`pdftotext`) too if you need to read numbers out of source PDFs (election results are often published as PDFs).
**Optional access**: HubSpot (only to enrich with CRM fields if connected) and Google Drive (only to auto-upload the PDFs). Neither is required; without them the roadmap still generates and the PDFs land in the output folder.
**Companion book**: `books/roadmap-scoring-rubric.md` (used in Step 5)
**Script**: `scripts/shell/generate-roadmap-pdf.sh` (used in Step 6)

### Step 0 — Setup check (first run only)
Before Step 1, self-provision so the rest runs unattended:
- **pandoc**: if not on PATH, install it (`brew install pandoc` on macOS, or the platform equivalent).
- **Chrome**: confirm Google Chrome is installed; if its path is non-standard, set `$CHROME_BIN`.
- **poppler (optional)**: install if you expect to verify figures from source PDFs (`brew install poppler` gives you `pdftotext`).
- **Optional logins**: only if the user wants CRM enrichment or auto-upload, prompt them to log into HubSpot and/or Google once. Otherwise skip.

Skip Step 0 on later runs unless a check fails.

## Output folder structure

```
$ROADMAP_OUTPUT_DIR/[eo-slug]/
  [eo-slug]-variant-d-long.md
  [eo-slug]-variant-d-tactical.md
  am-summary.md
  research-notes.md
  scoring-report.md
  pdfs/                          # HTML intermediates + final PDFs
```

Use a lowercase kebab-case `[eo-slug]` derived from the EO's name (e.g. `jane-doe`).

## The pipeline (7 steps)

### Step 1 — EO inputs
Start from what the requester gives you: the EO's full name, office, and jurisdiction, plus an intake form if they have one. That is enough to proceed. If HubSpot is connected, enrich with CRM fields (account manager, election date, win status, onboarding status, poll dashboard URL) and note in the AM summary any fields that were unavailable. If you have access to past roadmaps (a Drive folder or shared output dir), check for a prior one in the same jurisdiction so you can reuse research; skip this if you have no way to look one up.

### Step 2 — Research pass
Web research across nine categories, recording every source URL and access date in `research-notes.md`:

1. Election results (exact vote counts for all candidates, turnout, margins)
2. Government structure (form, body size, terms, executive role, voting thresholds)
3. Budget cycle (dates, recent budget votes with splits)
4. Contested votes (who voted which way, coalition dynamics)
5. Committee structure
6. EO background (biography, campaign themes, prior office)
7. Coalition dynamics (allies, opposition, swing members)
8. State policy context (relevant statutes, pending bills)
9. Upcoming calendar (meetings, budget hearings, filing deadlines)

**Quality bar**: exact vote counts (no approximations), verified quotes, modeled data explicitly labeled, every gap flagged. See the research-notes template below.

Two rules when sources conflict or can't be confirmed:
- **Official record wins.** When the official source (clerk's results, charter, posted agenda) and press disagree on a number, use the official figure and note the override in the methodology.
- **No unverifiable quotes.** If you cannot confirm a quote is word-for-word from the source text (for example your fetch tool only returned a paraphrase), do not quote it. Paraphrase the fact with a citation instead.

### Step 3 — Draft D-Long and D-Short

**D-Long — 10 sections**: (1) situation, (2) government structure, (3) vote map, (4) priorities with political math, (5) constituency model, (6) phased calendar, (7) risk register, (8) reelection narrative, (9) GoodParty support, (10) methodology.

**D-Short — 4 sections only**: (1) situation, (2) moves with action items, (3) council/body map, (4) calendar.

Write in the second person. Add an inline parenthetical citation at the first occurrence of each major factual claim. No em dashes. No banned words.

### Step 4 — Verify accuracy (the main quality gate)
This is the most important step. Go through both documents claim by claim and confirm:
- Every quote matches its source word for word.
- Every vote count and number matches the official record (no `~` approximations).
- Every major factual claim has an inline citation at its first occurrence.
- Every modeled or estimated figure is labeled as modeled, not stated as fact.

Record anything you cannot verify as a flag for follow-up. List the verification items the AM still needs to confirm in `am-summary.md`.

### Step 5 — Fix, then run the internal quality check
Resolve every flag from Step 4: fix or remove unverified claims, add missing citations, correct numbers, update the methodology note.

Then, as an internal aid (not a deliverable for the EO), score both documents against the 12-dimension rubric in `books/roadmap-scoring-rubric.md` and write the result to `scoring-report.md`. The rubric exists to catch coverage gaps and to benchmark quality against past roadmaps before sending. Treat a low score as a prompt to deepen research or tighten the draft, not as a number to optimize. Both documents should pass accuracy verification, and clear the rubric's SEND bar if you score them, before you generate PDFs.

### Step 6 — Generate PDFs
Run the PDF script for the EO:

```bash
scripts/shell/generate-roadmap-pdf.sh <eo-slug> "$ROADMAP_OUTPUT_DIR/<eo-slug>/pdfs"
```

Pass the EO's actual `pdfs` directory as the second argument. If you did not set `$ROADMAP_OUTPUT_DIR`, give the full path to the output folder you used so the PDFs land next to the markdown, not in a default location. It converts each markdown variant to clean HTML with `pandoc`, then to PDF with headless Chrome. Content starts at the first heading with no title block and no page headers/footers.

### Step 7 — Deliver the PDFs
The finished PDFs are in the output folder. If Google Drive is connected, upload both to the completed-roadmaps folder (`$COMPLETED_ROADMAPS_DRIVE_FOLDER`), updating in place when replacing an existing file so shared links keep working. If Drive is not connected, leave the PDFs in the output folder for the requester to share.

## Parallel execution
- Steps 1-2 can run in parallel across EOs; Step 3 can overlap across EOs.
- Scoring and fixes (Steps 4-5) are per-EO and sequential.
- When two EOs share a jurisdiction, run the research once and fork it into separate drafts.

## Quality gates (do not proceed to PDF unless all pass)
- [ ] All quotes verified against source articles
- [ ] All vote counts verified against official results (no `~` prefixes)
- [ ] Inline citations present at first occurrence of each major factual claim
- [ ] Modeled data explicitly labeled in the methodology note
- [ ] Research gaps flagged for AM / politics-team follow-up
- [ ] Internal quality check run; nothing the rubric surfaced is left unaddressed

## Templates

### research-notes.md
- **Verified via primary sources**: biographical facts (with links); election results with exact counts for all candidates; government structure (form, body size, terms, executive role, thresholds); budget votes (date, action, split, who voted how); contested votes with coalition dynamics; legislative priorities; budget line items; CRM data (Contact ID, email, phone, account manager, election date, win status, onboarding status, poll dashboard URL).
- **Modeled, not measured**: constituency priority scores (0-100) with a methodology note explaining the derivation; demographic breakdown (source: ACS/Census at jurisdiction level); any approximate figures with an explanation of why.
- **Not in this roadmap (flagged gaps)**: numbered list, each with a follow-up owner.
- **Research rigor checklist (13 items)**: government structure confirmed; meeting schedule identified; committee structure mapped; ordinance/resolution process confirmed; budget cycle confirmed; voting thresholds confirmed; executive/chair role clarified; current political composition identified; recent significant legislation identified; election results verified (all candidates, exact counts); key allies identified; key opposition identified; state legal context addressed.
- **Known sensitivities**: political dynamics the AM should know before sending.
- **Suggested next steps**: verification tasks and data-collection opportunities for the AM and politics team.

### am-summary.md (internal only, NOT for the EO)
- **Accuracy scoring table**: combined quality and verdict for D-Long and D-Short, plus a 1-2 sentence summary.
- **Before you send (verification checklist)**: each item a checkbox with the exact data point, where to find it, and why it matters.
- **Assumptions made**: numbered judgment calls baked into the docs, with which sections break if the assumption is wrong.
- **Warnings**: sensitivities, relationship dynamics, framing risks that could affect reception.
- **Talking points for the AM**: how to introduce the D-Short ("the action version, your moves for the next 6 months"), the D-Long ("the full reference, read it when planning an agenda or prepping a budget hearing"), and the modeled data ("we estimated voter priorities from public data; when polling runs, we replace estimates with real numbers").

## Troubleshooting

| Problem | Fix |
|---|---|
| Score lands in REVIEW (5.0-6.9), usually thin Context | Common in small jurisdictions with no published votes or local press. Deepen Steps 2 research; if no primary sources exist, label gaps explicitly rather than inflating. |
| PDF has a title block or page headers/footers | Confirm the script passes `--metadata pagetitle` (not `title`) to pandoc and `--no-pdf-header-footer` to Chrome. |
| Drive link broke after re-upload | Update the file in place instead of deleting and re-creating it. |
| Two EOs in one jurisdiction scored inconsistently | Re-run the calibration anchor (see scoring book) before the batch; recalibrate if drift exceeds 0.5. |
