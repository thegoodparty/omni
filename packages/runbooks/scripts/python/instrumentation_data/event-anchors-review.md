# Event anchors — review queue (2026-09-21)

**This file is the review surface.** It lives at
`packages/runbooks/scripts/python/instrumentation_data/event-anchors-review.md` on `main`,
and the Slack digest links here. Edit it and the edits become the anchors.

**How to review a row.** Edit the `- fires_on:` and `- url:` lines directly when a draft is
wrong; whatever text is on them when this file is loaded back is what the event will carry.
Then set `- disposition:` to `accepted` or `dismissed`. Leaving it blank keeps the row
queued for next time, which is the right answer for anything you are unsure about.

**How to hand it back.** Either edit it on GitHub (pencil icon, commit to a branch, open a
PR) or edit your local copy, then ask Claude to load the queue — it runs
`uv run python event_anchors.py --load-review <this file>` from
`packages/runbooks/scripts/python`, which applies your edits and dispositions to the
committed state. Nothing reaches Amplitude Govern from this file; that write is a separate,
later step.

**Two mechanics worth knowing.** Keep each edited value on one line — a value wrapped onto
a second line is not understood as part of it, and is reported rather than guessed at, so
the rest of that edit is lost. And the `evidence` line is the call site the draft came from:
open it to check the claim before accepting it.

`confidence: LOW` means the draft is a flagged guess and names why. A flagged row is doing
its job; it is not an error to fix before accepting.

---

## Briefing Assistant - Sources Expanded
  evidence:   packages/gp-webapp/app/shared/citations/SourcesCollapsible.tsx:35
  confidence: LOW — no_route

- fires_on: Briefing Assistant, expanding the collapsible 'Sources' section under a briefing.
- url: n/a (shared component, no route)
- disposition:
- reason:

---

## Candidacy - Campaign Completed
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:631
  confidence: LOW — dynamic_dispatch

- fires_on: Candidacy flow, user marks their campaign as completed.
- url: n/a (dynamic dispatch, no call site)
- disposition:
- reason:

---

## Contacts - Download
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/shared/useContactsDownload.ts:178
  confidence: LOW — no_route

- fires_on: Contacts/CRM surface, clicking to download a contacts artifact
- url: n/a (backend/shared hook, no route)
- disposition:
- reason:

---

## Contacts - Segment Viewed
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/lists/ListDetailSheet.tsx:161
  confidence: LOW — no_route

- fires_on: Contacts CRM lists, opening a list's detail sheet and its segment resolving.
- url: /dashboard
- disposition:
- reason:

---

## Content Builder - Editor: Click Copy
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Content Builder editor, clicking Copy on generated content
- url: n/a (no call site found)
- disposition:
- reason:

---

## Content Builder - Editor: Click Delete
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Content Builder editor, clicking to delete generated content
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Content Builder - Editor: Click Regenerate
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Content builder editor, click 'Regenerate' on generated content
- url: n/a (no call site found)
- disposition:
- reason:

---

## Content Builder - Editor: Click Rename
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Content Builder editor, renaming a content piece
- url: n/a (no call site found)
- disposition:
- reason:

---

## Content Builder - Editor: Click Translate
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Content Builder editor, clicking the Translate button.
- url: n/a (no call site found)
- disposition:
- reason:

---

## Content Builder - Editor: Open Version Picker
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Content Builder editor, opening the content version picker
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Content Builder - Editor: Select Version
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Content Builder editor, selecting a saved content version
- url: n/a (no call site found)
- disposition:
- reason:

---

## Content Builder - Editor: Submit Regenerate
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Content Builder editor, submitting a request to regenerate content
- url: n/a (no call site found)
- disposition:
- reason:

---

## Content Builder - Editor: Submit Translate
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Content Builder editor, submitting a translation request.
- url: n/a (no call site found)
- disposition:
- reason:

---

## Content Builder: Click Content
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Content builder surface, opening a content piece
- url: n/a (no call site found)
- disposition:
- reason:

---

## Content Builder: Click Continue Questions
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Content builder question flow, click 'Continue' after answering content questions
- url: n/a (no call site found)
- disposition:
- reason:

---

## Content Builder: Click Generate
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Content builder surface, clicking Generate on a piece of content
- url: n/a (no call site found)
- disposition:
- reason:

---

## Content Builder: Close Additional Inputs
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Content Builder, closing the additional input fields panel
- url: n/a (no call site found)
- disposition:
- reason:

---

## Content Builder: Select Template
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Content builder surface, selecting a content template
- url: n/a (no call site found)
- disposition:
- reason:

---

## Content Builder: Submit Additional Inputs
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Content Builder, submitting additional input fields
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Daily Ad Metrics
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic/background event reporting daily advertising metrics; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## Dashboard - Campaign Plan Generation Completed
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:236
  confidence: LOW — dynamic_dispatch

- fires_on: Dashboard campaign plan, automatically fires when a candidate's campaign plan finishes generating.
- url: n/a (dynamic dispatch, no fixed call site)
- disposition:
- reason:

---

## Dashboard - Campaign Plan View Mode Toggled
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:244
  confidence: LOW — dynamic_dispatch

- fires_on: Dashboard campaign plan, toggling the view mode (e.g. list/calendar view).
- url: 
- disposition:
- reason:

---

## Dashboard - Campaign Plan Viewed
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:239
  confidence: LOW — dynamic_dispatch

- fires_on: Dashboard campaign plan checklist (legacy task list), viewing the plan
- url: n/a (dynamic dispatch, no call site)
- disposition:
- reason:

---

## Dashboard - Campaign Plan Week Navigated
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:241
  confidence: LOW — dynamic_dispatch

- fires_on: Campaign plan dashboard, navigating between weeks (e.g. next/previous week arrows) in the campaign plan view.
- url: n/a (dynamic dispatch, no call site)
- disposition:
- reason:

---

## Dashboard - Campaign Plan: Campaign Manager Clicked
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:259
  confidence: LOW — dynamic_dispatch

- fires_on: Dashboard campaign plan, clicking a Campaign Manager link/CTA.
- url: 
- disposition:
- reason:

---

## Dashboard - Campaign Plan: Media Displayed
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:251
  confidence: LOW — dynamic_dispatch

- fires_on: Campaign Plan page, media results shown to the candidate
- url: 
- disposition:
- reason:

---

## Dashboard - Campaign Plan: Media Requested
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:247
  confidence: LOW — dynamic_dispatch

- fires_on: Campaign Plan page, requesting media coverage results
- url: 
- disposition:
- reason:

---

## Dashboard - Campaign Plan: Media Results Received
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:250
  confidence: LOW — dynamic_dispatch

- fires_on: Campaign Plan page, media results returned from the server after a request
- url: 
- disposition:
- reason:

---

## Dashboard - Campaign Plan: Plan Downloaded
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:256
  confidence: LOW — dynamic_dispatch

- fires_on: Dashboard campaign plan, downloading the plan
- url: n/a (dynamic dispatch, no call site)
- disposition:
- reason:

---

## Dashboard - Campaign Plan: Strategic Landscape Displayed
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:255
  confidence: LOW — dynamic_dispatch

- fires_on: Campaign Plan page, strategic landscape results shown to the candidate
- url: 
- disposition:
- reason:

---

## Dashboard - Campaign Plan: Strategic Landscape Requested
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:249
  confidence: LOW — dynamic_dispatch

- fires_on: Campaign Plan page, requesting strategic landscape results
- url: 
- disposition:
- reason:

---

## Dashboard - Campaign Plan: Strategic Landscape Results Received
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:253
  confidence: LOW — dynamic_dispatch

- fires_on: Campaign Plan page, strategic landscape results returned from the server after a request
- url: 
- disposition:
- reason:

---

## Dashboard - Campaign Task Status Updated
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:243
  confidence: LOW — dynamic_dispatch

- fires_on: Dashboard campaign plan tracker, updating a task's status
- url: n/a (dispatched dynamically, no fixed call site)
- disposition:
- reason:

---

## Dictation - Started
  evidence:   packages/gp-webapp/app/dashboard/shared/dictation/useDictation.ts:461
  confidence: LOW — no_route

