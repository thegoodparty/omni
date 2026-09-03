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

An earlier, unrelated `recommendedLists` module existed in `gp-api` and was
deleted before this work started. It served door-knocking aggregates from
Win's `mart_win_agents.win_agent_voters` warehouse behind an async snapshot,
had no webapp consumer, and shares no code with this feature. Don't resurrect
it.

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
| Door knocking | the top-N precincts for that variant |

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

## Door-knocking precinct selection

Rank the variant's own matching voters by precinct, descending by **plain
count** — not density. Take precincts until the cumulative count reaches a door
target, rather than a fixed top-3.

Precincts are only unique within a county, so the persisted `precincts` column
encodes `county|precinct` pairs.

**Pick N against a door count, not a percentage.** The absolute top-3 total
sits in a stable 5,000–15,000 band for every district above 15k voters,
whether that district has 46 precincts or 50,041, because precinct size sets
it rather than district size. The percentage it represents is meaningless and
misleading in both directions — 4% in PA-12, 100% in a small Louisiana town.
Roughly 5,000–15,000 doors is a week of canvassing almost anywhere.

Two things that will bite:

- **Exclude voters with no precinct.** They currently collapse into a single
  synthetic `COUNTY|` key that ranks like a real precinct. Between 0 and 17,140
  voters per district (CA statewide 17,140, IN-1 941, AL-6 812). Where that
  bucket is large it wins the ranking and sends a canvasser to an undefined
  geography.
- **Bound every per-precinct query.** California statewide has **50,041
  precincts**, two orders of magnitude past the next largest sampled district.

## Minimum size floor

**Express the floor as an absolute count, not a share of the district.** The
share is nearly constant across district size — it is a property of the L2
turnout model, not of the district — so a percentage floor either passes
everything or fails everything. The absolute count spans four orders of
magnitude across real users: the intro list is 320 people in Campti Town, LA
and 16.9M in California statewide.

**Floor: 250.** At that value the eval's 26 districts lose only the genuinely
useless variants (9 of 26 event-ideology-Moderate lists, 5 of 26
election-day-ideology-Conservative) while every primary list survives,
including in small districts where those lists matter most. A floor of 1,000
starts suppressing primary lists exactly where they're most useful.

Behavior below the floor:

- **Door knocking** — widen N (add precincts) and re-count. If the
  district-wide version is still under the floor, omit the recommendation.
- **Every other channel** — omit the recommendation.

Omit, don't show-and-warn. A variant under 250 contactable people is not a
recommendation worth a card.

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
| `districtShare`    | `count` over the district total                             |
| `estimatedCost` | **Deferred.** channel unit price x count, but the unit prices have no resolved source yet — see Open items. Omit the field until that is closed rather than guessing a price. |
| `copy`             | `{ title, criteriaSummary }` with placeholders filled       |
| `existingFilterId` | set when this recommendation already exists as a saved list |

Behavior:

- **Nothing is persisted at recommendation time.** The `VoterFileFilter` row is
  created on submit, through the existing audience-step name flow.
- **Counts fan out concurrently.** One request is several Databricks
  aggregates: one count per variant, the district total, and for door knocking
  a precinct ranking. Run them in parallel and show a loading state. No
  caching in v1.
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
district share, and accepted-as-is vs accepted-and-edited. Follow the
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
| The `3 × votesNeededToWin` cut                              | Computable, but there's nowhere to store "the top N by propensity"                                                  | Lists are no longer sized to the race. Two candidates needing 400 and 40,000 votes in similar districts get the same list                                                                                           |
| County and city geography levels                            | You can't door-knock a county                                                                                       | None. `pickSubGeo` is gone; always precinct                                                                                                                                                                         |
| Fixed top-3 precincts                                       | Too thin in large districts                                                                                         | None. N is adaptive                                                                                                                                                                                                 |
| Geography on the event intent                               | We don't know the venue at recommendation time, so "densest 3 precincts" doesn't do the job its rationale claims    | Event invites aren't geographically targeted. Revisit if the flow starts collecting an event location                                                                                                               |
| `regAddon` / `modeledIAddon` per-campaign party adjustments | `modeledIAddon` needs `hs_` columns absent from the mart; `regAddon` widens with an OR, which AND-only would invert | **The affinity list doesn't know who you're running against.** A candidate facing a lone Republican and one facing a lone Democrat get the same list. Best candidate for reinstatement once unions are on the table |
| `hf_likely_vbm`                                             | Not in the mart, and adding it was declined for v1                                                                  | Early voting has no distinct audience                                                                                                                                                                               |
| Opponent placement and district-lean gating on ideology     | v1 simplification                                                                                                   | No "target moderate when you and your opponent are at opposite extremes" case. The district-lean guard is partly redundant with the size floor anyway                                                               |

## Gotchas

- **There is no address filter, deliberately.** `Residence_Addresses_AddressLine`
  is 100% populated — zero null or empty rows across 30.6M voters in CA, MD and
  LA — and a door-knocking refinement on it was a no-op in all 390 measured
  eval cells. So the precinct restriction is the only thing that narrows a door
  list. Note this was already true before this feature: the `doorKnocking`
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
- **Two district totals disagree, so pick the mart's.** The mart's own voter
  count and `m_election_api__district.registered_voters` differ by under 0.5%
  usually, but 2.2% for CA statewide (23,348,065 vs 22,847,425) and 0.6% for
  IN-1. **Use the mart's own count** — `COUNT(*)` over `gp_api_voters` scoped to
  the district — as the `districtShare` denominator. Two reasons: it is already
  computed as part of the fan-out, and every list count in the numerator is a
  mart count, so any other denominator makes the share inconsistent with its own
  numerator. If the district-stats panel uses `registered_voters`, the two
  surfaces will disagree by up to 2.2%; aligning that panel is a follow-up, not
  a reason to pick the wrong denominator here.
- **Precinct granularity isn't comparable across states.** IN-1 has 523
  precincts for 518k voters (~990 each); MD-2 has 244 for 547k (~2,240 each). A
  fixed N buys twice the doors in Maryland. If N is ever user-visible, express
  it as "the precincts covering your first N doors."
- **The filter UI is flag-gated but `filterDimensions.catalog.ts` is not**, so
  the AI assistant will advertise affinity and ideology before the wizard shows
  them.

## Open items

- Where per-channel unit pricing lives, for `estimatedCost`. Until this is
  answered the field is omitted from the response, not guessed.
- Reconciliation with Nigel's revised model once he lands the AND-only rewrite.
  The propensity-band narrowing (dropping `Unreliable` from `reliable`), the
  precinct-count metric, and dropping event geography all need his sign-off.

## Where the eval lives

The 26-district sizing eval that set the floor, killed the wide propensity
band, and showed the address column carries no signal produced a per-district,
per-variant, per-channel CSV grid plus a re-runnable query script. It is scratch output, not
committed here. Re-run it after the universes change — they will.
