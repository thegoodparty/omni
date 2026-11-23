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
- The old prompt forbade reading any page. The copy here allows a bounded one
  (at most two reads a run), only for an authoritative roster page a snippet
  suggests names a filer — that is the one case where the field can be confirmed
  and a snippet cannot be evidence on its own.
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
  before it dispatches, so the run the agent finishes is the one the plan points
  at. `onOppositionResearchArtifact` is idempotent on `oppositionPersistedAt`,
  because `onArtifact` can run twice for one run.
