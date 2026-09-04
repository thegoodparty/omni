# Recommended lists

When a Win candidate creates an outreach in the product, they pick a **channel**
(SMS, robocall, phone banking, door knocking) and then an **intent** (introduce
myself, persuade likely voters, invite to a local event, encourage early voting,
election day turnout). This feature turns that pair into one or more
**recommended voter lists** — each a `VoterFileFilter` the candidate can accept,
edit, and send against.

**Two independent gates, and they are not the same mechanism.** Win-only is a
permanent product restriction, not a rollout setting: the endpoint refuses
Serve (`eo-`) organizations, and the affinity and ideology filter dimensions
are Win-only at the API boundary. The `win-recommended-lists` flag is separate
and controls only UI visibility during rollout. Turning the flag off never
opens the feature to Serve, and turning it on never bypasses the Win check.

## Background and division of labor

The voter universes are Nigel's model, written up in ClickUp ("TDD:
Recommended list universe definitions"). This document is the **implementable
reduction** of that model, and it deliberately diverges from it — see
[What this cuts from the source model](#what-this-cuts-from-the-source-model).
The two most consequential constraints driving those cuts:

1. **A recommendation must be expressible as a saved `VoterFileFilter`.** That
   model ANDs across dimensions and ORs only within one dimension, so a
   universe that unions across dimensions cannot be saved. Every universe here
   is a plain conjunction.
2. **Nothing in the product can cap a list at N people.** Outreach resolves its
   audience from the saved filter (`outreachMaterialization.service.ts`), and
   `VoterFileFilter` has no size column. So any sizing rule expressed as "the
   top N voters by propensity" is computable but unstorable.

**A prerequisite, not history.** An earlier, unrelated `recommendedLists`
module is still live in `gp-api` on `main`: `RecommendedListsModule` is
registered in `app.module.ts`, and its controller owns
`GET campaigns/mine/recommended-lists` — the **identical route** this feature's
endpoint uses. It serves door-knocking aggregates from Win's
`mart_win_agents.win_agent_voters` warehouse behind an async snapshot, has no
webapp consumer, and shares no code with this feature.

PR #1648 deletes it in full. **That PR must merge before this feature's
endpoint is wired**, or the two collide at module registration. Don't resurrect
the old module, and don't build around it.

## Verified data facts

Every recommendation resolves against
`goodparty_data_catalog.mart_gp_api.gp_api_voters` — the mart every CRM voter
filter query hits, ~219M rows, 367 columns. It carries exactly two `hf_`
columns and **zero `hs_` columns**, so no Haystaq modeled score is available
here without a data-platform change.

| Column                                                      | Type    | Coverage                                                                                      |
| ----------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `Voter_Status`                                              | STRING  | No nulls. `Super` 35.9%, `Likely` 17.6%, `Unreliable` 20.2%, `Unlikely` 23.9%, `Unknown` 2.5% |
| `Voter_Independent_Affinity`                                | BOOLEAN | **No nulls.** 66.45% true                                                                     |
| `hf_ideology_general`                                       | STRING  | 59.9% fill. `Conservative` 51.2M, `Liberal` 45.7M, `Moderate` 34.2M, null 87.9M               |
| `Voter_Turnout_Probability`                                 | DOUBLE  | ~97.5%. Not referenced anywhere in gp-api                                                     |
| `Residence_Addresses_AddressLine`                           | STRING  | **100% populated**, which is why there is no address filter |
| `VoterTelephones_CellPhoneFormatted` / `_LandlineFormatted` | STRING  | Sparse                                                                                        |
| `County`, `Precinct`, `City`, `City_Ward`                   | STRING  | Precinct has gaps — see the gotcha below                                                      |

**`Voter_Status` is a fixed bucketing of `Voter_Turnout_Probability`**, not a
separate construct: `Super` is p ≥ 0.75, `Likely` 0.50–0.75, `Unreliable`
0.25–0.50, `Unlikely` < 0.25, `Unknown` is p null. The cut points are absolute
and national, so unlike a within-district percentile the same label means the
same probability everywhere. In a high-turnout district nearly everyone is
`Super`; in a low-turnout one nearly nobody. That is a known and accepted
tradeoff.

## Propensity bands

The three bands every universe below is built from. `Unknown` is never
included in any band — 2.5% of voters with no probability at all, and nothing
to say about them.

| Band       | `voterStatus` values | Median share of a district |
| ---------- | -------------------- | -------------------------- |
| `reliable` | Super, Likely        | 51%                        |
| `high`     | Super                | 15%–45%                    |
| `mid`      | Likely, Unreliable   | 26%–56%                    |

**There is deliberately no wider band.** Super + Likely + Unreliable measured a
median **72%** of a district across 26 sampled real districts, reaching 82%,
and in 10 of 26 the resulting list was ≥75% of every registered voter. In
PA-12 that is 435,661 of 529,131 people. A list that size is the contact
database, not a recommendation. `Unreliable` alone carries a median 21% of that
bloat, which is why it is excluded from `reliable`.

## The intent universes

Each intent yields **one to three** recommendations. Multiple recommendations
per intent is intended; most intents will surface one or two in practice,
because the support-status variants are empty until a campaign has done
outreach and the ideology variants require a target bucket that many campaigns
won't have.

Support state comes from the CRM, not the voter file — `SupportStatusService`
resolves it from `contact_interaction_door_knock.support_answer` and
`contact_interaction_phone_banking.support_answer`, the only two tables that
carry an answer. `unsure` rolls up to `undecided`.

| Intent           | Variant                 | `voterStatus`                | Other filters                                                                  |
| ---------------- | ----------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| Introduce myself | `introNeverIded`        | reliable                     | `supportStatus` = unknown                                                      |
| Persuade         | `persuadeAffinity`      | reliable                     | `affinity` = true                                                              |
| Persuade         | `persuadeIdeology`      | reliable                     | `ideology` = target bucket                                                     |
| Persuade         | `persuadeUndecided`     | reliable                     | `supportStatus` = undecided                                                    |
| Invite to event  | `eventSupporters`       | —                            | `supportStatus` = supporter                                                    |
| Invite to event  | `eventAffinity`         | high                         | `affinity` = true, `supportStatus` in (supporter, undecided, unknown, refused) |
| Invite to event  | `eventIdeology`         | high                         | `ideology` = target bucket, same support exclusion                             |
| Early voting     | `earlyVoteSupporters`   | —                            | `supportStatus` = supporter                                                    |
| Early voting     | `earlyVoteAffinity`     | reliable                     | `affinity` = true                                                              |
| Early voting     | `earlyVoteIdeology`     | reliable                     | `ideology` = target bucket                                                     |
| Election day     | `electionDaySupporters` | Likely, Unreliable, Unlikely | `supportStatus` = supporter                                                    |
| Election day     | `electionDayAffinity`   | mid                          | `affinity` = true                                                              |
| Election day     | `electionDayIdeology`   | mid                          | `ideology` = target bucket                                                     |

Notes on specific rows:

- **`supportStatus` = unknown means never ID'd**, not "we have a row with no
  answer." The filter resolves it by excluding everyone with any non-null
  answer, which is the correct semantics over the full voter universe. See the
  comment on `SupportStatusService.personIdsByStatus`.
- **The support exclusion on the event variants** (`supporter, undecided,
unknown, refused`) is the inclusion-list expression of "not a known opponent
  supporter." `supportStatus` is an inclusion array, so a negation is written
  as its complement.
- **The event supporter and early-vote supporter variants carry no propensity
  band.** A known supporter is worth inviting or banking regardless of how
  reliably they vote.
- **Election day's supporter variant excludes `Super` on purpose.** A
  near-certain voter needs no turnout reminder; the whole point is chasing the
  supporters who don't reliably show up.

### Early voting has no distinct audience, by decision

`earlyVoteAffinity` is identical to `persuadeAffinity`, and the ideology and
supporter variants likewise duplicate their persuade and event counterparts.
This is accepted: the two intents differ by **message**, not by audience.

The screen that would have differentiated them is `hf_likely_vbm`, a Haystaq
vote-by-mail propensity. It is not in the mart and adding it was declined for
v1. In the eval, a VBM-refined early-vote list was 26% of the persuasion list
and ranged from 8.6% to 80.8% across districts, tracking real vote-by-mail
culture — so the differentiation would have been genuine. Two zero-new-column
options remain available later: `AbsenteeTypes_Description` (already in the
mart, `Permanent U.S.` is 13.3% of voters, though those people already vote by
mail and need no encouragement) or promoting `hf_likely_vbm` into the mart.

## Channel refinements

The channel never changes the universe. It only adds a contactability filter,
and for door knocking a precinct restriction.

| Channel       | Refinement                                              |
| ------------- | ------------------------------------------------------- |
| SMS           | `hasCellPhone`                                          |
| Robocall      | `hasAnyPhone`                                           |
| Phone banking | `hasAnyPhone`                                           |
| Door knocking | the top 3 precincts for that variant |

Email is not a channel — the product doesn't support email outreach, and there
is no email column in L2 or in the mart. Social and "write my own message" get
no recommendation.

The intent arrives as the outreach flow's **purpose** slug. Those were three
divergent per-channel vocabularies (SMS and robocall shared one, phone banking
had its own, door knocking had none at all), so this feature consolidates them
onto the SMS list — `introduce_myself`, `persuade_voters`, `event_invite`,
`early_voting`, `election_day_turnout`, `custom` — and maps that one list to
the five intents. `custom` and social's `issue_update` map to no intent and
therefore get no recommendation.

Measured yield: SMS retains 58%–74% of a list, phone 70%–85%.

`hasAnyPhone` is a within-dimension OR (cell present OR landline present) and
so is expressible. It is **not** the same as setting `hasCellPhone` and
`hasLandline` together, which ANDs to "has both."

**`hasAnyPhone` only became persistable in the filter-dimensions PR (#1678).**
On `main` it is a count-only wire filter, deliberately absent from
`voterFilterBaseSchema`, so a robocall or phone-banking recommendation has no
storable representation of "cell OR landline" until that PR lands. It adds
`has_any_phone` to `voterFileFilter.prisma` alongside affinity and ideology.
Another reason #1678 gates this work.

## Door-knocking precinct selection

**The top 3 precincts by matching voter count, descending.** Rank the
variant's own matching voters by `county|precinct` — by **plain count**, not
density — exclude voters with no precinct, and take the first three. There is
no accumulation, no adaptive N, and no district-wide fallback. `LIMIT 3` in the
SQL is the whole narrowing mechanism.

Precincts are only unique within a county, so the persisted `precincts` column
encodes `county|precinct` pairs.

Three is a reasonable walk list because our precincts are typically small, and
it is what the source model has always specified — `anchorTurfs()` ranks by
voter count descending and takes the top 3.

**An adaptive door target was tried and removed.** The rule was "take
precincts until the cumulative count reaches 10,000," and **86% of districts
never reach it** — so accumulation exhausted every precinct in the ranking and
the door list silently equalled the whole district. Door knocking's only
narrowing mechanism was inert almost everywhere. The 10,000 figure was also
justified as "roughly a week of canvassing," which is wrong by an order of
magnitude: at 15 doors an hour it is about 667 canvasser-hours.

One thing that will bite:

- **Exclude voters with no precinct.** They otherwise collapse into a single
  synthetic `COUNTY|` key that ranks like a real precinct. Between 0 and 17,140
  voters per district (CA statewide 17,140, IN-1 941, AL-6 812). Where that
  bucket is large it wins the ranking and sends a canvasser to an undefined
  geography. Still load-bearing.

## Minimum size floor

**One floor, expressed as a share of the race's vote goal: 25% of
`votesNeededToWin`.** A list holding less than a quarter of the votes the
candidate needs cannot move the race, so it isn't worth offering. It is
race-relative on purpose — two candidates needing 400 and 40,000 votes in
similarly sized districts are not owed the same minimum, which is the property
an absolute count was a poor substitute for.

This is _not_ a share of the district. That share is nearly constant across
district size — it is a property of the L2 turnout model, not of the district —
so a district-relative floor either passes everything or fails everything.
Share of the vote goal is a different quantity entirely.

**Two families are exempt from the floor entirely, not held to a smaller one:**

- **Door knocking.** A door list is three precincts by construction, so
  precinct size sets how big it is and the race has nothing to say about it.
  Judging a walk against a whole race's vote goal would suppress nearly every
  door list.
- **The id'd-supporter variants** — `eventSupporters`, `earlyVoteSupporters`,
  `electionDaySupporters`. Each always appears beside a larger recommendation
  for the same intent, so a small supporter list is additive rather than the
  candidate's only option. The registry's `supporterBased` flag is what marks
  them, and a test cross-checks that flag against each variant's own universe
  so the two cannot drift apart. `eventAffinity` is the near miss the check
  exists for: its support clause carries `supporter` among four values as an
  exclusion list, and a looser test would hand it an exemption it hasn't
  earned.

**A vote goal that doesn't resolve exempts a variant too.** No `raceId` on the
campaign, no Race row in election-api, an election-api outage, or a
non-positive win number all yield no goal — and there is then nothing to take a
share of. The recommendations still ship; `voteGoalShare` is omitted from each
of them.

**An empty list is always dropped, floor or no floor.** A card offering nobody
is worse than no card, and it is a real case: a campaign with real supporters
can still count zero once a channel's contactability filter is applied. The
`supportStatus`-resolves-to-nobody short-circuit does not cover that, so the
zero check is separate and explicit.

Omit, don't show-and-warn.

**Where the vote goal comes from, and its standing caveat.**
`ElectionApiService.getRaceContext` — the client that already fetches
win-number data, reused rather than duplicated — supplies
`win_number_effective`, resolved **once per request** inside the existing
concurrent fan-out rather than as a serial hop in front of it.
`win_number_effective` **assumes a single seat**, so an at-large or multi-seat
race overstates the goal and the floor is correspondingly _more permissive_
there. Known and accepted; not fixed here.

## Candidate ideology

The ideology variants need a per-campaign **target bucket** — one of
`progressive`, `moderate`, `conservative` — to match against
`hf_ideology_general`. When there is no bucket, **every ideology variant is
hidden**, which is the common case for a campaign that hasn't filled in its
onboarding issues.

### Input

All three onboarding story answers, which persist to two different places
(`useOnboardingStoryDraft.ts`):

| Onboarding step                    | Stored at                                              | Signal                                                                      |
| ---------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| "What issues do you want to solve" | `Website.content.about.issues[]` (title + description) | **Primary.** Stated positions in the candidate's own words                  |
| "Why are you running"              | `Website.content.about.bio`                            | Strong secondary                                                            |
| "What's your background"           | `CampaignStory.background`                             | Weak — the field is scoped to "childhood, career, community ties" by design |

Mechanically that is `RaceOpponentService.buildCandidatePlatform` (which
already reads bio + issues, and is the shared reader the opponent-research path
uses) plus a `CampaignStory` read. Do not add a second reader.

The website `about` surface **is** the onboarding surface, not a Pro-only
marketing artifact. Coverage confirms it: in August 2026, 562 of 569 new
websites carried a bio and 467 carried at least one titled issue, against
45%–65% bio coverage before July. So ideology's reach is roughly 82% of
recently onboarded candidates.

### Output and storage

A three-value bucket or null. **Not a 0–1 score** — the voter column has
exactly three values, so a continuous score gets bucketed on arrival and its
resolution discarded. Confidence, if we want it, comes from self-consistency
across repeated runs, not from a number the model reports about itself.

A `CampaignIdeology` satellite with `campaignId @unique`, mirroring
`CampaignStory`'s shape:

| Field        | Purpose                                                    |
| ------------ | ---------------------------------------------------------- |
| `bucket`     | nullable enum                                              |
| `evidence`   | the text the model cited for its placement                 |
| `inputHash`  | hash of the concatenated input; the invalidation mechanism |
| `model`      | which model produced it                                    |
| `computedAt` | timestamp                                                  |

Computed **lazily** on the first recommendation request that needs it, and
recomputed when `inputHash` changes. Not on a TTL, not per request, and not on
story save — a campaign that never opens the outreach flow should never cost an
LLM call.

### Prompt contract

Three rules, all borrowed from the `race_opponent_actions` agent because
they're already load-bearing there:

1. **Work only from the provided text.** No general knowledge about this
   person. Candidates are often locally known and the model must not import
   outside beliefs about them.
2. **Abstain freely.** Return null when the text is thin, purely biographical,
   or genuinely doesn't place.
3. **Cite the evidence.** Every placement names the specific text it rests on.

**Abstaining is the most important property of this classifier.** The
expensive failure is not calling a progressive a conservative — it is silently
defaulting to `moderate` when the text says nothing political, because
`moderate` is a plausible-looking bucket covering 34M voters and nobody would
ever notice. Null must be common. A near-zero abstain rate on thin inputs means
the prompt is broken, not good.

### The measurement seam

The candidate is placed from their own platform text by an LLM. Voters are
placed by Haystaq's behavioral model. Same three words, two different
instruments — a candidate we call progressive and a voter Haystaq calls
`Liberal` may not be commensurable at all.

Not fixable, only hedgeable. This is the same seam the shipped issue-alignment
copy already lives with, and it takes the same hedge: the list is framed as a
hypothesis to test in the field, never as a fact about those voters.

### Evaluation

Shipping behind the flag without a formal eval is accepted. Before the flag
comes off, two things:

- **Measure the abstain rate** over a few hundred real campaigns and eyeball
  ten placements. Nearly free, and the abstain rate _is_ the feature's reach.
- **A human gold set** — ~40 real platforms, three people bucket each
  independently, and **report inter-rater agreement before model accuracy.** If
  humans only agree 60% of the time, the axis is ill-posed and that is the
  finding.

Note ideology fill varies far more by district than the national 59.9%
suggests: 44% in Campti Town, LA and 45% in AL-6 against 82% in Ann Arbor Ward 2. Every ideology variant inherits that as a hidden size multiplier, so two
similarly-sized districts can produce ideology lists differing 2x for coverage
reasons alone.

## The endpoint

`GET campaigns/mine/recommended-lists?channel=<channel>&intent=<intent>`

Returns an ordered array of recommendations. Each carries the unsaved filter
shape plus everything the card displays:

| Field              | Notes                                                       |
| ------------------ | ----------------------------------------------------------- |
| `variant`          | the registry key, e.g. `persuadeAffinity`                   |
| `filter`           | the unsaved `VoterFileFilter` shape                         |
| `count`            | contactable size after the channel refinement               |
| `voteGoalShare`    | `count` over `votesNeededToWin`. Omitted — not nulled — when the vote goal can't be resolved. Deliberately unbounded above: a list can hold several times the votes a race needs |
| `estimatedCostCents` | per-contact cost x count, in cents, from the same pricing utils the checkout charges from (`textPricing.util.ts` at 35 tenth-cents, `robocallPricing.util.ts` at 45). SMS and robocall only — phone banking and door knocking are volunteer-run and the field is omitted rather than zero, since "$0" reads as free where the truth is "not applicable". Robocall prices the calls portion alone: the $2 caller-ID number fee is charged once per run, not per contact, and no pre-purchase screen puts it in an estimate either |
| `copy`             | `{ title, criteriaSummary }` with placeholders filled       |
| `existingFilterId` | set when this recommendation already exists as a saved list |

Behavior:

- **Nothing is persisted at recommendation time.** The `VoterFileFilter` row is
  created on submit, through the existing audience-step name flow.
- **Counts fan out concurrently.** One request is several Databricks
  aggregates: one count per variant, and for door knocking a precinct ranking
  instead. Run them in parallel and show a loading state. The vote goal
  resolves alongside the district lookup in the hop before them, since the
  size floor gates on it. No caching in v1.
- **Refuse `eo-` organizations.**
- **Variants under the floor are omitted**, per the rules above.

### Dedupe against existing lists

Don't recommend a list the organization already has; return the existing one
instead, so accepting a recommendation twice doesn't create a duplicate.

**Compare normalized filter payloads, not rows.** `voterFileFilter.utils.ts`
already converts a saved row into the people-db filter payload — a small object
holding only the dimensions actually set. Two lists are the same list when
their payloads match. That is the right comparison because it is the code path
that already defines what a filter _means_: null and false collapse
automatically, since neither appears in the payload.

Two caveats. Arrays need deterministic ordering before comparison. And support
status, contacts-made and activity conditions resolve outside the payload, so
those three compare off the row.

## Provenance and analytics

Four nullable columns on `VoterFileFilter`:

| Column                | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `recommendedVariant`  | registry key; null means user-built                       |
| `recommendedChannel`  | the channel that produced it                              |
| `recommendedIntent`   | the intent that produced it                               |
| `recommendedModified` | whether the candidate edited the filter before submitting |

Channel and intent are recoverable from the `Outreach` row today, but a filter
can be reused across many outreaches, so the originating context is worth
pinning at creation.

`recommendedModified` is the highest-signal field of the four: accepting a
recommendation and then changing two filters tells us more than either
accepting or rejecting it. Because the row is created on submit, we can diff
the submitted filter against what we recommended.

Reuse tracking is already free — `firstUsedForOutreachAt` exists, and the
`Outreach` rows pointing at a filter give the return count.

Fire an analytics event on select/continue carrying the variant, count,
vote-goal share, and accepted-as-is vs accepted-and-edited. Follow the
`instrument-analytics-event` skill.

## Copy

A static registry of `{ title, criteriaSummary }` per variant, with
`{placeholder}` tokens filled by a code-side step. **No serve-time LLM.**

Rules that hold the house voice:

- "moderate to high propensity voters," never "likely voters."
- Never name the model, the column, or a score cutoff.
- Ideology copy carries hypothesis framing — a lean to test, not a fact.
- No sub-geography language on any channel but door knocking.

## What this cuts from the source model

Listed so nobody helpfully reimplements them.

| Cut                                                         | Why                                                                                                                 | Cost                                                                                                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every top-level OR                                          | Not expressible as a saved filter                                                                                   | Rewrites the event and election-day universes, whose union branches were load-bearing                                                                                                                               |
| Within-district turnout percentiles                         | Not a filter dimension; only the four `Voter_Status` bands are                                                      | Bands are absolute, not district-relative                                                                                                                                                                           |
| The `3 × votesNeededToWin` cut                              | Computable, but there's nowhere to store "the top N by propensity"                                                  | Lists are not _sized_ to the race — two candidates needing 400 and 40,000 votes in similar districts get the same list. The vote-goal floor makes the race decide whether a list is offered at all, which is weaker but is not nothing |
| County and city geography levels                            | You can't door-knock a county                                                                                       | None. `pickSubGeo` is gone; always precinct                                                                                                                                                                         |
| Geography on the event intent                               | We don't know the venue at recommendation time, so "densest 3 precincts" doesn't do the job its rationale claims    | Event invites aren't geographically targeted. Revisit if the flow starts collecting an event location                                                                                                               |
| `regAddon` / `modeledIAddon` per-campaign party adjustments | `modeledIAddon` needs `hs_` columns absent from the mart; `regAddon` widens with an OR, which AND-only would invert | **The affinity list doesn't know who you're running against.** A candidate facing a lone Republican and one facing a lone Democrat get the same list. Best candidate for reinstatement once unions are on the table |
| `hf_likely_vbm`                                             | Not in the mart, and adding it was declined for v1                                                                  | Early voting has no distinct audience                                                                                                                                                                               |
| Opponent placement and district-lean gating on ideology     | v1 simplification                                                                                                   | No "target moderate when you and your opponent are at opposite extremes" case. The district-lean guard is partly redundant with the size floor anyway                                                               |

## Gotchas

- **There is no *persisted* address filter, deliberately.**
  `Residence_Addresses_AddressLine` is 100% populated — zero null or empty rows
  across 30.6M voters in CA, MD and LA — and a door-knocking refinement on it
  was a no-op in all 390 measured eval cells. So there is no
  `VoterFileFilter` column and no catalog entry, and the precinct restriction is
  the only thing that narrows a door list. The pre-existing *wire* filter does
  survive (`PeopleFilters.schema.ts:249`, plus its SQL case) because it backs
  the reachability figure described next — don't go looking for it as though it
  were removed. Note this was already true before this feature: the `doorKnocking`
  built-in segment carries `filters: []` and has never filtered on address.
- **The shipped door-knock reachability figure is meaningless, and predates
  this work.** `buildListDetailAggregatesSql` emits
  `COUNT_IF(addressPresentSql()) AS doorKnocking`
  (`databricksVoterSql.util.ts:694`), which feeds the list-detail response and
  its tile. Because the column is 100% populated, that number always equals the
  list total. Don't build anything on it, and don't read it as a reachability
  signal. Fixing it changes an API response's meaning, so it needs its own
  decision: keep it and accept that it means "everyone", or drop the channel
  from the tile.
- **Precinct granularity isn't comparable across states.** IN-1 has 523
  precincts for 518k voters (~990 each); MD-2 has 244 for 547k (~2,240 each), so
  three precincts buys roughly twice the doors in Maryland. That is accepted
  rather than corrected: the alternative is sizing against a door count, which
  is the rule the 86% figure above killed.
- **The cost on the card must agree with the checkout, so it comes from the
  same utils.** `calcTextAmountInCents` / `calcRobocallAmountInCents` own the
  tenth-cent rounding, and that rounding rule is what makes the figure match
  what the candidate is actually charged. Don't re-derive the arithmetic. It is
  computed from the **channel-refined** count — the same count on the card,
  after the channel's contactability filter is merged into the filter — so the
  quote is for the people the channel can actually reach.
- **The filter UI is flag-gated but `filterDimensions.catalog.ts` is not**, so
  the AI assistant will advertise affinity and ideology before the wizard shows
  them.

## Open items

- Reconciliation with Nigel's revised model once he lands the AND-only rewrite.
  The propensity-band narrowing (dropping `Unreliable` from `reliable`), the
  precinct-count metric, and dropping event geography all need his sign-off.

## Where the eval lives

The 26-district sizing eval that killed the wide propensity band and showed
the address column carries no signal produced a per-district,
per-variant, per-channel CSV grid plus a re-runnable query script. It is scratch output, not
committed here. Re-run it after the universes change — they will.
