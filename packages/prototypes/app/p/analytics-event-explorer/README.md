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
| Standalone | `standalone/` | one file, published as an Artifact: the copy people actually use, and the only one that tracks usage or takes feedback |

Declaring `db` makes the published artifact organization-internal, so every viewer is
a signed-in GoodParty account — which is what lets a visit be attributed at all.

**Every page change has to land in both.** They render the same snapshot but share no
code: the prototype is React against the styleguide, the standalone is vanilla JS with
its own CSS. That duplication is deliberate and temporary — it goes away when the page
moves into gp-admin (DATA-2506 phase 3) and the standalone copy is retired.

## How it stays current (nothing here is manual)

```
analytics-governance.yml, Mon + Thu 11:00 UTC
  └─ event_explorer_snapshot.py  ->  data/event-explorer.json, committed in the state PR
        └─ routine "Republish the analytics events explorer", Mon + Thu 15:00 UTC
              └─ standalone/build.py  ->  publish to the same artifact URL
```

The routine (`trig_01E8wipVnESi9uqoEBWZXFKY`) republishes only when the committed
snapshot is newer than the live page, so a run that fires before the pipeline has
committed cannot replace a newer page with an older one. It must **never** pass
`capabilities` on the publish: the page's stored declaration survives only when that
field is omitted, and replacing it would break the tracking and the feedback button.

## Refreshing by hand

```bash
# from packages/runbooks/scripts/python — needs Databricks, nothing else
uv run event_explorer_snapshot.py --series \
  -o ../../../prototypes/app/p/analytics-event-explorer/data/event-explorer.json

cd ../../../prototypes/app/p/analytics-event-explorer/standalone && python3 build.py
```

`--series` adds the 9-week sparkline data; without it the rest still builds and the
sparklines read "no data". The builder reads `event_state_assembler.assemble()`, the
same rows the event-state sheet gets, so the page and the sheet cannot disagree and no
Google credential is involved. `build.py` needs no credentials at all.

`data/event-explorer.json` is committed so the prototype runs with no credentials.
Republish to the **same URL** so the link people already have keeps working.

## Tracking and feedback (the shared page only)

The published page has no server, so the trial is instrumented through the artifact
runtime it declares: `db`, `user` (scope `profile`), and `comments` (composer only).

- One document per visit in the `sessions` collection: the viewer's opaque id, the
  snapshot they saw, their searches (query, result count, whether a question matched,
  whether it fell back to closest matches), events opened, questions picked, outbound
  clicks by kind, feedback opened. Read it with the `ArtifactData` tool.
- Memory is the source of truth and the document is its projection, so a visit is one
  `set()` of the whole row — never a read-modify-write counter, which last-writer-wins
  would corrupt.
- Searches are logged on a pause, not per keystroke. Outbound clicks are classified by
  destination rather than by tagging each link, so a link added later is still counted.
- **Rows are readable by anyone in the org who opens the page.** A `db` rule's read
  level can never be stricter than its write level, so a log everyone writes is a log
  everyone can read. The page says so under the usage panel.
- Feedback opens the claude.ai comment composer (`openComposer`), so the page posts
  nothing itself and threads render in the shell. Read them with `ArtifactComments`.
- The usage panel renders only for `isOwner()`. It resolves ids to names at render
  time; names are never written into a row. The `email` scope is not enabled for this
  organization, so there are names but no addresses.
- None of this exists in the Next.js copy: there is no runtime outside claude.ai, so
  `claude.use` is absent and every call no-ops. That is the graceful-absence path, and
  it is why the local page looks identical minus the feedback button and the panel.

## Search

People search in sentences and in their own spelling, so the index is not literal:
grammar words are dropped, a joined compound matches a split one (`phonebanking` finds
`Phone Banking`), and a plural matches the singular the data uses. When nothing matches
every word, a second pass returns the closest matches under a banner rather than an
empty page — a blank result here reads as "we do not measure that", which is the one
wrong answer this page can give. `lib/search.test.ts` holds the queries that were
actually typed at it.

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
- **A caveat has two halves.** `headline` in `monitored_events.yaml` is the plain
  sentence everyone reads; `caveats` is the precise prose, one disclosure down, for
  whoever writes the query. A test fails the PR if a caveat has no headline, or if a
  headline carries backticks, file names or ticket ids.
- **The standalone page declares its own charset.** Opened as a saved file there is no
  `Content-Type` header, and every arrow, check and middot renders as mojibake without
  it. Sending someone the file is the whole point of that copy.
- **Browser or server is derived from the code path**, the only signal we hold, so the
  266 events with a path say which and the other 326 say nothing at all.
- **`ANSWERS` and `USED_BY` in the snapshot builder are hand-kept.** They retire when
  the Analytics Questions list gets an "Answer link" field (DATA-2509).
