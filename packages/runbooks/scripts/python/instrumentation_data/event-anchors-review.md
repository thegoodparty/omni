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

## Account - User Deleted
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:21
  confidence: LOW — no_route

- fires_on: Account deletion, tracked server-side when a user's account is deleted
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Briefing Assistant - Agenda Created
  evidence:   packages/gp-api/src/meetings/services/meetingBriefings.service.ts:1347
  confidence: LOW — no_route

- fires_on: Briefing Assistant, backend confirmation that a meeting agenda was successfully created.
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Briefing Assistant - Agenda Not Created
  evidence:   packages/gp-api/src/meetings/services/meetingBriefings.service.ts:1284
  confidence: LOW — no_route

- fires_on: Briefing Assistant agenda generation job failing or finding no upcoming meeting (backend event)
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Briefing Assistant - Dispatch Skipped
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:89
  confidence: LOW — no_route

- fires_on: Backend daily cron job for Meeting Briefings that skips sending a briefing to an otherwise-eligible office because the user has been inactive past the activity threshold, feeding a HubSpot re-engagement email.
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Briefing Assistant - Sources Expanded
  evidence:   packages/gp-webapp/app/shared/citations/SourcesCollapsible.tsx:35
  confidence: LOW — no_route

- fires_on: Briefing Assistant, expanding the collapsible 'Sources' section under a briefing.
- url: n/a (shared component, no route)
- disposition:
- reason:

---

## Campaign - Follow-On Created
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:92
  confidence: LOW — no_route

- fires_on: Backend process creating a follow-on campaign for an existing office-holder
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Campaign Plan - Weekly Tasks Digest
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:97
  confidence: LOW — no_route

- fires_on: Backend weekly digest job for Campaign Plan tasks, used to trigger a HubSpot email listing the week's tasks.
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Campaign Plan V2 - Community Events Generation Completed
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:109
  confidence: LOW — no_route

- fires_on: Campaign Plan V2 onboarding plan generation, server finishes generating the community events section
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Campaign Plan V2 - Community Events Generation Started
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:107
  confidence: LOW — no_route

- fires_on: Campaign Plan V2 onboarding plan generation, server starts generating the community events section
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Campaign Plan V2 - Media Generation Completed
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:105
  confidence: LOW — no_route

- fires_on: Server-side generation job for the V2 onboarding campaign plan finishing its media-generation step (no user-facing page).
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Campaign Plan V2 - Media Generation Started
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:104
  confidence: LOW — no_route

- fires_on: Server-side campaign plan generation job starting media generation for the onboarding campaign plan
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Campaign Plan V2 - Opportunities & Challenges Generation Completed
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:117
  confidence: LOW — no_route

- fires_on: Server-side generation job for the V2 onboarding campaign plan completing its opportunities & challenges step (no user-facing page).
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Campaign Plan V2 - Opportunities & Challenges Generation Started
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:115
  confidence: LOW — no_route

- fires_on: Server-side generation job for the V2 onboarding campaign plan starting its opportunities & challenges step (no user-facing page).
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Campaign Plan V2 - Opposition Research Generation Completed
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:113
  confidence: LOW — no_route

- fires_on: Server-side generation job for the V2 onboarding campaign plan completing its opposition-research step (no user-facing page).
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Campaign Plan V2 - Opposition Research Generation Started
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:111
  confidence: LOW — no_route

- fires_on: Server-side generation job for the V2 onboarding campaign plan starting its opposition-research step (no user-facing page).
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Campaign Plan V2 - Strategy Race Changed
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:118
  confidence: LOW — no_route

- fires_on: Campaign Plan V2 server-side strategy generation, changing the race used for strategic landscape generation.
- url: 
- disposition:
- reason:

---

## Campaign Verify Token Status Update
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:71
  confidence: LOW — no_route

- fires_on: Backend Campaign Verify integration updating a campaign's 10DLC compliance token status, feeding downstream HubSpot/compliance workflows.
- url: n/a (backend service, no route)
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

## Candidate Website - Published
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:38
  confidence: LOW — no_route

