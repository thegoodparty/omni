# Feature map

Where each product area lives in code. Use it to go from a tab name, a URL or a
screenshot in a bug report to the page, the API behind it, the flags that gate it,
the test user state that reaches it, and the Playwright spec to extend.

Every entry was traced through the code, not copied from other docs. "unknown"
means the trace did not settle it; fix it when you learn the answer.

- **Reach it** names a gp-api test-fixtures state (`POST /v1/test-fixtures/users`,
  see `packages/gp-api/src/testFixtures/AGENTS.md`) that can open the page.
- **Keeping it current:** `npm run feature-map:check` fails CI when a path here no
  longer exists, a dashboard nav id is missing or gone, or a folder under
  `packages/gp-webapp/app/` or `packages/gp-webapp/app/dashboard/` has no entry.
  A PostToolUse hook runs the same check when an agent edits a webapp page or this
  file. Update the entry in the same PR as the change.

## Shared by Win and Serve

### Campaign Manager home

- Nav: `campaign-tracker-dashboard`
- Modes: win
- Route: `/dashboard` -> `packages/gp-webapp/app/dashboard/`
- Route: `/dashboard` (home components) -> `packages/gp-webapp/app/dashboard/campaign-manager/`
- API: `packages/gp-api/src/chats/` (`POST /v1/chats`, `GET /v1/chats`, `GET /v1/chats/:id`), `packages/gp-api/src/campaigns/campaignTracker/` (`GET /v1/campaigns/tracker-tasks`), `packages/gp-api/src/campaigns/tcrCompliance/` (`GET /v1/campaigns/tcr-compliance/mine`), `packages/gp-api/src/electedOffice/` (`GET /v1/elected-office/current`), `packages/gp-api/src/campaigns/` (`GET /v1/campaigns/mine/status`)
- Contracts: `packages/contracts/src/chats/Chat.schema.ts`
- Reach it: fixture state `free-win` | `pro-win`
- E2E: `packages/gp-webapp/e2e-tests/tests/app/dashboard/dashboard.spec.ts`, `packages/gp-webapp/e2e-tests/tests/app/campaign-manager/campaign-manager-attachments.spec.ts`, `packages/gp-webapp/e2e-tests/tests/app/organizations/dashboard-regression.spec.ts`
- Docs: `packages/gp-webapp/app/dashboard/AGENTS.md`, `packages/gp-api/src/campaigns/AGENTS.md`
- Notes: `campaign-manager/` has no page.tsx. `/dashboard` is `packages/gp-webapp/app/dashboard/page.tsx` -> `packages/gp-webapp/app/dashboard/components/DashboardContent.tsx` -> `CampaignManagerHome`. The page redirects to `/dashboard/chief-of-staff` when the org has a current elected office, so `serve` fixtures never land here. Nav and layout live in `packages/gp-webapp/app/dashboard/shared/`; the chat client is `packages/gp-webapp/app/dashboard/shared/agent-chat/chatClient.ts`.

### Contacts

- Nav: `contacts-dashboard`, `win-contacts-dashboard`
- Modes: both
- Route: `/dashboard/contacts` -> `packages/gp-webapp/app/dashboard/contacts/`
- API: `packages/gp-api/src/contacts/` (`GET /v1/contacts`, `GET /v1/contacts/:id`, `POST /v1/contacts/count`, `GET /v1/contacts/list-detail`, `POST /v1/contacts/list-detail`, `POST /v1/contacts/overlap-count`, `POST /v1/contacts/points`, `POST /v1/contacts/polygon-preview`, `GET /v1/contacts/precincts`, `GET /v1/contacts/:personId/notes`, `POST /v1/contacts/:personId/notes`, `PATCH /v1/contacts/notes/:noteId`, `DELETE /v1/contacts/notes/:noteId`, `PATCH /v1/contacts/:personId/status`, `PATCH /v1/contacts/:personId/follow-up`), `packages/gp-api/src/voters/` (`GET /v1/voters/voter-file/filters`, `POST /v1/voters/voter-file/filter`, `PUT /v1/voters/voter-file/filter/:id`, `DELETE /v1/voters/voter-file/filter/:id`), `packages/gp-api/src/contactEngagement/` (`GET /v1/contact-engagement/:id/activities`, `GET /v1/contact-engagement/:id/issues`), `packages/gp-api/src/recommendedLists/` (`GET /v1/campaigns/mine/recommended-lists`), `packages/gp-api/src/constituentFeedback/` (`GET /v1/constituent-feedback`), `packages/gp-api/src/outreach/` (`GET /v1/outreach`)
- Contracts: `packages/contracts/src/people/`, `packages/contracts/src/recommendedLists/`
- Flags: `serve-contacts-activities-and-issues` (activities and issues sections in the person overlay, read in `packages/gp-webapp/app/dashboard/contacts/crm/person/PersonOverlay.tsx`)
- Reach it: fixture state `pro-win` | `serve` (free-win reaches the page but hits the Pro gate; `canUseProFeatures` is `isPro || electedOffice` in `packages/gp-webapp/app/dashboard/contacts/crm/ContactsTableProvider.tsx`)
- E2E: `packages/gp-webapp/e2e-tests/tests/app/contacts/`, `packages/gp-webapp/e2e-tests/tests/app/organizations/contacts-org-scoping.spec.ts`
- Docs: `packages/gp-webapp/app/dashboard/contacts/AGENTS.md`, `packages/gp-api/src/contacts/AGENTS.md`, `packages/gp-api/src/voters/AGENTS.md`
- Notes: Win and Serve share one route and component tree (`packages/gp-webapp/app/dashboard/contacts/crm/`); only the nav id and labels differ. Serve is protected by the district gate in `packages/gp-webapp/app/dashboard/shared/useDistrictResolution.ts`, not the Pro gate.

