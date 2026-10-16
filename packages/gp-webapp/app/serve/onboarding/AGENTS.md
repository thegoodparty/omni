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
  constituents, pledge.
- `serve-citizen-panels` on: the district story replaces `constituents`:
  `story-represent`, `story-loudest`, `story-sample`, `story-grow`, then
  `priorities`, then `pledge` (button "Meet your Chief of Staff", lands on the
  Chief of Staff home). `ConstituentsStep` stays in the file for the flag-off
  flow so bringing it back is a config change.

Every Continue writes the step id to `ElectedOffice.onboardingStep`. gp-api
validates it against `SERVE_ONBOARDING_STEPS`
(`gp-api/src/electedOffice/schemas/electedOffice.schema.ts`); a new step id
must be added there in the same change, or its checkpoint PUT 400s. A
checkpoint from the other flag state is not in the step list and resumes at
the data-derived step. Story steps navigate first and save the checkpoint
behind, so the save never holds the motion.

## The district story

- **Population** is `districtPopulation` (2020 census) from
  `GET /v1/onboarding/contacts/stats`, the constituents step's query. Null
  drops the number from the copy.
- **Dots** come from `POST /v1/contacts/points` with no filters (the contacts
  wizard's endpoint: bare coordinates for the district, capped). The ids are
  dropped in the query function. A seeded random pick of ~640 keeps the
  density, so each dot is about population / dots residents. Dots are
  placed in Web Mercator and fitted to the view, and the camera that fit
  implies (`basemapZoom`) frames the basemap, so each dot sits on its street.
- **Basemap** (`DistrictBasemap`): maplibre with Geoapify's light `positron`
  style and the `NEXT_PUBLIC_GEOAPIFY_TILES_KEY` the contacts and
  door-knocking maps use, with the same compact attribution. One map instance
  for all four steps; `interactive: false`, so it is a picture with no
  drag, zoom or scroll capture. maplibre is imported inside the effect, the
  dots never wait for it, and no key, no WebGL or a refused tile leaves the
  muted frame. There is no district boundary geometry, so no outline.
  maplibre's stylesheet sets `position: relative` on its map element and,
  unlayered, beats Tailwind's `absolute`, so a wrapper is positioned and the
  map element only fills it (`h-full w-full`). Positioning the map element
  itself gives it zero height: no tiles, no attribution.
- **Fallback**: no EO, no position, a 4xx/5xx, under 100 points, or no data
  within 8 seconds draws a stand-in district (its own outline and a City Hall
  marker, no tiles). The
  map never swaps once drawn, and the step never errors.
- **The picks are illustrative**: the loud cluster is the 12 dots nearest the
  middle; the sample is sized to `answersNeeded(population)` from contracts
  (±10 points at 95%, finite-population corrected) and spread by a greedy
  minimum-distance pick; 38 of it fill in on the grow step. No joined count is
  shown.
- **Motion** (`DISTRICT_MOTION`): intro sweeps in by neighborhood over ~1.2s
  with a 1s count-up, once a session; dim 400ms with a one-time pop on the
  loud cluster (`animate-pop-in`); sample 600ms with a 5ms stagger; grow turns
  the sample to rings, then fills 38 at a 40ms stagger. Back runs 300ms with
  no stagger. Reduced motion shows each end state. The four steps render one
  `DistrictStoryStep`, so the map stays mounted and only its mode changes.
  No Lottie: the map is per-district data.