- fires_on: Any dictation-enabled surface (briefings, onboarding story steps), starting voice dictation
- url: n/a (shared dictation hook, no single route)
- disposition:
- reason:

---

## Door Knocking - Do Not Knock Set
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Door Knocking, marking an address as Do Not Knock
- url: n/a (no call site found)
- disposition:
- reason:

---

## Door Knocking - Route Built
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Door Knocking, a canvassing route is successfully built
- url: n/a (no call site found)
- disposition:
- reason:

---

## Experiment Viewed
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic experiment-viewed tracking event; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## Navigation - Dashboard: Click Content Builder
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Dashboard sidebar navigation, clicking the Content Builder link
- url: n/a (no call site found)
- disposition:
- reason:

---

## Navigation - Dashboard: Click Door Knocking
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:200
  confidence: LOW — dynamic_dispatch

- fires_on: Dashboard sidebar, click 'Door Knocking' navigation item
- url: n/a (dashboard sidebar)
- disposition:
- reason:

---

## Newsletter Form Submitted
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Newsletter signup form, submitting the form
- url: n/a (no call site found)
- disposition:
- reason:

---

## Onboarding - Office Step: Click Can't See Office
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:144
  confidence: LOW — dynamic_dispatch

- fires_on: Onboarding office-selection step, click 'Can't see my office' link
- url: n/a (dynamic dispatch, no direct call site found)
- disposition:
- reason:

---

## Onboarding - Registration Completed
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:846
  confidence: LOW — no_route

- fires_on: Onboarding sign-up flow, completing account registration
- url: n/a (backend/helper call, no route)
- disposition:
- reason:

---

## Onboarding V2 - Community Events Displayed
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:693
  confidence: LOW — dynamic_dispatch

- fires_on: Onboarding V2 campaign plan flow, 'Community Events' results shown to the user.
- url: n/a (dynamic dispatch, no call site)
- disposition:
- reason:

---

## Onboarding V2 - Community Events Results Received
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:692
  confidence: LOW — dynamic_dispatch

- fires_on: Onboarding V2 campaign plan flow, server returns 'Community Events' results.
- url: n/a (dynamic dispatch, no call site)
- disposition:
- reason:

---

## Onboarding V2 - Media Displayed
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:689
  confidence: LOW — dynamic_dispatch

- fires_on: Onboarding V2 campaign plan flow, 'Media' results shown to the user.
- url: n/a (dynamic dispatch, no call site)
- disposition:
- reason:

---

## Onboarding V2 - Media Requested
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:687
  confidence: LOW — dynamic_dispatch

- fires_on: Onboarding V2 campaign plan flow, user requests 'Media' results.
- url: n/a (dynamic dispatch, no call site)
- disposition:
- reason:

---

## Onboarding V2 - Media Results Received
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:688
  confidence: LOW — dynamic_dispatch

- fires_on: Onboarding V2 campaign plan flow, server returns 'Media' results.
- url: n/a (dynamic dispatch, no call site)
- disposition:
- reason:

---

## Onboarding V2 - Party Designation Blocked
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:636
  confidence: LOW — no_route

- fires_on: Onboarding flow, Party Designation step, selecting a major party which shows the blocking alert
- url: n/a (no_route)
- disposition:
- reason:

---

## Onboarding V2 - Strategic Landscape Displayed
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:699
  confidence: LOW — dynamic_dispatch

- fires_on: Onboarding flow, Strategic Landscape results section is shown to the user
- url: n/a (dynamic_dispatch)
- disposition:
- reason:

---

## Onboarding V2 - Strategic Landscape Results Received
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:697
  confidence: LOW — dynamic_dispatch

- fires_on: Onboarding V2 campaign plan flow, server returns 'Strategic Landscape' results.
- url: n/a (dynamic dispatch, no call site)
- disposition:
- reason:

---

## Onboarding V2 - What's Your Background Completed
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:707
  confidence: LOW — dynamic_dispatch

- fires_on: Onboarding V2 flow, clicking Continue on the "What's your background" campaign story step.
- url: n/a (dynamic dispatch, no fixed call site)
- disposition:
- reason:

---

