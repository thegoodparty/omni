# src/campaignStrategy

The V2 campaign plan's two generated sections. `opposition_research` finds who is
on the ballot; `opportunities_and_challenges` finds what the race offers and costs
the candidate. Each is one background agent, and each can run on either engine
while the consolidation is in progress (`docs/cap-consolidation.md`).

`CampaignStrategy` is the plan row: `oppositionRunId` / `opportunitiesRunId` point
at each section's run, `oppositionPersistedAt` / `opportunitiesPersistedAt` mark
its rows as written, and `oppositionAttempts` / `opportunitiesAttempts` cap the
lifetime dispatches per section. The endpoint reports `ready` only once both
markers are set; a failed or stuck section re-dispatches on the next poll.

## Where to look

| Path | What |
| --- | --- |
| `campaignStrategy.service.ts` | The polling endpoint, the two sections' dispatch and write path, and the race/story/roster reset machinery |
| `services/sectionRun.ts` | One section's run, read from whichever engine ran it: status, roster seen, artifact |
| `services/strategicLandscapeParams.service.ts` | Builds the agent input and fits it to the dispatch budget |
| `services/strategicLandscape.persister.ts` | The two sections' rows, claimed against the race the run generated for |
| `services/raceContext.service.ts` | The election database's campaign-strategy context |
| `oppositionResearch/` | The `opposition_research` agent: prompt, schemas, definition and its test |
| `opportunities_and_challenges.eval.ts`, `opposition_research.eval.ts` | The two sections' Universal Judge suites |

## The engine switch

`runsOnGpApi(OPPOSITION)` is per agent, and every path that touches a section's run
reads it: `tryDispatch` picks `AgentsService.run` or the PMF Engine's
`dispatchRun`, `sectionRunFrom` picks `AgentRun` or `ExperimentRun`, and the
`opposition_research` agent's `onArtifact` writes the section through the same
`persistSection` the PMF Engine's result consumer calls. `sectionRunFor` is public
so the race-opponent page's discovery status reads the same table the dispatcher
wrote to.

A section whose run no plan links is a judge run, or one a race change already
orphaned. Its output has nowhere to land, and the judge's run route returns the
artifact instead.

## opposition_research

- `oppositionResearch/oppositionResearch.prompt.ts` is
  `packages/runbooks/experiments/opposition_research/instruction.md` (manifest
  version 10) with the runtime swapped: input in the first message,
  `webSearch` / `fetchPage` / `renderPage` for the web, `submitOutput` in place of
  the file, the validator, the assembler and TodoWrite. The PMF Engine copy stays
  as the base arm while the switch exists.
- The old prompt forbade reading any page, because its only tool was WebSearch
  and a snippet cannot confirm a filer. The copy here allows exactly one bounded
  read (at most two a run) to check that an authoritative roster states this
  race's office, jurisdiction and election date; a page that does not state all
  three confirms nothing and the name is dropped. A roster that already names
  opponents is complete, so the search runs only when it is thin or empty.
- **The output schema is the manifest's, unchanged**: the plan's Opposition
  Research section is rendered from `{ opponents: [{ full_name,
  party_affiliation, incumbent }] }` and the persister reads it, so a gp-api run
  publishes the same artifact the PMF Engine does. The assembler's mapping
  (parties normalized to `Nonpartisan` in a nonpartisan race, incumbency to a
  boolean or null, dedup by normalized name) lives in the prompt because gp-api
  publishes what the model submits.
- `onArtifact` resolves `CampaignStrategyService` lazily. The service imports the
  agent registry, so a static import back would close a cycle and leave one side
  undefined whichever module loaded first.
- Persisted by the plan's own `oppositionRunId`: the dispatcher links the run id
  right after it dispatches, so the run the agent finishes is normally the one
  the plan points at. A run that finishes before that link lands persists
  nothing, the same way it already worked on the PMF Engine, and the stale sweep
  reclaims it. `onOppositionResearchArtifact` re-runs the bootstrap when the
  marker is set but the side effects did not finish, because `onArtifact` can
  run twice for one run.
