# Door-knocking talking points

AI-drafted talking points for a door-knocking list. The canvasser opens a door,
the person sheet's first card tells them what to say, and what it says was
written for **this list** (its goal and its audience) rather than for the
campaign in general.

## The product requirements

1. **Per list, not per person.** One set of points per door-knocking list,
   drafted when the list is created and frozen with it.
2. **Takes the list's purpose into account**: the goal picked on the wizard's
   first step. "Turn out my supporters" and "Ask for community input" should
   not produce the same card.
3. **Takes the list's filters into account**: "I'm talking to women today",
   "I'm chatting with homeowners".
4. **Notes, not a word-for-word script**, and no tone selector, because there
   is no prose voice to select. The canvasser reads the card and says the idea
   in their own words.
5. **The talking points are the candidate's free text.** The AI drafts bullets
   to start; the candidate can edit them, add to them, delete the markers and
   write sentences, or write from blank. Nothing forces bullets.

## The card

At the door the card has three parts:

| Part               | Origin                                | Why                                                                                                                                                |
| ------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Introduction       | Composed at render by the app         | Depends on who is reading. Wrong output here is the worst failure in the feature (a volunteer claiming to be the candidate), so no model writes it |
| Talking points     | Stored with the list                  | Drafted by the model, edited by the candidate in the wizard                                                                                        |
| Thanks and goodbye | Composed at render (`DEPARTURE_NOTE`) | The same however the conversation went, so it is a constant                                                                                        |

The introduction and goodbye depend on _who is reading the card_, not on which
list it is, so they cannot be frozen at create time by a candidate on a laptop
and then read by a volunteer on a doorstep. `useDoorScript` composes the
introduction from the live user, campaign and role (candidate, team member,
volunteer, Serve official) on every walk.

There is no website call-to-action line. The model never writes a URL, phone
number or QR code.

`DoorScript.tsx` deliberately does not print the design canvas's caption ("AI-generated
from this voter's profile and your candidate info."). The points are drafted
from the list, never from the resident, and the candidate edited them before
they were frozen. Printing that sentence would tell a canvasser the lines were
written about the person in front of them.

## Drafting

`POST /v1/outreach/door-knocking/draft` and its `serve/` sibling, in
`src/outreach/` (`outreachDoorKnocking.controller.ts`,
`outreachServeDoorKnocking.controller.ts`,
`services/outreachDoorKnockingGeneration.service.ts`). Stateless: nothing
persists, the wizard holds the text and sends it on create. That keeps an LLM
call out of the create transaction, which already carries a paid Geoapify round
trip. The response is one `draft` string, contracts
`DoorKnockingTalkingPointsDraftResponseSchema`.

**A fresh draft is 4 to 5 bullets.** The model returns a list of plain strings
and the service assembles them, so every line starts with
`DOOR_KNOCKING_BULLET` (`'• '`) whatever the model did: whitespace is
collapsed to one line per bullet, any marker or number the model added is
stripped, each bullet is trimmed to 200 characters at a sentence boundary, and
empty ones are dropped. The prompt asks for 4 or 5, but any count the model
returns is kept, capped at 5, rather than failed: a draft with three bullets is
still something the candidate can edit. Only an empty result is a failure.

Each bullet is one action or idea, about 25 words at most, about what the
campaign (or, on Serve, the office) is working toward or asking for, never
about the person who answers the door. Plain spoken English in sentence case,
no em dashes, no emoji. No greeting, introduction, thank-you or goodbye,
because the app writes both ends.

**Improve keeps the candidate's shape.** It is a light polish of whatever is in
the field: bullets stay bullets, sentences stay sentences, line breaks and line
markers are kept, and every concrete detail in the original must survive. It
never turns one shape into the other.

**Regenerate** sends the text on screen as `previousDraft` so the re-roll does
not converge on what was just turned down. The `custom` purpose is never freshly
drafted (a 400, and the wizard does not make the call); only Improve applies.
Any model failure is a 502, never a canned fallback.

### Grounding rules

Beyond the shared non-partisan and no-invention baseline:

- **Notes, not dialogue.** Stated first, because it is the rule the other
  channels' prompts get backwards: write what the canvasser needs to remember,
  not what to recite.
- **Concrete HOW, not the topic.** Lifted from the SMS prompt. A note that
  compresses to "Roads" pushes the canvasser into improvising, which is where
  false claims come from.
- **One ask.** Exactly one bullet is the ask: one request, answerable where the
  resident is standing. A yes-or-no where the purpose seeks a commitment, a
  single question where the purpose is listening.
- **Evergreen except the ask.** A list is walked over weeks; a date belongs only
  in the ask, and only from the event details the flow supplies.
- **No brackets, no links.** Event logistics come from the event details or are
  left out. The step still warns about any bracket the candidate types.
- **Never assert audience membership.** See below.

**Purpose steers** are two records keyed on the purpose slugs (Win and Serve),
in the service. They are steers, not text that ships: each names what the
bullets cover and which single commitment the ask aims at, and the model writes
the notes. A wrong steer shifts output rather than putting words in a
canvasser's mouth. Grade them with the eval set and change them there. A
`community_input` list's own question replaces the generic listening ask.

### The audience allowlist

**Filters select which of the candidate's own priorities to lead with. They
never generate claims about the audience.** A list cut to 65+ homeowners leads
with the road and property-tax stances the candidate already wrote; it does not
open with an assumption about who answered the door.

The audience reaches the prompt only through `describeFilterForTalkingPoints`
(`packages/gp-api/src/contacts/utils/describeFilter.util.ts`), an allowlist of
life-circumstance dimensions (age, homeownership, children, veteran, education,
marital status, language, income). Everything else is dropped, for three
reasons:

- **Party.** Every prompt says "Stay strictly non-partisan." Passing a party
  label alongside that rule is asking for trouble, so party never reaches the
  prompt on either rail.
- **Most columns are modeled estimates.** "As a homeowner, you've probably
  noticed your property taxes" said to a renter is a candidate saying something
  false to a stranger's face. `FILTER_DIMENSION_PROVENANCE_RULES` rides with
  the description, and the audience rule forbids asserting it.
- **Targeting mechanics** (precincts, support status, contact activity, search)
  carry nothing a canvasser can say.

The description is null rather than "no filters" when nothing survives the
allowlist, and then the audience block is omitted.

Door knocking is the only compose caller that passes `includeWebsiteIssues` to
`buildCampaignContext`, so the candidate's issues from current onboarding
(`website.content.about.issues`) reach the prompt. See
`packages/gp-api/src/outreach/AGENTS.md`.

## The create step

The wizard's `points` stage (`createFlow/TalkingPointsStep.tsx`, wired in
`CreateListFlow.tsx`) sits before the route step, so the purpose and audience
are settled and the paid route purchase stays last. The draft is requested on
arrival at the step.

The step shows the whole card: the introduction as a read-only preview (built
with the same builders `useDoorScript` uses, so the preview cannot drift), one
editable talking-points field, and the goodbye as a read-only preview. The field
has a length counter against `DOOR_KNOCKING_TALKING_POINTS_MAX_LENGTH` (2000)
and is read-only only while the first draft is loading. Around it: Regenerate,
an instructions input, Improve with AI, dictation, an error card with Try again,
and a request-id guard so a stale reply never lands on top of an edit.

## Storage and delivery

The create body sends `talkingPoints` as the field's text, **trimmed**, and
omits it when blank. `doorKnockingCreate.service.ts` stores it on the existing
`Outreach.script` column, the one every other channel keeps its script in, so
there is no new column. `DoorKnockingTurf.purpose` is persisted beside it.

`doorKnockingServe.service.ts` selects `script` on the envelope join it already
runs and emits it as the route payload's optional `talkingPoints`, omitted
rather than `''` when empty. It rides the payload rather than a hook because a
volunteer cannot call the candidate's own endpoints. The printable walk sheet
and PDF receive it and do not render it: the card is identical at every door,
and both surfaces repeat their header on every page.