### Profile and texting compliance

- Nav: `campaign-details-dashboard`, `nav-dash-profile`
- Modes: both
- Route: `/dashboard/profile` -> `packages/gp-webapp/app/dashboard/profile/`
- Route: `/dashboard/profile/texting-compliance` -> `packages/gp-webapp/app/dashboard/profile/texting-compliance/`
- Route: `/dashboard/profile/texting-compliance-agentic` -> `packages/gp-webapp/app/dashboard/profile/texting-compliance-agentic/`
- API: `packages/gp-api/src/campaigns/tcrCompliance/` (`GET /v1/campaigns/tcr-compliance/mine/compliance-state`, `POST /v1/campaigns/tcr-compliance/agentic`, `POST /v1/campaigns/tcr-compliance/:tcrComplianceId/submit-cv-pin`, plus create and fetch), `packages/gp-api/src/users/` (`PUT /v1/users/me/metadata`), `packages/gp-api/src/campaignStory/` (`POST /v1/campaigns/mine/story/rewrite`)
- Reach it: fixture state `free-win` | `pro-win` | `serve`; texting compliance flow needs a campaign without a completed TCR registration
- E2E: `packages/gp-webapp/e2e-tests/tests/app/profile/`
- Docs: `packages/gp-api/src/campaigns/tcrCompliance/AGENTS.md`
- Notes: Nav label is "My Profile" but the id is `campaign-details-dashboard`, not a profile id.

### Account settings

- Nav: `nav-dash-account`
- Modes: both
- Route: `/dashboard/account` -> `packages/gp-webapp/app/dashboard/account/`
- API: `packages/gp-api/src/users/` (`DELETE /v1/users/:id`)
- Reach it: any signed-in fixture; unauthenticated users are redirected to `/login`
- E2E: none
- Notes: The account dropdown also holds `nav-dash-team` and `nav-log-out`; logout is mapped under Sign in and sign up.

### Onboarding

- Nav: none
- Modes: both
- Route: `/onboarding/[slug]` -> `packages/gp-webapp/app/onboarding/`
- API: `packages/gp-api/src/campaigns/` (`GET /v1/campaigns/mine`, `POST /v1/campaigns/launch`, `GET /v1/campaigns/mine/plan-version`, `POST /v1/campaigns/follow-on`, `POST /v1/campaigns/mine/plan-pdf-share`), `packages/gp-api/src/onboarding/` (`GET /v1/onboarding/voter-issues`, `GET /v1/onboarding/local-news`, `GET /v1/onboarding/contacts/stats`), `packages/gp-api/src/organizations/` (`GET /v1/organizations`, `PATCH /v1/organizations/:slug`), `packages/gp-api/src/campaignStory/` (`PUT /v1/campaigns/mine/story`), `packages/gp-api/src/campaignStrategy/` (`POST /v1/campaignStrategy/mine/strategic-landscape`), `packages/gp-api/src/elections/` (`GET /v1/elections/race-by-position`, `GET /v1/elections/races-by-year`), `packages/gp-api/src/contacts/` (`GET /v1/contacts/stats`)
- Reach it: none-fits (all fixtures are launched campaigns; needs a fresh signup with no campaign)
- E2E: `packages/gp-webapp/e2e-tests/tests/core/auth/onboarding.spec.ts`, `packages/gp-webapp/e2e-tests/tests/core/auth/office-picker-28806.spec.ts`, `packages/gp-webapp/e2e-tests/tests/core/auth/custom-office.spec.ts`, `packages/gp-webapp/e2e-tests/tests/app/serve/serve-onboarding.spec.ts`
- Docs: `packages/gp-webapp/app/onboarding/AGENTS.md`, `packages/gp-api/src/campaigns/AGENTS.md`

### Issue capture (what we heard)

- Nav: none
- Modes: both
- Route: `/dashboard/issue-capture/[outreachId]` -> `packages/gp-webapp/app/dashboard/issue-capture/`
- Route: `/dashboard/issue-capture/[outreachId]/theme/[themeId]` -> `packages/gp-webapp/app/dashboard/issue-capture/[outreachId]/theme/`
- Route: `/dashboard/issue-capture/[outreachId]/review` -> `packages/gp-webapp/app/dashboard/issue-capture/[outreachId]/review/`
- API: `packages/gp-api/src/constituentFeedback/` (`GET /v1/constituent-feedback/efforts/:outreachId/report`, `GET /v1/constituent-feedback/pending`, `GET /v1/constituent-feedback/themes/:id`, `GET /v1/constituent-feedback/tags`)
- Flags: `issue-capture` (gates every page and the gp-api routes, read in `packages/gp-webapp/app/dashboard/issue-capture/issueCaptureAccess.ts` via `packages/gp-webapp/app/shared/experiments/issueCaptureFlag.ts`)
- Reach it: any fixture state with the `issue-capture` flag forced on (gate is `candidateAccess` plus the flag, no Pro check); needs an outreach effort with phone-banking notes to show anything
- E2E: `packages/gp-webapp/e2e-tests/tests/app/dashboard/issue-capture/issue-capture-flag-off.spec.ts`
- Docs: `packages/gp-webapp/app/dashboard/issue-capture/AGENTS.md`, `packages/gp-api/src/constituentFeedback/AGENTS.md`
- Notes: Reached from links on outreach results, not the nav. Win vs Serve copy is chosen from the org slug (`eo-` prefix). A flag-off visit redirects to `/dashboard`.

### Help and community links

