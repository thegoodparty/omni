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

This is that filed piece of work. The display surface needs little; the content
behind it is what changes, from per-campaign issue stances to a per-list,
five-section door script.

`DoorScript.tsx`'s header comment records that the design canvas captions this
card "AI-generated from this voter's profile and your candidate info." and that
we deliberately do not print it, because nothing generates the lines. **Half of
that caption becomes true here and the other half deliberately does not**: the
points are generated from the candidate's info, and they are per-list, not per
voter. Do not print the canvas's sentence unedited — a canvasser reading the
card aloud would be told it was written about the person in front of them.

## The product requirements

1. **Per list, not per person.** One set of points per door-knocking list,
   generated once when the list is created, frozen with it.
2. **Takes the list's purpose into account** — the goal the candidate already
   picked on the wizard's first step. "Turn out my supporters" and "Ask for
   community input" should not produce the same card.
3. **Takes the list's filters into account** — "I'm talking to women today",
   "I'm chatting with homeowners".
4. **Bullets, not a word-for-word script**, and no tone selector, because there
   is no prose voice to select.

## The five-section template

Source: *Door Knocking Script.docx* (product). It defines the structure of a
doorstep conversation, and it is the single most useful constraint in this
feature — it is what turns "generate some bullets" into a gradeable task.

| # | Section | Job | Slots |
| --- | --- | --- | --- |
| 1 | Introduction | Who you are and why you're at this door, ending in a light engagement question so it invites a response rather than opening a monologue | `[Canvasser Name]`, `[Affiliation]`, `[Candidate]`, `[Office]` |
| 2 | Context | Why this candidate, in one or two sentences. Core message, background, or differentiating values. The persuasion beat, and deliberately evergreen rather than tied to a dated event | `[Candidate]`, `[Core Message / 1–2 Priorities]` |
| 3 | CTA | A low-friction next step the resident can take on their own. Framed as an invitation to learn more, not a commitment | `[Website URL / Handle / Shortcode]` |
| 4 | Ask | The one concrete commitment wanted from this conversation, with only the logistics needed to act | `[Ask Type]`, `[Date]`, `[Location]`, `[Time]` |
| 5 | Departure / Thanks | Affirm their support matters, thank them, leave an open channel, close warmly. Consistent regardless of how the conversation went | — |

**One bullet per section.** The card is five lines, each the substance of its
section — not the template's full sample paragraph, and not a heading.

### These are bullets, not a script

The template's sample is a word-for-word script. **Ours is not**, and the
distinction governs every prompt rule below: the canvasser reads the card and
says the idea in their own words. Nothing on it is meant to be recited.

The register is not uniform across the five, and that is not incoherent — it
tracks how much of each line is *data* versus *substance*. A canvasser cannot
paraphrase their own name, a URL, or an event start time, so Introduction and
CTA land close to literal. "Why this candidate" is precisely the thing they
should put in their own words, so Context, Ask and Departure are true notes.

### What the template buys us

Three problems that an open-ended "write 3–5 bullets" prompt could not solve are
solved by the structure itself:

- **Bullets stop being topics.** Each line has one defined job, so the model
  cannot emit "Public safety" where a sentence belongs. An Introduction bullet
  has to be an actual greeting.
- **The speaker becomes explicit.** `[Affiliation]` enumerates candidate,
  volunteer, staff, neighbor, and `[Candidate]` is annotated *"if not
  candidate"*. The template anticipates the volunteer-at-the-door case that the
  product currently gets wrong (see PR 1).
- **Thin campaign materials stop being fatal.** Only section 2 needs the
  candidate's issue positions. Sections 1, 3, and 5 are composable from data
  every campaign has, and section 4 is drivable from purpose alone.

## The most important design decision: the model writes three lines

Everything else on the card is composed from data.

