# Case scout quality bench

A fixed yardstick for the cases the scout drafts. Twenty fictional chats with
known right answers go through the scout's real scoring, drafting and PII-gate
code (`reader/night.py` `run_night`), then automatic checks run on each one and
you grade every draft by hand.

Run it by hand before trusting a scout prompt change. It is not in CI because a
real run spends money.

## Run it

From `packages/gp-ai`:

```bash
uv run python -m case_scout.bench            # prints the cost estimate and refuses
uv run python -m case_scout.bench --stub     # free: label-echo answers, checks the plumbing only
uv run python -m case_scout.bench --live     # real Anthropic calls; needs ANTHROPIC_API_KEY in the shell
```

Each run writes `bench-out/<timestamp>/results.json` and `report.html`
(`bench-out/` is gitignored). The bucket is moto, the message reader is
`FakeCaseScoutMessageReader`, and the case lists come from this checkout's
`packages/gp-api/src/chats/evals/judge/cases/`, so a run needs no AWS, no
Databricks and no GitHub. The bench passes `nightly_cap` to `run_night` so every
candidate is drafted instead of the usual 1 to 5 a night.

A `--stub` run answers every model call from the fixture labels. Use it to see
the report's shape; it says nothing about quality.

## What it costs

The runner prints an estimate before anything runs. With the current fixtures
and `claude-opus-4-7` at $5 / $25 per million tokens: about $1 for a run that
goes the way the labels say (19 scoring calls, 12 drafting calls, 11 gate
reads), and at most about $2.50 if every covered chat is drafted and every call
needs its one retry. The estimate is from character counts; the scout's call
functions return only text, so real token usage is not visible here.
`results.json` carries the same estimate for the calls the run actually made.

## The fixtures

One JSON file per chat in `fixtures/`. Each has the chat (`messages`, with
timestamps and tool calls) and a label (`expect`) of what the scout should do.
`loader.py` turns each message into a row with the `case_scout_messages` view's
own columns and converts it with the Databricks reader's own row converter, so
fixtures reach session splitting the way production chats do.

| Category          | Count | The scout should                                                                           |
| ----------------- | ----- | ------------------------------------------------------------------------------------------ |
| `known_pattern`   | 9     | Draft a case, and flag the one known pattern the chat shows (one fixture per pattern)       |
| `good`            | 5     | Not draft                                                                                  |
| `borderline`      | 2     | Not draft (cosmetic, severity 1)                                                           |
| `planted_pii`     | 2     | Draft without any planted PII, or drop the draft                                           |
| `duplicate`       | 1     | Skip it as covered by the case already on main                                             |
| `uncovered_agent` | 1     | Ignore it: never scored, no ledger line                                                    |

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
- `judge_loader`: the draft parses in the judge's case-list loader.

`judge_loader` uses a Python mirror of `parseCaseList` and `ChatCaseSchema`
(`judge_loader.py`), not `cli.ts --dry-run`, so a run needs no gp-api install.
It appends the draft to the agent's real case list and checks what the loader
checks that the gate does not: unknown keys, null values, trimmed lengths and
repeated caseIds. `tests/test_bench.py` pins its key set and bounds to `cases.ts`.

## Grading

Open `report.html`. For each draft, grade 1 to 3:

- **Faithful:** the case tests the failure in the chat.
- **Gradeable:** one judge could apply the handled-when rule the same way twice.
- **Fictional:** no real person, office or place.

Choices are kept in the browser while you work. Press **Export grades**, then
merge the file into the run:

```bash
uv run python -m case_scout.bench --grade bench-out/<timestamp> ~/Downloads/grades-<timestamp>.json
```

That writes the grades and a `gradeSummary` (share of drafts at 3/3/3) into
`results.json` and redraws the report with them filled in.
