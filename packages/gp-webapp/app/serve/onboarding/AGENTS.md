# Serve onboarding

The elected-official onboarding at `/serve/onboarding`. One stepper, one
progress bar; the step set and order live in `serveOnboardingConfig.ts`.

| File                                  | What                                                                  |
| ------------------------------------- | --------------------------------------------------------------------- |
| `ServeOnboardingFlow.tsx`             | The flow: load, resume, Continue/Back, saves, completion              |
| `serveOnboardingConfig.ts`            | Step ids, per-branch order, resume rules, all copy                    |
| `serveOnboardingAnalytics.ts`         | Step events (`Viewed`/`Completed` where a step has them)              |
| `districtStory/districtDots.ts`       | Pure dot model: real points to ~640 dots, the stand-in map, the picks |
| `districtStory/DistrictStoryMap.tsx`  | The one SVG map and its modes and motion                              |
| `districtStory/DistrictBasemap.tsx`   | The street tiles behind a real district's dots                        |
| `districtStory/DistrictStoryStep.tsx` | The story steps' data, copy and layout                                |
| `warmWelcome/WarmWelcomeFlow.tsx`     | The warm welcome: who gets it, its data, checkpoints, saves and Done  |
| `warmWelcome/warmWelcomeConfig.ts`    | Its step ids, which steps are in the flow, office wording, all copy   |
| `warmWelcome/WarmWelcomeShell.tsx`    | Its frame: breadcrumb, stage, Back, and the footer's docked buttons   |
| `warmWelcome/warmWelcome.css`         | The design's own stylesheet, scoped under `.ww`                       |
| `warmWelcome/parts.tsx`               | The one raw `<button>` (`Tap`), `Btn`, the foil logo                  |
| `warmWelcome/Reveal.tsx`              | Word-by-word reveal, rise, and the handoff between a step's states    |
| `warmWelcome/firstMeeting.ts`         | The first meeting, the date sentence's values, and the calendar links |
| `warmWelcome/DateSentence.tsx`        | "January 7th at 7:00 pm": three words, three menus, sheets on phones  |
| `warmWelcome/maps.tsx`                | The meeting card's thumbnail and the residents map (maplibre)         |
| `warmWelcome/voiceTour.ts`            | The camera that flies between resident comments                       |
| `warmWelcome/Ocean.tsx`, `Sky.tsx`    | The bubble ocean behind the ask, the flying texts on "All set"        |
| `warmWelcome/panelDays.ts`            | The days the first Civic Panel invites can go out                     |
| `warmWelcome/confetti.ts`             | Its confetti: rigid bodies that pour, pile up and pop                 |

## Step order

Branches: `prefill` (office/term came from sales or BallotReady, checked on
the `confirm` hub) and `net-new` (`office` then `term-dates`).

- Flag off: welcome, inOffice, party, confirm | office + term-dates,
  pledge.
- `serve-citizen-panels` on: after the term, the district story
  (`story-represent`, `story-loudest`, `story-sample`, `story-grow`), then
  `priorities`, then `pledge` (button "Meet your Chief of Staff", lands on the
  Chief of Staff home). Completion goes through
  `/post-auth-redirect?next=...&org=eo-<id>`; `org` names the office just
  finished so a user with several lands in it, not the first on the list.

## The warm welcome