## Onboarding V2 - What's Your Background Viewed
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:706
  confidence: LOW — dynamic_dispatch

- fires_on: Onboarding flow, viewing the "What's your background" campaign story screen
- url: n/a (dispatched dynamically, no direct call site)
- disposition:
- reason:

---

## Outreach - Action Clicked
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:618
  confidence: LOW — dynamic_dispatch

- fires_on: Outreach section, click an outreach action item
- url: n/a (dynamic dispatch, no direct call site found)
- disposition:
- reason:

---

## Outreach - Door Knocking: Complete
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:595
  confidence: LOW — dynamic_dispatch

- fires_on: Voter Outreach flow, Door Knocking step, marking the door knocking outreach as complete.
- url: n/a (dynamic dispatch, no fixed call site)
- disposition:
- reason:

---

## Outreach - Phone Banking: Complete
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:598
  confidence: LOW — dynamic_dispatch

- fires_on: Phone banking outreach flow, completing a phone banking session
- url: n/a (dynamic dispatch, no single call site)
- disposition:
- reason:

---

## Outreach - Social Media: Complete
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:592
  confidence: LOW — dynamic_dispatch

- fires_on: Outreach planning flow, logging completed social media outreach progress.
- url: 
- disposition:
- reason:

---

## Person Profile Claim CTA Submitted
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Person profile page, submitting the claim-this-profile CTA
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Person Profile Notify Submitted
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Person profile notify feature, submitting a notify request.
- url: n/a (no call site found)
- disposition:
- reason:

---

## Pro Upgrade - Guidance: Click let's go
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:415
  confidence: LOW — dynamic_dispatch

- fires_on: Pro Upgrade flow, clicking 'Let's go' to continue from the Guidance screen
- url: n/a (dynamic dispatch, no call site to confirm route)
- disposition:
- reason:

---

## Schedule Text Campaign - Audience: Check Age
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:314
  confidence: LOW — dynamic_dispatch

- fires_on: Schedule Text Campaign flow, checking the Age audience filter
- url: 
- disposition:
- reason:

---

## Schedule Text Campaign - Audience: Check Audience
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:311
  confidence: LOW — dynamic_dispatch

- fires_on: Schedule Text Campaign flow, checking the Audience filter option
- url: 
- disposition:
- reason:

---

## Schedule Text Campaign - Audience: Check Gender
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:315
  confidence: LOW — dynamic_dispatch

- fires_on: Schedule Text Campaign wizard, checking the Gender filter on the Audience step.
- url: n/a (dynamic dispatch, no fixed call site)
- disposition:
- reason:

---

## Schedule Text Campaign - Audience: Check Political Party
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:313
  confidence: LOW — dynamic_dispatch

- fires_on: Schedule Text Campaign flow, checking the Political Party audience filter
- url: 
- disposition:
- reason:

---

## Schedule Text Campaign - Audience: Enter Audience Request
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:317
  confidence: LOW — dynamic_dispatch

- fires_on: Schedule Text Campaign wizard, entering a custom audience request in the Audience step.
- url: n/a (dispatched dynamically, no fixed call site)
- disposition:
- reason:

---

## Schedule Text Campaign - Script: Click Add your own script
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:326
  confidence: LOW — dynamic_dispatch

- fires_on: Schedule Text Campaign flow, clicking 'Add your own script' in the script selection step
- url: n/a (dynamic dispatch, no call site to confirm route)
- disposition:
- reason:

---

## Schedule Text Campaign - Script: Click Generate a new script
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:324
  confidence: LOW — dynamic_dispatch

- fires_on: Schedule Text Campaign flow, clicking 'Generate a new script' in the script selection step
- url: n/a (dynamic dispatch, no call site to confirm route)
- disposition:
- reason:

---

## Schedule Text Campaign - Script: Click Use a saved script
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:321
  confidence: LOW — dynamic_dispatch

- fires_on: Schedule Text Campaign wizard, clicking 'Use a saved script'
- url: n/a (dynamic dispatch, no call site)
- disposition:
- reason:

---

## Schedule Text Campaign - Script: Select Saved Script
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:322
  confidence: LOW — dynamic_dispatch