- Nav: `nav-dash-support`, `community-dashboard`, `nav-dash-community`
- Modes: both
- API: none
- Reach it: any fixture state
- E2E: none
- Notes: No route in this repo. `nav-dash-support` opens the support chat widget (`packages/gp-webapp/app/shared/utils/supportWidget.ts`); the two community ids open the external Circle forum in a new tab.

## Win (candidates)

### Campaign plan

- Nav: `campaign-plan-dashboard`
- Modes: win
- Route: `/dashboard/campaign-plan` -> `packages/gp-webapp/app/dashboard/campaign-plan/`
- API: `packages/gp-api/src/campaigns/campaignTracker/` (`GET /v1/campaigns/tracker-tasks`, `POST /v1/campaigns/tracker-tasks/generate`, `PUT /v1/campaigns/tracker-tasks/complete/:id`, `DELETE /v1/campaigns/tracker-tasks/complete/:id`)
- Contracts: `packages/contracts/src/campaigns/CampaignTaskCatalog.schema.ts`
- Reach it: fixture state `free-win`
- E2E: `packages/gp-webapp/e2e-tests/tests/app/campaign-story/campaign-story-flow.spec.ts`
- Docs: `packages/gp-api/src/campaigns/campaignTracker/AGENTS.md`
- Notes: `useTrackerTasks` lives under `packages/gp-webapp/app/dashboard/campaign-plan/components/campaignStrategy/` and is also used by the Campaign Manager home.

### Your story

- Nav: `campaign-story-dashboard`
- Modes: win
- Route: `/dashboard/campaign-story` -> `packages/gp-webapp/app/dashboard/campaign-story/`
- API: `packages/gp-api/src/campaignStory/` (`GET /v1/campaigns/mine/story`, `PUT /v1/campaigns/mine/story`, `POST /v1/campaigns/mine/story/rewrite`)
- Contracts: `packages/contracts/src/campaigns/CampaignStory.schema.ts`
- Reach it: fixture state `free-win`
- E2E: `packages/gp-webapp/e2e-tests/tests/app/campaign-story/campaign-story-flow.spec.ts`
- Docs: `packages/gp-webapp/app/dashboard/campaign-story/AGENTS.md`
- Notes: form is shared with onboarding and fetches its own data client-side; page.tsx only gates access.

### Voter outreach

- Nav: `outreach-dashboard`
- Modes: win
- Route: `/dashboard/outreach` -> `packages/gp-webapp/app/dashboard/outreach/`
- Route: `/dashboard/outreach/phone-banking/[listId]` -> `packages/gp-webapp/app/dashboard/outreach/phone-banking/`
- API: `packages/gp-api/src/outreach/` (`GET /v1/outreach`, `GET /v1/outreach/:id`, `GET /v1/outreach/:id/results`, `PATCH /v1/outreach/:id/archive`, `DELETE /v1/outreach/:id`, `GET /v1/outreach/:id/assignments`), `packages/gp-api/src/phoneBanking/` (`GET /v1/phone-banking/lists/:id`, `DELETE /v1/phone-banking/lists/:id`), `packages/gp-api/src/campaigns/tcrCompliance/` (`GET /v1/campaigns/tcr-compliance/mine`), `packages/gp-api/src/contacts/` (`POST /v1/contacts/count`, `GET /v1/contacts/list-detail`, `GET /v1/contacts/precincts`), `packages/gp-api/src/constituentFeedback/` (`POST /v1/constituent-feedback`)
- Contracts: `packages/contracts/src/campaigns/CampaignTaskCatalog.schema.ts`, `packages/contracts/src/chats/ComposeHandoff.schema.ts`, `packages/contracts/src/constituentFeedback/FeedbackSynthesis.schema.ts`, `packages/contracts/src/outreach/SmsAdminConsole.schema.ts`, `packages/contracts/src/doorKnocking/DoorKnockingTurf.schema.ts`
- Flags: `outreach-pro-gating-v2` (admits free campaigns into compose flows, read in `packages/gp-webapp/app/dashboard/outreach/v2/gate/useOutreachGate.ts`, `packages/gp-webapp/app/dashboard/outreach/v2/OutreachHubPage.tsx`, `packages/gp-webapp/app/dashboard/outreach/v2/ChannelTileGrid.tsx`), `issue-capture` (issue capture in phone banking outcome form, read in `packages/gp-webapp/app/dashboard/outreach/phone-banking/[listId]/PhoneBankingOutcomeForm.tsx`)
- Reach it: fixture state `pro-win` (free-win sees Pro gating unless `outreach-pro-gating-v2` is on); phone banking route needs a saved phone-banking list
- E2E: `packages/gp-webapp/e2e-tests/tests/app/dashboard/outreach/`, `packages/gp-webapp/e2e-tests/tests/app/dashboard/issue-capture/issue-capture-flag-off.spec.ts`
- Docs: `packages/gp-webapp/app/dashboard/outreach/AGENTS.md`, `packages/gp-api/src/outreach/AGENTS.md`
- Notes: page redirects to the marketing `/run-for-office` when the user has no campaign. Serve users use `/dashboard/constituent-outreach` instead, but serve endpoints (`GET /v1/outreach/serve/:id`) are called from components in this dir.

### Campaign verification (texting)

