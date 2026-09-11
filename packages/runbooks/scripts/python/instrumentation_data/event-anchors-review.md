# Event anchors — review queue (2026-09-11)

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

## 10 DLC Compliance - PIN Verification Completed
  evidence:   packages/gp-webapp/app/dashboard/profile/texting-compliance/shared/useSubmitCvPin.ts:74
  confidence: high

- fires_on: Candidate profile texting compliance, submitting the PIN verification form
- url: /dashboard/profile
- disposition:
- reason:

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

## Briefing Assistant - Agenda Submitted
  evidence:   packages/gp-webapp/app/dashboard/briefings/components/UploadAgendaModal.tsx:134
  confidence: high

- fires_on: Briefings page, submitting an agenda (file upload or URL) in the Upload Agenda modal
- url: /dashboard/briefings
- disposition:
- reason:

---

## Briefing Assistant - Briefing Viewed
  evidence:   packages/gp-webapp/app/dashboard/briefings/components/TrackBriefingViewed.tsx:10
  confidence: high

- fires_on: Briefing Assistant, viewing a briefing
- url: /dashboard/briefings
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

## Briefing Assistant - Download Clicked
  evidence:   packages/gp-webapp/app/dashboard/briefings/components/detail/ShareBriefingDrawer.tsx:177
  confidence: high

- fires_on: Briefing share drawer, clicking Download to save the briefing as a PDF.
- url: /dashboard/briefings
- disposition:
- reason:

---

## Briefing Assistant - Feedback Completed
  evidence:   packages/gp-webapp/app/dashboard/briefings/components/detail/FeedbackRow.tsx:49
  confidence: high

- fires_on: Briefing detail page, giving thumbs up/down feedback on a briefing item.
- url: /dashboard/briefings
- disposition:
- reason:

---

## Briefing Assistant - List Viewed
  evidence:   packages/gp-webapp/app/dashboard/briefings/components/TrackBriefingListViewed.tsx:8
  confidence: high

- fires_on: Serve Briefings section, viewing the briefings list screen
- url: /dashboard/briefings
- disposition:
- reason:

---

## Briefing Assistant - Share Completed
  evidence:   packages/gp-webapp/app/dashboard/briefings/components/detail/ShareBriefingDrawer.tsx:140
  confidence: high

- fires_on: Briefing share drawer, clicking the copy-link button to share a briefing.
- url: /dashboard/briefings
- disposition:
- reason:

---

## Briefing Assistant - Share Drawer Opened
  evidence:   packages/gp-webapp/app/dashboard/briefings/components/detail/ShareBriefingDrawer.tsx:109
  confidence: high

- fires_on: Briefing detail page, opening the Share drawer for a briefing.
- url: /dashboard/briefings
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

## Briefing Assistant - TOC Item Clicked
  evidence:   packages/gp-webapp/app/dashboard/briefings/components/detail/DetailToc.tsx:101
  confidence: high

- fires_on: Briefing detail page, clicking an item in the table of contents to jump to that section.
- url: /dashboard/briefings
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

## Campaign Plan - Campaign Tracker Viewed
  evidence:   packages/gp-webapp/app/dashboard/campaign-plan/components/campaignStrategy/CampaignStrategySection.tsx:118
  confidence: high

- fires_on: Campaign Plan page, campaign tracker section rendering with tasks, fires automatically when viewed
- url: /dashboard/campaign-plan
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

## Campaign Story - Rewrite Accepted
  evidence:   packages/gp-webapp/app/dashboard/campaign-story/components/useStoryRewrite.ts:93
  confidence: high

- fires_on: Dashboard Campaign Story page, accepting an AI-rewritten story field
- url: /dashboard/campaign-story
- disposition:
- reason:

---

## Campaign Story - Rewrite Discarded
  evidence:   packages/gp-webapp/app/dashboard/campaign-story/components/useStoryRewrite.ts:112
  confidence: high

- fires_on: Campaign Story editor, discarding an AI rewrite (undo)
- url: /dashboard/campaign-story
- disposition:
- reason:

---

## Campaign Story - Rewrite Requested
  evidence:   packages/gp-webapp/app/dashboard/campaign-story/components/useStoryRewrite.ts:72
  confidence: high

- fires_on: Dashboard Campaign Story page, clicking to request an AI rewrite of a story field
- url: /dashboard/campaign-story
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

## Candidacy - Did You Win Modal Completed
  evidence:   packages/gp-webapp/app/dashboard/election-result/components/ElectionResultPage.tsx:156
  confidence: high

- fires_on: Election result page, submitting the 'Did you win?' modal with a lost-election selection
- url: /dashboard/election-result
- disposition:
- reason:

---

## Candidacy - Did You Win Modal Viewed
  evidence:   packages/gp-webapp/app/dashboard/election-result/components/ElectionResultPage.tsx:257
  confidence: high

- fires_on: Election Result page, automatically fires when the 'Did you win?' modal/screen is viewed.
- url: /dashboard/election-result
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

## Community Issues - Issue Detail Viewed
  evidence:   packages/gp-webapp/app/dashboard/community-issues/components/IssueDetail.tsx:81
  confidence: high

- fires_on: Community Issues page, automatically fires when a user opens the detail view for a specific issue.
- url: /dashboard/community-issues
- disposition:
- reason:

---

## Community Issues - List Viewed
  evidence:   packages/gp-webapp/app/dashboard/community-issues/components/IssueFeedList.tsx:144
  confidence: high

- fires_on: Serve dashboard, viewing the Community Issues feed
- url: /dashboard/community-issues
- disposition:
- reason:

---

## Community Issues - Prioritize Clicked
  evidence:   packages/gp-webapp/app/dashboard/community-issues/components/PrioritizeButton.tsx:21
  confidence: high

- fires_on: Community Issues dashboard, clicking 'Add to my priorities' on an issue.
- url: /dashboard/community-issues
- disposition:
- reason:

---

## Community Issues - Run Poll Clicked
  evidence:   packages/gp-webapp/app/dashboard/community-issues/components/IssueDetail.tsx:267
  confidence: high

- fires_on: Community Issues detail page, clicking "Run a poll on this issue" next-step card
- url: /dashboard/community-issues
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

## Contacts - Contacts Viewed
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/CrmContactsPage.tsx:51
  confidence: high

- fires_on: Contacts screen (CRM view) in the dashboard, fires automatically when the page loads
- url: /dashboard/contacts
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

## Contacts - List Wizard Conditions Viewed
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/wizard/CreateListWizard.tsx:52
  confidence: high

