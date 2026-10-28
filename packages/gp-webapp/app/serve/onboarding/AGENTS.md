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

## Pro winners (the Win to Serve handoff)

A Pro candidate who wins (`app/dashboard/election-result/`) gets an office
created from the campaign org: `campaignId` set, the campaign's position on
the new `eo-<id>` org, its party mapped to Serve's values when it has one,
an `onboardingStep` of `confirm`, and no `onboardingCompletedAt` or term
dates. So the flow resolves the prefill branch and lands on the term step
(then `confirm`), or straight on `confirm` once dates are known; with no
party it starts at `party`. The pledge stamps it like any other office.
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
and checkpoint, filling them from the win only when empty.

Sign-in routing is unchanged and lands a winner on the dashboard;
`DashboardLayout` sends any user holding a `campaignId` office with no
`onboardingCompletedAt` to `/serve/onboarding`, every time, until the
pledge (never from `/serve/*` or `/dashboard/election-result*`). The page
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

The office picker (`ServeOfficePicker`) lists positions from upcoming races
(`races-by-year`, `timeframe: 'future'`) and labels each row with its last
general election from a second `timeframe: 'past'` lookup (`Last elected:
Nov 8, 2022`), which tells apart cohort twins with the same name. Primaries
and runoffs are not when an official was elected, so they never set the date.
A failed past lookup drops the dates, never the list.

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
started as soon as the office is on the org. A failed start retries once on
its own. The step has three list states: the "Finding issues" spinner while
the list loads, "We couldn't load issues for your area" with Try again when
the search failed twice (Other and skip stay available), and the "couldn't
find issues" empty line only when the search succeeded with nothing.

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
  The first step reads "You represent the {people} people living in {place}"
  (the number is the accent), or "You represent the people living in
  {place}" without a population. The count-up starts at 0, so the number
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
  map never swaps once drawn, and the step never errors.
- **The picks are illustrative**: the loud cluster is the 12 dots nearest the
  middle; the sample is a few dots (`SAMPLE_PER_CELL`, 4) picked at random in
  each part of a 4 by 4 grid over the district, so it spreads across the map;
  half of it fills in on the grow step. No count is shown, on the map or in
  the copy: the sample step's headline is "A few voices from every group tell
  you where your community stands", its line is "We reach people in every part
  of your district, so you hear what everyone thinks." (never "at random":
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