| Section | Origin | Why |
| --- | --- | --- |
| 1a Introduction — identity | Composed at render | Pure template over known data. Wrong output here is the worst failure in the feature — a volunteer claiming to be the candidate — and it needs no judgement to get right |
| 1b Introduction — engagement question | **Generated** | Needs campaign and jurisdiction data (see below); carries no identity claim |
| 2 Context | **Generated** | Needs the candidate's materials, and is where the filters do their work |
| 3 CTA | Composed at create, editable | `campaign.details.website` is real data; a model that phrases this can also invent a URL |
| 4 Ask | **Generated** | Needs purpose judgement and event logistics |
| 5 Departure | Composed at render | The template says it is constant. It is a constant |

### Why the introduction splits

The template's engagement question looked like a per-purpose constant until we
tried to write the constants. The natural `early_voting` question is "did you
know early voting has already started?" — a factual claim that varies by state,
hardcoded, repeated at every door. `explain_decision` wants to name a recent
vote; `share_resource` wants to name an actual program. These need campaign and
jurisdiction data, so they cannot be static strings.

So the introduction splits along the line that actually matters. The **identity
clause** — who I am, who I represent, what office — stays composed, because
being wrong there means a volunteer claiming to be the candidate. The
**engagement question** is generated, because it needs data and carries no
identity claim. The dangerous half stays deterministic.

This narrowing is what makes the feature defensible:

- **The empty-materials case degrades gracefully.** A campaign with nothing
  filled in still gets a correct introduction, a real website CTA, a
  purpose-appropriate ask, and a warm close. Only the Context line is thin.
  Compare the alternative, where a thin prompt produces five generic lines and
  the canvasser stops trusting the card at the first door.
- **The volunteer bug cannot recur.** The speaker is decided by code that knows
  the reader's role, not by a model reading a prompt.
- **Hallucination surface shrinks to three short lines**, each with a stated job
  and a length budget.
- It is cheaper, faster, and each half is separately testable.

### Stored vs. composed, and where the line falls

**Stored on `Outreach.script`: the engagement question and sections 2, 3, 4** —
four newline-separated lines. These are the list-specific, candidate-editable
content.

**Composed at render inside `useDoorScript`: the identity clause and section
5.** These depend on *who is reading the card*, not on which list it is, so they
cannot be frozen at create time by a candidate on a laptop and then read by a
volunteer on a doorstep. This is also exactly what `useDoorScript` already does
— it composes `buildIntro` from the live user and campaign today — so it is an
extension of the existing shape rather than a new one.

The introduction is therefore assembled from both halves at render: composed
identity, then the stored question.

The wizard shows the candidate all five sections and lets them edit the four
lines that are theirs, so they see what the canvasser will see.

`[Canvasser Name]` is a **literal token interpolated at render**, following the
proven `VOTER_NAME_TOKEN` pattern: defined once in contracts
(`phoneBanking/PhoneBankingScript.const.ts` is the precedent), emitted into
text, and swapped for the live value by the reading surface —
`PhoneBankingEntryPanel.tsx` already does exactly this, splitting on the token
and setting the interpolated value apart visually so the reader can tell live
data from fixed script.

## Decisions already taken

- **Storage is the existing `Outreach.script` column.** Every door-knocking list
  already has an `Outreach` envelope, born in the same transaction as the turf
  and the route (the 1:1:1 invariant in `docs/door-knocking.md`), carrying a
  `script String? @db.Text` door knocking has never populated. No new content
  table, no new content column, and the wire format is plain text — one line per
  stored section — so `script` keeps meaning what it means on every other
  channel and "Improve with AI" can round-trip it as a string.
- **Purpose is persisted**, as an enum column, following phone banking's
  precedent.
- **The static build stays as the fallback**, so this ships without a backfill.
- **The candidate can edit and regenerate** in the wizard.

## Architecture

**Generation is a stateless draft endpoint.** `POST /v1/outreach/door-knocking/draft`,
modelled on `POST /v1/outreach/phone-banking/draft`. Nothing persists; the
wizard holds the text client-side and freezes it at create. This is the settled
convention for every AI-drafted channel and it keeps an LLM call out of the
create transaction, which already carries a paid Geoapify round trip inside a
120-second window.