- fires_on: Contacts CRM, reaching the conditions stage of the create-list wizard.
- url: /dashboard
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

## Contacts - List Wizard Method Viewed
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/wizard/CreateListWizard.tsx:51
  confidence: high

- fires_on: Contacts CRM, opening the create-list wizard on its first (method-choice) stage.
- url: /dashboard
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

## Contacts - Segment Deleted
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/lists/DeleteListDialog.tsx:73
  confidence: high

- fires_on: Contacts/CRM lists page, confirming deletion of a saved contact segment/list.
- url: /dashboard/contacts
- disposition:
- reason:

---

## Contacts - Segment Updated
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/wizard/CreateListWizard.tsx:472
  confidence: high

- fires_on: Contacts CRM segment editor, saving edits to a segment's filters/criteria (the 'List updated' confirmation).
- url: /dashboard/contacts
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

## Contacts - Voter Data Unavailable
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/CrmContactsPage.tsx:65
  confidence: high

- fires_on: Contacts page, automatically fires when the voter district can't be resolved and the page falls back to a support handoff message.
- url: /dashboard/contacts
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

## Dashboard - Path to Victory: Exit Understand Path to Victory
  evidence:   packages/gp-webapp/app/dashboard/components/campaignManager/CountsInfoModal.tsx:66
  confidence: high

- fires_on: Dashboard Path to Victory info modal, closing the 'Projected votes needed to win' dialog
- url: /dashboard
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

## Door Knocking - Door Logged
  evidence:   packages/gp-webapp/app/dashboard/door-knocking/native/RecordKnockForm.tsx:156
  confidence: high

- fires_on: Door Knocking native record-knock form, submitting a logged door interaction outcome.
- url: /dashboard/door-knocking
- disposition:
- reason:

---

## Door Knocking - List Created
  evidence:   packages/gp-webapp/app/dashboard/door-knocking/native/createFlow/CreateListFlow.tsx:738
  confidence: high

- fires_on: Door knocking list-creation flow, finish building a turf/list and route
- url: /dashboard/door-knocking
- disposition:
- reason:

---

## Door Knocking - List Deleted
  evidence:   packages/gp-webapp/app/dashboard/door-knocking/native/DeleteTurfControl.tsx:68
  confidence: high

- fires_on: Door Knocking lists page, confirming deletion of a turf/list
- url: /dashboard/door-knocking
- disposition:
- reason:

---

## Door Knocking - List Edited
  evidence:   packages/gp-webapp/app/dashboard/door-knocking/native/EditTurfDialog.tsx:68
  confidence: high

- fires_on: Door Knocking turf list, saving an edit (rename/recolor) in the Edit Turf dialog
- url: /dashboard/door-knocking
- disposition:
- reason:

---

## Door Knocking - Not A Voter Reason Set
  evidence:   packages/gp-webapp/app/dashboard/door-knocking/native/NotAVoterControl.tsx:59
  confidence: high

- fires_on: Door knocking canvassing app, marking a resident's 'not a voter' reason on a stop.
- url: /dashboard/door-knocking
- disposition:
- reason:

---

## Door Knocking - Route Build Failed
  evidence:   packages/gp-webapp/app/dashboard/door-knocking/native/createFlow/CreateListFlow.tsx:762
  confidence: high

- fires_on: Door Knocking, route build request fails after drawing a turf/list
- url: /dashboard/door-knocking
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

## Door Knocking - Session Abandoned
  evidence:   packages/gp-webapp/app/dashboard/door-knocking/native/useWalkSession.ts:61
  confidence: high

- fires_on: Door knocking native walk session, session ends with zero doors logged
- url: /dashboard/door-knocking
- disposition:
- reason:

---

## Door Knocking - Session Completed
  evidence:   packages/gp-webapp/app/dashboard/door-knocking/native/useWalkSession.ts:65
  confidence: high

- fires_on: Door knocking native walk session, ending a walk after logging at least one door.
- url: /dashboard/door-knocking
- disposition:
- reason:

---

## Door Knocking - Session Started
  evidence:   packages/gp-webapp/app/dashboard/door-knocking/native/useWalkSession.ts:40
  confidence: high

- fires_on: Door Knocking native walk view, automatically fires when a canvasser starts a walk session (entering the turf/walk view).
- url: /dashboard/door-knocking
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

## Onboarding - Candidate Office Completed
  evidence:   packages/gp-webapp/app/onboarding/[slug]/[step]/components/OfficeStep.tsx:191
  confidence: high

- fires_on: Onboarding flow, Office step, completing the office selection step.
- url: /onboarding/[slug]/[step]
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

## Onboarding - Magic Link Clicked
  evidence:   packages/gp-webapp/app/serve/welcome/ServeWelcomeContent.tsx:114
  confidence: high

- fires_on: Serve welcome/onboarding landing page, arriving after clicking a magic-link sign-in email
- url: /serve/welcome
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

## Onboarding - Office Step: Click Next
  evidence:   packages/gp-webapp/app/onboarding/[slug]/[step]/components/OfficeStep.tsx:108
  confidence: high

- fires_on: Onboarding office-selection step, click 'Next' to save the selected office
- url: /onboarding/[slug]/[step]
- disposition:
- reason:

---

## Onboarding - Office Step: Office Selected
  evidence:   packages/gp-webapp/app/onboarding/[slug]/[step]/components/OfficeStep.tsx:235
  confidence: high

- fires_on: Onboarding flow, Office step, selecting an office/race
- url: /onboarding/[slug]/[step]
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

## Onboarding V2 - Ballot Status Viewed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:552
  confidence: high

- fires_on: Onboarding flow, Ballot Status screen shown when the user reaches that step
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

## Onboarding V2 - Pledge Viewed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:561
  confidence: high

- fires_on: Onboarding V2 flow, arriving at the Pledge step.
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

## Onboarding V2 - Votes Needed Failed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:528
  confidence: high

- fires_on: Onboarding flow, when the votes-needed (win number) calculation fails
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

## Onboarding V2 - Welcome Completed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:971
  confidence: high

- fires_on: Onboarding flow, Welcome screen, clicking Next/Continue to complete the welcome step
- url: /onboarding
- disposition:
- reason:

---

## Onboarding V2 - Welcome Viewed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:551
  confidence: high

- fires_on: Onboarding flow, Welcome screen shown when a new user reaches the first step
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

## Onboarding V2 - Why Are You Running Completed
  evidence:   packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx:153
  confidence: high

