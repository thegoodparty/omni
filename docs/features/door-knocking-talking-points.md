# Door-knocking talking points

AI-generated talking points for a door-knocking list. The canvasser opens a
door, the person sheet's first card tells them what to say, and what it says
was written for **this list** — its goal and its audience — rather than for the
campaign in general.

## What already exists, and what this changes

The card is already there. `DoorScript.tsx` renders a section titled "Talking
points" as the first thing in the person sheet's scrolling body, fed by
`useDoorScript` from `doorScriptContent.ts`, which assembles the candidate's own
issue stances out of the issues editor. It is deliberately static, and says so:

> The door script is deliberately static: the candidate's own issue stances,
> assembled from what they already wrote elsewhere in the product. No AI, and
> nothing authored here — a script the candidate can't recognize is worse than
> none, and generated talking points are a separate, filed piece of work.

This is that filed piece of work. The display surface needs almost nothing; the
content behind it is what changes, from per-campaign issue stances to per-list
generated bullets.

`DoorScript.tsx`'s header comment records that the design canvas captions this
card "AI-generated from this voter's profile and your candidate info." and that
we deliberately do not print it, because nothing generates the lines. **Half of
that caption becomes true here and the other half deliberately does not**: the
points are generated from the candidate's info, and they are per-list, not per
voter. Do not print the canvas's sentence unedited — a canvasser reading the
card aloud would be told it was written about the person in front of them.

## The three product requirements

1. **Per list, not per person.** One set of points per door-knocking list,
   generated once when the list is created, frozen with it.
2. **Takes the list's purpose into account** — the goal the candidate already
   picked on the wizard's first step. "Turn out my supporters" and "Ask for
   community input" should not produce the same card.
3. **Takes the list's filters into account** — "I'm talking to women today",
   "I'm chatting with homeowners".

Each maps to one mechanism, and each has one gap today:

| Requirement | Mechanism | Gap |
| --- | --- | --- |
| Per list | Generate at create, store on the list's `Outreach` envelope, serve on the route payload | Nothing on the list holds them |
| Purpose | Purpose slug into the prompt, persisted for later regeneration | The wizard collects it and throws it away |
| Filters | Natural-language description of the saved `VoterFileFilter` into the prompt | gp-api cannot describe a filter in words |

## Decisions already taken

Settled with the product owner before this plan was written:

- **Storage is the existing `Outreach.script` column.** Every door-knocking list
  already has an `Outreach` envelope, born in the same transaction as the turf
  and the route (the 1:1:1 invariant in `docs/door-knocking.md`), and that
  envelope already carries a `script String? @db.Text` that door knocking has
  never populated. No new content table, no new content column.
- **Purpose is persisted properly**, as an enum column, following phone
  banking's precedent (`PhoneBankingList` carries both a `PhoneBankingPurpose`
  and its `script`). Passing it through to the draft endpoint without storing it
  would make the points unregenerable the moment the flow closes.
- **The static build stays as the fallback.** Generated points win when a list
  has them; a list created before this ships, or one whose generation was
  skipped, keeps today's issue-stance card. This is what makes the change
  shippable without a backfill.
- **The candidate can edit and regenerate** in the wizard, matching every other
  channel.

## Architecture

Three moving parts, each copying an existing pattern rather than inventing one.

**Generation is a stateless draft endpoint.** `POST /v1/outreach/door-knocking/draft`,
modelled line for line on `POST /v1/outreach/phone-banking/draft`. Nothing
persists; the wizard holds the text client-side and freezes it at create. This
is the settled convention for every AI-drafted channel and it is also what keeps
an LLM call out of the create transaction, which already carries a paid Geoapify
round trip inside a 120-second window.

**Persistence is one field on an insert that already runs.** `Outreach.script`
is written in `doorKnockingCreate.service.ts`'s existing `tx.outreach.create`.