- Nav: none
- Modes: win
- Route: `/dashboard/campaign-verification` -> `packages/gp-webapp/app/dashboard/campaign-verification/`
- API: `packages/gp-api/src/campaigns/tcrCompliance/` (`POST /v1/campaigns/tcr-compliance/agentic`), `packages/gp-api/src/campaigns/` (`GET /v1/campaigns/mine`, `PUT /v1/campaigns/mine`)
- Flags: `outreach-pro-gating-v2` (whole page behind FeatureFlagGuard, read in `packages/gp-webapp/app/dashboard/campaign-verification/page.tsx`)
- Reach it: fixture state `free-win` plus `outreach-pro-gating-v2` on
- E2E: none
- Docs: `packages/gp-api/src/campaigns/tcrCompliance/AGENTS.md`
- Notes: form reused from `packages/gp-webapp/app/dashboard/profile/texting-compliance/election-filing/components/ElectionFilingForm.tsx`.

### Door knocking

- Nav: none
- Modes: both
- Route: `/dashboard/door-knocking` -> `packages/gp-webapp/app/dashboard/door-knocking/`
- Route: `/dashboard/door-knocking/print/[turfId]` -> `packages/gp-webapp/app/dashboard/door-knocking/print/`
- API: `packages/gp-api/src/doorKnocking/` (`GET /v1/door-knocking/turfs`, `POST /v1/door-knocking/turfs`, `GET /v1/door-knocking/turfs/:id/route`, `POST /v1/door-knocking/turfs/:id/route`, `POST /v1/door-knocking/interactions`, `POST /v1/door-knocking/audience-check`, `GET /v1/door-knocking/serve/turfs`, `GET /v1/door-knocking/campaigns/:anchorId`), `packages/gp-api/src/outreach/` (`POST /v1/outreach/door-knocking/draft`, `POST /v1/outreach/:id/assignments`), `packages/gp-api/src/contactNote/` (`GET /v1/contacts/:personId/notes`), `packages/gp-api/src/constituentFeedback/` (`POST /v1/constituent-feedback`)
- Contracts: `packages/contracts/src/doorKnocking/DoorKnockingTurf.schema.ts`, `packages/contracts/src/doorKnocking/DoorKnockingPack.schema.ts`, `packages/contracts/src/people/ContactNote.schema.ts`, `packages/contracts/src/chats/ChatCard.schema.ts`
- Flags: `outreach-pro-gating-v2` (admits free campaigns past the Pro lock, read in `packages/gp-webapp/app/dashboard/door-knocking/native/DoorKnockingPageGate.tsx`), `issue-capture` (read in `packages/gp-webapp/app/dashboard/door-knocking/native/RecordKnockForm.tsx`, `packages/gp-webapp/app/dashboard/door-knocking/native/createFlow/CreateListFlow.tsx`)
- Reach it: fixture state `pro-win` or `serve`; print route needs an existing turf
- E2E: `packages/gp-webapp/e2e-tests/tests/app/dashboard/door-knocking/`, `packages/gp-webapp/e2e-tests/tests/app/dashboard/dashboard-nav-door-knocking.spec.ts`, `packages/gp-webapp/e2e-tests/tests/app/dashboard/outreach/outreach-list-to-door-knocking.spec.ts`
- Docs: `packages/gp-webapp/app/dashboard/door-knocking/AGENTS.md`
- Notes: no nav tab; reached from outreach hub tiles and `?create=1` deep links. Non-Pro without elected office sees `DoorKnockingProLockedView`.

### Pro upgrade

- Nav: `upgrade-pro-dashboard`
- Modes: win
- Route: `/dashboard/pro-upgrade` -> `packages/gp-webapp/app/dashboard/pro-upgrade/`
- API: `packages/gp-api/src/campaigns/` (`GET /v1/campaigns/mine`, `GET /v1/campaigns/mine/filing-instructions`, `POST /v1/campaigns/mine/filing-instructions/email`, `POST /v1/campaigns/mine/ein-instructions/email`, `GET /v1/eligibility`), `packages/gp-api/src/campaigns/tcrCompliance/` (`POST /v1/campaigns/tcr-compliance/agentic`), `packages/gp-api/src/payments/` (`POST /v1/payments/purchase/checkout-session`, `GET /v1/payments/purchase/pro-receipt`)
- Contracts: `packages/contracts/src/payments/ProReceipt.schema.ts`, `packages/contracts/src/campaigns/CampaignTaskCatalog.schema.ts`
- Flags: `outreach-pro-gating-v2` (read in `packages/gp-webapp/app/dashboard/pro-upgrade/components/ProUpgradeWizard.tsx`, `packages/gp-webapp/app/dashboard/pro-upgrade/components/ProUpgradeEntry.tsx`)
- Reach it: fixture state `free-win`
- E2E: `packages/gp-webapp/e2e-tests/tests/app/dashboard/pro-upgrade/`
- Docs: `packages/gp-webapp/app/dashboard/pro-upgrade/AGENTS.md`, `packages/gp-api/src/payments/AGENTS.md`
- Notes: `upgrade-pro-dashboard` is only a placeholder while the elected-office query loads; it is then swapped for `win-contacts-dashboard` (Contacts). Index page has no UI, it redirects to a derived wizard step (value-prop, candidate-profile, filing-details, filing-instructions, ein, guidance, payment, status, success).

### Purchase checkout

- Nav: none
- Modes: win
- Route: `/dashboard/purchase` -> `packages/gp-webapp/app/dashboard/purchase/`
- API: `packages/gp-api/src/payments/` (`POST /v1/payments/purchase/create-checkout-session`, `POST /v1/payments/purchase/complete-checkout-session`, `POST /v1/payments/purchase/complete-free-purchase`)
- Reach it: fixture state `free-win` with `?type=` a valid PURCHASE_TYPES value (404 otherwise)
- E2E: `packages/gp-webapp/e2e-tests/tests/app/polls/polls-onboarding.spec.ts`
- Docs: `packages/gp-api/src/payments/AGENTS.md`