**Persistence is one field on an insert that already runs** —
`Outreach.script` in `doorKnockingCreate.service.ts`'s existing
`tx.outreach.create`.

**Delivery rides the route payload.** `doorKnockingServe.service.ts` already
joins the envelope (`outreach: { select: { id: true } }`), so serving the script
is one more selected column on a query that already runs, emitted as an optional
top-level field beside `isServe`. It has to ride the payload rather than be
fetched by a hook, for the same reason `isServe` does: the printable walk sheet
and the PDF render server-side with no organization provider above them.

## Implementation, in seven PRs

PRs 1 and 2 are standalone bug fixes that should ship regardless of whether the
rest of the feature does. PRs 3–5 land dark, PR 6 turns it on, PR 7 shows it at
the door.

### PR 1 — Fix the volunteer door script (live bug)

**Today, when a volunteer walks a route, the talking points card reads:**

> **Talking points**
> Hi, I'm Sam Volunteer.

That is the entire card. `CampaignProvider` deliberately returns `null` for a
volunteer (ENG-11072 — `GET /v1/campaigns/mine` 403s a volunteer, so the query
is skipped outright), so `buildIntro` drops the office clause, and the positions
query never fires because it is gated on `campaignId !== undefined`. The
self-hiding guard at `DoorScript.tsx:40` misses it because the intro is
non-empty.

Three things are wrong, in descending severity: the card never says whose
campaign the volunteer represents, a card titled "Talking points" contains none,
and "Hi, I'm Sam Volunteer." under that heading reads as the candidate
self-identifying.

**Fix**: `useDoorScript` learns the reader's role and composes the affiliation
branch the template's `[Affiliation]` slot describes — the candidate's own
opener as today, or a volunteer opener naming the candidate and the office, in
the shape phone banking's `VOLUNTEER_OPENER_RULE` already established for the
same audience on the same rail. That needs the candidate's name and office on a
path where `useCampaign()` is null, so the volunteer walk needs a minimal
campaign-identity source — the served route payload is the natural carrier,
since it is already the thing the volunteer path can read and already carries
`isServe` for the same reason.

Tests: `VolunteerWalkPage.test.tsx` has no door-script coverage today, and
`useDoorScript.test.tsx`'s `[undefined]` campaign cases are framed as *loading*
states with a comment asserting "a known name still introduces the candidate" —
a premise that is false and permanent on this path. Both need the volunteer
case.

### PR 2 — Close the issue-store gap (live gap, all compose channels)

`buildCampaignContext` reads `campaign.details.customIssues`. Current onboarding
writes the candidate's issues to `website.content.about.issues` via
`saveAboutFields({ issues })`. **Different stores, and nothing bridges them in
that direction.**

Three issue stores exist. `customIssues` and `CampaignPosition` are written only
by the legacy `/dashboard/questions` flow, which has no nav entry and is
reachable only by detouring through Content Builder. The website store is what
modern onboarding fills. `buildCampaignContext` reads the first; the door script
reads the first two; neither reads the third.

The practical consequence is that for a candidate onboarded through the current
flow, the single most useful prompt input — their own issue positions — is
probably absent, and the prompt degrades to geography plus whatever story they
did not skip.

**Fix**: `buildCampaignContext` unions the website issues into its issue block,
deduped, the same way `website/create/page.tsx` already unions the other
direction via `combineIssues`. Consider the same union in
`doorScriptContent.ts`'s `buildScriptIssues`, which has the identical gap on the
static path.

**This is its own PR because it changes SMS, social, robocall, and phone banking
output too.** That is the point — every compose surface has been running on a
store most candidates never write — but it deserves its own review and its own
before/after sample rather than arriving inside a door-knocking feature.

### PR 3 — Describe a filter in words, server-side

The prose generator already exists — `buildFilterSummary` in
`packages/gp-webapp/app/dashboard/contacts/crm/lists/ListFilterSummary.tsx`
turns a saved filter into *"Age 18-24 or 25-34, Language Spanish, and Support
status Supporter."* — but it lives in the webapp and gp-api cannot import it.
gp-api has the label vocabulary and no sentence assembly.

