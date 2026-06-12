---
name: instrument-analytics-event
description: Add a Segment/Amplitude analytics event when building a feature — in the webapp (frontend, via trackEvent) or in gp-api (backend, via AnalyticsService). Decide whether it earns an event, which side fires it, name it per the standard, register it, and fire it.
---

# Instrument an analytics event

Use when adding or changing something a dashboard might ask about — a new flow, screen, primary button, form submit, funnel step, outcome, async job, payment, or status change — in **gp-webapp** (frontend) or **gp-api** (backend). This skill decides whether the moment earns an event, which side should fire it, names it, registers it, and fires it.

Background: events flow app/api → Segment → Amplitude (and HubSpot). There are two registries:

- **Frontend** — `helpers/analyticsHelper.ts` in gp-webapp: the `EVENTS` map + `trackEvent`.
- **Backend** — `src/vendors/segment/segment.types.ts` in gp-api: the `EVENTS` map, fired through `AnalyticsService.track`.

Naming and governance are adopted from the Analytics Event Tracking Guide (product-os `processes/analytics-standards.md`, owner: Bryan Levine), which remains the source of truth.

## Procedure

1. **Decide whether to instrument.**

   <!-- v0 — PENDING PRODUCT FEEDBACK. These lists are a draft adopted from the rubric doc
        (rubric circulated to #product 2026-06-09). Revise this section when feedback lands;
        the rest of the skill is stable. -->

   The rule everything serves: **every event must answer a question you would put on a dashboard. If you cannot name the question, do not fire the event.** More events is not more insight; un-asked events are noise.

   **Instrument** these moments:
   - Funnel steps, viewed and completed (so we can see drop-off).
   - Conversions and primary calls to action (the action a screen exists to drive).
   - Activation moments (first time a user reaches core value).
   - Outcomes (the user produced the thing the feature makes).
   - Blockers and errors that stop a user (they explain drop-off).
   - First-time adoption of a feature we want to drive.

   **Skip** these:
   - Pure UI state toggles (open/close, expand/collapse, show/hide).
   - In-page navigation with no decision (tab switches, scrolling, carousel arrows).
   - Hover, focus, mouseover.
   - Anything a page view already captures (route changes are tracked separately — do not double-track).
   - A variation that a property could capture instead (one event with a `channel` prop beats one event per channel).

2. **Decide where it fires — frontend or backend.**

   Fire from the **webapp (frontend)** when the browser directly observes the moment: a screen view, a button click, a form submit, a funnel step the user navigates.

   Fire from **gp-api (backend)** when the moment is server truth the client cannot honestly observe:
   - an async or AI job completes (the browser only knows it *started*),
   - a payment or subscription confirms,
   - a webhook lands, or a status changes (compliance, domain, publish),
   - the event needs server-only data, or must be tamper-proof / guaranteed to fire.

   **Do not double-fire.** If the backend owns the outcome, the webapp must not also emit it. Live example from the Serve product (poll results): the webapp fires `Polls - Poll Results Overview Viewed` when the official opens the results screen, while gp-api fires `Poll - Results Synthesis Complete` when the synthesis job finishes in the queue worker. "Did the user look" and "did the job finish" are two different questions — two sides, no overlap.

3. **Name the event.**

   Format: `{Product Area} - {Noun} {Past-Tense Verb}`, in Title Case. Prefer the verbs `Viewed` and `Completed`; reach for `Created`, `Updated`, `Dismissed`, `Blocked`, `Errored` only when those do not fit.

   ```
   Briefing Assistant - Briefing Viewed
   Briefing Assistant - Agenda Submitted
   Polls - Poll Results Overview Viewed
   ```

   - Product area is the navigation area the user is in (frontend) or the domain the work belongs to (backend).
   - If it is something the user *is* or *has* (officeType, isPro, onboardingCompleted), it is a **user property**, not an event — set it with `identifyUser` (frontend, from `@shared/utils/analytics`) or `AnalyticsService.identify` (backend), not a track call.

4. **Register it in the `EVENTS` map.**

   The casing rule, both sides: **group keys are PascalCase, the event-name string values are Title Case, and property keys (the object you pass when firing) are camelCase.**

   **Frontend** — edit `helpers/analyticsHelper.ts`. Add the event under its product-area group (create the group if new):

   ```ts
   BriefingAssistant: {
     BriefingViewed: 'Briefing Assistant - Briefing Viewed',
     AgendaSubmitted: 'Briefing Assistant - Agenda Submitted',
   },
   ```

   **Backend** — edit `src/vendors/segment/segment.types.ts`:

   ```ts
   Polls: {
     ResultsSynthesisCompleted: 'Poll - Results Synthesis Complete',
   },
   ```

   ⚠️ **HubSpot caveat (backend only).** That file is load-bearing for HubSpot. Names marked `⚠️ DO NOT MODIFY` trigger HubSpot workflows (email sequences, 10DLC compliance) on the exact string — **never rename one**. Adding a new event is safe; renaming an existing one breaks the integration. Test the full App → Segment → HubSpot path before touching any existing name.

   Always reference the map — never pass a string literal to the tracker. The literal lives in exactly one place.

5. **Fire it.**

   **Frontend** — `import { EVENTS, trackEvent } from 'helpers/analyticsHelper'`:

   - "Viewed" / screen-entry events fire in a `useEffect` so they run once per view, not on every render:

     ```ts
     useEffect(() => {
       trackEvent(EVENTS.BriefingAssistant.BriefingViewed, { briefingId })
     }, [briefingId])
     ```

   - Action / completion / outcome events fire in the handler, with camelCase properties:

     ```ts
     trackEvent(EVENTS.BriefingAssistant.AgendaSubmitted, {
       meetingDate,
       source: 'upload',
     })
     ```

   `trackEvent` already merges in persisted UTMs and the impersonation flag, and never throws — you do not need a try/catch around it.

   **Backend** — inject `AnalyticsService` (it is a `@Global()` provider, so no module import is needed):

   ```ts
   import { AnalyticsService } from '@/analytics/analytics.service'
   import { EVENTS } from 'src/vendors/segment/segment.types'

   constructor(private readonly analytics: AnalyticsService) {}
   ```

   Fire telemetry fire-and-forget so a Segment hiccup never blocks or breaks the request — pass the user id, the event, and camelCase properties:

   ```ts
   void this.analytics
     .track(userId, EVENTS.Polls.ResultsSynthesisCompleted, {
       pollId,
       durationMs,
     })
     .catch(() => undefined)
   ```

   `await` the call only when the outcome must propagate — e.g. a payment must not be considered tracked if Segment failed. `track` already merges in the user's email/hubspotId context and the impersonation flag.

6. **Verify.**

   **Frontend** (from the repo root):

   ```bash
   npm exec -w packages/gp-webapp -- next typegen
   npm exec -w packages/gp-webapp -- tsc --noEmit
   npm exec -w packages/gp-webapp -- tsc --noEmit --project e2e-tests/tsconfig.json
   npm run lint -w packages/gp-webapp
   ```

   **Backend** (from the repo root):

   ```bash
   npm run verify -w packages/gp-api
   ```

   To confirm the event actually reaches Segment, trigger the interaction and watch the Segment debugger — frontend: also the browser network tab for the Segment `t` call; backend: the `[ANALYTICS]` debug logs.

## When to skip

- The interaction is on the **skip** list in step 1.
- The event already exists in the relevant `EVENTS` map — reuse it, do not mint a near-duplicate.
- It is a variation of an existing event — add a property instead of a new event.
- It is a user attribute, not an action — use `identifyUser` (frontend) or `AnalyticsService.identify` (backend), not a track call.

## Common mistakes

- Firing a server-truth outcome from the frontend, or double-firing it on both sides — the browser only sees a job *start*; let gp-api emit the completion.
- Renaming a backend event marked `⚠️ DO NOT MODIFY` — it breaks the HubSpot workflow that triggers on that exact string.
- `await`-ing a non-critical backend `track` and letting a Segment hiccup block or fail the request — use `void … .catch(() => undefined)` for telemetry.
- Passing a string literal to `trackEvent` / `track` instead of an `EVENTS` entry — defeats the single source of truth and drifts the catalog.
- Minting a new event for what is really a property (one event per outreach channel instead of a `channel` property).
- Wrong casing — group keys PascalCase, event-name values Title Case, property keys camelCase.
- Firing a "Viewed" event on every render instead of once in a `useEffect`.
- Tracking something page views already cover, or a moment no dashboard question depends on.