### Know your opponent

- Nav: `race-opponent-dashboard`
- Modes: win
- Route: `/dashboard/race-opponent` -> `packages/gp-webapp/app/dashboard/race-opponent/`
- API: `packages/gp-api/src/raceOpponent/` (`GET /v1/campaigns/mine/race-opponent`, `POST /v1/campaigns/mine/race-opponent/collect`, `POST /v1/campaigns/mine/race-opponent/opponents/identify`, `GET /v1/campaigns/mine/race-opponent/opponents/profile`, `POST /v1/campaigns/mine/race-opponent/self-research`, `POST /v1/campaigns/mine/race-opponent/contrasts/generate`)
- Contracts: `packages/contracts/src/raceOpponent/RaceOpponentRoutes.schema.ts`
- Reach it: fixture state `pro-win` (free-win gets `OpponentProLockedView`)
- E2E: none
- Docs: `packages/gp-webapp/app/dashboard/race-opponent/AGENTS.md`, `packages/gp-api/src/raceOpponent/AGENTS.md`

### Website builder

- Nav: none
- Modes: win
- Route: `/dashboard/website` -> `packages/gp-webapp/app/dashboard/website/`
- API: `packages/gp-api/src/websites/` (`GET /v1/websites/mine`, `POST /v1/websites`, `PUT /v1/websites/mine`, `GET /v1/websites/mine/contacts`, `GET /v1/domains/search`, `GET /v1/domains/status`, `DELETE /v1/domains/:id`)
- Reach it: fixture state `free-win`
- E2E: `packages/gp-webapp/e2e-tests/tests/app/website/website.spec.ts`
- Docs: `packages/gp-webapp/app/dashboard/website/AGENTS.md`, `packages/gp-api/src/websites/AGENTS.md`
- Notes: subroutes create, editor, domain. Domain purchase hands off to `/dashboard/purchase`.

### Additional questions

- Nav: none
- Modes: win
- Route: `/dashboard/questions` -> `packages/gp-webapp/app/dashboard/questions/`
- API: `packages/gp-api/src/campaigns/` (`GET /v1/campaigns/mine`, `PUT /v1/campaigns/mine`), `packages/gp-api/src/campaigns/positions/` (`GET /v1/campaigns/:id/positions`), `packages/gp-api/src/topIssues/` (`GET /v1/top-issues`)
- Reach it: fixture state `free-win`
- E2E: none
- Notes: issue helpers are imported from `packages/gp-webapp/app/dashboard/campaign-details/components/`.

### Campaign details (legacy redirect)

- Nav: none
- Modes: win
- Route: `/dashboard/campaign-details` -> `packages/gp-webapp/app/dashboard/campaign-details/`
- API: `packages/gp-api/src/campaigns/positions/` (`GET /v1/campaigns/:id/positions`, `POST /v1/campaigns/:id/positions`), `packages/gp-api/src/topIssues/` (`GET /v1/top-issues`, `GET /v1/top-issues/by-location`)
- Reach it: fixture state `free-win`
- E2E: none
- Notes: page.tsx just redirects to `/dashboard/profile`. Nav id `campaign-details-dashboard` links to `/dashboard/profile`, not here. The dir survives as a component library used by profile and questions.

### Election result

- Nav: none
- Modes: win
- Route: `/dashboard/election-result` -> `packages/gp-webapp/app/dashboard/election-result/`
- API: `packages/gp-api/src/electedOffice/` (`GET /v1/elected-office/mine`, `POST /v1/elected-office`), `packages/gp-api/src/organizations/` (`GET /v1/organizations`)
- Reach it: fixture state `free-win`
- E2E: `packages/gp-webapp/e2e-tests/tests/app/organizations/` (via `winRaceWithTermDates` in `packages/gp-webapp/e2e-tests/src/helpers/organizations.ts`)
- Notes: the "I won" path creates the elected office and promotes the user to Serve; `loss/` is the lost-race branch.

### Briefing admin review

- Nav: none
- Modes: serve
- Route: `/dashboard/admin-review/briefings/[slug]` -> `packages/gp-webapp/app/dashboard/admin-review/`
- API: `packages/gp-api/src/meetings/` (`GET /v1/meetings/:date/briefing`), `packages/gp-api/src/artifactReview/` (`GET /v1/meetings/:date/briefing/review-verdict`, `PUT /v1/meetings/:date/briefing/review-verdict`)
- Reach it: none-fits (needs `serve` plus staff impersonation and a generated briefing)
- E2E: none
- Notes: gated by `serveAccess` and `AdminReviewGate` (Clerk actor, impersonation only). Reuses briefing cards from `packages/gp-webapp/app/dashboard/briefings/components/`.

### Win welcome (magic link landing)

- Nav: none
- Modes: win
- Route: `/win/welcome` -> `packages/gp-webapp/app/win/`
- API: unknown (no gp-api call; redeems a Clerk sign-in token client-side)
- Reach it: none-fits (needs an unused Clerk sign-in link token)
- E2E: none

## Serve (elected officials)

### Chief of Staff

