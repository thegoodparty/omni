# Product design gaps

> **Working list, under review** alongside `product-design.md`. Agents read
> only Part 4 (Components), from `product-design.md` section 7, to avoid
> duplicate component proposals. Nothing in this file is a rule.

Where the product today doesn't match `product-design.md`, or does the same
thing several ways with no rule to settle it, plus the components that would
close those gaps. The rulebook says what good looks like. This file says where
we are not there yet.

Paths are relative to `packages/gp-webapp/app/` unless they start with
`packages/`. Counts are from the dashboard (logged-in product) as of
2026-10-22; G-41 onward as of 2026-11-02.

## The big picture

Most entries below are symptoms of six causes. Fixing a cause closes many
entries at once; fixing entries one by one without the cause brings them
back.

1. **No shared pattern, so each feature invents one.** Pro gating, payment
   errors, loading and prerequisites are each done four to six ways (G-08,
   G-20, G-21, G-22), and so are confirming, saving, copying, paging,
   status and bottom bars (G-41 to G-47, G-56, G-59). Cure: a rule plus one
   component per pattern (C-01 to C-04, C-11 to C-17).
2. **The DS lacks variants, so screens restyle it locally.** Visual
   `className` overrides and div panels fill the gap (G-12, G-33, G-40).
   Cure: a missing look becomes a styleguide variant, never a local override.
3. **Feature flags leave two live versions.** The same moment looks
   different depending on a flag (G-20, G-21). Cure: every UI flag gets a
   removal date, and the old path is deleted when it ships.
4. **Legacy layers are never removed.** Old headers, `H1`, `Paper`, three
   modal wrappers, two icon sets, the old typography set, the old step
   indicator and leftovers sit next to their replacements (G-04, G-13,
   G-14, G-57, G-61). Cure: migrate on touch, and delete
   the old layer once nothing uses it.
5. **No shared helpers for data.** Dates and money are formatted locally
   (G-24, G-25). Cure: one helper each.
6. **Agreed rules aren't enforced.** About 80 buttons still break an agreed
   §4 rule (G-05). Cure: deterministic checks and a UX review (Part 5).

**Where to start, by user impact:**

1. **Moments that cost money or reach voters:** G-08, G-09, G-25, G-31.
   Mistakes here cost trust and money.
2. **Losing work or data:** G-41, G-42, G-46. One tap removes a teammate
   for good; leaving an editor drops the edits.
3. **Pro and prerequisites:** G-05, G-20, G-21, G-39, G-54. Users hit a wall
   with no explanation, at the moment we most want them to upgrade.
4. **Naming and orientation:** G-14 to G-18, G-48, G-49, G-50. Every page,
   every session; one name meaning three things.
5. **Field use, states and accessibility:** G-62, G-22, G-23, G-27, G-28.
6. **Cleanup:** G-13, G-33, G-40, G-55 to G-61, as screens are touched.

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
- **Priority:** high / medium / low · **Status:** proposed / approved by Eugene / rejected by Eugene: why · ClickUp: —
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

### G-41 Destructive actions are confirmed at random

- **Rule:** §5 "Confirm only actions that can't be undone" (proposed)
- **What the user sees:** deleting a note, a list, a turf or a chat asks
  first. Removing a team member, revoking an invite, deleting a website issue
  and archiving a priority happen on one tap, with no confirmation and no
  undo. The same object is handled both ways: a policy priority is confirmed
  in texting compliance but not in the website editor. Unpublishing the
  website is confirmed; unpublishing the public profile is a bare switch.
- **Where:** confirmed in `dashboard/contacts/crm/lists/DeleteListDialog.tsx`,
  `dashboard/door-knocking/native/DoorNotesCard.tsx`,
  `dashboard/profile/texting-compliance/candidate-profile/components/PolicyPriorities.tsx`,
  `dashboard/website/editor/components/EditSettingsMenu.tsx`; not confirmed
  in `dashboard/team/components/TeamPage.tsx` (remove member, revoke invite),
  `dashboard/website/editor/components/IssuesForm.tsx`,
  `dashboard/priorities/components/PrioritiesHub.tsx` (archive, and no
  restore exists), `dashboard/public-profile/components/PublicProfileEditor.tsx`.
- **Proposal:** confirm every action that can't be undone, with C-14; give
  archive a restore or an undo toast; treat both publish switches the same.
- **Status:** open · ClickUp: —

### G-42 Page editors lose unsaved changes without warning

- **Rule:** none yet
- **What the user sees:** the outreach flows, turf drawing and boundary
  drawing ask "Discard changes?" before closing. The website editor, the
  public profile and the opponents section let you leave and lose your edits.
- **Where:** warn in `dashboard/outreach/v2/OutreachFlowShell.tsx`,
  `dashboard/door-knocking/native/createFlow/TurfPanel.tsx`,
  `dashboard/contacts/crm/map/BoundaryDrawOverlay.tsx`; don't warn in
  `dashboard/website/editor/components/WebsiteEditFlow.tsx`,
  `dashboard/public-profile/components/PublicProfileEditor.tsx`,
  `dashboard/campaign-details/components/RunningAgainstSection.tsx`. The only
  `beforeunload` hook (`shared/hooks/usePageExit.ts`) runs a callback and
  never warns.
- **Proposal:** every editor with an explicit Save warns before leaving with
  unsaved changes. C-17.
- **Status:** open · ClickUp: —

### G-43 Saving gives four kinds of feedback

- **Rule:** §5 "Every action gets feedback where it happened" (proposed)
- **What the user sees:** the ordinance draft shows an inline "Saving… /
  Saved"; the public profile shows a toast, even for "No changes to save";
  the opponents section reloads the whole page; archiving an outreach closes
  the drawer with no message, and archiving a priority just drops the row.
- **Where:** `dashboard/ordinances/components/DraftDetail.tsx`,
  `dashboard/public-profile/components/PublicProfileEditor.tsx`,
  `dashboard/campaign-details/components/RunningAgainstSection.tsx`,
  `dashboard/outreach/v2/OutreachDetailsDrawer.tsx`,
  `dashboard/priorities/components/PrioritiesHub.tsx`.
- **Proposal:** an inline saved state next to the Save action; never reload
  the page; removals confirmed with a toast that can undo.
- **Status:** open · ClickUp: —

### G-44 Busy buttons look four ways

- **Rule:** §5 (the styleguide `Button` has a `loading` prop)
- **What the user sees:** while something runs, a button shows a spinner, or
  its label changes to "Saving…", or a hand-placed spinner appears, or it just
  goes grey with no sign anything is happening.
- **Where:** `loading` prop in
  `dashboard/public-profile/components/PublicProfileEditor.tsx` and
  `dashboard/race-opponent/components/ContrastCard.tsx`; label swap in
  `dashboard/door-knocking/native/DoorNotesCard.tsx` and
  `dashboard/door-knocking/native/RecordKnockStepForm.tsx`; manual spinner in
  `dashboard/shared/ConfirmDeleteDialog.tsx`; grey only in
  `dashboard/contacts/crm/lists/DeleteListDialog.tsx` and
  `dashboard/team/components/TeamPage.tsx`. "Retry Registration" in
  `dashboard/website/domain/components/DeleteDomain.tsx` has no guard against
  a second press.
- **Proposal:** always `Button loading`, including inside confirm dialogs.
- **Status:** open · ClickUp: —

### G-45 Confirm dialogs built five ways

- **Rule:** §5 "naming the thing and what's lost, with a confirm button that
  names the action" (proposed)
- **What the user sees:** a centered 3xl title with a "Proceed" button; a
  "Delete" that isn't red; "Are you sure you want to delete X?"; "Delete
  {name}?" with what you lose and "Keep turf". Titles, buttons and colors
  differ for the same kind of moment.
- **Where:** `shared/utils/AlertDialog.tsx` (legacy, defaults to "Proceed"),
  `dashboard/components/DeleteAction.tsx` (`redButton={false}`),
  `dashboard/contacts/crm/lists/DeleteListDialog.tsx`,
  `dashboard/door-knocking/native/createFlow/removeTurfDialog.tsx` (the good
  one), `dashboard/shared/ConfirmDeleteDialog.tsx`.
- **Proposal:** one confirm dialog, C-14; retire `shared/utils/AlertDialog.tsx`.
- **Status:** open · ClickUp: —

### G-46 Copy to clipboard: toast, checkmark, both, or a false success

- **Rule:** none yet
- **What the user sees:** "Copied to clipboard" even when copying failed;
  a toast and a checkmark at once; only a checkmark in chat; a check that
  never resets; briefing and plan sharing that fail silently.
- **Where:** `shared/utils/CopyToClipboard.tsx` (ignores the result),
  `shared/utils/CopyToClipboardButton.tsx`,
  `dashboard/shared/agent-chat/MessageActionBar.tsx`,
  `dashboard/shared/agent-chat/cards/OutsideContactCard.tsx`,
  `onboarding/success/components/SharePlanModal.tsx`. Only
  `dashboard/outreach/v2/copyText.util.ts` has a fallback.
- **Proposal:** one copy control: an inline check for about two seconds, the
  `copyText` fallback, and a visible message when it fails. C-16.
- **Status:** open · ClickUp: —

### G-47 Long lists page four ways

- **Rule:** none yet
- **What the user sees:** numbered pages that reset on Back, hand-built
  Previous/Next with "Page X of Y", pages kept in the URL, or "Load more".
- **Where:** `dashboard/outreach/v2/OutreachHistoryTable.tsx` (DS
  pagination, page in component state),
  `dashboard/website/components/WebsiteInbox.tsx` with
  `dashboard/website/components/PaginationButtons.tsx`,
  `dashboard/contacts/crm/ContactsTableProvider.tsx` (page in the URL),
  `dashboard/outreach/v2/poll/results/PollCommentList.tsx` and
  `dashboard/outreach/v2/ServeSmsRepliesSection.tsx` ("Load more").
- **Proposal:** tables use DS `Pagination` with the page in the URL (A-05);
  feeds inside a detail view use "Load more".
- **Status:** open · ClickUp: —

# Part 2: Gaps with no rule yet

## Components and styling

### G-12 DS components restyled through className

- **Rule:** §7. `check:design-system` in gp-webapp counts them and stops the
  count from rising; `--list-restyled` lists every one
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

### G-56 The same status looks four ways

- **Rule:** none yet (`design-memory/learned.md` #30 limits badges per card
  but doesn't pick a status style)
- **What the user sees:** poll status is plain colored text in outreach
  history and a solid box on the Polls page; website, briefing and door
  knocking statuses each use their own pill. None uses `Badge`.
- **Where:** `dashboard/outreach/v2/channelMeta.tsx` (`StatusText`),
  `dashboard/polls/components/StatusBadge.tsx`,
  `dashboard/website/components/StatusChip.tsx`,
  `dashboard/briefings/components/AgendaStatusPill.tsx`,
  `dashboard/door-knocking/native/WalkView.tsx`.
- **Proposal:** one status component with a fixed set of tones. C-11.
- **Status:** open · ClickUp: —

### G-57 The old typography set still renders

- **Rule:** `design-memory/learned.md` #20 (title hierarchy), #22 (16px body)
- **What the user sees:** page titles from 16px to 36px; in the Pro upgrade
  wizard the title size jumps between steps and with a feature flag.
- **Where:** `@shared/typography` (H1 to H6, Body1/2, Subtitle) is imported in
  about 95 files (`shared/typography/H1.tsx`, `shared/typography/Body2.tsx`);
  `dashboard/pro-upgrade/components/PaymentStep.tsx` vs
  `dashboard/pro-upgrade/components/CandidateProfileStep.tsx`, both arms of
  `dashboard/pro-upgrade/components/GuidanceStep.tsx`;
  `dashboard/community-issues/all/page.tsx` (16px h1). This is the type
  scale; the header component is G-14.
- **Proposal:** a type scale in the styleguide (C-15); retire
  `@shared/typography` as screens are touched.
- **Status:** open · ClickUp: —

### G-66 Body text is 14px, the rule says 16px

- **Rule:** `design-memory/learned.md` #22 (body and input text is 16px)
- **What the user sees:** step content in flows reads at 14px, and only the
  caption under a step title is 16px. A screen built to the rule looks
  larger than the flow around it.
- **Where:** across the dashboard `text-sm` appears about 960 times and
  `text-base` about 210 (`*.tsx`, tests excluded); in `dashboard/outreach/v2`
  it is 213 to 18. Examples: `dashboard/outreach/v2/sms/SmsReviewStep.tsx`,
  `dashboard/outreach/v2/robocall/RobocallReviewStep.tsx`,
  `dashboard/outreach/v2/audience/RecommendedListCard.tsx`. 16px only in
  `dashboard/outreach/v2/social/Intro.tsx` (step caption) and a few places
  such as `dashboard/outreach/v2/gate/ProPitchPanel.tsx`.
  `dashboard/outreach/v2/poll/PollQuestionStep.tsx` uses 16px on a phone and
  14px from `md`.
- **Proposal:** decide which one is the rule: 16px everywhere, or 14px for
  step content with 16px for captions and inputs. Then write it into
  `learned.md` and the type scale (C-15).
- **Status:** open · ClickUp: —

### G-67 File drop zones are built five ways

- **Rule:** none yet; `design-memory/learned.md` has no drop zone rule.
- **What the user sees:** the same dashed upload area reacts differently on
  hover and on drag: a tinted border and gray fill in outreach, a faint fill
  for the avatar, indigo or gray colors on older screens, and some show
  nothing while a file is dragged over them.
- **Where:** `dashboard/outreach/v2/sms/SmsComposeStep.tsx` and
  `dashboard/outreach/v2/poll/PollImageDropzone.tsx`
  (`hover:border-primary/50 hover:bg-muted`, the model);
  `dashboard/campaign-details/components/cards/UploadAvatarDialog.tsx`
  (`hover:bg-muted/30`); `dashboard/polls/components/PollImageUpload.tsx`
  (gray and green palette colors); `shared/inputs/FileDropZone.tsx`
  (`bg-indigo-100`); `dashboard/contacts/crm/import/ImportContactsWizard.tsx`
  follows outreach.
- **Proposal:** one drop zone component with fixed hover, drag-over, error
  and busy states. C-18.
- **Status:** open · ClickUp: —

### G-58 Overlines are still in use

- **Rule:** `design-memory/learned.md` #19 (no overlines)
- **What the user sees:** small uppercase labels above sections and cards on
  new surfaces.
- **Where:** `dashboard/door-knocking/native/createFlow/WhoStep.tsx`,
  `dashboard/chief-of-staff/components/TaskCard.tsx`,
  `dashboard/outreach/v2/OutreachAssigneesSection.tsx`,
  `dashboard/components/UpdateHistorySection.tsx`.
- **Proposal:** section titles instead; then remove or deprecate the
  styleguide `overline.tsx`.
- **Status:** open · ClickUp: —

### G-60 The user's avatar looks different in every nav

- **Rule:** `design-memory/learned.md` #15 (one product shell)
- **What the user sees:** a rounded square in the dashboard sidebar, a circle
  in the volunteer sidebar, gray initials with no circle in the top-nav
  dropdown.
- **Where:** `dashboard/shared/DashboardMenu.tsx`,
  `volunteer/VolunteerSidebar.tsx`, `shared/layouts/navigation/ProfileDropdown.tsx`
  with `shared/user/UserAvatar.tsx`. Initials are built by hand in
  `dashboard/outreach/v2/OutreachAssignModal.tsx`,
  `dashboard/race-opponent/components/RaceOpponentList.tsx` and
  `dashboard/shared/agent-chat/cards/cardShell.tsx`.
- **Proposal:** C-13.
- **Status:** open · ClickUp: —

### G-61 Polls use an old step indicator

- **Rule:** none yet
- **What the user sees:** poll creation and poll onboarding show a row of
  bars with clickable segments; every other flow shows the DS `Stepper`.
- **Where:** `shared/stepper/StepIndicator.tsx`, used by
  `dashboard/polls/create/CreatePoll.tsx` and
  `polls/onboarding/components/OnboardingPage.tsx`. Compare
  `dashboard/pro-upgrade/components/ProUpgradeWizard.tsx` and
  `dashboard/outreach/v2/OutreachFlowShell.tsx`.
- **Proposal:** move polls onto `Stepper` (A-04) and delete `shared/stepper`.
- **Status:** open · ClickUp: —

### G-63 Inline notices built by hand

- **Rule:** none yet
- **What the user sees:** info and warning notices that look different from
  the DS `Alert` used elsewhere.
- **Where:** `dashboard/race-opponent/components/AddOpponentsForm.tsx`,
  `dashboard/door-knocking/native/DoNotKnockControl.tsx`,
  `dashboard/shared/ai-chat/AiChatBody.tsx`,
  `dashboard/ordinances/components/QualityReport.tsx`,
  `polls/onboarding/components/ErrorMessage.tsx`.
- **Proposal:** DS `Alert` (A-06).
- **Status:** open · ClickUp: —

### G-64 The same field is explained two ways

- **Rule:** none yet
- **What the user sees:** the election filing link field in texting
  compliance has an info icon that opens an old modal in one variant, and
  inline helper text in the other.
- **Where:** `dashboard/profile/texting-compliance/register/components/FilingLinkInfoIcon.tsx`,
  `dashboard/profile/texting-compliance/register/components/TextingComplianceRegistrationForm.tsx`.
- **Proposal:** inline helper text; delete the icon and its modal.
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
  person's details. Title case also runs through the main nav ("Campaign
  Plan", "Know Your Opponent", "Voter Outreach"), the account menu ("Account
  Settings", "Community Forum"), headings and buttons ("Delete Account", "New
  Note", "Add Note", "Yes, Checkout").
- **Where:** `dashboard/contacts/crm/person/PersonOverlay.tsx`,
  `dashboard/shared/navLabels.ts` (fixes every tab at once),
  `dashboard/shared/DashboardMenu.tsx`,
  `dashboard/account/components/DeleteAccountPage.tsx`,
  `dashboard/briefings/components/annotations/AddNoteSheet.tsx`,
  `dashboard/polls/create/CreatePoll.tsx`.
- **Proposal:** sentence case labels, nav items, headings and buttons.
- **Status:** open · ClickUp: —

### G-48 "Campaign Manager" names three things

- **Rule:** `product-copy.md` rule 7 (reuse the phrase); `product-vocabulary.md`
  reserves the name for the AI assistant
- **What the user sees:** the AI assistant, the Home nav link and a human
  team role you can invite and assign outreach to are all "Campaign
  Manager". The contacts assistant spells it "Campaign manager".
- **Where:** `dashboard/campaign-manager/CampaignManagerTasks.tsx`,
  `dashboard/team/team.util.ts` (`campaignAdmin`),
  `dashboard/team/components/InviteMemberDrawer.tsx`,
  `dashboard/outreach/v2/OutreachAssignModal.tsx` (role filter),
  `dashboard/contacts/crm/assistant/assistantChat.ts`.
- **Proposal:** rename the human role; one spelling for the assistant.
- **Status:** open · ClickUp: —

### G-49 Turfs become "lists" once created

- **Rule:** `product-copy.md` rules 6 and 7
- **What the user sees:** creating and finishing work says "turf"; editing
  and deleting say "Edit list" and "List deleted", the word the same flow
  uses for voter lists.
- **Where:** `dashboard/door-knocking/native/createFlow/DrawStep.tsx`,
  `dashboard/door-knocking/native/MarkDoneDialog.tsx` vs
  `dashboard/door-knocking/native/EditTurfDialog.tsx`,
  `dashboard/door-knocking/native/DeleteTurfControl.tsx`; voter lists in
  `dashboard/door-knocking/native/createFlow/CreateListFlow.tsx`.
- **Proposal:** "turf" everywhere a turf is meant.
- **Status:** open · ClickUp: —

### G-50 The same step reads differently in each channel

- **Rule:** `product-copy.md` rule 7 ("the same question should read the same
  way in every channel") and rule 1
- **What the user sees:** the schedule step is "When do you want to send?",
  "When should it go out?", "When do you want to send it?" (robocall's header
  and body disagree) or "When should we send them?". The last step is "Review
  & pay", "Review your campaign" or "Review and verify". The advance button
  is "Continue" in most flows and "Next" in polls, the website editor and
  `ModalFooter`.
- **Where:** `dashboard/outreach/v2/sms/SmsFlow.tsx`,
  `dashboard/outreach/v2/robocall/RobocallFlow.tsx`,
  `dashboard/outreach/v2/robocall/RobocallScheduleStep.tsx`,
  `dashboard/outreach/v2/poll/gather/gatherCopy.ts`,
  `dashboard/polls/create/CreatePoll.tsx`,
  `dashboard/website/editor/components/WebsiteEditorPageStepper.tsx`,
  `shared/ModalFooter.tsx`.
- **Proposal:** one title per step id, defined once; "and", not "&";
  "Continue" to advance.
- **Status:** open · ClickUp: —

### G-51 Success messages differ in wording, case and punctuation

- **Rule:** `product-copy.md` mechanics (no exclamation points, no em dashes,
  sentence case)
- **What the user sees:** "Payment successful!", "Payment Successful!",
  "Purchase Successful!", "You're all set", "Scheduled!"; toasts that say
  "successfully", end with a period or carry an em dash.
- **Where:** `dashboard/outreach/v2/sms/SmsFlow.tsx`,
  `dashboard/outreach/v2/robocall/RobocallPayStep.tsx`,
  `dashboard/polls/shared/components/PollPaymentSuccess.tsx`,
  `dashboard/purchase/complete/page.tsx`,
  `dashboard/purchase/components/PurchaseSuccess.tsx`,
  `dashboard/contacts/crm/wizard/CreateListWizard.tsx`,
  `dashboard/profile/texting-compliance/shared/useSubmitCvPin.ts`,
  `dashboard/ordinances/components/DraftDetail.tsx`.
- **Proposal:** one pattern: "[Thing] [past-tense verb]", no "successfully",
  no "!", no period.
- **Status:** open · ClickUp: —

### G-52 "Can't be undone" has five wordings

- **Rule:** `product-copy.md` rules 5 (contractions) and 7
- **What the user sees:** "This can not be undone.", "This cannot be
  undone.", "This action is not reversible.", "This action cannot be
  undone.", "You can't undo this.", "This can't be undone.", some under an
  "Are you sure?" title.
- **Where:** `dashboard/contacts/crm/lists/DeleteListDialog.tsx`,
  `dashboard/door-knocking/native/DoorNotesCard.tsx`,
  `dashboard/account/components/DeleteAccountPage.tsx`,
  `dashboard/shared/ai-chat/AiChatHistoryPopover.tsx`,
  `dashboard/briefings/components/annotations/NotesSurface.tsx`,
  `dashboard/ordinances/components/DraftDetail.tsx`.
- **Proposal:** "This can't be undone.", with a title that names the item.
  Part of C-14.
- **Status:** open · ClickUp: —

### G-53 Sign in, sign out and setup are named differently by surface

- **Rule:** `product-copy.md` rules 6 and 7
- **What the user sees:** "Log In" and "Sign in"; "Logout" and "Log out";
  "Continue Setup", "Continue" and "Continue Onboarding".
- **Where:** `shared/layouts/navigation/RightSide.tsx`,
  `sign-in-link/SignInLinkContent.tsx`, `team-invite/page.tsx`,
  `dashboard/shared/DashboardMenu.tsx`,
  `shared/layouts/navigation/ProfileDropdown.tsx`, `logout/page.tsx`,
  `shared/layouts/navigation/DashboardOrContinue.tsx`,
  `shared/layouts/navigation/RightSideMobile.tsx`.
- **Proposal:** "Sign in", "Sign up", "Sign out" and one name for resuming
  setup, everywhere.
- **Status:** open · ClickUp: —

### G-54 Pro upsell copy breaks the copy rules

- **Rule:** `product-copy.md` ("Words we do not use", mechanics, rule 9)
- **What the user sees:** "Start today for just $10/month.", "powerful
  canvassing tools", "Win with GoodParty.org Pro!", "…first campaign!".
- **Where:** `dashboard/shared/ProUpgradeModal.tsx`,
  `dashboard/shared/P2PUpgradeModal.tsx`,
  `dashboard/pro-upgrade/components/ValuePropStep.tsx`,
  `onboarding/components/OnboardingFlow.tsx`.
- **Proposal:** drop "just", "powerful" and "!"; reuse the price line from
  `dashboard/shared/membership/membershipCopy.ts`.
- **Status:** open · ClickUp: —

### G-65 Account deletion says "campaign" to elected officials

- **Rule:** `product-vocabulary.md`
- **What the user sees:** an elected official deleting their account reads
  "All your campaign data will be permanently deleted".
- **Where:** `dashboard/account/components/DeleteAccountPage.tsx`, rendered for Serve
  from `dashboard/account/components/AccountProfilePage.tsx`. `campaign` isn't on the
  `check:serve-vocabulary` list, so the check misses it.
- **Proposal:** a mode-keyed copy object for this screen.
- **Status:** open · ClickUp: —

## Navigation and page headers

### G-14 No single page header

- **Rule:** none yet (planned §8)
- **What the user sees:** titles of different sizes and weights, in different
  places, page to page.
- **Where:** two generic headers (`dashboard/shared/DashboardNavHeader.tsx`,
  `dashboard/shared/DashboardPageHeader.tsx`) plus feature headers
  (`dashboard/briefings/components/detail/DetailHeader.tsx`,
  `dashboard/polls/[id]/components/PollHeader.tsx`,
  `dashboard/profile/texting-compliance/shared/TextingComplianceHeader.tsx`). About a
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
  `dashboard/campaign-plan/` (`dashboard/campaign-plan/components/CampaignTrackerHero.tsx`).
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

## Layout and mobile

### G-55 Sibling pages get different gutters and widths

- **Rule:** `design-memory/learned.md` #15 (one product shell), #26 (bottom
  padding)
- **What the user sees:** content starts at a different distance from the
  edge on pages next to each other in the nav; Win outreach and its Serve
  twin have different gutters; the contacts page has 8px on a phone.
- **Where:** `dashboard/shared/DashboardLayout.tsx` pads `p-2 md:p-4`; about
  15 pages turn that off with `!p-0` and pad themselves, the rest add theirs
  on top. `dashboard/outreach/v2/OutreachHubPage.tsx` vs
  `dashboard/constituent-outreach/ConstituentOutreachPage.tsx`;
  `dashboard/contacts/crm/CrmContactsPage.tsx`;
  `dashboard/community-issues/all/page.tsx` vs `dashboard/priorities/page.tsx`.
  Content widths include 560, 640, 672, 720 and 1280px; bottom padding varies.
- **Proposal:** the layout owns the gutter, width (reading or wide) and
  bottom padding; pages stop overriding it.
- **Status:** open · ClickUp: —

### G-59 Every page builds its own fixed bottom bar

- **Rule:** none yet (see G-17 for which actions belong there)
- **What the user sees:** bottom bars that sit at different offsets from the
  sidebar and layer differently; the domain checkout bar can run under the
  sidebar; the toast lifts itself over a hand-kept list of routes.
- **Where:** `dashboard/contacts/crm/assistant/AssistantBar.tsx`,
  `dashboard/shared/ai-chat/AiChatBar.tsx`,
  `dashboard/campaign-plan/components/CampaignPlanView.tsx`,
  `dashboard/website/domain/components/DomainSearch.tsx`,
  `shared/utils/Snackbar.tsx` (route list),
  `polls/onboarding/components/OnboardingPage.tsx` (footer rendered twice).
- **Proposal:** C-12.
- **Status:** open · ClickUp: —

### G-62 Door knocking actions are under 44px

- **Rule:** none yet
- **What the user sees:** at the door, on a phone, "Save note", "Add a note"
  and "Close route" are 32px tall and door navigation is 40px.
- **Where:** `dashboard/door-knocking/native/DoorNotesCard.tsx`,
  `dashboard/door-knocking/native/WalkSurface.tsx`,
  `dashboard/door-knocking/native/PersonSheet.tsx`; `small` is `h-8` in
  `packages/styleguide/src/components/ui/button.tsx`.
- **Proposal:** large buttons in the walk view; add a 44px minimum touch
  target to the rulebook.
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
  one (`dashboard/door-knocking/native/DoorNotesCard.tsx`,
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
  `dashboard/outreach/v2/poll/gather/GatherMoreFlow.tsx`, `dashboard/outreach/v2/robocall/RobocallReviewStep.tsx`,
  `dashboard/outreach/v2/audience/OutreachAudienceStep.tsx`) and raw `toFixed(2)` in about 17 places; the
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
  `dashboard/outreach/v2/robocall/RobocallComposeStep.tsx`), campaign plan, briefings
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
  primary "continue" usually is. Today's state: G-41, G-45.
- **Pressing twice.** §4 only protects form submits. Anything that charges
  money or reaches voters should be safe to press twice, not just disabled
  while it runs. Today's state: G-44.
- **Accent color.** The DS has no non-status accent token, so Serve uses
  `warning` orange as decoration. Should there be one?

# Part 4: Components

## Proposed new components

A list of proposals, not rules. Before proposing a component (section 7 of
`product-design.md`), check here: if it's already listed, add your places to
its entry; if it was rejected, don't propose it again. A new proposal gets the
next free C-ID and status `proposed`.

- **Status:** `proposed` until Eugene decides, then `approved by Eugene` or
  `rejected by Eugene: <why, in one line>`.
- **Approved:** delete the entry once the component ships in the styleguide.
- **Rejected:** keep the entry, so nobody proposes it again.

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
- **Exists in DS?** Partly: `ProBadge` and `ChannelCard`'s Pro `tag` exist;
  the behavior doesn't.
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
- **Replaces today:** the hand-built switch in `dashboard/outreach/v2/OutreachHistoryTable.tsx`
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

### C-11 StatusBadge

- **Solves:** G-56
- **Job:** shows a status in words with one of a fixed set of tones
  (neutral, active, done, warning, failed).
- **Replaces today:** `StatusText`, polls `StatusBadge`, website
  `StatusChip`, `AgendaStatusPill`, the door knocking pill.
- **Exists in DS?** Partly: `Badge` exists, without status tones.
- **Priority:** medium · **Status:** proposed · ClickUp: —

### C-12 BottomBar

- **Solves:** G-59
- **Job:** a fixed bottom bar that clears the sidebar and the phone's safe
  area and tells the toast to sit above it.
- **Replaces today:** the per-page bars and the route list in
  `shared/utils/Snackbar.tsx`.
- **Exists in DS?** No (`StepFooter` covers flows only).
- **Priority:** medium · **Status:** proposed · ClickUp: —

### C-13 UserAvatar

- **Solves:** G-60
- **Job:** a person's picture, or their initials, or an icon, in one shape
  and set of sizes.
- **Replaces today:** `shared/user/UserAvatar.tsx`, the sidebar avatars and
  three copies of initials code.
- **Exists in DS?** Partly: check `avatar.tsx` in the styleguide first.
- **Priority:** low · **Status:** proposed · ClickUp: —

### C-14 ConfirmDialog

- **Solves:** G-41, G-45, G-52
- **Job:** confirms an action that can't be undone: a title that names the
  item, what's lost, "This can't be undone.", a destructive button that
  names the action, and a loading state.
- **Replaces today:** `shared/utils/AlertDialog.tsx`, `DeleteAction`,
  `DeleteListDialog`, `ConfirmDeleteDialog`. The turf removal dialog is the
  model.
- **Exists in DS?** Partly: `AlertDialog` exists; the content rules don't.
- **Priority:** high · **Status:** proposed · ClickUp: —

### C-15 Type scale (Heading, Text)

- **Solves:** G-57, G-66, part of G-14
- **Job:** the product's title and body sizes as tokens or components.
- **Replaces today:** `@shared/typography` and hand-picked `text-*` sizes on
  titles.
- **Exists in DS?** No.
- **Priority:** medium · **Status:** proposed · ClickUp: —

### C-16 CopyButton

- **Solves:** G-46
- **Job:** copies text, shows an inline check for about two seconds, falls
  back when the clipboard API fails, and says so when copying fails.
- **Replaces today:** `CopyToClipboard`, `CopyToClipboardButton` and
  per-surface copy code.
- **Exists in DS?** No.
- **Priority:** low · **Status:** proposed · ClickUp: —

### C-17 Leave guard

- **Solves:** G-42
- **Job:** warns before leaving an editor with unsaved changes, on in-app
  navigation and on closing the tab.
- **Replaces today:** per-flow "Discard changes?" dialogs.
- **Exists in DS?** No (a hook plus `ConfirmDialog`).
- **Priority:** medium · **Status:** proposed · ClickUp: —

### C-18 FileDropzone

- **Solves:** G-67
- **Job:** a dashed area that takes a dropped or picked file, with one
  hover look (`border-primary/50`, `bg-muted`), a drag-over look
  (`border-primary`), an error look and a busy state; the whole area opens
  the file picker.
- **Replaces today:** the hand-built zones listed in G-67 and
  `shared/inputs/FileDropZone.tsx`.
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

### A-04 Stepper

- **Solves:** G-61
- **Where it lives:** `packages/styleguide/src/components/ui/stepper.tsx`.

### A-05 Pagination

- **Solves:** G-47
- **Where it lives:** `packages/styleguide/src/components/ui/pagination.tsx`.
- **Note:** keep the page in the URL so Back returns to it.

### A-06 Alert

- **Solves:** G-63
- **Where it lives:** `packages/styleguide/src/components/ui/alert.tsx`.

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