**Delivery rides the route payload.** `doorKnockingServe.service.ts` already
joins the envelope (`outreach: { select: { id: true } }`), so serving the script
is one more selected column on a query that already runs, emitted as an optional
top-level field beside `isServe`. It has to ride the payload rather than be
fetched by a hook, for the same reason `isServe` does: the printable walk sheet
and the PDF render server-side with no organization provider above them.

## The one thing the settled decisions leave open

`Outreach.script` is a text column and the product wants bullets. Those two
facts have to be reconciled, and the repo's own rules rule out the lazy answer:
`prisma/AGENTS.md` calls JSON columns an anti-pattern for known-shape data, so
serializing a `{title, body}[]` into the script column is the option to avoid.

**Recommendation: the wire format is plain text, one bullet per line.** The
title/body split stays a convention inside the prompt rather than a shape on the
wire. Four reasons:

1. It is what `script` already means on every other channel, so nothing about
   the column's meaning forks for door knocking.
2. The candidate edits the points in a textarea, and "editable" was a settled
   decision. A structured editor is a much larger surface for no product gain.
3. "Improve with AI" sends the current text back as `currentDraft`, which is a
   string on every existing draft contract. Structured bullets would need a
   bespoke improve path.
4. `DoorScript` already renders a bulleted list; it needs only to accept flat
   strings alongside today's `ScriptIssue[]`.

The cost is that `DoorScript`'s `{title} — {body}` rendering becomes
`{line}` for generated points. If the em-dash framing turns out to matter at a
door, the model can emit it as literal text within the line and nothing about
the storage changes.

## Implementation, in five PRs

Sized so each one is independently reviewable and nothing is half-wired at any
point. PRs 1–3 land dark (no UI reaches them); PR 4 turns the feature on; PR 5
is the display swap.

### PR 1 — Describe a filter in words, server-side

The only genuinely new logic in the feature, and the one piece with no backend
template. It is also independently useful, so it goes first and alone.

The prose generator already exists — `buildFilterSummary` in
`packages/gp-webapp/app/dashboard/contacts/crm/lists/ListFilterSummary.tsx`
turns a saved filter into *"Age 18-24 or 25-34, Language Spanish, and Support
status Supporter."* — but it lives in the webapp and gp-api cannot import it.
gp-api has the label vocabulary but no sentence assembly.

**Reuse:** `FILTER_DIMENSIONS` from
`packages/gp-api/src/contacts/filterDimensions.catalog.ts` (every column key →
display label, already mode-filtered per org, already written for LLM
consumption), plus `decodePrecinctPair` and `INCOME_RANGE_MAPPING` from
contracts.

**Port** the clause assembly and `joinAsSentence` from `buildFilterSummary` into
a new `packages/gp-api/src/contacts/utils/describeFilter.util.ts`.

**Write new**, because the catalog does not cover them:

- Legacy age keys (`age18_25`, `age25_35`, `age35_50`, `age50Plus`). They exist
  only in the webapp's `legacyAgeOptions`, saved rows still carry them, and
  without them an age-only legacy list describes as unfiltered.
- Precincts. Deliberately absent from `FILTER_DIMENSIONS` — its header explains
  that advertising the dimension without its per-district values would invite
  the assistant to invent precinct names — but `VoterFileFilter.precincts` is a
  real column, so the description needs the decode-and-cap clause.
- The free-text `search` clause.

**Do not widen `FILTER_DIMENSIONS` to cover those three.** The catalog is what
`describe_filter_dimensions` advertises to the Chief of Staff assistant as
*writable*, and precincts are excluded from it on purpose. Keep the read-only
additions in a separate map inside the new util. `filterDimensions.catalog.test.ts`
drift-checks the catalog and should stay passing untouched.

Unit tests per clause combination, mirroring the webapp's existing
`ListFilterSummary` tests.

### PR 2 — Prisma and contracts