- Nav: `chief-of-staff-dashboard`
- Modes: serve
- Route: `/dashboard/chief-of-staff` -> `packages/gp-webapp/app/dashboard/chief-of-staff/`
- API: `packages/gp-api/src/chats/general/` (`GET /v1/chats`, `GET /v1/chats/:id`, `POST /v1/chats`, `DELETE /v1/chats/:id`, `GET /v1/chats/:conversationId/attachments`), `packages/gp-api/src/dashboardCards/` (`GET /v1/dashboard/cards`, `PUT /v1/dashboard/cards/:id/dismiss`, `GET /v1/dashboard/onboarding-cards`, `PUT /v1/dashboard/onboarding-cards/:key/skip`), `packages/gp-api/src/meetings/` (`GET /v1/meetings`, `POST /v1/meetings/dispatch-if-needed`), `packages/gp-api/src/voters/voterFile/` (`GET /v1/voters/voter-file/filters`, `POST /v1/voters/voter-file/filter`, `PUT /v1/voters/voter-file/filter/:id`, `GET /v1/voters/voter-file/filter/by-proposal-key/:proposalKey`), `packages/gp-api/src/electedOffice/` (`GET /v1/elected-office/support-estimate`), `packages/gp-api/src/contacts/` (`GET /v1/contacts`, `POST /v1/contacts/points`)
- Reach it: fixture state `serve`
- E2E: `packages/gp-webapp/e2e-tests/tests/app/chief-of-staff/`
- Docs: `packages/gp-api/src/meetings/AGENTS.md`, `packages/gp-api/src/voters/AGENTS.md`
- Notes: Page gated by `packages/gp-webapp/app/dashboard/shared/serveAccess.ts`, which redirects to /post-auth-redirect when the user owns an elected-office org that is not the selected one. `serve-chat-attachments-guard` in ChiefOfStaffChatBody.tsx is a localStorage key, not a flag.

### Briefing assistant

- Nav: `briefings-dashboard`
- Modes: serve
- Route: `/dashboard/briefings` -> `packages/gp-webapp/app/dashboard/briefings/`
- API: `packages/gp-api/src/meetings/` (`POST /v1/meetings/briefings/dispatch`), `packages/gp-api/src/chats/briefing-chats/` (`POST /v1/briefing-chats`), `packages/gp-api/src/speech/` (`POST /v1/speech/synthesize`), `packages/gp-api/src/electedOffice/` (`GET /v1/elected-office/current`)
- Reach it: fixture state `serve`; detail pages under [slug] need a meeting with a generated briefing
- E2E: `packages/gp-webapp/e2e-tests/tests/app/briefings/`
- Docs: `packages/gp-api/src/meetings/AGENTS.md`
- Notes: Gated by `packages/gp-webapp/app/dashboard/shared/serveAccess.ts`. Annotations and feedback controllers for briefings live in `packages/gp-api/src/annotations/` and `packages/gp-api/src/artifactFeedback/`.

### Community issues

- Nav: `community-issues-dashboard`
- Modes: serve
- Route: `/dashboard/community-issues` -> `packages/gp-webapp/app/dashboard/community-issues/`
- API: `packages/gp-api/src/communityIssues/` (`GET /v1/community-issues`, `GET /v1/community-issues/:id`, `POST /v1/community-issues/:id/prioritize`, `POST /v1/community-issues/self-dispatch`, `POST /v1/community-issues/dispatch-if-needed`)
- Reach it: fixture state `serve`; issue detail needs dispatched community issues
- E2E: `packages/gp-webapp/e2e-tests/tests/app/community-issues/`
- Docs: `packages/gp-webapp/app/dashboard/community-issues/AGENTS.md`, `packages/gp-api/src/communityIssues/AGENTS.md`
- Notes: Gated by serveAccess. Nav visibility is computed in DashboardMenu.tsx alongside the other Serve items.

### Constituent outreach

- Nav: `constituent-outreach-dashboard`
- Modes: serve
- Route: `/dashboard/constituent-outreach` -> `packages/gp-webapp/app/dashboard/constituent-outreach/`
- API: `packages/gp-api/src/outreach/` (`GET /v1/outreach/serve`, `GET /v1/outreach/serve/:id`, `POST /v1/outreach/serve/sms`, `POST /v1/outreach/serve/sms/draft`, `POST /v1/outreach/serve/social`, `POST /v1/outreach/serve/social/draft`, `POST /v1/outreach/serve/social/generate`, `POST /v1/outreach/serve/phone-banking/draft`, `PATCH /v1/outreach/:id/archive`), `packages/gp-api/src/phoneBanking/` (`POST /v1/phone-banking/serve/lists`), `packages/gp-api/src/doorKnocking/` (`POST /v1/door-knocking/turfs`, `GET /v1/door-knocking/serve/turfs`), `packages/gp-api/src/contacts/` (`POST /v1/contacts/count`, `GET /v1/contacts/list-detail`), `packages/gp-api/src/voters/voterFile/` (`GET /v1/voters/voter-file/filters`), `packages/gp-api/src/electedOffice/` (`GET /v1/elected-office/current`)
- Flags: `serve-sms-outreach` (gates the SMS channel card, read in `packages/gp-webapp/app/shared/experiments/serveSmsFlag.ts` via useServeSmsFlag)
- Reach it: fixture state `serve`
- E2E: `packages/gp-webapp/e2e-tests/tests/app/dashboard/constituent-outreach/`
- Docs: `packages/gp-webapp/app/dashboard/constituent-outreach/AGENTS.md`, `packages/gp-api/src/outreach/AGENTS.md`
- Notes: Serve outreach uses the `/v1/outreach/serve*` controllers (outreachServe*.controller.ts), not the Win `/v1/outreach` ones.

### Ordinances