- fires_on: Onboarding V2 flow, clicking Continue on the "Why are you running" campaign story step.
- url: /onboarding
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

## Ordinances - Authority Completed
  evidence:   packages/gp-webapp/app/dashboard/ordinances/components/OrdinanceFlowChat.tsx:68
  confidence: high

- fires_on: Ordinances drafting chat flow, fires when the user completes the Authority step
- url: /dashboard/ordinances
- disposition:
- reason:

---

## Ordinances - Authority Viewed
  evidence:   packages/gp-webapp/app/dashboard/ordinances/components/OrdinanceFlowChat.tsx:58
  confidence: high

- fires_on: Ordinances drafting chat flow, fires when the Authority step is viewed
- url: /dashboard/ordinances
- disposition:
- reason:

---

## Ordinances - Clarify Completed
  evidence:   packages/gp-webapp/app/dashboard/ordinances/components/OrdinanceFlowChat.tsx:67
  confidence: high

- fires_on: Ordinances drafting chat flow, fires when the user completes the Clarify step
- url: /dashboard/ordinances
- disposition:
- reason:

---

## Ordinances - Clarify Viewed
  evidence:   packages/gp-webapp/app/dashboard/ordinances/components/OrdinanceFlowChat.tsx:57
  confidence: high

- fires_on: Ordinances chat flow, viewing the clarify step of the drafting conversation
- url: /dashboard/ordinances
- disposition:
- reason:

---

## Ordinances - Current Law Completed
  evidence:   packages/gp-webapp/app/dashboard/ordinances/components/OrdinanceFlowChat.tsx:69
  confidence: high

- fires_on: Ordinances drafting chat flow, fires when the user completes the Current Law step
- url: /dashboard/ordinances
- disposition:
- reason:

---

## Ordinances - Current Law Viewed
  evidence:   packages/gp-webapp/app/dashboard/ordinances/components/OrdinanceFlowChat.tsx:59
  confidence: high

- fires_on: Ordinances drafting chat flow, fires when the Current Law step is viewed
- url: /dashboard/ordinances
- disposition:
- reason:

---

## Ordinances - Draft Creation Completed
  evidence:   packages/gp-webapp/app/dashboard/ordinances/components/OrdinanceFlowChat.tsx:251
  confidence: high

- fires_on: Ordinances draft chat, fires automatically once the assistant finishes generating a draft ordinance widget in the conversation.
- url: /dashboard/ordinances
- disposition:
- reason:

---

## Ordinances - Draft Creation Viewed
  evidence:   packages/gp-webapp/app/dashboard/ordinances/components/OrdinanceFlowChat.tsx:61
  confidence: high

- fires_on: Ordinances draft chat, viewing the Draft Creation step of the ordinance flow.
- url: /dashboard/ordinances
- disposition:
- reason:

---

## Ordinances - Draft Details Downloaded
  evidence:   packages/gp-webapp/app/dashboard/ordinances/components/DraftDetail.tsx:321
  confidence: high

- fires_on: Ordinances draft detail page, clicking Export/Download on a draft (Word or PDF)
- url: /dashboard/ordinances
- disposition:
- reason:

---

## Ordinances - Draft Details Status Updated
  evidence:   packages/gp-webapp/app/dashboard/ordinances/components/DraftDetail.tsx:357
  confidence: high

- fires_on: Ordinances draft detail page, changing the draft's status (e.g. draft/published) selector
- url: /dashboard/ordinances
- disposition:
- reason:

---

## Ordinances - Draft Details Viewed
  evidence:   packages/gp-webapp/app/dashboard/ordinances/components/DraftDetail.tsx:167
  confidence: high

- fires_on: Ordinances draft detail page (opened from the draft-ready chat card or the ordinances list), fires when the draft is viewed
- url: /dashboard/ordinances
- disposition:
- reason:

---

## Ordinances - How Others Solved It Completed
  evidence:   packages/gp-webapp/app/dashboard/ordinances/components/OrdinanceFlowChat.tsx:70
  confidence: high

- fires_on: Ordinances chat flow, completing the 'How Others Solved It' (comparables) step by advancing to the next step.
- url: /dashboard/ordinances
- disposition:
- reason:

---

## Ordinances - How Others Solved It Viewed
  evidence:   packages/gp-webapp/app/dashboard/ordinances/components/OrdinanceFlowChat.tsx:60
  confidence: high

- fires_on: Ordinances drafting chat flow, fires when the How Others Solved It (comparables) step is viewed
- url: /dashboard/ordinances
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

## Outreach - Click Create
  evidence:   packages/gp-webapp/app/dashboard/outreach/components/OutreachComposeDeepLink.tsx:121
  confidence: high

- fires_on: Outreach page, clicking Create/Continue to start composing an outreach campaign via a deep link
- url: /dashboard/outreach
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

## Outreach - Phone Banking: Call Logged
  evidence:   packages/gp-webapp/app/dashboard/outreach/phone-banking/[listId]/PhoneBankingOutcomeForm.tsx:77
  confidence: high

- fires_on: Phone banking call session page, log the outcome of a call to a contact
- url: /dashboard/outreach/phone-banking/[listId]
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

## Outreach - Phone Banking: Contact Viewed
  evidence:   packages/gp-webapp/app/dashboard/outreach/phone-banking/[listId]/PhoneBankingEntryPanel.tsx:110
  confidence: high

- fires_on: Phone banking list page, viewing a contact's entry panel
- url: /dashboard/outreach/phone-banking/[listId]
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

## Outreach - View Accessed
  evidence:   packages/gp-webapp/app/dashboard/outreach/v2/OutreachHubPage.tsx:217
  confidence: high

- fires_on: Voter Outreach hub page, loading the outreach dashboard view.
- url: /dashboard/outreach
- disposition:
- reason:

---

## P2P Upgrade - Modal: Click Button
  evidence:   packages/gp-webapp/app/dashboard/shared/P2PUpgradeModal.tsx:96
  confidence: high

- fires_on: Dashboard P2P upgrade modal, click the modal's main CTA button
- url: /dashboard
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

## P2P Upgrade - Modal: Modal Shown
  evidence:   packages/gp-webapp/app/dashboard/shared/P2PUpgradeModal.tsx:78
  confidence: high

- fires_on: Dashboard, the P2P upgrade modal is displayed
- url: /dashboard
- disposition:
- reason:

---

## Payment - Completed
  evidence:   packages/gp-webapp/app/dashboard/polls/[id]/expand-payment/components/ExpandPaymentPage.tsx:47
  confidence: high

