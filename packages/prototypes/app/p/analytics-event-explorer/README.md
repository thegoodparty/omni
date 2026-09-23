# Analytics event explorer

A browsable surface over the analytics event governance data that otherwise only
exists in the event-state Google Sheet. Answers three questions: do we have an event
for that, is it working, and how are we measuring X.

Tickets: DATA-2506 (the explorer), DATA-2509 (consumer links, intake, usage trial).
Design doc: `docs/superpowers/specs/2026-09-22-analytics-event-explorer-design.md`
(gitignored, local only).

## Two copies of the same page

| | Where | Why it exists |
| --- | --- | --- |
| Prototype | this folder, `http://localhost:4002/p/analytics-event-explorer` | the one we iterate on |
| Standalone | `standalone/` | a single file that can be published and sent to someone, no server, no login |

**Every page change has to land in both.** They render the same snapshot but share no
code: the prototype is React against the styleguide, the standalone is vanilla JS with
its own CSS. That duplication is deliberate and temporary — it goes away when the page
moves into gp-admin (DATA-2506 phase 3) and the standalone copy is retired.

## Refreshing the data

`data/event-explorer.json` is generated. It is committed so the prototype runs without
Databricks or Google credentials.

```bash
# from packages/runbooks/scripts/python
uv run event_explorer_snapshot.py --series \
  -o ../../../prototypes/app/p/analytics-event-explorer/data/event-explorer.json
```

`--series` adds the 9-week sparkline data and needs Databricks; without it the rest
still builds and the sparklines read "no data". The sheet read needs the cached Google
OAuth token (`~/.config/gp-event-state/gsheet_token.pickle`).

The snapshot reflects the last governance cron run (Mondays and Thursdays, 11:00 UTC),
not live data, which is why the page states its own refresh date and the next run.

## Rebuilding the shared page

```bash
cd standalone && python3 build.py
```

Writes a gitignored `analytics-event-explorer.html`, which is then published as an
Artifact. Republish to the **same URL** so the link people already have keeps working.

## Things that will surprise you

- **`where_it_fires` does not come from Amplitude.** Govern has it for 2 of 592 events.
  The rest come from the accepted rows of the anchor review queue, via the assembler
  fallback, because the Govern write-back does not exist yet (DATA-2434).
- **Product is the tag first, the code path second.** A directory cannot settle it:
  `CreateListWizard.tsx` fires a Win event and a Serve event from the same file. The
  path only fills gaps where no tag exists, never overrides one. 385 of 592 known.
- **`supersession` is prose, not a reference**, and runs in both directions. `lib/
  lineage.ts` parses it. 11 of 22 resolve; DATA-2507 is the fix.
- **A caveat is shown on an event only when it names that event.** Attaching every
  caveat from every question an event serves buried one card under four warnings,
  three of them about unrelated subjects.
- **`ANSWERS` and `USED_BY` in the snapshot builder are hand-kept.** They retire when
  the Analytics Questions list gets an "Answer link" field (DATA-2509).