**Prisma** (`prisma/schema/doorKnockingTurf.prisma`): a `DoorKnockingPurpose`
enum and a nullable `purpose` column on `DoorKnockingTurf`. Nullable because
every existing list predates it and there is no honest value to backfill.
`npm run migrate:dev`; migrations are immutable once applied.

**The enum is exactly `PhoneBankingPurpose`'s nine values, with no additions.**
The wizard already picks from the shared vocabulary — `doorKnockingPurposes.ts`
re-exports `OUTREACH_PURPOSE_VALUES` and `serveDoorKnockingPurposes.ts`
re-exports `SERVE_OUTREACH_PURPOSE_VALUES` — so the storage vocabulary is the
union of the two, which is the set phone banking already consolidated onto:

```
introduce_myself  persuade_voters  event_invite  early_voting
election_day_turnout  custom  explain_decision  community_input  share_resource
```

Do not invent a door-knocking-shaped purpose. `doorKnockingPurposes.ts`'s own
header records that this channel used to carry a local six-value vocabulary and
that consolidating it onto the shared slugs is what the consolidation existed to
achieve — a fourth translation table is the thing being avoided.

What *is* door-knocking's own is the **wording**, and it already exists:
`DOOR_KNOCKING_PURPOSE_LABELS` and `SERVE_DOOR_KNOCKING_PURPOSE_LABELS`, kept
deliberately distinct from social's and phone banking's copy. Nothing about the
labels changes here; PR 3's prompt copy is a third record keyed on the same
slugs, for the same reason the name suggestions are a second one.

Nothing is added for the points themselves — `Outreach.script` already exists.

**Contracts** (`packages/contracts/src/`):

- `outreach/DoorKnockingTalkingPoints.schema.ts` — the draft request/response,
  modelled on `PhoneBankingScript.schema.ts`. Carries `purpose`, the filter (a
  saved `voterFileFilterId`, or the draft filter object for an audience being
  cut in the wizard), and the `currentDraft` / `previousDraft` / `instructions`
  trio with the same mutual-exclusion `.refine`. **No `tone`** — the points are
  not word-for-word, so there is no voice to select.
- `doorKnocking/DoorKnockingTurf.schema.ts` — add `purpose` and `talkingPoints`
  to `CreateDoorKnockingTurfSchema`. It is `.strict()`, so this is required, not
  optional politeness.
- `doorKnocking/DoorKnockingRoutePayload.schema.ts` — add `talkingPoints` beside
  `isServe`, **`.optional()` and never `.default()`**. The file states the rule
  and the reason at length: nothing parses this payload at runtime in either
  direction, so a default promises the compiler a value it will not supply, and
  a pre-ship service-worker snapshot would hand a consumer `undefined` with no
  type error. Absent must render identically to empty.

Per `contracts/AGENTS.md`, export from the feature index *and* the root index or
it does not ship, and update consumers in the same PR.

### PR 3 — The draft endpoint

Lives in `src/outreach/`, not `src/doorKnocking/`. `outreach/AGENTS.md` is
explicit: that package owns the stateless draft/improve endpoints, and the
stateful create stays in the feature's own module.

- `outreach/outreachDoorKnocking.controller.ts` — a near-copy of
  `outreachPhoneBanking.controller.ts`: `@UseCampaign()`, `@UseOrganization()`,
  `@UseInterceptors(ZodResponseInterceptor)`, `assertProAccess`, best-effort
  position resolution in a try/catch that degrades rather than failing the
  draft.
- `outreach/services/outreachDoorKnockingGeneration.service.ts` — the generation
  service. Follows `OutreachPhoneBankingGenerationService`'s shape but does
  **not** need its `PhoneBankingVoiceConfig` indirection: door knocking is one
  route for both Win and Serve, and `door-knocking/AGENTS.md` explicitly rejects
  copying the phone-banking surface object into this feature. A ternary on the
  `eo-` slug is the established pattern here.
- `OutreachComposeContextService` is used **unchanged**. It is already
  channel-agnostic and already emits exactly the candidate story, issue
  positions, and campaign-plan blocks this needs.