- fires_on: Serve poll expansion payment page, completing the purchase.
- url: /dashboard/polls/[id]/expand-payment
- disposition:
- reason:

---

## Payment - Schedule and Pay Viewed
  evidence:   packages/gp-webapp/app/dashboard/polls/create/CreatePoll.tsx:600
  confidence: high

- fires_on: Create Poll flow, Schedule and Pay step is viewed
- url: /dashboard/polls/create
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

## Polls - Add Image Completed
  evidence:   packages/gp-webapp/app/dashboard/polls/create/CreatePoll.tsx:503
  confidence: high

- fires_on: Create Poll flow, clicking Next after choosing (or skipping) an image
- url: /dashboard/polls/create
- disposition:
- reason:

---

## Polls - Add Image Viewed
  evidence:   packages/gp-webapp/app/dashboard/polls/create/CreatePoll.tsx:492
  confidence: high

- fires_on: Create Poll flow, viewing the add-image step
- url: /dashboard/polls/create
- disposition:
- reason:

---

## Polls - Audience Selection Completed
  evidence:   packages/gp-webapp/app/dashboard/polls/create/CreatePoll.tsx:450
  confidence: high

- fires_on: Create Poll flow, clicking Next after selecting the audience size
- url: /dashboard/polls/create
- disposition:
- reason:

---

## Polls - Audience Selection Viewed
  evidence:   packages/gp-webapp/app/dashboard/polls/create/CreatePoll.tsx:401
  confidence: high

- fires_on: Create poll flow, viewing the audience selection step
- url: /dashboard/polls/create
- disposition:
- reason:

---

## Polls - Constituent Data Unavailable Viewed
  evidence:   packages/gp-webapp/app/dashboard/polls/shared/ConstituentDataUnavailable.tsx:21
  confidence: high

- fires_on: Polls surface (onboarding, create, or expand poll), viewing the 'constituent data unavailable' blocking message
- url: /dashboard/polls
- disposition:
- reason:

---

## Polls - Create Poll Clicked
  evidence:   packages/gp-webapp/app/dashboard/polls/components/PollsPage.tsx:37
  confidence: high

- fires_on: Polls page, clicking the "Create Poll" button
- url: /dashboard/polls
- disposition:
- reason:

---

## Polls - Low Confidence Modal Clicked
  evidence:   packages/gp-webapp/app/dashboard/polls/[id]/components/PollsDetailPage.tsx:48
  confidence: high

- fires_on: Poll detail page, clicking a button in the low-confidence results modal
- url: /dashboard/polls/[id]
- disposition:
- reason:

---

## Polls - Poll Bias Detection Shown
  evidence:   packages/gp-webapp/app/dashboard/polls/shared/components/poll-text-bias/PollTextInput.tsx:44
  confidence: high

- fires_on: Poll creation, a bias/grammar warning is shown while writing the poll question text
- url: /dashboard/polls
- disposition:
- reason:

---

## Polls - Poll Preview Completed
  evidence:   packages/gp-webapp/app/dashboard/polls/create/CreatePoll.tsx:559
  confidence: high

- fires_on: Create Poll flow, Poll Preview step, clicking "Yes, Checkout"
- url: /dashboard/polls/create
- disposition:
- reason:

---

## Polls - Poll Preview Viewed
  evidence:   packages/gp-webapp/app/dashboard/polls/create/CreatePoll.tsx:542
  confidence: high

- fires_on: Create Poll flow, viewing the poll preview/review step
- url: /dashboard/polls/create
- disposition:
- reason:

---

## Polls - Poll Question Completed
  evidence:   packages/gp-webapp/app/dashboard/polls/create/CreatePoll.tsx:228
  confidence: high

- fires_on: Create Poll flow, clicking Select Audience after completing the poll question/details step
- url: /dashboard/polls/create
- disposition:
- reason:

---

## Polls - Poll Question Optimized
  evidence:   packages/gp-webapp/app/dashboard/polls/shared/components/poll-text-bias/PollTextBiasInput.tsx:228
  confidence: high

- fires_on: Poll creation flow, clicking to AI-optimize a poll question's text.
- url: /dashboard/polls
- disposition:
- reason:

---

## Polls - Poll Question Viewed
  evidence:   packages/gp-webapp/app/dashboard/polls/create/CreatePoll.tsx:233
  confidence: high

- fires_on: Poll creation flow, view the poll question step
- url: /dashboard/polls/create
- disposition:
- reason:

---

## Polls - Poll Results Issue Details Viewed
  evidence:   packages/gp-webapp/app/dashboard/polls/[id]/issue/[issueIndex]/components/PollIssueDetailPage.tsx:23
  confidence: high

- fires_on: Poll issue detail page, viewing the details for a specific poll issue.
- url: /dashboard/polls/[id]/issue/[issueIndex]
- disposition:
- reason:

---

## Polls - Poll Results Overview Viewed
  evidence:   packages/gp-webapp/app/dashboard/polls/[id]/components/PollsDetailPage.tsx:30
  confidence: high

- fires_on: Poll detail page, view the poll results overview
- url: /dashboard/polls/[id]
- disposition:
- reason:

---

## Polls - Schedule Poll Completed
  evidence:   packages/gp-webapp/app/dashboard/polls/create/CreatePoll.tsx:367
  confidence: high

- fires_on: Create Poll flow, clicking Next after choosing the poll's send date
- url: /dashboard/polls/create
- disposition:
- reason:

---

## Polls - Schedule Poll Viewed
  evidence:   packages/gp-webapp/app/dashboard/polls/create/CreatePoll.tsx:352
  confidence: high

- fires_on: Create poll flow, viewing the schedule/date selection step
- url: /dashboard/polls/create
- disposition:
- reason:

---

## Pro Upgrade - Banner Viewed
  evidence:   packages/gp-webapp/app/dashboard/components/campaignManager/ProUpgradeBanner.tsx:21
  confidence: high

- fires_on: Candidate dashboard, viewing the Pro upgrade banner shown to non-Pro candidates on the dashboard.
- url: /dashboard
- disposition:
- reason:

---

## Pro Upgrade - Banner: Click Get Pro
  evidence:   packages/gp-webapp/app/dashboard/components/campaignManager/ProUpgradeBanner.tsx:30
  confidence: high

- fires_on: Dashboard, clicking "Get Pro" on the Pro upgrade promotional banner.
- url: /dashboard
- disposition:
- reason:

---

