---
name: instrument-analytics-event
description: Add a Segment/Amplitude analytics event when building a feature — in the webapp (frontend, via trackEvent) or in gp-api (backend, via AnalyticsService). Decide whether it earns an event, which side fires it, name it per the standard, register it, and fire it. For frontend events it then hands off to the event-metadata skill to record governance metadata, and it also handles client events a change removes (routing them to retirement).
---

# Instrument an analytics event

Use when adding or changing something a dashboard might ask about — a new flow, screen, primary button, form submit, funnel step, outcome, async job, payment, or status change — in **gp-webapp** (frontend) or **gp-api** (backend). This skill decides whether the moment earns an event, which side should fire it, names it, registers it, and fires it. For frontend events it then hands off to the `event-metadata` skill to record the event's governance metadata in Amplitude (step 6); and when a change **removes** a client event, it routes that event to retirement (see "When a change removes an event").

Background: events flow app/api → Segment → Amplitude (and HubSpot). There are two registries:

- **Frontend** — `helpers/analyticsHelper.ts` in gp-webapp: the `EVENTS` map + `trackEvent`.
- **Backend** — `src/vendors/segment/segment.types.ts` in gp-api: the `EVENTS` map, fired through `AnalyticsService.track`.

Naming and governance are adopted from the Analytics Event Tracking Guide (product-os `processes/analytics-standards.md`, owner: Bryan Levine), which remains the source of truth.

## Procedure

1. **Decide whether to instrument.**

   The rule everything serves: **every event must answer a question you would put on a dashboard. If you cannot name the question, do not fire the event.** More events is not more insight; un-asked events are noise.

   **Instrument** these moments:
   - Funnel steps and multi-step workflows, viewed and completed (so we can see drop-off). Any flow with more than one step counts, not just classic onboarding funnels.
   - Primary calls to action: the main action a screen exists to drive.
   - Outcomes: the user produced the thing the feature makes (a poll sent, a website published).
   - Blockers and errors that stop a user (they explain drop-off).

   **Capture the core action; let the higher-level metric be derived.** Do not mint separate `Activated`, `Converted`, or `First-Time` events. Activation and conversion are metrics defined on top of the action events above. Which specific action counts as activation or conversion for a product (for example, a poll sent in Win) is a product designation that can change without re-instrumenting, and Amplitude derives first-occurrence-per-user from any event automatically. Your job is to make sure the underlying core action is tracked.

   **Skip** these:
   - Pure UI state toggles (open/close, expand/collapse, show/hide). Exception: opening an AI chat and sending a message are real engagement, not chrome. Track both (chat opened and message sent) so we can see the open-to-send drop-off.
   - In-page navigation with no decision (tab switches, scrolling, carousel arrows). Main navigation destinations are already captured as page views (the root `RouteTracker` fires a Segment `page()` call on every route change), so do not add click events for them unless you need the entry point or source and can name the question it answers.
   - Hover, focus, mouseover.
   - Anything a page view already captures (route changes auto-fire a `page()` call via the root `RouteTracker`; do not double-track).
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

   - Product area is the navigation area the user is in (frontend) or the domain the work belongs to (backend). Follow the app's navigation as the source of truth for the area name rather than inventing one or leaning on a fixed list; the canonical set is still evolving, so match how the product is organized in the nav today.
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

6. **Record the event's metadata (frontend/client events).**

   **If this change only removes a frontend `trackEvent` call (no new event is being added),** skip directly to "When a change removes an event" below, complete the RETIRE handoff, then go to step 7.

   A new event is illegible later without its governance metadata. For a new **frontend** event, hand off to the **`event-metadata`** skill, which writes the purpose, status, product tag, and supersession lineage into Amplitude. Pass an ADD payload — you supply hints, it owns the write and the human confirmations:

   - `mode=add`,
   - `event` = the Title Case event-name string you just registered (e.g. `Briefing Assistant - Agenda Submitted`),
   - `purposeDraft` = the one-line question this event answers (you already reasoned about this when naming it),
   - `productHint` = `win | serve | shared` (from the nav area you used to name it),
   - `supersedes` = the event it replaces — **only** if this event explicitly replaces a named one. Never infer a supersession from an unrelated event being removed in the same change.

   Backend (`segment.types.ts`) events are out of scope for metadata for now (ClickUp 86aj7bdkp) — skip the handoff for them.

   If this change also **removes** a frontend `trackEvent` call, go to "When a change removes an event" below and complete the RETIRE handoff before moving to step 7.

7. **Verify.**

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

## When a change removes an event

If the change you are working on **removes** a `trackEvent` call (a frontend/client event is being deleted), that event still reads as in use in Amplitude until its metadata says otherwise — and "no recent data" alone cannot tell an intentional removal from a silent break. So when you see a client `EVENTS` entry / `trackEvent` literal being deleted:

1. Confirm with the human that it is an intentional removal.
2. Hand off to the **`event-metadata`** skill with a RETIRE payload: `mode=retire`, `event` = the removed Title Case event-name string, `reason` = a one-line why. `event-metadata` stamps `not in use` with the date and PR.

Adds and removes are **independent**. A removal happening in the same change as an addition does *not* mean the new event supersedes the removed one — only treat it as a supersession if the human explicitly says so (handled by the add's `supersedes` hint in step 6, not by pairing them automatically).

## Common mistakes

- Firing a server-truth outcome from the frontend, or double-firing it on both sides — the browser only sees a job *start*; let gp-api emit the completion.
- Renaming a backend event marked `⚠️ DO NOT MODIFY` — it breaks the HubSpot workflow that triggers on that exact string.
- `await`-ing a non-critical backend `track` and letting a Segment hiccup block or fail the request — use `void … .catch(() => undefined)` for telemetry.
- Passing a string literal to `trackEvent` / `track` instead of an `EVENTS` entry — defeats the single source of truth and drifts the catalog.
- Minting a new event for what is really a property (one event per outreach channel instead of a `channel` property).
- Wrong casing — group keys PascalCase, event-name values Title Case, property keys camelCase.
- Firing a "Viewed" event on every render instead of once in a `useEffect`.
- Tracking something page views already cover, or a moment no dashboard question depends on.