- fires_on: Candidate website publishing action (backend-tracked event, name only appears in the event registry)
- url: n/a (no_route)
- disposition:
- reason:

---

## Community Issues - Initial Issues Generated
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:144
  confidence: LOW — no_route

- fires_on: Community Issues feed for elected officials, when the initial set of issues finishes generating server-side
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Community Issues - Top Issues Dispatch Skipped
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:153
  confidence: LOW — no_route

- fires_on: Backend daily cron job skipping a top-issues email dispatch for an inactive user
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Community Issues - Top Issues Refreshed
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:147
  confidence: LOW — no_route

- fires_on: Community Issues feature, backend job snapshot fired when the top-issues list is refreshed after the initial generation.
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Community Issues - Trending Issues Dispatch Skipped
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:155
  confidence: LOW — no_route

- fires_on: Backend daily cron job for Community Issues that skips sending a trending-issues digest to an otherwise-eligible org because the user has been inactive past the activity threshold, feeding a HubSpot re-engagement email.
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Community Issues - Trending Issues Refreshed
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:148
  confidence: LOW — no_route

- fires_on: Community Issues feed, trending issues list refreshed by a background agent job (backend event)
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Constituent Data - List Created
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/wizard/CreateListWizard.tsx:390
  confidence: LOW — no_route

- fires_on: Contacts CRM list wizard, finishing the voter-file branch to create a custom constituent list
- url: /dashboard/contacts/crm/wizard
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

## Contacts - List Wizard Conditions Completed
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/wizard/CreateListWizard.tsx:350
  confidence: LOW — no_route

- fires_on: Contacts CRM, clicking Next after completing the conditions step of the Create List wizard
- url: /dashboard/contacts
- disposition:
- reason:

---

## Contacts - List Wizard Method Completed
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/wizard/CreateListWizard.tsx:340
  confidence: LOW — no_route

- fires_on: Create-list wizard in Contacts/CRM, clicking Next after choosing a list build method
- url: /dashboard/contacts/crm
- disposition:
- reason:

---

## Contacts - List Wizard Name Completed
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/wizard/CreateListWizard.tsx:379
  confidence: LOW — no_route

- fires_on: Contacts CRM, Create List wizard, completing the name step and creating the list
- url: /dashboard/contacts
- disposition:
- reason:

---

## Contacts - List Wizard Name Viewed
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/wizard/CreateListWizard.tsx:53
  confidence: LOW — no_route

- fires_on: Contacts CRM, reaching the "name your list" step of the Create List wizard
- url: /dashboard/contacts
- disposition:
- reason:

---

## Contacts - Segment Created
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/lists/useDuplicateList.ts:76
  confidence: LOW — unspecified

- fires_on: Contacts/CRM lists, duplicating a list which creates a new segment
- url: /dashboard
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

## Content Builder: Generation Completed
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:79
  confidence: LOW — no_route

- fires_on: Content Builder, server-side AI content generation job completing (no user-facing page).
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Content Builder: Generation Started
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:78
  confidence: LOW — no_route

- fires_on: Server-side AI content generation job starting, triggered from the Content Builder feature
- url: n/a (backend service, no route)
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

## Dictation - Failed
  evidence:   packages/gp-webapp/app/dashboard/shared/dictation/useDictation.ts:269
  confidence: LOW — dynamic_dispatch

- fires_on: Voice dictation control on any dashboard surface (briefings, onboarding story steps, etc.), when a dictation attempt fails
- url: /dashboard
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

## Door Knocking - Canvassing Totals Updated
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:213
  confidence: LOW — no_route

- fires_on: Backend rollup of an org's door knocking canvassing totals (turf create, turf complete, or daily sweep), not a page click
- url: n/a (backend service, no route)
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

## Navigation - Dashboard: Click Briefings
  evidence:   packages/gp-webapp/app/dashboard/shared/DashboardMenu.tsx:201
  confidence: LOW — global_chrome

- fires_on: Dashboard sidebar navigation, clicking the Briefing Assistant menu item
- url: n/a (dashboard sidebar)
- disposition:
- reason:

---

## Navigation - Dashboard: Click Campaign Plan
  evidence:   packages/gp-webapp/app/dashboard/shared/DashboardMenu.tsx:248
  confidence: LOW — global_chrome

- fires_on: Dashboard sidebar, clicking the 'Campaign Tracker'/'Campaign Plan' nav item
- url: n/a (dashboard sidebar)
- disposition:
- reason:

---

## Navigation - Dashboard: Click Campaign Team
  evidence:   packages/gp-webapp/app/dashboard/shared/DashboardMenu.tsx:459
  confidence: LOW — global_chrome

- fires_on: Dashboard sidebar menu, clicking the 'Team' navigation item
- url: n/a (dashboard sidebar)
- disposition:
- reason:

---

## Navigation - Dashboard: Click Community Issues
  evidence:   packages/gp-webapp/app/dashboard/shared/DashboardMenu.tsx:211
  confidence: LOW — global_chrome

- fires_on: Dashboard sidebar navigation, clicking the Community Issues menu item
- url: n/a (dashboard sidebar)
- disposition:
- reason:

---

## Navigation - Dashboard: Click Constituent Outreach
  evidence:   packages/gp-webapp/app/dashboard/shared/DashboardMenu.tsx:191
  confidence: LOW — global_chrome

- fires_on: Dashboard sidebar menu, clicking the Constituent Outreach nav item
- url: n/a (dashboard sidebar)
- disposition:
- reason:

---

## Navigation - Dashboard: Click Contacts
  evidence:   packages/gp-webapp/app/dashboard/shared/DashboardMenu.tsx:155
  confidence: LOW — global_chrome

- fires_on: Dashboard sidebar, clicking the 'Contacts' nav item
- url: n/a (dashboard sidebar)
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

## Navigation - Dashboard: Click Dashboard
  evidence:   packages/gp-webapp/app/dashboard/shared/DashboardMenu.tsx:106
  confidence: LOW — global_chrome

- fires_on: Dashboard sidebar, clicking the 'Dashboard' (Campaign Manager) nav item
- url: n/a (dashboard sidebar)
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

## Navigation - Dashboard: Click My Profile
  evidence:   packages/gp-webapp/app/dashboard/shared/DashboardMenu.tsx:125
  confidence: LOW — global_chrome

- fires_on: Dashboard sidebar, clicking "My Profile".
- url: n/a (dashboard sidebar)
- disposition:
- reason:

---

## Navigation - Dashboard: Click Polls
  evidence:   packages/gp-webapp/app/dashboard/shared/DashboardMenu.tsx:180
  confidence: LOW — global_chrome

- fires_on: Dashboard sidebar, clicking the 'Polls' nav item.
- url: n/a (dashboard sidebar)
- disposition:
- reason:

---

## Navigation - Dashboard: Click Voter Outreach
  evidence:   packages/gp-webapp/app/dashboard/shared/DashboardMenu.tsx:115
  confidence: LOW — global_chrome

- fires_on: Dashboard sidebar, clicking the 'Voter Outreach' nav item
- url: n/a (dashboard sidebar)
- disposition:
- reason:

---

## Navigation - Top - Avatar Dropdown: Close Dropdown
  evidence:   packages/gp-webapp/app/shared/layouts/navigation/RightSide.tsx:26
  confidence: LOW — global_chrome

- fires_on: Top navigation bar, closing the avatar/profile dropdown
- url: n/a (global nav)
- disposition:
- reason:

---

## Navigation - Top: Click Avatar Dropdown
  evidence:   packages/gp-webapp/app/shared/layouts/navigation/ProfileDropdown.tsx:86
  confidence: LOW — global_chrome

- fires_on: Top navigation bar, clicking the avatar/profile dropdown
- url: n/a (global nav)
- disposition:
- reason:

---

## Navigation - Top: Click Logo
  evidence:   packages/gp-webapp/app/shared/layouts/navigation/HeaderLogo.tsx:41
  confidence: LOW — global_chrome