- Nav: `ordinances-dashboard`
- Modes: serve
- Route: `/dashboard/ordinances` -> `packages/gp-webapp/app/dashboard/ordinances/`
- API: `packages/gp-api/src/ordinances/` (`GET /v1/ordinances`, `POST /v1/ordinances`, `GET /v1/ordinances/:slug`, `PATCH /v1/ordinances/:slug`, `DELETE /v1/ordinances/:slug`, `POST /v1/ordinances/:slug/clarify-answers`, `GET /v1/ordinances/:slug/quality-report`, `POST /v1/ordinances/:slug/quality-report`, `GET /v1/ordinances/:slug/quality-iterations`, `DELETE /v1/ordinances/:slug/quality-loop`), `packages/gp-api/src/annotations/` (`POST /v1/ordinances/:slug/annotations`), `packages/gp-api/src/priorities/` (`GET /v1/priorities`)
- Flags: `serve-ordinance-quality-loop` (gates quality loop UI in DraftDetail/DraftReadyWidget, read in `packages/gp-webapp/app/shared/experiments/ordinanceQualityLoopFlag.ts`)
- Reach it: fixture state `serve`; draft and solve pages need an existing ordinance slug
- E2E: `packages/gp-webapp/e2e-tests/tests/app/ordinances/`
- Docs: `packages/gp-api/src/ordinances/AGENTS.md`
- Notes: Nav item only shown when the elected-office check passes (`ordinancesShown` in DashboardMenu.tsx). Pages gated by serveAccess.

### Polls

- Nav: `polls-dashboard`
- Modes: serve
- Route: `/dashboard/polls` -> `packages/gp-webapp/app/dashboard/polls/`
- API: `packages/gp-api/src/polls/` (`GET /v1/polls`, `GET /v1/polls/:pollId`, `GET /v1/polls/:pollId/top-issues`, plus apiRoutes.polls.hasPolls, analyzeBias, imageUploadUrl), `packages/gp-api/src/contacts/` (`GET /v1/contacts/stats`)
- Reach it: fixture state `serve`; poll detail, issue and expand pages need a poll with results
- E2E: `packages/gp-webapp/e2e-tests/tests/app/polls/`, `packages/gp-webapp/e2e-tests/tests/app/organizations/dashboard-regression.spec.ts`
- Docs: `packages/gp-webapp/app/dashboard/polls/AGENTS.md`
- Notes: Gated by serveAccess. Expand flow (expand, expand-review, expand-payment, expand-payment-success) redirects back to /dashboard/polls or /expand on invalid state.

### Polls onboarding

- Nav: none
- Modes: unknown
- Route: `/polls/onboarding` -> `packages/gp-webapp/app/polls/`
- API: `packages/gp-api/src/polls/` (`POST /v1/polls/initial-poll`), `packages/gp-api/src/contacts/` (`GET /v1/contacts/stats`)
- Reach it: unknown; onboarding page calls requireAuth and candidateAccess, welcome page gating unknown
- E2E: `packages/gp-webapp/e2e-tests/tests/app/polls/polls-onboarding.spec.ts`
- Notes: Top-level route outside the dashboard shell (own layout with OnboardingProvider). Redirects to /dashboard/polls when done. Includes /polls/welcome and /polls/onboarding/success, loading-insights.

### Priorities

- Nav: `priorities-dashboard`
- Modes: serve
- Route: `/dashboard/priorities` -> `packages/gp-webapp/app/dashboard/priorities/`
- API: `packages/gp-api/src/priorities/` (`GET /v1/priorities`, `POST /v1/priorities`, `GET /v1/priorities/:id`, `PUT /v1/priorities/:id`, `DELETE /v1/priorities/:id`, `GET /v1/priorities/:id/status`), `packages/gp-api/src/communityIssues/` (`GET /v1/community-issues`, `POST /v1/community-issues/:id/prioritize`)
- Flags: `serve-priorities` (gates the whole segment server-side, redirects to /dashboard/chief-of-staff when off, read in `packages/gp-webapp/app/dashboard/priorities/layout.tsx`; also gates the nav item in DashboardMenu.tsx via useServePrioritiesFlag)
- Reach it: fixture state `serve` plus `serve-priorities` flag on
- E2E: none
- Docs: `packages/gp-webapp/app/dashboard/priorities/AGENTS.md`, `packages/gp-webapp/app/dashboard/priorities/[priorityId]/AGENTS.md`

### Public profile

- Nav: `public-profile-dashboard`, `public-profile-campaign`
- Modes: both
- Route: `/dashboard/public-profile` -> `packages/gp-webapp/app/dashboard/public-profile/`
- API: `packages/gp-api/src/personProfiles/` (`GET /v1/person-profiles/mine`, `POST /v1/person-profiles`, `PUT /v1/person-profiles/mine`, `PUT /v1/person-profiles/mine/issues`, `POST /v1/person-profiles/mine/publish`, `POST /v1/person-profiles/mine/unpublish`, `POST /v1/person-profiles/mine/upload-image`), `packages/gp-api/src/priorities/` (`GET /v1/priorities`, serve only), `packages/gp-api/src/electedOffice/` (apiRoutes.electedOffice.current)
- Reach it: fixture state `serve` or `free-win`
- E2E: `packages/gp-webapp/e2e-tests/tests/app/serve/public-profile-editor.spec.ts`
- Notes: Access decided by `packages/gp-webapp/app/dashboard/public-profile/publicProfileAccess.ts` (returns 'serve' or 'win', else redirects to /sign-up or /dashboard). Publishing needs a canonical personId (canCreate false until minted).

### Team

