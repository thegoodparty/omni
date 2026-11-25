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

| Path                                                                  | What                                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `campaignStrategy.service.ts`                                         | The polling endpoint, the two sections' dispatch and write path, and the race/story/roster reset machinery |
| `services/sectionRun.ts`                                              | One section's run, read from whichever engine ran it: status, which engine, roster seen, artifact          |
| `services/strategicLandscapeParams.service.ts`                        | Builds the agent input and fits it to the dispatch budget                                                  |
| `services/strategicLandscape.persister.ts`                            | The two sections' rows, claimed against the race the run generated for                                     |
| `services/raceContext.service.ts`                                     | The election database's campaign-strategy context                                                          |
| `oppositionResearch/`                                                 | The `opposition_research` agent: prompt, schemas, definition and its test                                  |
| `opportunitiesAndChallengesAgent/`                                    | The `opportunities_and_challenges` agent: prompt, schemas, definition and its test                         |
| `opportunities_and_challenges.eval.ts`, `opposition_research.eval.ts` | The two sections' Universal Judge suites                                                                   |

## The engine switch

`runsOnGpApi(OPPOSITION)` is per agent, and every path that touches a section's run
reads it: `tryDispatch` picks `AgentsService.run` or the PMF Engine's
`dispatchRun`, `sectionRunFrom` picks `AgentRun` or `ExperimentRun`, and each
agent's `onArtifact` writes its section through the same `persistSection` the PMF
Engine's result consumer calls. `sectionRunFor` is public
so the race-opponent page's discovery status reads the same table the dispatcher
wrote to.

The switch picks the table for a new dispatch; it cannot pick one for a run that
was already in flight when it flipped. A plan's section or a race-opponent
discovery dispatched before the flip keeps its run id in the other engine's
table, and the id is in exactly one of them, so `sectionRunFrom` falls back to
the other table and returns the run that actually holds it, `engine` and all.
Without that, the section read as idle, the endpoint started a second paid run,
and the first landed nowhere the plan points at — and reverting a line as a
rollback had the same problem in reverse.

Both sections run on gp-api's own agents in dev and prod, and a preview runs
them on gp-api's engine too, because it is the judge's candidate arm
(`deploy/agentsOnGpApi.ts`). The PMF Engine is the fallback for an agent the
list leaves out.

`superseded` is the one status the two engines disagree about, so a `SectionRun`
carries its `engine` and `sectionRunIsInFlight` reads it. The PMF Engine's resume
sweep writes it on a predecessor _after_ dispatching a successor that shares the
plan's run id, so there it is in flight and re-dispatching would orphan live work.
gp-api's `supersede` starts a successor under a new run id that nothing points the
plan at, so that run can never land: it has to read as re-dispatchable, or the
plan stays `generating` forever. Every reader of a section's status calls
`sectionRunIsInFlight` for that reason — the plan poll and the race-opponent
discovery poll alike, since a reader with its own status list drifts back to the
wrong rule.

The tracker bootstrap runs after the last section persists, and the plan poll
re-attempts it for a section persisted inside `PERSIST_GRACE_MINUTES`. It cannot
run on every ready poll: `tracker_bootstrapped` shipped `DEFAULT false` with no
backfill, so an unscoped retry would start a paid initial tracker generation for
every plan that went ready before that column existed.

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

## opportunities_and_challenges

- `opportunitiesAndChallengesAgent/opportunitiesAndChallenges.prompt.ts` is
  `packages/runbooks/experiments/opportunities_and_challenges/instruction.md`
  (manifest version 8) with the runtime swapped, as the opposition prompt is. The
  PMF Engine copy stays as the base arm while the switch exists.
- The input carries `today`, the run's date, which the manifest's fields do not:
  the old runner stated it in the system prompt and every runway is counted from
  it. The dispatcher fills it and the judge's run route fills it, so both engines
  hand the agent the same date. It is the only agent that takes one.
- The prompt is the instruction's rules as written, with one exception, because
  the Universal Judge said so four times over. A straight port lost on sourcing
  and precision rather than on arithmetic, so the ported rules are stated as
  instructions: a figure comes from the input or from a page this run read, a
  citation names a URL this run opened, a runway is an exact day count computed
  from `today`, and a thin input is named rather than padded. That replaces what
  the experiment got from its `http.head` link check and its "use only what the
  input and fetched pages support" line, neither of which survives the runtime
  swap. The tightening also reverses two readings the port invited:
  `winNumberEffective` is a planning target and not a rule about who wins, so a
  single seat earns no bullet about plurality, runoffs or second place; and
  `partisanType: nonpartisan` says nothing about party money, staff or data.
  Step 0b and the "always wrong here" list name the phrasings the judge read as
  invented election law or an invented statistic. Step 4 makes the agent
  recompute every derived number before it submits, because the old engine's
  validator loop re-read the artifact's numbers and `submitOutput` validates the
  shape and nothing else: a bullet can state a phone-coverage share that counts
  numbers as voters, or a sit-out share that is not 1 minus turnout, and still
  pass. The step names each of those, and the rule for a conflict between two
  input fields: report it, do not reconcile it. The Universal Judge then scored
  the agent BETTER than the experiment it came from, so treat these rules as the
  agent's contract rather than as scaffolding to relax.
- **The output schema is the manifest's, unchanged**: the two lists ARE the
  section, so `parseOpportunitiesChallengesArtifact` reads the same shape from
  either engine's run and the persister did not change.
- `onArtifact` resolves `CampaignStrategyService` lazily, for the same import
  cycle the opposition agent avoids that way.