**Reuse** `FILTER_DIMENSIONS` from
`packages/gp-api/src/contacts/filterDimensions.catalog.ts`, plus
`decodePrecinctPair` and `INCOME_RANGE_MAPPING` from contracts. **Port** the
clause assembly and `joinAsSentence` into a new
`packages/gp-api/src/contacts/utils/describeFilter.util.ts`. **Write new** the
three things the catalog does not cover: legacy age keys (`age18_25` etc., which
saved rows still carry and without which an age-only legacy list describes as
unfiltered), precincts (deliberately absent from the catalog, but a real
column), and the free-text `search` clause.

**Do not widen `FILTER_DIMENSIONS`.** It is what `describe_filter_dimensions`
advertises to the Chief of Staff assistant as *writable*, and precincts are
excluded on purpose. Keep read-only additions in a separate map inside the new
util; `filterDimensions.catalog.test.ts` should stay passing untouched.

#### The filter allowlist, and why the raw description must not reach the prompt

The literal requirement — "take the filters into account" — is the part of this
feature most likely to produce bad output, and it needs to be reframed rather
than implemented as written.

**Filters select and order which of the candidate's own priorities to lead with.
They never generate claims about the audience.** A list cut to 65+ homeowners
leads with the road maintenance and property tax stances the candidate already
wrote; it does not open with an assumption about who answered the door. This is
both safer and more useful, and it is what section 2's
`[Core Message / 1–2 Priorities]` slot already asks for.

Three concrete reasons the raw description cannot be passed through:

- **Party is a filter, and every compose prompt in the product ends with "Stay
  strictly non-partisan. No party labels, no attacks."** Passing the whole
  description hands the model a party label and a rule forbidding it in the same
  breath. Party is excluded from the allowlist outright.
- **Most of these columns are modeled estimates, not observed facts.** "As a
  homeowner, you've probably noticed your property taxes" said to a renter is
  not a bad text message you can delete — it is a candidate saying something
  false to a stranger's face. `FILTER_DIMENSION_PROVENANCE_RULES` from the
  catalog goes into the system prompt, and the Context rule forbids asserting
  audience membership regardless.
- **Several dimensions are targeting mechanics with no conversational content.**
  Voter likelihood, contacts-made buckets, and support status say nothing a
  canvasser can use. Excluded.

The allowlist is small and product-owned: the dimensions that plausibly change
*which issue leads*, not who the person is.

### PR 4 — Prisma and contracts

**Prisma** (`prisma/schema/doorKnockingTurf.prisma`): a `DoorKnockingPurpose`
enum and a nullable `purpose` column on `DoorKnockingTurf`. Nullable because
every existing list predates it. `npm run migrate:dev`; migrations are immutable
once applied. Nothing is added for the points themselves — `Outreach.script`
already exists.

**The enum is exactly `PhoneBankingPurpose`'s nine values, with no additions.**
The wizard already picks from the shared vocabulary — `doorKnockingPurposes.ts`
re-exports `OUTREACH_PURPOSE_VALUES` and `serveDoorKnockingPurposes.ts`
re-exports `SERVE_OUTREACH_PURPOSE_VALUES` — so the storage vocabulary is the
union of the two:

```
introduce_myself  persuade_voters  event_invite  early_voting
election_day_turnout  custom  explain_decision  community_input  share_resource
```

Do not invent a door-knocking-shaped purpose. `doorKnockingPurposes.ts`'s header
records that this channel used to carry a local six-value vocabulary and that
consolidating onto the shared slugs is what the consolidation existed to
achieve. What *is* door-knocking's own is the wording, and it already exists in
`DOOR_KNOCKING_PURPOSE_LABELS` and its Serve twin.

**Contracts** (`packages/contracts/src/`):

- `outreach/DoorKnockingTalkingPoints.schema.ts` — the draft request/response,
  modelled on `PhoneBankingScript.schema.ts`. Request carries `purpose`, the
  filter (a saved `voterFileFilterId`, or the draft filter for an audience being
  cut in the wizard), and the `currentDraft` / `previousDraft` / `instructions`
  trio with the same mutual-exclusion `.refine`. **No `tone`.** Response is
  `{ engagementQuestion: string, context: string, ask: string }` — the three
  generated lines, named, so the model cannot merge or reorder them and each is
  separately assertable.