- Nav: `nav-dash-team`
- Modes: win
- Route: `/dashboard/team` -> `packages/gp-webapp/app/dashboard/team/`
- API: `packages/gp-api/src/organizations/` (`GET /v1/organizations/team`, `GET /v1/organizations/team/stats`, `POST /v1/organizations/team/invites`, `DELETE /v1/organizations/team/invites/:id`, `PATCH /v1/organizations/team/members/:userId`, `DELETE /v1/organizations/team/members/:userId`)
- Reach it: fixture state `free-win`
- E2E: `packages/gp-webapp/e2e-tests/tests/app/dashboard/team/`
- Docs: `packages/gp-webapp/app/dashboard/team/AGENTS.md`, `packages/gp-api/src/organizations/AGENTS.md`
- Notes: Lives in the account menu, not the primary rail (`nav-dash-team`, hidden for elected-office orgs). Page gated by `packages/gp-webapp/app/dashboard/shared/candidateAccess.ts`.

### Team invite acceptance

- Nav: none
- Modes: n/a
- Route: `/team-invite` -> `packages/gp-webapp/app/team-invite/`
- API: `packages/gp-api/src/organizations/` (`GET /v1/organizations/team/invites/mine`, `POST /v1/organizations/team/invites/accept`)
- Reach it: none-fits; needs a pending team invite for the signed-in user
- E2E: `packages/gp-webapp/e2e-tests/tests/app/dashboard/team/team-invite-ticket.spec.ts`
- Notes: Unauthenticated users are sent to /login?redirect_url=/team-invite.

### Volunteer shell

- Nav: none
- Modes: n/a
- Route: `/volunteer` -> `packages/gp-webapp/app/volunteer/`
- API: `packages/gp-api/src/outreach/` (`GET /v1/outreach/assignments/mine`), `packages/gp-api/src/doorKnocking/` (`GET /v1/door-knocking/turfs/:id`, `GET /v1/door-knocking/turfs/:id/route`, `GET /v1/door-knocking/pack`), `packages/gp-api/src/constituentFeedback/` (`GET /v1/constituent-feedback/pending`), `packages/gp-api/src/organizations/` (`DELETE /v1/organizations/team/members/me`)
- Flags: `issue-capture` (read via useIssueCaptureFlag in `packages/gp-webapp/app/shared/experiments/issueCaptureFlag.ts`, used by shared door-knocking components the volunteer pages render)
- Reach it: none-fits; needs a user whose active org role is volunteer (layout redirects others to /dashboard)
- E2E: `packages/gp-webapp/e2e-tests/tests/app/volunteer/`
- Docs: `packages/gp-api/src/constituentFeedback/AGENTS.md`
- Notes: Own sidebar shell, no candidateAccess. Door-knocking and phone-banking subpages reuse components from `packages/gp-webapp/app/dashboard/door-knocking/` and `packages/gp-webapp/app/dashboard/outreach/`.

### Serve onboarding

- Nav: none
- Modes: serve
- Route: `/serve/onboarding` -> `packages/gp-webapp/app/serve/`
- API: `packages/gp-api/src/electedOffice/` (`GET /v1/elected-office/current`, `GET /v1/elected-office/mine`, `POST /v1/elected-office`, `PUT /v1/elected-office/:id`), `packages/gp-api/src/organizations/` (`GET /v1/organizations/:slug`, `PATCH /v1/organizations/:slug`), election-api via apiRoutes.elections.racesByYear
- Reach it: none-fits; needs a signed-in user without a completed elected office (existing office redirects to /dashboard/chief-of-staff)
- E2E: `packages/gp-webapp/e2e-tests/tests/app/serve/serve-onboarding.spec.ts`
- Notes: Includes /serve/welcome. `serve-onboarding-positions` in ServeOfficePicker.tsx is a react-query key, not a flag.

## Auth, staff and dev routes

### Sign in and sign up

- Nav: none
- Modes: n/a
- Route: `/login` -> `packages/gp-webapp/app/login/`
- Route: `/sign-up` -> `packages/gp-webapp/app/sign-up/`
- Route: `/logout` -> `packages/gp-webapp/app/logout/`
- Route: `/post-auth-redirect` -> `packages/gp-webapp/app/post-auth-redirect/`
- Route: `/sign-in-link` -> `packages/gp-webapp/app/sign-in-link/`
- API: unknown (no gpApi route calls in these dirs; auth is Clerk client-side, post-auth routing logic in `packages/gp-webapp/helpers/resolvePostAuthRedirectPath.util.ts`)
- Reach it: none-fits (signed-out browser)
- E2E: `packages/gp-webapp/e2e-tests/tests/core/auth/login.spec.ts`, `packages/gp-webapp/e2e-tests/tests/core/auth/signup.spec.ts`
- Docs: `packages/gp-api/src/authentication/AGENTS.md`

### Staff tools (impersonate, admin components)

- Nav: none
- Modes: n/a
- Route: `/impersonate` -> `packages/gp-webapp/app/impersonate/`
- Route: none (no page.tsx) -> `packages/gp-webapp/app/admin/`
- API: `packages/gp-api/src/authentication/` (`POST /v1/authentication/send-set-password-email`, from `packages/gp-webapp/app/admin/shared/sendSetPasswordEmail.ts`)
- Reach it: none-fits (staff user)
- E2E: none
- Docs: `packages/gp-webapp/app/admin/AGENTS.md`
- Notes: `app/admin/` holds only shared admin components, not routable pages.

### Dev-only and infra routes

- Nav: none
- Modes: n/a
- Route: `/dev/briefings`, `/dev/issues`, `/dev/runs/[id]` -> `packages/gp-webapp/app/dev/`
- Route: `/mx/evs/[...path]` -> `packages/gp-webapp/app/mx/`
- Route: `/api/robots` -> `packages/gp-webapp/pages/`
- API: unknown
- Reach it: none-fits (dev pages render only when NODE_ENV is development)
- E2E: none
- Notes: `/mx/evs` is a Segment ingestion proxy route handler, not UI. The legacy `pages/` router holds only `pages/api/robots.ts`.