- fires_on: Schedule Text Campaign wizard, Script step — selecting a saved script from the list.
- url: n/a (dynamic dispatch, no fixed call site)
- disposition:
- reason:

---

## Schedule Text Campaign - Script: Submit added script
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:327
  confidence: LOW — dynamic_dispatch

- fires_on: Schedule Text Campaign wizard, submitting a custom script the user wrote themselves
- url: n/a (dynamic dispatch, no call site)
- disposition:
- reason:

---

## Schedule Text Campaign: Back
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:303
  confidence: LOW — dynamic_dispatch

- fires_on: Schedule Text Campaign flow, clicking Back to a previous step
- url: n/a (dynamic dispatch, no call site to confirm route)
- disposition:
- reason:

---

## Schedule Text Campaign: Exit
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:301
  confidence: LOW — dynamic_dispatch

- fires_on: Dashboard Voter Contact texting flow, exiting the Schedule Text Campaign wizard
- url: n/a (dispatched dynamically, no direct call site)
- disposition:
- reason:

---

## Schedule Text Campaign: Next
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:302
  confidence: LOW — dynamic_dispatch

- fires_on: Schedule Text Campaign flow, clicking Next to advance through the scheduling steps
- url: 
- disposition:
- reason:

---

## Scroll Depth
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic browser/session-level scroll depth tracking; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## Segment Consent Preference Updated
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Cookie/privacy consent preference control, updating a consent preference.
- url: n/a (no call site found)
- disposition:
- reason:

---

## Sign Up Clicked
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Primary sign-up call-to-action button being clicked
- url: 
- disposition:
- reason:

---

## Viewed
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Generic page-view tracking event; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## Voter Outreach - Payment Started
  evidence:   packages/gp-webapp/helpers/analyticsHelper.ts:588
  confidence: LOW — dynamic_dispatch

- fires_on: Outreach flow, starting payment for an outreach send
- url: n/a (dynamic dispatch, no call site)
- disposition:
- reason:

---

## [Amplitude] Dead Click
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic Amplitude autotrack event capturing clicks that produce no visible effect (dead clicks); no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## [Amplitude] Element Changed
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic Amplitude autotrack event capturing form field changes (dropdown selection, text input) across the product; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## [Amplitude] Element Clicked
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic Amplitude autotrack event capturing clicks on interactive page elements across the product; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## [Amplitude] File Downloaded
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic Amplitude autotrack event for a file download anywhere on the site
- url: n/a (no call site found)
- disposition:
- reason:

---

## [Amplitude] Form Started
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic Amplitude autotrack event capturing when a user begins filling out a form; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## [Amplitude] Form Submitted
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic Amplitude autotrack event capturing form submissions; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## [Amplitude] Page Viewed
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic Amplitude autotrack event capturing generic page loads across the product; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## [Amplitude] Rage Click
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Amplitude's automatic rage-click detection, firing anywhere in the app when a user clicks repeatedly in frustration.
- url: n/a (no call site found)
- disposition:
- reason:

---

## [Amplitude] Replay Captured
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic Amplitude session-replay capture event; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## [Amplitude] Viewport Content Updated
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic Amplitude autotrack event capturing viewport/content visibility changes; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## [Amplitude] Web Vitals
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic Amplitude autotrack event capturing page performance/web vitals metrics; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## [Experiment] Assignment
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic experiment-assignment tracking event; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## [Experiment] Exposure
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic experiment-exposure tracking event; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## [Experiment] Impression
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic experiment-impression tracking event; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## ai_content_generation_start
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Content Builder, starting AI content generation
- url: n/a (no call site found)
- disposition:
- reason:

---

## schedule_campaign_image_too_large
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Campaign outreach scheduling image upload, uploading an image that is too large.
- url: n/a (no call site found)
- disposition:
- reason:

---

## session_end
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic browser/session-level event marking the end of a user session; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:

---

## session_start
  evidence:   none found
  confidence: LOW — no_call_site

- fires_on: Automatic browser/session-level event marking the start of a user session; no specific surface can be identified.
- url: n/a (no call site found)
- disposition:
- reason:
