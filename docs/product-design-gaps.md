# Product design gaps

> **Working list, under review** alongside `product-design.md`. Like that file,
> it is not linked from `CLAUDE.md` or any `AGENTS.md` yet.

Where the product today doesn't match `product-design.md`, or does the same
thing several ways with no rule to settle it, plus the components that would
close those gaps. The rulebook says what good looks like. This file says where
we are not there yet.

Paths are relative to `packages/gp-webapp/app/` unless they start with
`packages/`. Counts are from the dashboard (logged-in product) as of
2026-10-22.

## The big picture

Most entries below are symptoms of six causes. Fixing a cause closes many
entries at once; fixing entries one by one without the cause brings them
back.

1. **No shared pattern, so each feature invents one.** Pro gating, payment
   errors, loading and prerequisites are each done four to six ways (G-08,
   G-20, G-21, G-22). Cure: a rule plus one component per pattern
   (C-01 to C-04).
2. **The DS lacks variants, so screens restyle it locally.** Visual
   `className` overrides and div panels fill the gap (G-12, G-33, G-40).
   Cure: a missing look becomes a styleguide variant, never a local override.
3. **Feature flags leave two live versions.** The same moment looks
   different depending on a flag (G-20, G-21). Cure: every UI flag gets a
   removal date, and the old path is deleted when it ships.
4. **Legacy layers are never removed.** Old headers, `H1`, `Paper`, three
   modal wrappers, two icon sets and leftovers sit next to their
   replacements (G-04, G-13, G-14). Cure: migrate on touch, and delete
   the old layer once nothing uses it.
5. **No shared helpers for data.** Dates and money are formatted locally
   (G-24, G-25). Cure: one helper each.
6. **Agreed rules aren't enforced.** About 80 buttons still break an agreed
   §4 rule (G-05). Cure: deterministic checks and a UX review (Part 5).

**Where to start, by user impact:**

1. **Moments that cost money or reach voters:** G-08, G-09, G-25, G-31.
   Mistakes here cost trust and money.
2. **Pro and prerequisites:** G-05, G-20, G-21, G-39. Users hit a wall with
   no explanation, at the moment we most want them to upgrade.
3. **Orientation:** G-14 to G-18. Every page, every session.
4. **States and accessibility:** G-22, G-23, G-27, G-28.
5. **Cleanup:** G-13, G-33, G-40, as screens are touched.

## How to use this file

- **Building or changing UI in an area listed here:** fix the gap as part of
  the change if it's in scope, and delete the entry in the same PR.
- **Reviewing UI:** cite the ID (`G-07`) instead of re-describing the problem.
- **Found a new one:** add an entry under the matching section with the next
  free ID. IDs are never reused.
- **Fixed:** delete the entry. Don't mark it done; git history keeps it.
- **This repo is public.** Describe what the user sees and where in the code.
  Never add customer data, and keep anything that reads as a security or
  privacy flaw out of this file. Report those privately.

Each gap uses this shape:

```markdown
### G-00 Short name of the gap

- **Rule:** the `product-design.md` section it breaks, or "none yet"
- **What the user sees:** the inconsistency, in user terms
- **Where:** file paths (a few representative ones, not an exhaustive list)
- **Proposal:** what the fix or the missing rule should be
- **Status:** open · ClickUp: —
```

Each proposed component uses this shape:

```markdown
### C-00 ComponentName

- **Solves:** G-xx, G-yy
- **Job:** what it does, in one sentence
- **Replaces today:** what gets deleted once it exists
- **Exists in DS?** no / partly (what's missing)
- **Priority:** high / medium / low · **Status:** proposed · ClickUp: —
```

# Changes to the rulebook

Changes this file has already made to `product-design.md`, and why. When a
change is agreed and settled, delete its entry here; the rule itself is the
record.

### R-01 Two overlay layers are allowed (§3)

- **Was:** "At most one layer on top, and only for a confirmation or a quick
  pick, never a second form."
- **Now:** at most two layers. A drawer or sheet can open one more drawer for
  a single focused task in the same job; a confirmation can sit on top of
  either; never a third layer, and never a second drawer that starts a
  different job. Closing the top layer leaves the one below as it was.
- **Also changed:** the "warning sign" now says an overlay that collects
  tabs, steps, tables or _jobs_ of its own has become a place (it said
  "dialogs", which contradicted the new rule).
- **Why:** the team allows a drawer over a drawer, and the field tools rely
  on it: recording a call or knock outcome from the phone banking panel or
  door knocking person sheet, attaching a file to a briefing note. Each one
  is a short step inside the job the user is already doing, so sending them
  to a page or closing the first drawer would break their flow. The old rule
  marked all of these as violations. The limit stays at two so overlays
  don't turn back into places.
- **Status:** changed, awaiting review

# Part 1: Gaps against agreed rules

## 2. Flows

### G-01 Multi-step flows run inside sheets with no URL per step

- **Rule:** §2 "Every flow is its own page"
- **What the user sees:** Back closes the whole flow instead of going one step
  back; refresh throws away the work; a step can't be linked.
- **Where:** SMS steps are local state inside `OutreachSheet`
  (`dashboard/outreach/v2/sms/SmsFlow.tsx`); the contacts wizard uses a local
  `stepIndex` (`dashboard/contacts/crm/wizard/CreateListWizard.tsx`). Already
  listed as a known gap in §3.
- **Proposal:** move each to a page with a route per step when it's next
  changed meaningfully.
- **Status:** open · ClickUp: —

## 3. Pages, drawers and dialogs

### G-04 Several responsive modal components, none at 1024px

- **Rule:** §3 "Use one shared responsive component" (known gap there)
- **What the user sees:** the same kind of dialog becomes a drawer at
  different widths on different screens.
- **Where:** `shared/utils/Modal.tsx`, `shared/utils/ResponsiveModal.tsx`,
  `shared/ui/ModalOrDrawer.tsx` (768px), plus features doing their own
  `useIsMobile` switch.
- **Proposal:** C-01.
- **Status:** open · ClickUp: —

## 4. Asking for input

### G-05 Buttons disabled for missing input, with no reason

- **Rule:** §4 "Don't disable the submit button to signal missing input"
- **What the user sees:** a grey button and no idea what's missing.
- **Where:** about 80 dashboard buttons are disabled for missing input or a
  prerequisite rather than loading. Examples:
  - `dashboard/polls/create/CreatePoll.tsx` (Next until a date, Next until an
    audience)
  - `dashboard/website/domain/components/DomainSearch.tsx` (Checkout)
  - `dashboard/components/campaignManager/RecordVoterContactsModal.tsx` (Save)
  - `dashboard/contacts/crm/CrmContactsPage.tsx` ("Create new list")
  - `dashboard/shared/agent-chat/cards/OutreachProposalCard.tsx` (CTA while
    data loads)
- **Proposal:** keep the button active and show what's missing on press;
  disable only during submit, with a loading state.
- **Status:** open · ClickUp: —

### G-06 Form errors shown in a toast

- **Rule:** §4 "Never show a form error in a toast"
- **What the user sees:** a validation message that fades away.
- **Where:** `dashboard/public-profile/components/PublicProfileEditor.tsx`.
- **Proposal:** show errors next to the field.
- **Status:** open · ClickUp: —

### G-07 Form inputs built by hand instead of from the DS

- **Rule:** none yet (see G-12)
- **What the user sees:** inputs that look and behave differently from the
  rest of the app.
- **Where:**
  - `dashboard/purchase/components/PromoCodeSection.tsx` (text input)
  - `dashboard/profile/texting-compliance/shared/PinForm.tsx` (per-digit PIN;
    the DS has `input-otp`)
  - `dashboard/public-profile/components/PrioritiesPublicationEditor.tsx`
    (native `<select>`)
- **Proposal:** move to DS `Input`, `InputOTP` and `Select`.
- **Status:** open · ClickUp: —

## 5. Actions and what happens next (proposed section)

### G-08 Each paid flow handles a failed payment differently

- **Rule:** §5 "Every action gets feedback where it happened" (proposed)
- **What the user sees:**
  - Robocall: inline "Your card was declined" with "Try another card". This
    is the good one (`dashboard/outreach/v2/robocall/RobocallPayStep.tsx`).
  - SMS: an inline alert and a toast for the same decline
    (`dashboard/outreach/v2/sms/SmsReviewStep.tsx` +
    `dashboard/purchase/components/CheckoutForm.tsx`).
  - Pro upgrade: a decline only shows the toast
    (`dashboard/pro-upgrade/components/PaymentStep.tsx`).
- **Proposal:** one inline payment error in the pay step, with retry and
  another way forward; never toast-only. C-04.
- **Status:** open · ClickUp: —

### G-09 The shared purchase error view is a dead end

- **Rule:** §5 (proposed), `product-copy.md` rule 8
- **What the user sees:** "Purchase Error" and a red line of text, with no
  retry and no way forward.
- **Where:** `dashboard/purchase/components/PurchaseError.tsx`, used by SMS,
  Pro upgrade, poll payment, gather more, the purchase page and payment
  interstitials.
- **Proposal:** C-04.
- **Status:** open · ClickUp: —

### G-35 Door knocking failures shown only as toasts

- **Rule:** §5 "Every action gets feedback where it happened" (proposed)
- **What the user sees:** creating a route fails inline, but editing or
  deleting a turf fails in a toast that fades away.
- **Where:** inline in `dashboard/door-knocking/native/createFlow/CreateListFlow.tsx`;
  toasts in `dashboard/door-knocking/native/EditTurfDialog.tsx` and
  `dashboard/door-knocking/native/turfLifecycle.ts`.
- **Proposal:** show the failure where the action happened, with retry.
- **Status:** open · ClickUp: —

# Part 2: Gaps with no rule yet

## Components and styling

### G-12 DS components restyled through className

- **Rule:** none yet (planned §7)
- **What the user sees:** the same button or card looks slightly different
  from screen to screen.
- **Where:** in the dashboard, about 66 Buttons and 43 Cards change color,
  border, radius or shadow through `className`; about 75 Buttons set size by
  hand instead of `size`; 120 of 144 Cards re-pad. Examples:
  - `dashboard/outreach/v2/sms/SmsScheduleStep.tsx` (a Button made to look
    like an input)
  - `dashboard/questions/components/issues/AddNewIssueTrigger.tsx`
  - `dashboard/website/components/ShareButtons.tsx` (`!important` overrides)
  - `dashboard/campaign-manager/ManagerPromptCard.tsx`,
    `dashboard/chief-of-staff/components/TaskCard.tsx` (restyled Cards)
- **Proposal:** build only from DS components through props and variants; no
  visual overrides (layout and spacing are fine). Missing look → add a
  variant to the styleguide or flag a DS gap.
- **Status:** open · ClickUp: —

### G-13 Three icon sets

- **Rule:** none yet
- **What the user sees:** icons of different weight and style side by side,
  including in the sidebar.
- **Where:** `react-icons` (about 40 dashboard files, including
  `dashboard/shared/DashboardMenu.tsx`), direct `lucide-react` imports and
  DS icons.
- **Proposal:** DS icons only; migrate as screens are touched.
- **Status:** open · ClickUp: —

### G-33 Raw buttons instead of DS Button

- **Rule:** none yet (planned §7)
- **What the user sees:** rows and tiles that act as buttons but look and
  respond differently from DS buttons.
- **Where:** about 80 raw `<button>` in about 55 dashboard files, mostly
  custom rows and tiles, e.g. `dashboard/door-knocking/native/WalkView.tsx`,
  `dashboard/chief-of-staff/components/TaskCard.tsx`,
  `dashboard/pro-upgrade/components/FilingStatusStep.tsx`.
- **Proposal:** use DS `Button` variants; if a clickable row or tile is a
  real pattern, add it to the styleguide.
- **Status:** open · ClickUp: —

### G-40 Panels built from divs instead of Card

- **Rule:** none yet (planned §7)
- **What the user sees:** panels that look almost, but not quite, like
  cards.
- **Where:** Serve onboarding (`serve/onboarding/ServeOnboardingFlow.tsx`,
  `serve/onboarding/districtStory/DistrictStoryStep.tsx`) uses
  `rounded-xl border bg-card` divs because `Card`'s fixed padding and shadow
  don't fit.
- **Proposal:** add a flat, unpadded `Card` variant, or decide these panels
  are a separate DS component.
- **Status:** open · ClickUp: —

## Copy on screen

### G-36 Error copy breaks the copy rules

- **Rule:** `product-copy.md`
- **What the user sees:** "Purchase Error" in title case; "Building the
  route failed — nothing was saved." with a dash.
- **Where:** `dashboard/purchase/components/PurchaseError.tsx`,
  `dashboard/door-knocking/native/createFlow/CreateListFlow.tsx`.
- **Proposal:** sentence case, no dashes, "what happened, then what to do".
- **Status:** open · ClickUp: —

### G-37 Field labels in title case

- **Rule:** `product-copy.md` (sentence case)
- **What the user sees:** "Cell Phone Number", "Political Party" on a
  person's details.
- **Where:** `dashboard/contacts/crm/person/PersonOverlay.tsx`.
- **Proposal:** sentence case labels.
- **Status:** open · ClickUp: —

## Navigation and page headers

### G-14 No single page header

- **Rule:** none yet (planned §8)
- **What the user sees:** titles of different sizes and weights, in different
  places, page to page.
- **Where:** two generic headers (`dashboard/shared/DashboardNavHeader.tsx`,
  `dashboard/shared/DashboardPageHeader.tsx`) plus feature headers
  (`briefings/components/detail/DetailHeader.tsx`,
  `polls/[id]/components/PollHeader.tsx`,
  `profile/texting-compliance/shared/TextingComplianceHeader.tsx`). About a
  third of dashboard routes use the shared header; the rest render their own
  title: 24 distinct `<h1>` styles plus 32 uses of the legacy
  `shared/typography/H1.tsx`. The DS `PageHeader` is unused.
- **Proposal:** one header: title from the nav label, optional one-line
  description, back link on nested pages, primary action in the header slot.
  See A-01.
- **Status:** open · ClickUp: —

### G-15 Two titles on one page

- **Rule:** none yet
- **What the user sees:** "Voter Data" in the bar, then "Your Voter
  Universe" below it; "Campaign Plan", then a hero headline.
- **Where:** `dashboard/contacts/crm/CrmContactsPage.tsx`,
  `dashboard/campaign-plan/` (`CampaignTrackerHero.tsx`).
- **Proposal:** one title per page; anything below it is a section heading.
- **Status:** open · ClickUp: —

### G-16 Nav label and page title differ

- **Rule:** none yet
- **What the user sees:** "Team" opens "Team Settings"; "Profile" is "My
  Profile" in the mobile top bar.
- **Where:** `dashboard/shared/navLabels.ts`,
  `dashboard/shared/DashboardLayout.tsx` (mobile titles),
  `dashboard/shared/DashboardMenu.tsx`.
- **Proposal:** the page title is the nav label, everywhere.
- **Status:** open · ClickUp: —

### G-39 A nav item lands on a sales page

- **Rule:** none yet
- **What the user sees:** a free user taps "Voter Data" and lands on a page
  titled "76% of candidates who use Pro win", with no sign they're in Voter
  Data.
- **Where:** the Voter Data upgrade placeholder in
  `dashboard/shared/DashboardMenu.tsx` → `dashboard/pro-upgrade/components/ValuePropStep.tsx`.
- **Proposal:** a nav item opens its own page; a locked one shows its
  locked state there (C-02).
- **Status:** open · ClickUp: —

### G-17 Page actions sit in four different places

- **Rule:** none yet
- **What the user sees:** the main action of a page is top right on one
  screen, in a second bar, a fixed bottom bar or the middle of the content on
  others.
- **Where:** header slot via `dashboard/shared/DashboardNavHeaderAction.tsx`
  (public profile, race opponent, home, campaign plan, your story); second
  bar in `dashboard/contacts/crm/CrmContactsPage.tsx`; inline in
  `dashboard/website/components/EmptyState.tsx`. The fixed bottom bar on a
  briefing (`dashboard/briefings/components/detail/DesktopBottomBar.tsx`) may
  be a fair exception for a long reading page; decide and write it down.
- **Proposal:** the primary page action sits in the header slot; a fixed
  bottom bar is for flows (`dashboard/shared/StepFooter.tsx`) and agreed
  exceptions.
- **Status:** open · ClickUp: —

### G-18 Nested pages go back in different ways

- **Rule:** none yet
- **What the user sees:** a breadcrumb on one page, a "Back to …" link on
  another, a ghost button or a chevron on others; the ordinance flow has none.
- **Where:** `polls/[id]/issue/[issueIndex]` (breadcrumb),
  `priorities/[priorityId]/results` (text link),
  `issue-capture/[outreachId]/theme/[themeId]` (ghost button),
  `profile/texting-compliance/*` (chevron),
  `ordinances/solve/[slug]/[step]` (none outside the error state).
- **Proposal:** one back pattern, owned by the page header (A-01).
- **Status:** open · ClickUp: —

## Hide, lock, explain or disable

### G-20 Pro features are gated six different ways

- **Rule:** none yet
- **What the user sees:** the same "this is a Pro feature" moment looks and
  behaves differently depending on where they meet it.
- **Where:**
  - Redirect to `/dashboard/pro-upgrade` on click (text and phone banking
    tiles, `dashboard/outreach/v2/ChannelTileGrid.tsx`)
  - Legacy `ProUpgradeModal` on click (robocall and door knocking tiles,
    same file, flag off)
  - In-flow gate (`dashboard/outreach/v2/gate/`, flag on)
  - Full-page locked view (`dashboard/race-opponent/page.tsx`,
    `dashboard/door-knocking/native/DoorKnockingPageGate.tsx`)
  - Inline locked panel
    (`dashboard/contacts/crm/recommended/RecommendedListsSection.tsx`)
  - Unprompted popup (`dashboard/shared/ProUpgradePrompt.tsx`)
- **Proposal:** show locked with the Pro badge; one shared pitch on press.
  C-02.
- **Status:** open · ClickUp: —

### G-21 Missing prerequisites redirect silently

- **Rule:** none yet
- **What the user sees:** they open a page and land somewhere else, with no
  explanation.
- **Where:** texting compliance register → website domain or Pro upgrade
  (`dashboard/profile/texting-compliance/register/page.tsx`); opponents →
  self-research (`dashboard/race-opponent/opponents/page.tsx`); submit PIN →
  account (`dashboard/profile/texting-compliance/submit-pin/page.tsx`).
  Good counterexamples: the voter data empty state
  (`dashboard/contacts/crm/VoterDataUnavailableState.tsx`) and the SMS-closed
  tile tooltip (`dashboard/outreach/v2/ChannelTileGrid.tsx`). Texting
  compliance is a modal with the gating flag off and an in-flow gate with it
  on, so the same prerequisite looks different depending on the flag.
- **Proposal:** keep the destination, say what's missing, link to it. C-03.
- **Status:** open · ClickUp: —

## States

### G-22 Loading is shown four ways

- **Rule:** none yet (planned §6)
- **What the user sees:** skeletons on some screens, spinners on others,
  pulsing blocks elsewhere.
- **Where:** DS `Skeleton` (about 47 uses), DS `Spinner` (about 21),
  hand-rolled `animate-pulse` (about 18, e.g.
  `dashboard/contacts/crm/DistrictStatCard.tsx`,
  `dashboard/contacts/crm/lists/ListsIndex.tsx`), ad hoc `animate-spin`
  (about 60).
- **Proposal:** skeleton for content that's loading into a known layout,
  spinner only inside a button or a small control.
- **Status:** open · ClickUp: —

### G-23 Empty states built by hand

- **Rule:** none yet (planned §6)
- **What the user sees:** empty screens that look different from each other.
- **Where:** DS `EmptyState` is used on about 10 screens; others hand-roll
  one (`dashboard/door-knocking/DoorNotesCard.tsx`,
  `dashboard/community-issues/components/IssueFeedList.tsx`,
  `dashboard/website/components/WebsiteInbox.tsx`).
- **Proposal:** always DS `EmptyState`. A-02.
- **Status:** open · ClickUp: —

## Data display

### G-24 Dates formatted and parsed several ways

- **Rule:** none yet
- **What the user sees:** "Election date: Nov 3, 2026", "Election Date: …"
  and "Election November 3, 2026" in different places; "Oct 5" in outreach
  history and "Oct 5, 2026" in list details; a risk of dates showing a day
  off.