## Pro Upgrade - Candidate Profile Submitted
  evidence:   packages/gp-webapp/app/dashboard/profile/texting-compliance/candidate-profile/useCandidateProfileForm.ts:150
  confidence: high

- fires_on: Candidate Profile texting-compliance page, successfully saving the candidate profile submission
- url: /dashboard/profile/texting-compliance/candidate-profile
- disposition:
- reason:

---

## Pro Upgrade - Candidate Profile Viewed
  evidence:   packages/gp-webapp/app/dashboard/profile/texting-compliance/candidate-profile/useCandidateProfileForm.ts:124
  confidence: high

- fires_on: Pro Upgrade flow's Candidate Profile step, viewing the candidate profile form
- url: /dashboard/profile/texting-compliance/candidate-profile
- disposition:
- reason:

---

## Pro Upgrade - Committee Check Page: Hover "EIN number" help
  evidence:   packages/gp-webapp/app/dashboard/shared/EinCheckInput.tsx:40
  confidence: high

- fires_on: Dashboard EIN/committee-check input, hovering the "EIN number" help tooltip
- url: /dashboard
- disposition:
- reason:

---

## Pro Upgrade - EIN Viewed
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/EinStep.tsx:49
  confidence: high

- fires_on: Pro Upgrade wizard, viewing the EIN screen.
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - EIN: Click continue
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/EinStep.tsx:108
  confidence: high

- fires_on: Pro Upgrade wizard, EIN step, clicking Continue after successfully saving the EIN
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - EIN: Hover help
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/EinStep.tsx:158
  confidence: high

- fires_on: Pro Upgrade EIN step, hovering the help tooltip on the EIN field
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - Filing Details Submit Error
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/FilingDetailsStep.tsx:459
  confidence: high

- fires_on: Pro Upgrade filing details step, submitting the filing details form and getting a server rejection
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - Filing Details Submitted
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/FilingDetailsStep.tsx:447
  confidence: high

- fires_on: Pro Upgrade wizard, Filing Details step, submitting the registration form
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - Filing Details Viewed
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/FilingDetailsStep.tsx:435
  confidence: high

- fires_on: Pro Upgrade wizard, viewing the Filing Details screen.
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - Filing Instructions Viewed
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/FilingInstructionsStep.tsx:51
  confidence: high

- fires_on: Pro Upgrade flow, automatically fires when the Filing Instructions screen is viewed.
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - Filing Instructions: Click continue to dashboard
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/FilingInstructionsStep.tsx:119
  confidence: high

- fires_on: Pro Upgrade filing instructions page, clicking the exit/continue-to-dashboard control
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - Filing Instructions: Click email this to me
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/FilingInstructionsStep.tsx:102
  confidence: high

- fires_on: Pro Upgrade Filing Instructions step, clicking "email this to me"
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - Filing Status Viewed
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/FilingStatusStep.tsx:52
  confidence: high

- fires_on: Pro Upgrade wizard, viewing the Filing Status screen.
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - Filing Status: Click already filed
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/FilingStatusStep.tsx:33
  confidence: high

- fires_on: Pro Upgrade flow, clicking 'Yes, I'm already filed' on the Filing Status screen
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - Filing Status: Click not yet filed
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/FilingStatusStep.tsx:40
  confidence: high

- fires_on: Pro Upgrade flow, Filing Status step, clicking 'No, not yet' (not yet filed).
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - Guidance Viewed
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/GuidanceStep.tsx:58
  confidence: high

- fires_on: Pro Upgrade flow, viewing the 'Guidance' interstitial screen
- url: /dashboard/pro-upgrade
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

## Pro Upgrade - Locked Item: Click
  evidence:   packages/gp-webapp/app/dashboard/outreach/v2/ChannelTileGrid.tsx:122
  confidence: high

- fires_on: Outreach hub, click a locked (Pro-only) outreach channel tile like Texting or Phone Banking
- url: /dashboard/outreach
- disposition:
- reason:

---

## Pro Upgrade - Modal: Click Button
  evidence:   packages/gp-webapp/app/dashboard/shared/ProUpgradeModal.tsx:163
  confidence: high

- fires_on: Dashboard, clicking the upgrade button inside the Pro upgrade modal
- url: /dashboard
- disposition:
- reason:

---

## Pro Upgrade - Modal: Exit
  evidence:   packages/gp-webapp/app/dashboard/shared/ProUpgradeModal.tsx:149
  confidence: high

- fires_on: Dashboard, closing the Pro Upgrade upsell modal.
- url: /dashboard
- disposition:
- reason:

---

## Pro Upgrade - Modal: Modal Shown
  evidence:   packages/gp-webapp/app/dashboard/shared/ProUpgradeModal.tsx:138
  confidence: high

- fires_on: Dashboard, Pro upgrade modal shown to the user (system-triggered popup)
- url: /dashboard
- disposition:
- reason:

---

## Pro Upgrade - PIN Entry Viewed
  evidence:   packages/gp-webapp/app/dashboard/profile/texting-compliance-agentic/components/ProUpgrade3PinEntry.tsx:48
  confidence: high

- fires_on: Dashboard profile page, viewing the texting compliance PIN entry card.
- url: /dashboard/profile
- disposition:
- reason:

---

## Pro Upgrade - Payment Viewed
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/PaymentStep.tsx:144
  confidence: high

- fires_on: Pro Upgrade flow, viewing the 'Payment' checkout screen
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - Success Viewed
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/SuccessStep.tsx:40
  confidence: high

- fires_on: Pro Upgrade wizard, Success step, viewing the post-payment success screen
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - Success: Click continue
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/SuccessStep.tsx:57
  confidence: high

- fires_on: Pro Upgrade success screen, clicking Continue to return to the dashboard
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - Texting Setup Banner Viewed
  evidence:   packages/gp-webapp/app/dashboard/components/campaignManager/TextingSetupBanner.tsx:35
  confidence: high

- fires_on: Dashboard, viewing the "Finish your texting setup" banner prompting a Pro candidate to complete 10DLC texting compliance.
- url: /dashboard
- disposition:
- reason:

---

## Pro Upgrade - Texting Setup Banner: Click Start
  evidence:   packages/gp-webapp/app/dashboard/components/campaignManager/TextingSetupBanner.tsx:44
  confidence: high

- fires_on: Dashboard texting-setup banner, click 'Start registration' to begin 10DLC election-filing
- url: /dashboard
- disposition:
- reason:

---

## Pro Upgrade - Value Prop Viewed
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/ValuePropStep.tsx:87
  confidence: high

- fires_on: Pro Upgrade flow, viewing the 'Value Prop' screen
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - Value Prop: Click Get Pro
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/ValuePropStep.tsx:91
  confidence: high

- fires_on: Pro Upgrade wizard, Value Prop step, clicking Get Pro
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade - Value Prop: Click Maybe later
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/ValuePropStep.tsx:96
  confidence: high

- fires_on: Pro Upgrade value proposition screen, clicking 'Maybe later'
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Pro Upgrade: Click exit top nav
  evidence:   packages/gp-webapp/app/dashboard/pro-upgrade/components/ProUpgradeWizard.tsx:95
  confidence: high

- fires_on: Pro Upgrade flow, clicking the 'Exit' link in the wizard's top nav
- url: /dashboard/pro-upgrade
- disposition:
- reason:

---

## Profile - Campaign Details: Click Save
  evidence:   packages/gp-webapp/app/dashboard/campaign-details/components/cards/AboutMeDialog.tsx:98
  confidence: high

- fires_on: Campaign details page, clicking Save in the About Me dialog
- url: /dashboard/campaign-details
- disposition:
- reason:

---

## Profile - Candidate Profile: Click Submit
  evidence:   packages/gp-webapp/app/dashboard/profile/texting-compliance/candidate-profile/useCandidateProfileForm.ts:141
  confidence: high

- fires_on: Candidate Profile texting-compliance page, clicking Submit
- url: /dashboard/profile/texting-compliance/candidate-profile
- disposition:
- reason:

---

## Profile - Office Details: Click Edit
  evidence:   packages/gp-webapp/app/dashboard/campaign-details/components/cards/OfficeDetailsCard.tsx:111
  confidence: high

- fires_on: Campaign Details page, Office Details card, clicking Edit
- url: /dashboard/campaign-details
- disposition:
- reason:

---

## Profile - Office Details: Click Save
  evidence:   packages/gp-webapp/app/dashboard/campaign-details/components/cards/OfficeDetailsCard.tsx:116
  confidence: high

- fires_on: Campaign Details page, Office Details card, clicking Save after editing office details.
- url: /dashboard/campaign-details
- disposition:
- reason:

---

## Profile - Policy Priorities: Cancel Add
  evidence:   packages/gp-webapp/app/dashboard/profile/texting-compliance/candidate-profile/components/PolicyPriorities.tsx:62
  confidence: high

- fires_on: Candidate profile Policy Priorities section, clicking Cancel while adding a new priority
- url: /dashboard/profile/texting-compliance/candidate-profile
- disposition:
- reason:

---

## Profile - Policy Priorities: Cancel Edit
  evidence:   packages/gp-webapp/app/dashboard/profile/texting-compliance/candidate-profile/components/PolicyPriorities.tsx:61
  confidence: high

- fires_on: Candidate profile texting-compliance page, canceling an edit in the policy priorities modal
- url: /dashboard/profile/texting-compliance/candidate-profile
- disposition:
- reason:

---

## Profile - Policy Priorities: Click Add
  evidence:   packages/gp-webapp/app/dashboard/profile/texting-compliance/candidate-profile/components/PolicyPriorities.tsx:48
  confidence: high

- fires_on: Candidate profile page, clicking 'Add' on the Policy Priorities section
- url: /dashboard/profile/texting-compliance/candidate-profile
- disposition:
- reason:

---

## Profile - Policy Priorities: Click Delete
  evidence:   packages/gp-webapp/app/dashboard/profile/texting-compliance/candidate-profile/components/PolicyPriorities.tsx:84
  confidence: high

- fires_on: Candidate profile page, clicking Delete on a policy priority issue in the edit modal.
- url: /dashboard/profile/texting-compliance/candidate-profile
- disposition:
- reason:

---

## Profile - Policy Priorities: Click Edit
  evidence:   packages/gp-webapp/app/dashboard/profile/texting-compliance/candidate-profile/components/PolicyPriorities.tsx:53
  confidence: high

- fires_on: Candidate Profile page, Policy Priorities section, clicking Edit on an existing priority.
- url: /dashboard/profile/texting-compliance/candidate-profile
- disposition:
- reason:

---

## Profile - Policy Priorities: Submit Add
  evidence:   packages/gp-webapp/app/dashboard/profile/texting-compliance/candidate-profile/components/PolicyPriorities.tsx:76
  confidence: high

- fires_on: Candidate Profile texting-compliance page, Policy Priorities section, saving a newly added priority in the add modal
- url: /dashboard/profile/texting-compliance/candidate-profile
- disposition:
- reason:

---

## Profile - Policy Priorities: Submit Delete
  evidence:   packages/gp-webapp/app/dashboard/profile/texting-compliance/candidate-profile/components/PolicyPriorities.tsx:96
  confidence: high

- fires_on: Candidate profile page, confirming deletion of a policy priority issue.
- url: /dashboard/profile/texting-compliance/candidate-profile
- disposition:
- reason:

---

## Profile - Policy Priorities: Submit Edit
  evidence:   packages/gp-webapp/app/dashboard/profile/texting-compliance/candidate-profile/components/PolicyPriorities.tsx:71
  confidence: high

- fires_on: Candidate profile texting-compliance page, save an edited policy priority in the edit modal
- url: /dashboard/profile/texting-compliance/candidate-profile
- disposition:
- reason:

---

## Profile - Running Against: Click Add New
  evidence:   packages/gp-webapp/app/dashboard/campaign-details/components/RunningAgainstSection.tsx:97
  confidence: high

- fires_on: Campaign details page, click 'Add New Opponent' in the Running Against section
- url: /dashboard/campaign-details
- disposition:
- reason:

---

## Profile - Running Against: Click Edit
  evidence:   packages/gp-webapp/app/dashboard/campaign-details/components/RunningAgainstCard.tsx:34
  confidence: high

- fires_on: Campaign details page, clicking edit on an opponent in the Running Against card
- url: /dashboard/campaign-details
- disposition:
- reason:

---

## Profile - Running Against: Click Save
  evidence:   packages/gp-webapp/app/dashboard/campaign-details/components/RunningAgainstSection.tsx:30
  confidence: high

- fires_on: Campaign details page, clicking Save on the Running Against opponent info section
- url: /dashboard/campaign-details
- disposition:
- reason:

---

## Profile - Running Against: Submit Add New
  evidence:   packages/gp-webapp/app/dashboard/campaign-details/components/RunningAgainstSection.tsx:89
  confidence: high