## The walk reader

`readTalkingPoints` in `native/talkingPointsCard.ts` turns the stored string
into the card's lines, each `{ text, bullet }`:

1. **Legacy rows.** Exactly four lines, at least one non-blank, none starting
   with the bullet marker. These are lists frozen before free text (question,
   context, a call to action that may be blank, ask). Every non-blank line
   shows as a bullet. These rows are not migrated.
2. **Free text.** Anything else: split on newlines, blank lines dropped. A line
   starting with the marker is a bullet (marker stripped); any other line shows
   as written. A marker with nothing after it is dropped.
3. **Empty or absent.** Null, and `useDoorScript` falls back to the candidate's
   own issue stances, as it does for lists created before the step existed.

Cases 1 and 2 close with `DEPARTURE_NOTE` as a bullet. `DoorScript.tsx` groups
consecutive bullets into one list and renders other lines as paragraphs.

**Accepted edge:** new free text that is exactly four plain lines, none
bulleted, is indistinguishable from a legacy row and shows as four bullets. The
words are the same either way.

Stored points replace the issue stances rather than joining them, and the
stances query is not spent when a list has points.

## Deploy compatibility

For one release the draft response also fills the optional legacy
`engagementQuestion`, `context` and `ask` from the draft's lines (first line,
the middle lines joined with a space, last line, markers stripped), so a wizard
tab opened before the deploy keeps working. The current webapp reads only
`draft`. **Delete the three fields and `legacySections` after a release.**

## Testing

**Draft endpoints:** `outreach/tests/outreachDoorKnockingTalkingPoints.test.ts`
and its Serve twin pull the real `LlmService`, spy `jsonCompletion`, and read
the prompt back off the spy: per-purpose steers, the allowlisted audience
reaching the prompt, party never reaching it, bullet assembly and capping,
Improve vs fresh, validation refusals that never call the LLM, the Pro gate,
and a rejection producing a 502.

**Webapp:** `talkingPointsCard.test.ts` covers the reader's three cases and the
four-line edge; `DoorScript`, `useDoorScript`, `TalkingPointsStep`,
`CreateListFlow` and `WalkView` tests cover rendering, the stances fallback,
the step and the create body.

**No e2e spec may create a list**: every list is a billed Geoapify route.

### The eval set

Roughly fifteen cards before this reaches more candidates: one baseline per
purpose, plus three materials-richness variants (rich, thin, empty) on one
purpose and three filter variants (none, demographic, geographic) on another.

What is machine-checkable belongs in the tests above: party never in the
prompt, no brackets, no URLs, 4 to 5 bullets, length budgets, no em dashes.

What is left needs a reviewer who has knocked doors. Ask:

- **Can a canvasser expand this without inventing anything?** A note
  compressed past carrying content forces improvisation at a door.
- **Does it survive paraphrase?** Hand one bullet to three people, have each say
  it in their own words, compare. A bullet that yields three different campaigns
  is a bad bullet.
- **Is it glanceable?** It gets read while a door is opening.

Grade each bullet _usable as written_ / _usable after an edit_ / _not usable_,
because the decision is binary in the field.

## What to measure

How much material campaigns actually have decides whether the bullets carry
substance. Measure it restricted to campaigns that own a door-knocking list:

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

**Thin materials make thin bullets.** With no materials the prompt stays
issue-neutral and leans on listening, which is honest but generic. If the
measured fill rate stays low, the option is to prompt the candidate for a
one-line core message on the step itself.

**Generated points replace the candidate's own issue stances on the card.**
Showing the stances beneath the points instead is a small change if it reads
better in the field.

**Editing after create is out of scope.** The points freeze with the list, and
there is no surface to edit them from afterwards. Persisting `purpose` keeps
that open without a later migration.

**Serve is in scope.** The Serve prompt never says "candidate" or "campaign",
and the composed introduction never introduces a sitting official as a
candidate for their own seat, the mistake `buildServeIntro` exists to prevent.