- **Where:** `onboarding/components/OfficeSelectionStep.tsx`,
  `onboarding/[slug]/[step]/components/ballotOffices/RaceCard.tsx`,
  `dashboard/race-opponent/page.tsx`, `helpers/dateHelper.ts` (hardcoded
  offset), `dashboard/outreach/v2/outreachDate.util.ts`. Date inputs also
  differ: `MM/dd/yyyy` in `shared/inputs/DateInputCalendar.tsx`,
  `dd-MM-yyyy` in `polls/onboarding/components/OnboardingPage.tsx`. Good reference:
  SMS/robocall scheduling, which shows the time zone
  (`dashboard/outreach/v2/robocall/scheduleTimeZone.ts`).
- **Proposal:** one date format per context (short in lists, full in
  details), one shared helper, time zone shown wherever a time is.
- **Status:** open · ClickUp: —

### G-25 Money formatted several ways

- **Rule:** none yet
- **What the user sees:** "$1234.50" on the SMS review step and "$1,234.50"
  on the audience step of the same flow.
- **Where:** four local `money()` helpers (`dashboard/outreach/v2/sms/SmsReviewStep.tsx`,
  `GatherMoreFlow.tsx`, `dashboard/outreach/v2/robocall/RobocallReviewStep.tsx`,
  `OutreachAudienceStep.tsx`) and raw `toFixed(2)` in about 17 places; the
  shared `formatCurrency` (`helpers/numberHelper.ts`) is barely used. Unit
  prices show three decimals in some places
  (`dashboard/outreach/v2/robocall/RobocallReviewStep.tsx`,
  `dashboard/outreach/v2/OutreachDetailsDrawer.tsx`).
- **Proposal:** one money formatter with thousands separators, used
  everywhere.
- **Status:** open · ClickUp: —

### G-26 Tables have no mobile layout

- **Rule:** none yet (planned §10)
- **What the user sees:** sideways scrolling or squashed columns on a phone.
- **Where:** only `dashboard/outreach/v2/OutreachHistoryTable.tsx` switches
  to cards. `dashboard/polls/components/PollsTable.tsx` scrolls sideways;
  the team page and `dashboard/contacts/crm/lists/ListDetailSheet.tsx` have
  no mobile handling.
- **Proposal:** below 1024px a table becomes a list of cards. C-06.
- **Status:** open · ClickUp: —

## Accessibility

### G-27 Clickable elements keyboard users can't reach

- **Rule:** none yet
- **What the user sees:** with a keyboard or screen reader, some controls
  can't be reached or don't announce themselves.
- **Where:** clickable `div`/`span` with no role or key handling, e.g.
  `dashboard/door-knocking/native/createFlow/TurfCard.tsx`,
  `dashboard/campaign-details/components/issues/SuggestedIssues.tsx`,
  `dashboard/website/editor/components/ThemeSwatch.tsx`,
  `dashboard/components/tasks/TaskCheck.tsx`,
  `dashboard/components/campaignManager/ProgressSection.tsx`. Rows that
  remove the focus ring with only a faint replacement:
  `dashboard/briefings/components/BriefingListRow.tsx`,
  `dashboard/election-result/components/ResultOptionButton.tsx`.
- **Proposal:** interactive things are buttons or links; never remove the
  focus ring.
- **Status:** open · ClickUp: —

### G-28 Focus stays put when a step changes

- **Rule:** none yet (§2 only says scroll to top)
- **What the user sees:** after Next, a screen reader stays on the old
  button instead of reading the new step.
- **Where:** onboarding (`onboarding/components/OnboardingFlow.tsx`), Pro
  upgrade (`dashboard/pro-upgrade/components/ProUpgradeWizard.tsx`),
  outreach (`dashboard/outreach/v2/OutreachFlowShell.tsx`), contacts wizard,
  door knocking create flow.
- **Proposal:** on step change, scroll to top and move focus to the step
  title.
- **Status:** open · ClickUp: —

## AI output

### G-30 AI content is shown differently on every surface

- **Rule:** none yet (`design-memory/learned.md` #13 asks for feedback on
  everything generated)
- **What the user sees:**
  - The "AI-generated, double-check" label appears on the campaign plan and
    briefings only.
  - Thumbs feedback appears on briefings and chat only.
  - Regenerate is called "Regenerate", "Improve with AI" or "Refresh
    contrasts".
  - Content is editable in outreach compose, read-only elsewhere.