- fires_on: Campaign details page, submit the new opponent form in the Running Against section
- url: /dashboard/campaign-details
- disposition:
- reason:

---

## Profile - Running Against: Submit Edit
  evidence:   packages/gp-webapp/app/dashboard/campaign-details/components/RunningAgainstCard.tsx:23
  confidence: high

- fires_on: Campaign details page, saving an edited opponent entry in the Running Against card
- url: /dashboard/campaign-details
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

## Serve Onboarding - Add Image Viewed
  evidence:   packages/gp-webapp/app/polls/onboarding/components/steps/AddImageStep.tsx:13
  confidence: high

- fires_on: Serve onboarding flow, viewing the 'Add Image' step for the poll text message.
- url: /polls/onboarding
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

## Serve Onboarding - Confirm Viewed
  evidence:   packages/gp-webapp/app/serve/onboarding/serveOnboardingAnalytics.ts:23
  confidence: high

- fires_on: Serve onboarding flow, Confirm step is viewed
- url: /serve/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Constituency Profile Viewed
  evidence:   packages/gp-webapp/app/polls/onboarding/components/steps/InsightsStep.tsx:24
  confidence: high

- fires_on: Serve onboarding insights step, viewing the constituency profile/insights screen.
- url: /polls/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Getting Started Viewed
  evidence:   packages/gp-webapp/app/polls/onboarding/components/OnboardingPage.tsx:151
  confidence: high

- fires_on: Serve onboarding flow, viewing the first 'Getting Started' step.
- url: /polls/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Know Your Constituents Completed
  evidence:   packages/gp-webapp/app/serve/onboarding/serveOnboardingAnalytics.ts:27
  confidence: high

- fires_on: Serve onboarding flow, Know Your Constituents step is completed
- url: /serve/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Know Your Constituents Viewed
  evidence:   packages/gp-webapp/app/serve/onboarding/serveOnboardingAnalytics.ts:25
  confidence: high

- fires_on: Serve onboarding flow, Know Your Constituents step is viewed
- url: /serve/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Meet Your Constituents Viewed
  evidence:   packages/gp-webapp/app/polls/onboarding/loading-insights/components/LoadingInsightsPage.tsx:49
  confidence: high

- fires_on: Serve onboarding loading-insights screen, shown while constituency insights are being generated.
- url: /polls/onboarding/loading-insights
- disposition:
- reason:

---

## Serve Onboarding - Net New Completed
  evidence:   packages/gp-webapp/app/serve/onboarding/serveOnboardingAnalytics.ts:11
  confidence: high

- fires_on: Serve onboarding flow, the net-new onboarding is completed
- url: /serve/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Office Completed
  evidence:   packages/gp-webapp/app/serve/onboarding/serveOnboardingAnalytics.ts:22
  confidence: high

- fires_on: Serve onboarding flow, clicking Continue on the Office selection step.
- url: /serve/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Office Status Viewed
  evidence:   packages/gp-webapp/app/serve/onboarding/serveOnboardingAnalytics.ts:19
  confidence: high

- fires_on: Serve onboarding flow, viewing the Office Status step
- url: /serve/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Office Viewed
  evidence:   packages/gp-webapp/app/serve/onboarding/serveOnboardingAnalytics.ts:21
  confidence: high

- fires_on: Serve onboarding flow, Office step is viewed
- url: /serve/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Party Designation Viewed
  evidence:   packages/gp-webapp/app/serve/onboarding/serveOnboardingAnalytics.ts:20
  confidence: high

- fires_on: Serve onboarding flow, viewing the Party Designation step
- url: /serve/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Pledge Completed
  evidence:   packages/gp-webapp/app/serve/onboarding/serveOnboardingAnalytics.ts:29
  confidence: high

- fires_on: Serve onboarding flow, Pledge step is completed
- url: /serve/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Pledge Viewed
  evidence:   packages/gp-webapp/app/serve/onboarding/serveOnboardingAnalytics.ts:28
  confidence: high

- fires_on: Serve onboarding flow, Pledge step is viewed
- url: /serve/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Poll Preview Viewed
  evidence:   packages/gp-webapp/app/polls/onboarding/components/steps/PreviewStep.tsx:12
  confidence: high

- fires_on: Serve onboarding flow, viewing the poll preview / review step.
- url: /polls/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Poll Strategy Viewed
  evidence:   packages/gp-webapp/app/polls/onboarding/components/steps/StrategyStep.tsx:17
  confidence: high

- fires_on: Serve onboarding flow, viewing the free introductory poll strategy step.
- url: /polls/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Poll Value Props Viewed
  evidence:   packages/gp-webapp/app/polls/onboarding/components/steps/OutreachStep.tsx:7
  confidence: high

- fires_on: Serve onboarding flow, viewing the poll value proposition / outreach benefits step.
- url: /polls/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Sworn In Completed
  evidence:   packages/gp-webapp/app/polls/hooks/useOnboarding.ts:151
  confidence: high

- fires_on: Serve onboarding flow, submitting the sworn-in date on the 'Sworn In' step.
- url: /polls/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Sworn In Viewed
  evidence:   packages/gp-webapp/app/polls/onboarding/components/steps/SwornInStep.tsx:14
  confidence: high

- fires_on: Serve onboarding flow, viewing the 'when were you sworn in' step.
- url: /polls/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Term Dates Viewed
  evidence:   packages/gp-webapp/app/serve/onboarding/serveOnboardingAnalytics.ts:24
  confidence: high

- fires_on: Serve onboarding flow, Term Dates step is viewed
- url: /serve/onboarding
- disposition:
- reason:

---

## Serve Onboarding - Welcome Viewed
  evidence:   packages/gp-webapp/app/serve/onboarding/serveOnboardingAnalytics.ts:18
  confidence: high

- fires_on: Serve onboarding flow, viewing the Welcome step
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

## Settings - Account Settings: Click Upgrade
  evidence:   packages/gp-webapp/app/dashboard/profile/components/AccountSettingsButton.tsx:47
  confidence: high

- fires_on: Profile/account settings page, click 'Upgrade Plan' button
- url: /dashboard/profile
- disposition:
- reason:

---

## Settings - Delete Account: Cancel Delete
  evidence:   packages/gp-webapp/app/dashboard/account/components/DeleteAccountPage.tsx:112
  confidence: high

- fires_on: Account settings page, clicking Cancel in the 'Are you sure?' delete account confirmation dialog.
- url: /dashboard/account
- disposition:
- reason:

---

## Settings - Delete Account: Click Delete
  evidence:   packages/gp-webapp/app/dashboard/account/components/DeleteAccountPage.tsx:79
  confidence: high

- fires_on: Account settings page, click 'Delete Account' button
- url: /dashboard/account
- disposition:
- reason:

---

## Settings - Delete Account: Submit Delete
  evidence:   packages/gp-webapp/app/dashboard/account/components/DeleteAccountPage.tsx:34
  confidence: high

- fires_on: Account settings page, confirming account deletion in the delete-account dialog
- url: /dashboard/account
- disposition:
- reason:

---

## Settings - Notifications: Toggle Email
  evidence:   packages/gp-webapp/app/dashboard/profile/components/NotificationSection.tsx:124
  confidence: high

- fires_on: Profile/settings page, toggling an email notification setting
- url: /dashboard/profile
- disposition:
- reason:

---

## Settings - Personal Info: Click Upload
  evidence:   packages/gp-webapp/app/dashboard/campaign-details/components/cards/UploadAvatarDialog.tsx:75
  confidence: high

- fires_on: Campaign Details page, avatar upload dialog, clicking to save/upload a new profile photo.
- url: /dashboard/campaign-details
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

## Sign Up: Click Login
  evidence:   packages/gp-webapp/app/sign-up/SignUpForm.tsx:343
  confidence: high

- fires_on: Sign-up page, click 'Log In' link for existing account
- url: /sign-up
- disposition:
- reason:

---

## Team - Invite Modal Opened
  evidence:   packages/gp-webapp/app/dashboard/team/components/InviteMemberDialog.tsx:49
  confidence: high

- fires_on: Team management page, opening the Invite Member dialog.
- url: /dashboard/team
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

## Voter Data - Contact Searched
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/useContactTypeaheadSearch.ts:89
  confidence: high

- fires_on: Dashboard Contacts (CRM) page, searching for a contact via the search box
- url: /dashboard/contacts/crm
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

## Voter Data - Contact Viewed
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/person/PersonOverlay.tsx:417
  confidence: high

- fires_on: Contacts CRM, opening a voter's contact record overlay.
- url: /dashboard
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

## Voter Data - Send Outreach Clicked
  evidence:   packages/gp-webapp/app/dashboard/contacts/crm/lists/ListCard.tsx:160
  confidence: high

- fires_on: Contacts CRM list card, clicking "Send outreach" to start a campaign from that list.
- url: /dashboard
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

## Voter Outreach - 10DLC Compliance Modal Viewed
  evidence:   packages/gp-webapp/app/dashboard/outreach/hooks/useTextOutreachGate.tsx:31
  confidence: high

- fires_on: Voter outreach setup, the 10DLC texting compliance modal appearing when a Pro candidate isn't texting-compliant
- url: /dashboard/outreach
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

## Voter Outreach - 10DLC Compliance Started
  evidence:   packages/gp-webapp/app/dashboard/outreach/components/OutreachComposeDeepLink.tsx:139
  confidence: high

- fires_on: Outreach compose flow, starting 10DLC compliance when a non-Pro user tries a Pro-gated outreach type
- url: /dashboard/outreach
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

## Voter Outreach - Phone Banking Call List Created
  evidence:   packages/gp-webapp/app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow.tsx:315
  confidence: high

- fires_on: Phone banking outreach flow, successfully create a call list
- url: /dashboard/outreach
- disposition:
- reason:

---

## Voter Outreach - Phone Banking Call Sheet Downloaded
  evidence:   packages/gp-webapp/app/dashboard/outreach/phone-banking/[listId]/PhoneBankingCallerPage.tsx:292
  confidence: high

- fires_on: Phone banking caller page, clicking the PDF download button for the call sheet
- url: /dashboard/outreach/phone-banking/[listId]
- disposition:
- reason:

---

## Voter Outreach - Recommended List Accepted
  evidence:   packages/gp-webapp/app/dashboard/door-knocking/native/createFlow/CreateListFlow.tsx:417
  confidence: high

- fires_on: Door Knocking create-list flow, accepting a recommended voter list.
- url: /dashboard/door-knocking
- disposition:
- reason:

---

## Win - Opponent Profile Viewed
  evidence:   packages/gp-webapp/app/dashboard/race-opponent/components/OpponentResearch.tsx:204
  confidence: high

- fires_on: Dashboard Race & Opponent page, opponent research Handbook rendering after research completes
- url: /dashboard/race-opponent
- disposition:
- reason:

---

## Win - Opponent Research Started
  evidence:   packages/gp-webapp/app/dashboard/race-opponent/components/RaceOpponentList.tsx:595
  confidence: high

- fires_on: Race/Opponent Research page, automatically fires when an opponent research run starts (via Collect button, manual opponent submission, or auto-dispatch on Pro upgrade).
- url: /dashboard/race-opponent
- disposition:
- reason:

---

## Win - Opponent Standout Action Clicked
  evidence:   packages/gp-webapp/app/dashboard/race-opponent/components/StandoutActionsSection.tsx:50
  confidence: high

- fires_on: Race opponent page, clicking the Send-SMS CTA on a stand-out action card
- url: /dashboard/race-opponent
- disposition:
- reason:

---

## Win - Opponent Standout Actions Viewed
  evidence:   packages/gp-webapp/app/dashboard/race-opponent/components/StandoutActionsSection.tsx:38
  confidence: high

- fires_on: Race opponent brief page, viewing the stand-out action cards section
- url: /dashboard/race-opponent
- disposition:
- reason:

---

## Win - Opponent Upgrade Viewed
  evidence:   packages/gp-webapp/app/dashboard/race-opponent/components/OpponentProLockedView.tsx:70
  confidence: high

- fires_on: Race opponent research page, viewing the locked 'Unlock opponent research with Pro' upgrade screen for non-Pro candidates
- url: /dashboard/race-opponent
- disposition:
- reason:

---

## Win - Opponents Manually Added
  evidence:   packages/gp-webapp/app/dashboard/race-opponent/components/RaceOpponentList.tsx:440
  confidence: high

- fires_on: Race opponent research page, submitting the manual opponent-entry form when no opponents were auto-discovered
- url: /dashboard/race-opponent
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

## question_complete
  evidence:   packages/gp-webapp/app/dashboard/questions/components/Done.tsx:11
  confidence: high

- fires_on: Campaign questions flow, reaching the completed 'You're all set!' screen
- url: /dashboard/questions
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