The onboarding someone sees right after they win, from Olly Farshi's design
(product-os, `docs/prototypes/serve-warm-welcome`). There is no flag.
`ServeOnboardingFlow` renders `WarmWelcomeGate`, which opens the welcome for
an office that came from a win (`campaignId`), is unfinished, and has a
party that is not a major one (its own, else the campaign's); every other
office gets the stepper below (`isWarmWelcomeOffice`). The welcome has no
party step, which is why a major party or no party keeps the stepper.

**It is the design's own look, not the styleguide's.** `warmWelcome.css` is
the prototype's stylesheet carried over rule for rule and scoped under
`.ww`, with its class names (three are respelled because Tailwind owns the
originals: `.ol`, `.locked`, `.hring`). Colors, sizes and timings are the
design's. Every control is `Tap` in `parts.tsx`, the flow's one raw
`<button>`; do not swap in styleguide Buttons, Popovers or Calendars here.
The handwritten folder name and its label use two fonts loaded only by
`app/serve/onboarding/layout.tsx`.

Steps, in order: `warm-won`, `warm-meeting`, `warm-briefing`,
`warm-residents`, `warm-priorities`, `warm-recap`. A step with nothing to
show leaves the flow and the breadcrumb (`warmWelcomeSteps`).

- **You won**: the people who voted for them (`votesReceived` on the office
  read, from the campaign), counted up in red, then the label and number
  change in place to the people they now serve (`districtPopulation`). No
  vote count on file shows the one number; neither leaves the card out.
- **First meeting**: the first row of `GET /v1/meetings` still ahead
  (`firstMeetingFrom`). They confirm it (then a card with six calendar
  links built in the browser), change it in the date sentence, or say they
  don't know yet. A changed date is saved (`PUT /v1/meetings/first-meeting`),
  so gp-api briefs that meeting; it comes back with `source: 'official'`.
  The card's small map is the address looked up with Geoapify on the map
  key. No meeting found, and this step and the next leave the flow.
- **Meeting Briefing**: "should be ready around 2 days before your
  meeting". No day is promised: gp-api starts three days out and then needs
  the agenda to be published. "Remind me" saves
  `briefingTextReminder: true`; HubSpot sends the one text off the
  briefing-ready event. Left out after "I don't know yet".
- **Residents**: `GET /v1/resident-voices` (at most six comments; empty
  until the data team publishes the table) drives a map that flies between
  them, zones never pins, with an asterisk note when any are synthesized.
  Then the Civic Panel: the ask names the district's own goal
  (`GET /v1/contacts/civic-panel`), the invite is the design's wording
  (greeting, the part they can edit, the nonpartisan promise, then the two
  locked lines from `composeManagedInvite`), the day is one of
  `sendOptions`, and "Set it up" posts
  `/v1/contacts/civic-panel/managed` with its own `consentVersion`. An
  invite sent on or after their first day in office drops "-elect". Both
  reads sit behind `serve-citizen-panels` in gp-api; where they 404, the
  panel is not offered and its recap row is left out. A panel already
  being built skips the ask.
- **Priorities**: `GET /v1/priorities/onboarding/focus` (the search behind
  it is started when the flow opens). A tease, then the cards with Resident
  interest and First win; picking one brings up a verdict
  (`focusVerdict`) and "Start with this", which saves
  `PUT /v1/priorities/onboarding/focus`. gp-api keeps what was shown and
  what was picked.
- **Recap**: three rows (the briefing, the focus, the Civic Panel), then
  Done. A skipped panel's row carries a chevron back to the ask.

**Done is the completion save**: `PUT /v1/elected-office/:id` with the
party, `onboardingCompletedAt`, `onboardingStep: 'warm-recap'`, and, when
the office has no term on file, `termStartDate` set to the first meeting
they confirmed; gp-api works out the end from the race's term length, and
lets a win office finish with no dates at all. It sends no `pledgedAt`. The
frame then slides closed, the stage goes dark, and it leaves through
`/post-auth-redirect` like the stepper. The dashboard's term-dates prompt
waits a day before asking a winner for a date still missing.

Each forward move writes its step id to `onboardingStep` behind the move.
gp-api's `SERVE_ONBOARDING_STEPS` lists the `warm-*` ids; a checkpoint the
warm welcome does not know (the stepper's `confirm`) starts at the win. A
meeting confirmed on an earlier visit is not remembered unless they
corrected it, so a resumed flow sends no term start.

Motion follows the design's rule that nothing snaps: `Words` and `Rise`
bring content in with buttons last, steps slide sideways, states inside a
step hand off vertically (`useHandoff`), the frame slides open and closed,
and reduced motion shows every end state at once. A step names its footer
buttons with `useDock(id, delay, actions)`. Confetti is Matter.js rigid
bodies on one canvas (`ConfettiLayer`), cleared whenever the step changes;
`matter-js` and `maplibre-gl` load on first use.

Events: one Viewed / Completed pair per step (`WARM_WELCOME_EVENTS`: You
Won, First Meeting, Meeting Briefing, Residents, First Focus, Recap).
Completed carries: `hasPopulation`, `hasVotes`; `meetingAnswer`,
`calendar`; `textReminder`; `civicPanel` (set_up, skipped, unavailable),
`sawComments`, `editedInvite`, `firstSendChoice`; `shown`, `kind`,
`focusKind`, `residentInterest`, `firstWin`.

## Ever-Pro winners (the Win to Serve handoff)

A candidate whose campaign was ever Pro (`campaignWasEverPro` in
`@goodparty_org/contracts`) who wins (`app/dashboard/election-result/`) gets an office
created from the campaign org: `campaignId` set, the campaign's position on
the new `eo-<id>` org, its party mapped to Serve's values when it has one,
an `onboardingStep` of `confirm`, and no `onboardingCompletedAt` or term
dates. With a party that is not a major one it opens the warm welcome
above. Otherwise the stepper resolves the prefill branch and lands on the
term step (then `confirm`), or straight on `confirm` once dates are known;
with no party it starts at `party`. The pledge stamps it like any other
office.
What a win knows is filled in, and its steps still show:

- **Party**: the campaign's party (`winParty.ts`, reading `details.party`,
  or `otherParty` when that is empty or "Other") goes onto the office, and
  the flow falls back to reading the campaign when the office has none. A
  major party is carried too, so the party step shows it selected and
  blocked; a major party never counts as answered on resume, so that step
  can't be skipped.
- **Term**: gp-api fills the dates from the winner's own BallotReady
  office-holder record for the seat (`WinTermService`: same position, the
  user's first and last name, full dates not yet past), and drops them if
  they collide with an office the user already holds. Nothing is derived
  from the election date and a term length; without a record the term step
  asks.

A winner who already holds a lead's term-less office with no campaign (a
magic link, or Serve onboarding started and left) gets that office linked
instead: gp-api's `create()` sets `campaignId` on it and keeps its own party
and checkpoint, filling them from the win only when empty. Any other office
the winner holds, finished or not, is left alone and the win gets a new one;
a repeated win returns the office already linked to that campaign. The flow
finishes that office by id (`PUT /v1/elected-office/:id`).

Sign-in routing is unchanged and lands a winner on the dashboard;
`DashboardLayout` sends a winner holding a `campaignId` office whose
campaign was ever Pro (`campaignWasEverPro` on `GET /v1/elected-office/mine`,
the contracts helper of the same name: `isPro`, or `details.isProUpdatedAt`,
`subscriptionId` or `subscriptionCanceledAt` set) and with no `onboardingCompletedAt`, to
`/serve/onboarding`, every time, until the pledge (never from `/serve/*` or
`/dashboard/election-result*`).
A never-Pro winner's unfinished office leaves them on the Win dashboard:
Serve opens to everyone else a group at a time. Every win, from any source,
has such an office (gp-api creates it dormant: no Serve jobs until the
pledge, which starts them), so staff let a winner in by sending them here. gp-api answers ever Pro because
the active org can be the office's `eo-*` org, where `useCampaign` is null. The page
guard prefers an unfinished win office (`campaignId` set) over a finished
one, so someone who already serves and wins another seat lands on the new
seat; a stray unfinished lead office does not pull a finished official away
from the chief of staff. The `/dashboard` exemption from the election-result
redirect holds only where the campaign manager chat mounts (a Win org, dock
not hidden). An impersonating
admin can Dismiss the handoff (the election-result dismissal flag).

Every step change (and the end of loading) scrolls the window to the top, so
each step, the pledge included, opens with its headline in view. The window is
the only scroller around a step.

The office picker (`ServeOfficePicker`) lists the seats on file for the zip, not
the races ahead of it: one `races-by-year` call with `timeframe: 'all'` (no date
bound), collapsed to one row per position, so a seat whose next race is years
out or not published yet still shows (ENG-11637). Each row is labelled with its
last general election (`Last elected: Nov 8, 2022`), which tells apart cohort
twins with the same name. Primaries and runoffs are not when an official was
elected, so they never set the date.

Each story step has its own `Viewed` / `Completed` pair, named for what it
tells the official (`SERVE_STORY_EVENTS`: You Represent, Hear From The Loudest
Voices, Where Your Community Stands, Build And Grow Your List), and
`priorities` fires Priorities Viewed (once its list has loaded or failed,
with `loadMs` from entering the step) and Completed with shown and selected
counts. Priorities Errored fires each time the list lands on an error:
`reason` search_failed (either Try again state) or none_found, and
`retried` once Try again was pressed.

The earlier steps complete with what was picked: Welcome Completed
(`branch` net_new or prefill), Office Status Completed (`officeStatus`
elected, campaigning or testing, on both paths), Party Designation Completed
(`party`), Office Completed (`officesFound` in the picker's list,
`officeLevel` city, county, state or other from BallotReady's level, and
`usedFilter` when a name search or pill narrowed it) and Term Dates
Completed (`termYears`, rounded).

The term-date pickers block the user's other offices' terms
(`buildDisabledRanges`). An office with no start date blocks nothing, as
gp-api's `dateRangesOverlap` treats it; one with a start and no end blocks
from its start on. The end picker opens on the start date's month.

Every Continue writes the step id to `ElectedOffice.onboardingStep`. gp-api
validates it against `SERVE_ONBOARDING_STEPS`
(`gp-api/src/electedOffice/schemas/electedOffice.schema.ts`); a new step id
must be added there in the same change, or its checkpoint PUT 400s. A
checkpoint from the other flag state is not in the step list and resumes at
the data-derived step. Story steps navigate first and save the checkpoint
behind, so the save never holds the motion.

The priorities step's issues come from `POST /v1/community-issues/onboarding`,
started as soon as the office is on the org. gp-api queues the paid search and
answers before it runs, so that call returning tells the step nothing about
whether issues exist. The step waits 10 seconds for it, then reads
`GET /v1/priorities/onboarding` once and polls it every 4 seconds for up to 120
(a real starter search takes 25 to 55 seconds). A failed start retries once on
its own. That read is also where the step learns whether the search is over:
the queue is the only thing that knows, so every read's `searchPending` sets
`starterSearchPending` (true on a start, cleared when the job is gone from the
queue) and no local window decides. Because the first read lands before the
queued search can have written anything, an empty list while `searchPending`
is true is the search still running, not nothing found, however long the job
waits. So the step has four list states. "Finding issues in your community"
while the list loads or the search is still out (Continue stays available, so
nobody is held on the step), "We couldn't load issues for your area" with Try
again when the search failed twice (Other and skip stay available), the
"couldn't find issues" empty line once the queue reports the search over with
nothing (the only state that fires Priorities Errored `none_found`), and the
list itself. Priorities Viewed waits for the search to settle too, so `loadMs`
measures the real wait.

## The district story

- **Population** is `districtPopulation` (2020 census) from
  `GET /v1/onboarding/contacts/stats` (`onboardingDistrictStatsQueryOptions`,
  shared with the Win flow's demographics step). Null
  drops the number from the copy.
- **Place** is the picked office's `city`, else the city in the EO org's
  district name (`servePlaceOf`: contracts' `cityFromDistrictName` and
  `cityNameCase`, the path the Serve home's `useServePlace` takes; the name
  is read on load and from each office PATCH), else "your district". A
  BallotReady office often has no city (Asheville City Council).
  The first step reads "You were elected to represent the {people} people
  living in {place}" (the number is the accent), or "You were elected to
  represent the people living in {place}" without a population. The count-up starts at 0, so the number
  holds a placeholder until it moves and never reads "0 people".
- **Dots** come from `POST /v1/contacts/points` with no filters (the contacts
  wizard's endpoint: bare coordinates for the district, capped). The ids are
  dropped in the query function. A seeded random pick of ~640 keeps the
  density, so each dot is about population / dots residents. Dots are
  placed in Web Mercator and fitted to the view, and the camera that fit
  implies (`basemapZoom`) frames the basemap, so each dot sits on its street.
  The frame is square from `md` up and 16:10 below it. Both fits are built
  once when the data lands, and the step shows the one for the current
  width; the frame takes its shape from the model, so they never disagree.
- **Basemap** (`DistrictBasemap`): maplibre with Geoapify's full-color `osm-bright`
  style and the `NEXT_PUBLIC_GEOAPIFY_TILES_KEY` the contacts and
  door-knocking maps use, with the same compact attribution. maplibre opens
  a compact attribution expanded and collapses it only on the first drag, so
  every one of these maps collapses it on `load` to its "i" button; the
  attribution itself stays (OSM ODbL and the Geoapify plan require it). One map instance
  for all four steps; `interactive: false`, so it is a picture with no
  drag, zoom or scroll capture. maplibre is imported inside the effect, the
  dots never wait for it, and no key, no WebGL or a refused tile leaves the
  muted frame. Dots carry a white edge (`stroke-card`) so they stand out on the
  colors. There is no district boundary geometry, so no outline.
  maplibre's stylesheet sets `position: relative` on its map element and,
  unlayered, beats Tailwind's `absolute`, so a wrapper is positioned and the
  map element only fills it (`h-full w-full`). Positioning the map element
  itself gives it zero height: no tiles, no attribution.
- **Fallback**: no EO, no position, a 4xx/5xx, under 100 points, or no data
  within 8 seconds draws a stand-in district (its own outline and a City Hall
  marker, no tiles). The
  map never swaps once drawn, and the step never errors. Because a
  district-wide points read can outlast that wait, the flow prefetches the
  points and stats (`districtPointsQueryOptions`, keyed by office and
  position) as soon as an office is on the org at load, as it is for a
  winner or a prefill; an office picked this session is read when the story
  mounts.
- **The picks are illustrative**: the loud cluster is the 12 dots nearest the
  middle; the sample is a few dots (`SAMPLE_PER_CELL`, 4) picked at random in
  each part of a 4 by 4 grid over the district, so it spreads across the map;
  half of it fills in on the grow step. No count is shown, on the map or in
  the copy: the sample step's headline is "Hear from every part of your
  community", its line is "We reach people in every neighborhood, age group,
  race and gender, so you hear what everyone thinks." (never "at random":
  the panel's draw is steered to balance the district), and its
  info box says the aim ("We aim to hear from every age group, neighborhood,
  race and gender in your district.").
- **Motion** (`DISTRICT_MOTION`): intro sweeps in by neighborhood over ~1.2s
  with a 1s count-up, once a session; dim 400ms with a one-time pop on the
  loud cluster (`animate-pop-in`); sample 600ms with a 5ms stagger; grow turns
  the sample to rings, then fills half of it at a 40ms stagger. Back runs 300ms with
  no stagger. Reduced motion shows each end state. The four steps render one
  `DistrictStoryStep`, so the map stays mounted and only its mode changes.
  No Lottie: the map is per-district data.