- **Where:** outreach compose steps (`dashboard/outreach/v2/sms/SmsComposeStep.tsx`,
  `robocall/RobocallComposeStep.tsx`), campaign plan, briefings
  (`dashboard/briefings/components/detail/FeedbackRow.tsx`), chat
  (`dashboard/shared/agent-chat/MessageActionBar.tsx`), race opponent
  (`dashboard/race-opponent/components/RegenerateContrasts.tsx`), community
  issues.
- **Proposal:** one pattern for generated content: label, regenerate (one
  name), feedback. C-05.
- **Status:** open · ClickUp: —

## Compliance and voter data

### G-31 Opt-out wording differs

- **Rule:** none yet
- **What the user sees:** "Reply STOP to opt out." in outreach texts, "Text
  STOP to opt out" in polls.
- **Where:** `dashboard/outreach/v2/sms/smsCompose.util.ts`,
  `dashboard/polls/create/CreatePoll.tsx`.
- **Proposal:** one opt-out line, defined once.
- **Status:** open · ClickUp: —

# Part 3: Questions for the rulebook itself

- **Review before payment.** §2 says payment happens inside the step with no
  separate review step; §5 points to the "review and pay steps" as the
  reference. Which is it?
- **Refresh mid-flow.** Every step has a URL, but progress isn't saved by
  default. What does a refresh, or a link, to step 3 show?
- **Drawer vs Dialog.** In the §3 table they behave the same at both widths.
  What decides between them?
- **Side sheet on mobile.** It's full screen, so it looks like a page but has
  no address. What does Back do?
- **Precedence.** When this rulebook, `product-copy.md`, the styleguide and
  `design-memory/learned.md` disagree, which wins? `learned.md` already
  overlaps §4.
- **Out of date: "no undo yet".** The §5 note says the toast can't hold an
  action button; `packages/gp-webapp/app/shared/utils/Snackbar.tsx` now
  accepts one. No feature offers undo yet.
- **Rule IDs.** Give each rule a short ID and a severity (blocker / polish)
  so reviews and this file can cite them.
- **Undo without undo.** §5 proposes undo instead of "are you sure?", but no
  feature offers undo yet. Until one does, should reversible actions keep a
  confirmation?
- **Destructive actions.** §5 covers confirming them, not how they look or
  where they sit. Proposal: destructive variant, never in the spot where the
  primary "continue" usually is.
- **Pressing twice.** §4 only protects form submits. Anything that charges
  money or reaches voters should be safe to press twice, not just disabled
  while it runs.
- **Accent color.** The DS has no non-status accent token, so Serve uses
  `warning` orange as decoration. Should there be one?

# Part 4: Components

## Proposed new components

### C-01 ResponsiveOverlay

- **Solves:** G-04
- **Job:** one component that is a bottom drawer below 1024px and a dialog
  above, with a visible close button and Back closing it.
- **Replaces today:** `shared/utils/Modal.tsx`, `shared/utils/ResponsiveModal.tsx`,
  `shared/ui/ModalOrDrawer.tsx`, local `useIsMobile` switches, bottom
  `Sheet`s used as drawers.
- **Exists in DS?** Partly: `Dialog` and `Drawer` exist separately.
- **Priority:** high · **Status:** proposed · ClickUp: —

### C-02 ProLock (locked feature + shared pitch)

- **Solves:** G-20
- **Job:** shows a feature as locked with the Pro badge, and on press opens
  one shared upgrade pitch. Variants for a tile, an inline panel and a full
  page.
- **Replaces today:** the redirect, `ProUpgradeModal`, the outreach gate
  screens, `OpponentProLockedView`, the door knocking page gate and the
  contacts locked panel.
- **Exists in DS?** Partly: `ProBadge` and `ChannelCard` `locked` exist; the
  behavior doesn't.
- **Priority:** high · **Status:** proposed · ClickUp: —

### C-03 RequirementNotice

- **Solves:** G-21, G-05
- **Job:** explains what's needed before something can be used, with one
  action that goes to it ("Connect a domain first").
- **Replaces today:** silent server redirects and disabled buttons with no
  reason.
- **Exists in DS?** No (`Alert` and `EmptyState` cover parts of it).
- **Priority:** high · **Status:** proposed · ClickUp: —

### C-04 PaymentErrorState

- **Solves:** G-08, G-09
- **Job:** an inline error in the pay step that says what happened and
  offers retry, another card, or a way out.
