# Case scout quality bench

A fixed yardstick for the cases the scout drafts. Twenty fictional chats with
known right answers go through the scout's own scoring, drafting and PII-gate
code (`src/caseScout`: `caseScout.prompts.ts`, `CaseScoutModelService`,
`util/gate.util.ts`), then automatic checks run on each one and you grade
every draft by hand.

Run it by hand before and after any scout prompt change. It is not in CI
because a real run spends money.

## Run it

From the repo root:

```bash
npm run case-scout:bench -w packages/gp-api                 # prints the cost estimate and refuses
npm run case-scout:bench -w packages/gp-api -- --stub       # free: label-echo answers, checks the plumbing only
npm run case-scout:bench -w packages/gp-api -- --live       # real Anthropic calls; needs ANTHROPIC_API_KEY in the shell
```

Each run writes `packages/gp-api/bench-out/<timestamp>/results.json` and
`report.html` (`bench-out/` is gitignored; `--out-dir` moves it). The case
lists come from this checkout's `judge/cases/`, so a run needs no AWS, no
database and no GitHub.

`runner.ts` calls the pipeline's pieces in the order the score and draft jobs
do, in one night, with two differences: no spend cap or nightly draft cap, so
every candidate is drafted, and an empty ledger, so only that night's own
proposals count as duplicates. A change to the per-candidate rules in
`caseScoutDraft.service.ts` belongs in `runner.ts` too.

A `--stub` run answers every model call from the fixture labels. Use it to see
the report's shape; it says nothing about quality.

## What it costs

The CLI prints an estimate before anything runs. With the current fixtures and
`claude-opus-4-7` at $5 / $25 per million tokens: about $1 for a run that goes
the way the labels say (19 scoring calls, 12 drafting calls, 11 gate reads),
and at most about $2.60 if every covered chat is drafted and every call needs
its one retry. The estimate is from character counts, since the model service
returns only text. `results.json` carries the same estimate for the calls the
run actually made.

## The fixtures

One JSON file per chat in `fixtures/`. Each has the chat (`messages`, with
timestamps and tool calls) and a label (`expect`) of what the scout should do.
`fixtures.ts` turns each message into the shape the scout's message reader
returns, so fixtures reach session splitting the way stored chats do.

| Category          | Count | The scout should                                                                      |
| ----------------- | ----- | ------------------------------------------------------------------------------------- |
| `known_pattern`   | 9     | Draft a case, and flag the one known pattern the chat shows (one fixture per pattern) |
| `good`            | 5     | Not draft                                                                             |
| `borderline`      | 2     | Not draft (cosmetic, severity 1)                                                      |
| `planted_pii`     | 2     | Draft without any planted PII, or drop the draft                                      |
| `duplicate`       | 1     | Skip it as covered by the case already on main                                        |
| `uncovered_agent` | 1     | Ignore it: never scored, no ledger line                                               |

Everything in a fixture is invented: names, towns, offices, phone numbers
(555-01xx) and emails (example.com). They are the yardstick, so a change to one
needs the same review as a change to the scout.

## Automatic checks

Per fixture, in `results.json` and the report:

- `scored` or `ignored`: a covered agent's chat got a score; an uncovered one was never touched.
- `drafted`: a case reached the bundle exactly when the label says.
- `skipped_as_covered`: the duplicate came back as covered.
- `pattern`: the expected known pattern is among the scout's severity 2+ requests.
- `no_planted_pii`: no planted PII string from any fixture appears in a draft.
- `gate_schema`: the draft passes the gate's own schema check.
- `judge_loader`: the draft, appended to the agent's real case list, parses in the judge's own `parseCaseList`.

## Grading

Open `report.html`. For each draft, grade 1 to 3:

- **Faithful:** the case tests the failure in the chat.
- **Gradeable:** one judge could apply the handled-when rule the same way twice.
- **Fictional:** no real person, office or place.

Choices are kept in the browser while you work. Press **Export grades**, then
merge the file into the run:

```bash
npm run case-scout:bench -w packages/gp-api -- --grade <run dir> ~/Downloads/grades-<timestamp>.json
```

That writes the grades and a `gradeSummary` (share of drafts at 3/3/3) into
`results.json` and redraws the report with them filled in.