- fires_on: Top navigation bar (present on every page), clicking the GoodParty.org logo.
- url: n/a (global nav)
- disposition:
- reason:

---

## Navigation Top - Avatar Dropdown: Click Logout
  evidence:   packages/gp-webapp/app/shared/layouts/navigation/ProfileDropdown.tsx:91
  confidence: LOW — global_chrome

- fires_on: Top navigation avatar dropdown, clicking Logout.
- url: n/a (dashboard sidebar/top nav, global chrome)
- disposition:
- reason:

---

## Navigation Top - Avatar Dropdown: Click Profile
  evidence:   packages/gp-webapp/app/shared/layouts/navigation/ProfileDropdown.tsx:27
  confidence: LOW — global_chrome

- fires_on: Top navigation avatar dropdown menu, clicking the 'Profile' link.
- url: n/a (global nav)
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

## Onboarding - Candidate Office Searched
  evidence:   packages/gp-webapp/app/shared/hooks/useTrackOfficeSearch.ts:24
  confidence: LOW — no_route

- fires_on: Onboarding office step, typing/searching for an office to run for
- url: /onboarding
- disposition:
- reason:

---

## Onboarding - Magic Link Sent
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:33
  confidence: LOW — no_route

- fires_on: Backend sales process generating and sending a magic-link onboarding email to a lead
- url: n/a (backend service, no route)
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

## Onboarding V2 - Ballot Status Completed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:1028
  confidence: LOW — no_route

- fires_on: Onboarding flow, completing the Ballot Status step (advancing past the ballot-status question)
- url: /onboarding
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

## Onboarding V2 - Office Completed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:744
  confidence: LOW — no_route

- fires_on: Onboarding flow, completing the Office step (office selected and saved)
- url: /onboarding
- disposition:
- reason:

---

## Onboarding V2 - Office Next Clicked
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:991
  confidence: LOW — no_route

- fires_on: Onboarding flow, clicking Next on the Office selection step
- url: /onboarding
- disposition:
- reason:

---

## Onboarding V2 - Office Viewed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:554
  confidence: LOW — no_route

- fires_on: Onboarding flow, viewing the Office selection step screen
- url: /onboarding
- disposition:
- reason:

---

## Onboarding V2 - Onboarding Skipped
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:1153
  confidence: LOW — no_route

- fires_on: Onboarding flow, campaign story steps, clicking Skip on a story step
- url: /onboarding
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

## Onboarding V2 - Party Designation Completed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:896
  confidence: LOW — no_route

- fires_on: Onboarding flow, completing the Party Designation step (saving party affiliation and advancing)
- url: /onboarding
- disposition:
- reason:

---

## Onboarding V2 - Party Designation Viewed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:553
  confidence: LOW — no_route

- fires_on: Onboarding flow, viewing the Party Designation step screen
- url: /onboarding
- disposition:
- reason:

---

## Onboarding V2 - Pledge Completed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:946
  confidence: LOW — no_route

- fires_on: Onboarding flow, completing the Pledge step (pledge submitted and campaign launched)
- url: /onboarding
- disposition:
- reason:

---

## Onboarding V2 - Pledge Submit Clicked
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:910
  confidence: LOW — no_route

- fires_on: Onboarding flow, clicking Submit on the Pledge step
- url: /onboarding
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

## Onboarding V2 - Votes Needed Calculated
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:515
  confidence: LOW — no_route

- fires_on: Onboarding flow, Path to Victory step, when votes-needed metrics finish computing
- url: /onboarding
- disposition:
- reason:

---

## Onboarding V2 - Votes Needed Completed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:977
  confidence: LOW — no_route

- fires_on: Onboarding flow, clicking Next on the Path to Victory (Votes Needed) step
- url: /onboarding
- disposition:
- reason:

---

## Onboarding V2 - Votes Needed Viewed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:555
  confidence: LOW — no_route

- fires_on: Onboarding flow, viewing the Path to Victory (Votes Needed) step screen
- url: /onboarding
- disposition:
- reason:

---

## Onboarding V2 - What Issues Do You Want To Solve Completed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:161
  confidence: LOW — no_route

- fires_on: Onboarding story flow, clicking Continue on the 'What issues do you want to solve' step
- url: /onboarding
- disposition:
- reason:

---

## Onboarding V2 - What Issues Do You Want To Solve Viewed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:560
  confidence: LOW — no_route

- fires_on: Onboarding flow, viewing the "What issues do you want to solve" campaign story screen
- url: /onboarding
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

## Onboarding V2 - Why Are You Running Viewed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:558
  confidence: LOW — no_route

- fires_on: Onboarding flow, viewing the "Why are you running" campaign story screen
- url: /onboarding
- disposition:
- reason:

---

## Org Switcher - Organization Switched
  evidence:   packages/gp-webapp/app/shared/organization-picker.tsx:223
  confidence: LOW — global_chrome

- fires_on: Organization picker, switching between organizations
- url: n/a (dashboard header org switcher, appears across all pages)
- disposition:
- reason:

---

## Org Switcher - Run For Office Clicked
  evidence:   packages/gp-webapp/app/shared/organization-picker.tsx:262
  confidence: LOW — global_chrome

- fires_on: Org switcher dropdown in the sidebar, clicking to start the run-for-office follow-on flow
- url: n/a (dashboard sidebar)
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

## P2P Upgrade - Modal: Exit
  evidence:   packages/gp-webapp/app/dashboard/shared/P2PUpgradeModal.tsx:87
  confidence: LOW — global_chrome

- fires_on: P2P upgrade modal (shown across the dashboard), clicking to close/exit the modal.
- url: n/a (dashboard sidebar)
- disposition:
- reason:

---

## Peerly Identity ID Created
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:75
  confidence: LOW — no_route

- fires_on: 10DLC compliance backend process creating a Peerly identity id (backend-tracked event, name only appears in the event registry)
- url: n/a (no_route)
- disposition:
- reason:

---

## Person Profile - Completion Requested
  evidence:   packages/gp-api/src/personProfiles/observability/person-profiles.metrics.ts:59
  confidence: LOW — no_route

- fires_on: Person profile completion-request handling (backend service that emits an analytics event when a completion request is sent)
- url: n/a (backend service, no route)
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

## Poll - Results Synthesis Complete
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:82
  confidence: LOW — no_route

- fires_on: Poll results synthesis processing completing (system-triggered, not a user action on a page).
- url: n/a (backend service, no route)
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

## Robocall - Hold Placed
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:189
  confidence: LOW — no_route

- fires_on: Server-side robocall payment processing, placing the payment authorization hold once a robocall is scheduled
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Robocall - Scheduled
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:188
  confidence: LOW — no_route

- fires_on: Server-side robocall scheduling, creating the pending-payment robocall draft after the candidate schedules a robocall
- url: n/a (backend service, no route)
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

## Serve Onboarding - BR Suggestion Changed
  evidence:   packages/gp-webapp/app/serve/onboarding/serveOnboardingAnalytics.ts:10
  confidence: LOW — no_call_site

- fires_on: Serve onboarding flow, changing the suggested BR (biography/role) value on the onboarding screen
- url: /serve/onboarding
- disposition:
- reason:

---

## Settings - Account Settings: Click Manage Pro Subscription
  evidence:   packages/gp-webapp/app/shared/PaymentPortalButton.tsx:28
  confidence: LOW — global_chrome

- fires_on: Account settings, clicking 'Manage Pro Subscription' to open the billing portal.
- url: n/a (dashboard sidebar)
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

## Voter Data - Activity List Created
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/wizard/CreateListWizard.tsx:420
  confidence: LOW — no_route

- fires_on: Contacts CRM list wizard, finishing the outreach-activity branch to create a voter/constituent list
- url: /dashboard/contacts/crm/wizard
- disposition:
- reason:

---

## Voter Data - Contact Status Changed
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/person/StatusRow.tsx:185
  confidence: LOW — no_route

- fires_on: CRM contact/person detail view, changing a contact's Voter Likelihood status
- url: /dashboard/contacts/crm
- disposition:
- reason:

---

## Voter Data - List Created
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/wizard/CreateListWizard.tsx:389
  confidence: LOW — no_route

- fires_on: Contacts CRM, Create List wizard, successfully creating a voter-file list
- url: /dashboard/contacts
- disposition:
- reason:

---

## Voter Data - List Exported
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/lists/ListDetailSheet.tsx:189
  confidence: LOW — no_route

- fires_on: CRM contacts list detail panel, downloading a saved voter list
- url: /dashboard/contacts/crm
- disposition:
- reason:

---

## Voter Data - Note Added
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/person/NotesSection.tsx:245
  confidence: LOW — no_route

- fires_on: CRM contact/person detail view, adding a note to a voter record
- url: /dashboard/contacts/crm
- disposition:
- reason:

---

## Voter Outreach - 10DLC Compliance Candidate Profile Submitted
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:62
  confidence: LOW — no_route

- fires_on: Server-side event when a website content save completes the candidate's 10DLC compliance profile (no user-facing page).
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Voter Outreach - 10DLC Compliance Completed
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:43
  confidence: LOW — no_route

- fires_on: 10DLC compliance flow completion (backend-driven event for HubSpot tracking)
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Voter Outreach - 10DLC Compliance Form Submitted
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:45
  confidence: LOW — no_route

- fires_on: 10DLC compliance form submission (backend-tracked event, name only appears in the event registry)
- url: n/a (no_route)
- disposition:
- reason:

---

## Voter Outreach - 10DLC Compliance PIN Resent
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:56
  confidence: LOW — no_route

- fires_on: GoodParty staff admin console, triggering a 10DLC compliance PIN resend for a campaign
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Voter Outreach - 10DLC Compliance PIN Sent
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:51
  confidence: LOW — no_route

- fires_on: 10DLC compliance PIN delivery detection sweep sending a PIN (backend-tracked event, name only appears in the event registry)
- url: n/a (no_route)
- disposition:
- reason:

---

## Voter Outreach - 10DLC Compliance PIN Submitted
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:47
  confidence: LOW — no_route

- fires_on: 10DLC compliance PIN verification, submitting the PIN (backend event, HubSpot workflow trigger)
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Voter Outreach - 10DLC Compliance Rejected
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:69
  confidence: LOW — no_route

- fires_on: Server-side 10DLC compliance check rejecting a candidate's identity verification (Campaign Verify), not a user-facing screen
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Voter Outreach - Campaign Approved
  evidence:   packages/gp-api/src/outreach/services/outreachSmsAdmin.service.ts:403
  confidence: LOW — no_route

- fires_on: SMS outreach approval processing, when a campaign's SMS outreach is approved
- url: n/a (backend service, no route)
- disposition:
- reason:

---

## Voter Outreach - Campaign Completed
  evidence:   packages/gp-webapp/app/dashboard/components/campaignManager/RecordVoterContactsModal.tsx:174
  confidence: LOW — no_route

- fires_on: Dashboard campaign manager, saving recorded voter contacts in the Record Voter Contacts modal
- url: /dashboard
- disposition:
- reason:

---

## Voter Outreach - Free Texts Offer Redeemed
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:70
  confidence: LOW — no_route

- fires_on: Free texts offer redemption, tracked server-side when a candidate redeems a free-texts offer
- url: n/a (backend service, no route)
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

## page
  evidence:   packages/gp-admin/src/app/dashboard/agent-runs/types.ts:15
  confidence: LOW — no_call_site

- fires_on: Admin Agent Runs list page (gp-admin), a type/config declaration for search-param and status filter options rather than a tracked event call site.
- url: /dashboard/agent-runs (gp-admin)
- disposition:
- reason:

---

## pro_upgrade_complete
  evidence:   packages/gp-api/src/vendors/segment/segment.types.ts:20
  confidence: LOW — no_route

- fires_on: Pro upgrade completion (backend-tracked event, name only appears in the event registry)
- url: n/a (no_route)
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