- `doorKnocking/DoorKnockingTurf.schema.ts` — add `purpose` and `talkingPoints`
  to `CreateDoorKnockingTurfSchema`. It is `.strict()`, so this is required.
- `doorKnocking/DoorKnockingRoutePayload.schema.ts` — add `talkingPoints` beside
  `isServe`, **`.optional()` and never `.default()`**. The file states the rule
  and the reason at length: nothing parses this payload at runtime in either
  direction, so a default promises the compiler a value it will not supply.
  Absent must render identically to empty.
- `CANVASSER_NAME_TOKEN`, beside `VOTER_NAME_TOKEN`.

Per `contracts/AGENTS.md`, export from the feature index *and* the root index or
it does not ship, and update consumers in the same PR.

### PR 5 — The draft endpoint

Lives in `src/outreach/`, not `src/doorKnocking/` — `outreach/AGENTS.md` is
explicit that the package owns the stateless draft endpoints while the stateful
create stays in the feature's own module.

- `outreach/outreachDoorKnocking.controller.ts` — a near-copy of
  `outreachPhoneBanking.controller.ts`: `@UseCampaign()`, `@UseOrganization()`,
  `@UseInterceptors(ZodResponseInterceptor)`, `assertProAccess`, best-effort
  position resolution in a try/catch that degrades rather than failing the
  draft.
- `outreach/services/outreachDoorKnockingGeneration.service.ts` — no
  `PhoneBankingVoiceConfig` indirection: door knocking is one route for both
  rails, and `door-knocking/AGENTS.md` explicitly rejects copying the
  phone-banking surface object into this feature. A ternary on the `eo-` slug is
  the established pattern here.
- `OutreachComposeContextService` unchanged (PR 2 already improved it).
- The filter description from PR 3, allowlisted, as an additional block.

One LLM call returning both fields, so the model sees Context and Ask together
and they do not repeat each other. Any model failure is a 502, never a canned
fallback string.

#### The prompt

The system prompt states the five-section template in full, then says which
three lines are being written and that the rest is supplied by the app — so the
model knows the shape of the conversation its lines sit inside without writing
it.

**The framing rule, stated first, because it is the one the other channels'
prompts would get wrong:** these are notes a canvasser glances at and puts in
their own words, not lines to recite. Do not write dialogue. Do not open with
"Hi" or address the resident in second person. Write what the canvasser needs to
remember.

Rules beyond the shared non-partisan/no-invention baseline:

- **Concrete HOW, not the topic.** Lift the SMS prompt's rule verbatim — each
  line *"names the concrete HOW, not just the topic ('Fix our roads with a real
  maintenance plan, not patchwork', never just 'Fix our roads')."* This is the
  single highest-leverage sentence in the prompt, and the bullet format makes it
  more load-bearing rather than less: a note that compresses to "Roads" has told
  the canvasser nothing and pushes them into improvising, which is where false
  claims come from.
- **Context is one idea, evergreen.** The template says so explicitly: no dated
  events, because the Ask is where a date belongs and a list is walked over
  weeks.
- **Never assert audience membership.** The filter block selects which
  priorities to lead with; it is not a fact about the person at the door. Paired
  with `FILTER_DIMENSION_PROVENANCE_RULES`.
- **Brackets only in the Ask, only for logistics we do not model.** Event date,
  time, and location are the realistic cases. Everything else is grounded or
  written around. The severity is lower here than on the channels the rule comes
  from — a bracket in a note reads as a blank the canvasser fills, not as a
  stumble mid-sentence — but the wizard still highlights unfilled brackets
  before the paid press.

**Purpose copy** is two records keyed on the nine slugs (Win six, Serve six,
overlapping on `introduce_myself`, `event_invite`, `custom`), following phone
banking's `WIN_PURPOSE_PROMPTS` convention. It steers the Ask, which is where
purpose earns its keep — an `election_day_turnout` ask seeks a commitment to
vote, an `event_invite` ask carries logistics, a `community_input` ask is a
request to be heard from rather than a commitment at all. It steers the
engagement question secondarily.

This copy is a *steer*, not text that ships: it tells the model what commitment
to aim at, and the model writes the note. That is the whole reason it can be
prompt copy rather than the per-purpose constants we first reached for. Product
still owns it — `doorKnockingPurposes.ts` and its Serve twin both record that
robocall and phone banking shipped with copy pasted from social and had to be
corrected in #1379 — but a wrong steer shifts output rather than putting words
in a canvasser's mouth.

`custom` follows phone banking exactly: fresh generation is refused with a 400
and only the improve path is allowed.

### PR 6 — Persist and generate in the wizard

**Backend.** `purpose: input.purpose` on the existing `tx.doorKnockingTurf.create`
and `script: input.talkingPoints` on the existing `tx.outreach.create`. Two
lines inside a transaction that already runs; no LLM call goes inside it.

**Frontend.** A sixth stage between `confirm` and `route`. The purpose slug and
the filter are settled by then, and the route step is the paid press that must
stay last. `createFlow/createFlowSteps.ts` needs all five of its functions
updated (`stepperPosition`'s five hardcoded `totalSteps: 5` become six).
`CreateListFlow.tsx` needs a `STAGE_META` entry, a stage render, a CTA branch,
the new state, and both fields on the create body.

**One trap.** The orphan-filter cleanup effect keys on the orchestrator's
four-value `CreateFlowStep`, not the six-value stage, and deletes the filter this
flow minted whenever the step is neither `confirm` nor `route`. If the new stage
maps to its own `CreateFlowStep`, add it to that guard.

The step component is phone banking's `ScriptStep.tsx` minus the tone pills, the
name field (door knocking already names the campaign on `confirm`), the
phone-banking copy, and the surface indirection. It renders all five sections,
with the composed identity clause and close visually distinct and non-editable,
and the four stored lines editable. What survives from `ScriptStep`: the layout, `ThinkingStream`
gating, Regenerate, Improve with AI, the instructions input, dictation, the
error card, the stale-response request-id guard, and the `manuallyEdited` rule
that decides whether a regenerate may send `previousDraft`.

Register both new endpoints in `gpApi/api-endpoints.ts`.

### PR 7 — Show them at the door

`doorKnockingServe.service.ts`: add `script: true` to `ROUTE_INCLUDE`'s
`outreach` select and emit `talkingPoints` on the return literal beside
`isServe`. No extra query.

`useDoorScript` assembles the card: the composed identity clause from PR 1, the
four served lines, the composed close. It falls back to today's static build
when a list has no stored points, which covers every list created before this
ships. It is the single seam — one production caller (`PersonSheet.tsx:331`),
reached identically by the candidate walk and the volunteer walk.

`DoorScript.tsx` renders intro, bullets, close, and interpolates
`CANVASSER_NAME_TOKEN` the way `PhoneBankingEntryPanel` does.

**Decide explicitly whether the points print on paper.** The walk sheet and PDF
deliberately carry neither notes nor phones nor demographics, because paper
leaves the building. Talking points are campaign copy rather than voter data, so
the argument does not obviously apply — but both surfaces read the same payload
and will receive the field whether or not they render it.

## Testing

**Draft endpoint** — mirror `outreach/tests/outreachPhoneBanking.test.ts`, which
pulls the real `LlmService` out of the Nest container, spies `jsonCompletion`,
and reads the assembled prompt back off the spy. Cover per-purpose copy (one
representative sentence each, not a full-string pin), the allowlisted filter
description reaching the prompt, **party never reaching the prompt**, the
provenance block being present, improve vs. fresh, validation refusals asserting
the LLM was never called, the Pro gate, and a rejection producing a 502.

**Routes** — extend `doorKnocking.routes.test.ts`; the `create (the money path)`
block gains persistence and the `serve` block gains the payload field. The ADR
0009 and ADR 0011 blocks are the precedent for "a new optional field rides the
payload".

**Frontend** — the new wizard stage and create body; `useDoorScript`'s four
cases (candidate with points, candidate without, volunteer with, volunteer
without); token interpolation.

**No e2e spec may create a list** — every list is a billed Geoapify route.

### The eval set

Roughly fifteen cards before this reaches a candidate: one baseline per purpose
across all nine slugs, plus three materials-richness variants (rich, thin,
empty) on one purpose and three filter variants (none, demographic, geographic)
on another. About an hour of review.

Much of what could go wrong is machine-checkable and belongs in the assertions
above rather than in front of a person — party never reaching the prompt, no
brackets outside the Ask, no URL that isn't `campaign.details.website`, length
budgets, each line non-empty and distinct from its neighbours.

What is left needs a reviewer who has knocked doors, and the criteria are
**bullet criteria, not script criteria**. Do not ask "is this sayable" — nobody
says it. Ask:

- **Can a canvasser expand this without inventing anything?** The
  bullet-specific failure mode is a note compressed past the point of carrying
  content, which forces improvisation at a door. This is the same failure the
  concrete-HOW rule guards against, seen from the field.
- **Does it survive paraphrase?** Hand one bullet to three people, have each say
  it in their own words, compare. A bullet that yields three different campaigns
  is a bad bullet, and this is cheap to run directly.
- **Is it glanceable?** It gets read while a door is opening.

Grade per section on three points — *usable as written* / *usable after an edit*
/ *not usable* — because the decision is binary in the field, not a 1–5. Per
section localizes the fix: if Context grades badly while Ask grades well, the
cause is either the Context rule or the materials gap, and running the same set
before and after PR 2 says which.

**The open question the eval should answer: whether five lines is the right
number.** The template describes a conversation and its sample is a full spoken
script; our card is a reference glanced at on a doorstep. Those are different
artifacts, and it is entirely possible three lines is right and the CTA and
Departure belong in a collapsed footer. Better to learn that here than from
field complaints.

## What to measure

The number that most determines whether the generated Context line is worth
anything is how much material campaigns actually have. PR 2 improves it; measure
before and after, restricted to campaigns that own a door-knocking list, since
that population self-selects for engagement:

```sql
SELECT count(*) FILTER (WHERE background IS NOT NULL AND btrim(background) <> ''),
       count(*)
FROM campaign_story;

SELECT count(*) FILTER (WHERE jsonb_array_length(COALESCE(details->'customIssues','[]')) > 0),
       count(*)
FROM campaign;

SELECT count(DISTINCT campaign_id) FROM campaign_position;
```

Plus the website issues store, and the Segment funnel for
`EVENTS.OnboardingV2.BackgroundCompleted` against `OnboardingSkipped` with
`step: "What's Your Background"`, which gives the skip rate directly.

## Risks and open questions

**The Context line is still the weak one.** Sections 1, 3, 4 and 5 are robust to
a campaign with no materials; section 2 is not, and it is the persuasion beat.
PR 2 is the mitigation. If the measured fill rate stays low after it, the honest
options are to omit the Context bullet rather than pad it, or to prompt the
candidate for a one-line core message in the wizard step itself.

**Generated points replace the candidate's own issue stances on the card.** That
follows from the fallback decision. Showing the stances beneath the five lines
rather than instead of them is a one-line variation if it reads better in the
field.

**Regeneration after create is out of scope.** The points freeze with the list;
there is no reachable surface to edit them from afterwards, since
`TurfDetailsSheet` is unreachable by design. Persisting `purpose` is what keeps
that door open without a later migration.

**Serve is in scope, and the plan assumes it.** The Serve wizard already shows
six purpose cards that today decide nothing but a suggested list name. Two
things stay Serve-specific: the card keeps its "Introduction" heading where that
is the right word, and the composed intro must never introduce a sitting
official as a candidate for their own seat — the mistake `buildServeIntro`
exists to prevent, and the reason section 1 is composed rather than generated.