- The new filter description from PR 1 is injected as an additional context
  block.

**Failure posture** matches the siblings: any model failure is a 502, never a
canned fallback string.

#### The prompt

Three context blocks beyond name and office:

1. **Purpose.** A full instruction block per purpose, following phone banking's
   `WIN_PURPOSE_PROMPTS` / `SERVE_PURPOSE_PROMPTS` convention rather than the
   older one-line goal + structure pair. Two records keyed on the nine slugs
   from PR 2 — the Win six and the Serve six, overlapping on
   `introduce_myself`, `event_invite` and `custom`. This is where "Turn out my
   supporters" and "Ask for community input" produce genuinely different cards.
   Purpose copy is product's to write; transcribe it verbatim and do not
   editorialize, the same rule phone banking's copy carries.

   `custom` follows phone banking exactly: fresh generation is refused with a
   400 and only the improve path is allowed, because custom-purpose content is
   the candidate's own words being adapted rather than written.
2. **Audience.** The filter description from PR 1.
3. **Campaign materials.** `buildCampaignContext`, unchanged.

Two rules the system prompt needs that no sibling has:

- **Bullets, not a script.** Three to five short lines, each something a
  canvasser can say in their own words. Explicitly not a word-for-word script
  and explicitly not a dialogue — this is the whole reason the SMS and phone
  banking components could not simply be reused.
- **Hedge on modeled attributes.** Inject
  `FILTER_DIMENSION_PROVENANCE_RULES` from `filterDimensions.catalog.ts`. This
  matters more here than anywhere else in the product: a good chunk of the
  filter columns are *modeled estimates*, not observed facts, and requirement 3
  asks the model to write lines premised on who is behind the door. "As a
  homeowner, you've probably noticed your property taxes…" said to a renter is
  the failure mode, and it is said out loud, in person, by a candidate. The
  points should be written *for* an audience without *asserting* membership in
  it.

Do not put the voter's name, or anything person-specific, in the prompt. The
points are per list; the requirement is explicit about it.

### PR 4 — Persist and generate in the wizard

**Backend.** `doorKnockingCreate.service.ts`: `purpose: input.purpose` on the
existing `tx.doorKnockingTurf.create`, and `script: input.talkingPoints` on the
existing `tx.outreach.create`. Both are one line inside a transaction that
already runs. No LLM call goes inside it.

**Frontend.** A sixth stage in the create wizard, between `confirm` and `route`.
The purpose slug and the filter are both settled by then, and the route step is
the paid press that must stay last.

`createFlow/createFlowSteps.ts` needs all five of its functions updated —
`CreateFlowStage`, `stageStep`, `stepperPosition` (five hardcoded
`totalSteps: 5` become six), `previousStage`, and `flowStage`. `CreateListFlow.tsx`
needs a `STAGE_META` entry, a stage render, a CTA branch, the new state, and
`purpose` plus the points added to the create body at the existing `body`
object.

**One trap.** The orphan-filter cleanup effect keys on the orchestrator's
four-value `CreateFlowStep`, not on the six-value stage, and it deletes the
filter this flow minted whenever the step is neither `confirm` nor `route`. If
the new stage maps to a `CreateFlowStep` of its own, add it to that guard or a
filter minted on a retry is deleted mid-flow.

The step component is a copy of phone banking's `ScriptStep.tsx` with four
things removed: the tone pills, the name field (door knocking already names the
campaign on its `confirm` stage — a copied ScriptStep would ask twice), the
phone-banking copy, and the surface indirection. What survives is the layout,
the `ThinkingStream` gating, Regenerate, Improve with AI, the instructions
input, dictation via `useDictationAppend`, the error card, the stale-response
request-id guard, and the `manuallyEdited` rule that decides whether a
regenerate may send `previousDraft`.

There is no undo in `ScriptStep`; that lives in `SocialFlow`. Copy it from there
if it is wanted, or leave it out — phone banking ships without it.

Register both new endpoints in `gpApi/api-endpoints.ts`.

### PR 5 — Show them at the door

`doorKnockingServe.service.ts`: add `script: true` to `ROUTE_INCLUDE`'s
`outreach` select, and emit `talkingPoints` on the return literal beside
`isServe`. No extra query — the envelope is already joined and the turf is
already loaded.

`useDoorScript.ts` takes the served points and prefers them, falling back to
today's `buildScriptIssues` build when a list has none. It is the single seam:
one production caller (`PersonSheet.tsx:331`), reached identically by the
candidate walk and the volunteer walk, so both light up with no other change.

`DoorScript.tsx` accepts flat bullet lines alongside today's `ScriptIssue[]`.
Consider whether to print an "AI-generated" caption; if so it must say
*generated for this list*, not the canvas's per-voter wording.

**Decide explicitly whether the points print on paper.** The printed walk sheet
and the PDF deliberately carry neither notes nor phone numbers nor demographics,
because paper leaves the building and stops being access-controlled. Talking
points are campaign copy rather than voter data, so the argument does not
obviously apply — but it is a decision to make on purpose rather than by
default, and both surfaces read the same payload, so they will get the field
whether or not they render it.

## Testing

**Backend draft endpoint** — mirror `outreach/tests/outreachPhoneBanking.test.ts`
exactly. It pulls the real `LlmService` out of the Nest container and spies
`jsonCompletion`, then reads the assembled prompt back off the spy. Cover: each
purpose's copy reaching the prompt (one representative sentence per purpose, not
a full-string pin), the filter description reaching the prompt, campaign
materials reaching the prompt, improve vs. fresh path selection, the
provenance-rules block being present, validation refusals asserting the LLM was
never called, the Pro gate, and a model rejection producing a 502.

**Backend routes** — extend `doorKnocking.routes.test.ts`. The `create (the
money path)` block gains purpose and script persistence; the `serve` block gains
the payload field. The ADR 0009 and ADR 0011 blocks are the closest precedent
for "a new optional field rides the payload" and are worth reading first.

**Frontend** — `CreateListFlow` tests for the new stage and the create body;
`useDoorScript` tests for the prefer-served-fall-back-to-static branch;
`DoorScript` tests for the flat-line rendering.

**No e2e spec may create a list.** Every list is a billed Geoapify route, and
that suite gates every PR in the monorepo.

## Risks and open questions

**Generated points replace the candidate's own issue stances on the card.**
That follows from the settled fallback decision, and it may be the right call —
but the stances are what the candidate actually wrote and can recognize, which
is the exact argument `doorScriptContent.ts` makes for the static card
existing. Showing generated points above the issue stances rather than instead
of them is a one-line variation if it turns out to read better in the field.

**Regeneration after create is out of scope.** The points freeze with the list.
There is no reachable surface to edit them from afterwards: `TurfDetailsSheet`
is rendered but unreachable by design, and `door-knocking/AGENTS.md` warns
against inventing a surface for it. Persisting `purpose` in PR 2 is what keeps
that door open for later without a migration.

**Serve is probably in scope, and the plan assumes it is.** An elected
official's door script is opener-only today, and `door-knocking/AGENTS.md`
records that as the finished shape rather than a stub — the bullets under a Win
intro are campaign issue stances, and an official has no campaign to have
written them in. Generated points remove that constraint, because they come
from a prompt rather than an issues editor, and the Serve wizard **already
shows six purpose cards** ("Explain a recent decision", "Ask for community
input", "Share a resource or service", …) that today decide nothing but a
suggested list name. Those cards are the strongest argument that Serve gets
points: the candidate has already been asked the question, and the answer is
currently thrown away.

Two things stay Serve-specific if it ships: the card keeps its "Introduction"
heading rather than "Talking points" where that is still the right word, and
the prompt must never introduce a sitting official as a candidate for their own
seat — the mistake `buildServeIntro` exists to prevent.
