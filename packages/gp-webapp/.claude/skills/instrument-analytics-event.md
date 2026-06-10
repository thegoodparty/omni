---
name: instrument-analytics-event
description: Add a Segment/Amplitude analytics event when building a user-facing feature in the webapp — decide whether it earns an event, name it per the standard, register it, and fire it via trackEvent.
---

# Instrument an analytics event

Use when adding or changing a user-facing interaction in the webapp: a new flow, screen, primary button, form submit, funnel step, or outcome. This skill decides whether the interaction earns an event, names it, registers it, and fires it.

Background: events flow app → Segment → Amplitude (and HubSpot), via `trackEvent` in `helpers/analyticsHelper.ts`. Naming and governance are adopted from the Analytics Event Tracking Guide (product-os `processes/analytics-standards.md`, owner: Bryan Levine), which remains the source of truth.

Scope: this skill covers **frontend** events fired from the webapp. Backend events (gp-api `segment.types.ts`) are a separate, smaller catalog and are out of scope here; a sibling skill will cover them.

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

2. **Name the event.**

   Format: `{Product Area} - {Noun} {Past-Tense Verb}`, in Title Case. Prefer the verbs `Viewed` and `Completed`; reach for `Created`, `Updated`, `Dismissed`, `Blocked`, `Errored` only when those do not fit.

   ```
   Onboarding V2 - Welcome Viewed
   Onboarding V2 - Welcome Completed
   Voter Outreach - Campaign Completed
   ```

   - Product area is the navigation area the user is in.
   - If it is something the user *is* or *has* (officeType, isPro, onboardingCompleted), it is a **user property**, not an event — set it with `identifyUser` from `@shared/utils/analytics`, not `trackEvent`.

3. **Register it in the `EVENTS` map.**

   Edit `helpers/analyticsHelper.ts`. Add the event under its product-area group (create the group if new). Group keys are camelCase; values are the Title Case event name from step 2.

   ```ts
   OnboardingV2: {
     WelcomeViewed: 'Onboarding V2 - Welcome Viewed',
     WelcomeCompleted: 'Onboarding V2 - Welcome Completed',
   },
   ```

   Always reference the map — never pass a string literal to `trackEvent`. The literal lives in exactly one place.

4. **Fire it.**

   ```ts
   import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
   ```

   - **"Viewed" / screen-entry events** fire in a `useEffect` so they run once per view, not on every render:

     ```ts
     useEffect(() => {
       trackEvent(EVENTS.OnboardingV2.WelcomeViewed)
     }, [])
     ```

   - **Action / completion / outcome events** fire in the handler, with properties (camelCase, capturing the who/what/where/when/why/how):

     ```ts
     trackEvent(EVENTS.OnboardingV2.WelcomeCompleted, {
       stepIndex,
       source: 'cta',
     })
     ```

   `trackEvent` already merges in persisted UTMs and the impersonation flag, and never throws — you do not need a try/catch around it.

5. **Verify.**

   ```bash
   npx tsc --noEmit
   npm run lint
   ```

   To confirm the event actually fires, watch the Segment debugger (or the browser network tab for the Segment `t` call) while triggering the interaction locally.

## When to skip

- The interaction is on the **skip** list in step 1.
- The event already exists in `EVENTS` — reuse it, do not mint a near-duplicate.
- It is a variation of an existing event — add a property instead of a new event.
- It is a user attribute, not an action — use `identifyUser`, not `trackEvent`.

## Common mistakes

- Passing a string literal to `trackEvent` instead of an `EVENTS` entry — defeats the single source of truth and drifts the catalog.
- Minting a new event for what is really a property (one event per outreach channel instead of a `channel` property).
- snake_case or other casing — events are Title Case, property keys are camelCase.
- Firing a "Viewed" event on every render instead of once in a `useEffect`.
- Tracking something page views already cover.
- Instrumenting a moment no dashboard question depends on (event spam).