- **Replaces today:** `dashboard/purchase/components/PurchaseError.tsx` and
  the per-flow decline handling. The robocall pay step is the model.
- **Exists in DS?** No.
- **Priority:** high · **Status:** proposed · ClickUp: —

### C-05 AiContentActions

- **Solves:** G-30
- **Job:** the footer for any AI-generated block: an "AI-generated" label,
  regenerate (one name), thumbs up/down with a text field.
- **Replaces today:** `RegenerateContrasts`, briefing `FeedbackRow`, chat
  `MessageActionBar` actions, per-surface disclaimers.
- **Exists in DS?** Partly: `AiIcon` exists.
- **Priority:** medium · **Status:** proposed · ClickUp: —

### C-06 ResponsiveTable (DataList)

- **Solves:** G-26
- **Job:** a table on desktop that becomes a list of cards below 1024px,
  from one column definition.
- **Replaces today:** the hand-built switch in `OutreachHistoryTable.tsx`
  and horizontally scrolling tables.
- **Exists in DS?** Partly: `DataTable` and `Table` exist, without a mobile
  layout.
- **Priority:** medium · **Status:** proposed · ClickUp: —

### C-07 DatePicker

- **Solves:** two hand-built pickers
- **Job:** pick a date (and optionally a time and time zone) with one
  control.
- **Replaces today:** the Serve term-date picker (pill button plus restyled
  calendar) and the SMS/robocall schedule pickers (a Button styled as an
  input, see G-12).
- **Exists in DS?** Partly: `Calendar` and `CalendarButton` exist; check
  whether `CalendarButton` already covers this before building.
- **Priority:** medium · **Status:** proposed · ClickUp: —

### C-08 CheckboxCard

- **Solves:** checkbox cards assembled from `Checkbox` + `Label` with
  overridden classes (Serve onboarding priorities)
- **Job:** the multi-select counterpart of `RadioCardItem`.
- **Exists in DS?** No.
- **Priority:** medium · **Status:** proposed · ClickUp: —

### C-09 StepList

- **Solves:** hand-built numbered lists (Serve district story)
- **Job:** a numbered list of steps (number in a circle plus text), with or
  without a card per item. Not a progress indicator; `Stepper` is that.
- **Exists in DS?** No.
- **Priority:** low · **Status:** proposed · ClickUp: —

### C-10 MapLegend

- **Solves:** hand-built legends on maps (district story, door knocking)
- **Job:** colored marker plus label pairs that sit on or next to a map.
- **Exists in DS?** No.
- **Priority:** low · **Status:** proposed · ClickUp: —

## Existing DS components to adopt

These exist in the styleguide but aren't used where they should be. Adopt
them; don't build new ones.

### A-01 PageHeader

- **Solves:** G-14, G-15, G-16, G-17, G-18
- **Where it lives:** `packages/styleguide/src/components/ui/page-header.tsx`
  (0 uses in gp-webapp).
- **Note:** check it against `DashboardNavHeader` first; one of them should
  become the single page header, with the back link and action slot.

### A-02 EmptyState

- **Solves:** G-23
- **Where it lives:** `packages/styleguide/src/components/ui/empty-state.tsx`.

### A-03 InputOTP

- **Solves:** the PIN entry in G-07
- **Where it lives:** `packages/styleguide/src/components/ui/input-otp.tsx`.

# Part 5: Ideas for the design agent

Not gaps in the product, but ways to make the rulebook and this file work
better for agents.

- **A checklist at the end of the rulebook,** like "Before you ship a string"
  in `product-copy.md`: 8 to 10 questions to answer before calling UI done.
- **Deterministic checks for what grep can catch,** like
  `check:serve-vocabulary`: `disabled` on a submit with no loading state, form
  errors in a toast, visual `className` overrides on DS components, raw
  `<button>`, raw date and money formatting.
- **A `/ux-review` skill** with the review prompt from the ClickUp task, that
  also renders the screens at 375px and 1280px and attaches screenshots.
- **A fixed set of reference screens** (a few known-bad ones from this file
  and a few good ones) to run the review against whenever the rulebook
  changes, to see what it catches and misses.
- **Known gaps out of the rules.** Keep the rules in `product-design.md` and
  move its "Known gap" notes here, so agents don't re-read them as rules.
