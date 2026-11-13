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
2026-10-22; G-41 onward as of 2026-11-02. G-75 to G-113, C-36 to C-40 and every "Also (audit
2026-11-12)" line come from the full audit; `product-design-gaps-locations.md`
lists every place found, by zone. G-114 onward, C-41 and every "Seen on
screen" line come from a visual pass over screenshots of 107 screens at 1280
and 375px on real Win and Serve accounts, plus 12 Serve screens shown with
generated data; the locations file lists them under "Visual pass".

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

## Who does what

Design can't build 41 components and review every fix, so the work is split
by what needs a design call, not by who usually writes the code. Design
takes the decisions and the components that set the visual language;
developers take everything with a clear rule or an existing pattern to copy.
Each component entry below carries an `Owner:` line.

### Design takes

- **One decision session** (design and product together), with options and a
  recommendation for each, before any component work. Product calls: G-83
  call logging, G-99 strategy dialog, G-133 poll topics, the org switch bug
  ticket. Design system calls: G-62 the 44px touch target, G-72 an accent
  color, G-68 the secondary button, G-40 flat panels or Card, G-17 where page
  actions sit, C-31 button text size. Each answer goes into the entry and the
  rulebook the same day.
- **Eight components now**, the ones that set the visual language and unblock
  wave 1: C-15 type scale; C-21 and C-22 neutral and status tokens; C-03
  RequirementNotice; C-04 PaymentErrorState; C-14 ConfirmDialog; C-23 Alert
  warning variant; C-29 Stepper; C-39 and C-40 the compose card. Why design:
  each one decides how every screen looks, and a developer building it in
  place makes one more local version.
- **Eight components later, on touch:** C-02, C-08, C-09, C-10, C-25, C-27,
  C-30, C-37. Built when work in that zone needs them, not up front.
- **Rulebook and `learned.md`:** every decision and every new component is
  written there in the same PR, so agents stop repeating the gap.

### Developers take

- **Twenty-three components** that copy an existing pattern or are mostly
  engineering: C-01, C-05, C-06, C-07, C-11, C-12, C-13, C-16, C-17, C-18,
  C-19, C-20, C-24, C-26, C-28, C-31 (after the decision), C-32, C-33,
  C-34, C-35, C-36, C-38, C-41. Design reviews the component PR once, not
  every place it lands.
- **Fixes ready now, by product zone** (one developer per zone, so PRs don't
  collide): every gap with no pending component, the hardcode rows in
  `product-design-gaps-locations.md`, adopting A-01 to A-06, and the product
  bugs. Inside a zone, wave 1 first.
- **Fixes after a component lands:** a gap that names a design-owned
  component waits for it, then is fixed in the zone's package.
- **Visual tests:** screenshot tests for the reference screens (§13) in CI,
  with test users and `design-memory/fixtures.md` data, so a fixed screen
  can't quietly regress.
- **A capture script to keep:** the 2026-11-12 capture ran under a real
  account and can't be committed. Commit one that signs in as test users
  with generated data and shoots every route at 1280 and 375, so the monthly
  pass below can run.

### How each piece ships

1. **A component ships with its first screen.** The PR that adds it also
   moves one real screen onto it, the reference screen where there is one.
   No component merges without a real use.
2. **Review by risk.** Every UI PR runs the agent pre-review against the
   rulebook and `learned.md`. Design reviews in person only high-severity
   gaps, reference screens and new components.
3. **Flags only for flow changes.** A change to what a step asks or where it
   leads goes behind a flag with a removal date. A look-only fix (spacing,
   copy, a token, a component swap with the same behavior) ships without one,
   so the product never carries two versions of a screen.
4. **A check-in after it ships.** Two weeks after a zone's package merges,
   design looks at that zone on screen at 1280 and 375 and adds anything new
   here.
5. **A monthly visual pass (proposed).** Every route at 1280 and 375 with
   test accounts and generated data, and the sprint cleanup of fixed
   entries in the same PR. It becomes required once the capture script
   above is merged; until then it can't run.

### What design needs from the team

- **Capacity:** one product zone per sprint for developers, plus "fix the
  gaps in any zone you touch". Without it, audit work loses to the roadmap.
- **Decision time:** one session for the list above. Each week a decision
  waits is a week its components and fixes wait.

## Migration order

The order to fix gaps in, from the 2026-11-12 audit
(`product-design-gaps-locations.md` has every place). Work a wave before the
next; inside a wave, top to bottom. Each line is one gap and why it sits
there.

**Wave 1: references, then high-severity problems on main paths.** Agents
copy the references, so they go first; the rest cost users money, data or
a dead end. The product bugs under "Found in the visual pass" are not design
work but outrank this whole list: ticket them first. The org switch is
noted, its ticket TBD.

- **G-74** Reference screens: every new screen copies them, so their
  mistakes spread until they're fixed.
- **G-36** Error copy: "Refresh to try again" drops a walk, a call list or a
  chat in progress.
- **G-87** Failures with no retry, or shown as empty: the user is told
  there's nothing when the load failed.
- **G-63** Hand-built error panels: about 16 copies in the outreach pay and
  compose steps, copied into each new channel.
- **G-08** Payment failures: each paid flow handles a decline differently,
  and the two pay references disagree.
- **G-09** Purchase error dead end: a failed purchase offers no way forward.
- **G-22** Loading: includes failures that render as the wrong state and a
  branded loader on the field tools.
- **G-23** Empty states: hand-built across every zone, including the
  office picker showing a failed lookup as empty.
- **G-41** Unconfirmed destructive actions: removing a teammate or clearing
  a story is one tap with no undo.
- **G-45** Confirm dialogs: five builds, including the shared
  `ConfirmDeleteDialog` agents reuse.
- **G-05** Disabled buttons with no reason: in every channel flow, the
  contacts wizard, onboarding and Pro upgrade.
- **G-06** Form errors in a toast: registration and Pro upgrade saves fade
  away.
- **G-56** Status shown in red: in-progress polls and proposed ordinances
  read as failures.
- **G-88** Red alerts that aren't failures: low poll confidence and "not
  enough responses yet".
- **G-31** Preview differs from what's sent: the poll review shows other text
  than the message that goes to voters.
- **AI summaries that contradict the page:** Know your opponent says District
  3 and two candidates where the page says District 1 and three, and
  community issue cards show the agent's internal scoring notes. Users act
  on wrong facts. Route to the AI team; see Product bugs.
- **G-90** Preview shows an image that won't be sent.
- **G-96** Candidate words to elected officials: Serve onboarding and polls.
- **G-54** Uncited Pro claims: the upgrade pitch leads with an unbacked
  number.
- **G-01** Flows with no URL per step: Back leaves create poll, the website
  builder and the contacts wizard.
- **G-91** Two poll creation flows: every poll fix lands twice until one goes.
- **G-92** Flows that end on a timer: the user can't read what they bought.
- **G-14** No single page header: Website, Account, poll detail and the
  legacy compliance flow have none or their own.
- **G-15** Two titles on one page: Voter data, the plan, Profile and
  community issues.
- **G-26** Tables with no phone layout: Team, polls and the campaign plan
  scroll sideways.
- **G-61** Old poll step indicator: a neutral primary and a wrong step count
  in a paid flow.
- **G-70** Low confidence modal: opens by itself with no way to close it.
- **G-103** Three office pickers: the change-office modal still runs the
  legacy one.
- **G-59** Hand-built bottom bars: onboarding's 896px flow shell is the first
  screen every user sees.
- **G-84** No way out: Questions (Win) and door knocking without district
  data (Serve) are full pages with no shell, back or close; the call panel
  and poll payment step too.
- **G-115** Content off the screen on a phone: Account's "Manage
  Subscription" runs past the edge. Public profile is in wave 3 until it
  reproduces on a real Serve account.
- **G-118** Jobs that start without district data: the official finds out
  on a later screen, or never.
- **G-124** Counter over the answer: Campaign story text is unreadable
  where the count sits.

**Wave 2: shared components and the shell.** One change here fixes many
screens at once.

- **G-55** Widths and edges: the layout's padding causes most drift; C-19.
- **G-69** Flow footers: three shells build every flow, so the change lands
  in three files.
- **G-04** Modal wrappers: retire `Modal`, `ResponsiveModal` and
  `ModalOrDrawer` for one switch at 1024px; C-01.
- **G-73** Prompts the product opens: one look for upgrade, term dates and
  sunset prompts.
- **G-12** Restyled components: the biggest count; fix in shared
  components first (`ListCard`, `ProPitchDialog`, the chat composer).
- **G-40** Div panels and `Paper`: delete `Paper` once its 14 importers move.
- **G-57** Old typography and off-scale titles: C-15 makes the fix one
  import.
- **G-81** Titles off the type scale: same fix as G-57.
- **G-75** Hidden overlay titles: fix with C-15 so `DrawerTitle` ships right.
- **G-58** Overlines: `Stepper`'s overline puts one on every flow; C-29.
- **G-13** Icon sets: the sidebar and shared nav first.
- **G-37** Title case: `navLabels.ts` fixes every tab at once.
- **G-16** Nav label vs page title: same file as G-37.
- **G-17** Page actions: `DashboardNavHeaderAction` already exists.
- **G-18** Back patterns: one back arrow in the header (A-01).
- **G-44** Busy buttons: `Button loading` everywhere, including confirms.
- **G-33** Raw buttons: shared menus and rows first.
- **G-07** Hand-built inputs: `TextField` and `RenderInputField` are used by
  about 25 files.
- **G-105** Unlinked labels: fix with G-07.
- **G-27** Unreachable controls: choice cards become `RadioCardItem`.
- **G-28** Focus on step change: lands in the three flow shells.
- **G-112** Icon-only buttons with no tooltip.
- **G-108** Field checks shown only as an icon: one shared component.
- **G-113** sm: and md: breakpoints: fix as each screen above is touched.
- **G-94** Raw palette colors: shared components and C-21 first.
- **G-60** Avatars: C-13.
- **G-62** Touch targets: decide the 44px reach, then change `small`.
- **G-67** Drop zones: C-18.
- **G-68** Secondary variant: C-24.
- **G-100** Hand-built celebrations: one `ConfettiBurst` rule.
- **G-98** Dead UI files: one cleanup PR so grep stops surfacing them.
- **G-20** Pro gating: C-02.
- **G-21** Silent redirects: C-03.
- **G-42** Leave guard: C-17.
- **G-46** Copy to clipboard: C-16.
- **G-47** Paging: A-05.
- **G-24** Dates: one helper.
- **G-25** Money: one formatter.
- **G-30** AI content: C-05.
- **G-114** Several primary buttons: `ListCard` makes 18 on Voter data, so
  one change to the shared card fixes most of them.

**Wave 3: per zone.** Fix while working in the zone.

- **G-50** Outreach: step titles differ by channel.
- **G-51** Outreach and purchase: success wording.
- **G-71** Outreach: channel colors on Serve tiles and the pay steps.
- **G-76** Outreach: details drawer footers.
- **G-77** Outreach: the archive view switch.
- **G-78** Outreach: "n/a" vs a dash.
- **G-79** Outreach: Win and Serve hub sections.
- **G-80** Outreach: email details.
- **G-82** Outreach: the closed SMS tile.
- **G-83** Phone banking: too many questions per call.
- **G-86** Outreach: drawer section failures.
- **G-89** Outreach: the Pro gate panel.
- **G-109** Outreach: compose field errors.
- **G-35** Door knocking: toast-only failures.
- **G-49** Door knocking: turfs called lists.
- **G-110** Door knocking and contacts: map panels; C-36.
- **G-111** Contacts and door knocking: filter group labels.
- **G-93** Polls: introductions in a Select.
- **G-95** Polls: unbacked claims.
- **G-97** Polls: the fake wait.
- **G-99** Campaign plan: strategy dialog (needs a decision first).
- **G-101** Website: toast-only failures.
- **G-72** Serve onboarding: accent color (needs a decision first).
- **G-104** Onboarding: steps built twice.
- **G-106** Auth: sign in vs sign up.
- **G-107** Shell: the org switcher.
- **G-102** Purchase: the generic purchase page.
- **G-52** Account: "can't be undone" wording.
- **G-53** Auth: sign in and setup names.
- **G-64** Texting compliance: the filing link field.
- **G-65** Account: deletion copy for Serve.
- **G-43** AI workspaces and profile: save feedback.
- **G-48** Campaign Manager naming.
- **G-39** Voter data nav to a sales page.
- **G-85** Copy pass in every zone: em dashes and system explanations.
- **G-115** Public profile: sideways scroll on a phone (seen with
  generated data).
- **G-116** Cut row titles and chat placeholder on a phone.
- **G-119** Civic panel: different numbers on desktop and phone.
- **G-120** Website: the editor opening a sheet by itself.
- **G-121** Shell: a dashboard not-found page.
- **G-122** Pro upgrade: filler steps and lines.
- **G-123** Texting compliance and Pro upgrade: the Add a policy priority
  control.
- **G-125** Profile: empty fields that can't be pressed.
- **G-126** Priorities: rows that show an instruction.
- **G-127** Account and Serve Outreach: buttons wrapping left on a phone.
- **G-128** Serve list pages: filters over nothing.
- **G-129** Chief of Staff: the "Start here" label.
- **G-130** Polls: one name and icon.
- **G-131** Community issues, Priorities and Ordinances: one ranked row and
  one card action; C-41.
- **G-132** Door knocking: the Serve entry point.
- **G-133** Polls: topics from priorities (needs a decision first).
- **G-134** Outreach: the history heading and caption.

## How to use this file

- **Building or changing UI in an area listed here:** fix the gap as part of
  the change if it's in scope, and set its status to fixed in the same PR.
- **Reviewing UI:** cite the ID (`G-07`) instead of re-describing the problem.
- **Found a new one:** add an entry under the matching section with the next
  free ID. IDs are never reused.
- **Fixed:** change the Status line to `fixed in #<PR>`; don't delete the
  entry. Many PRs touch this file at once, and deleting entries makes them
  conflict. Once a sprint, one PR removes every fixed entry and every
  approved component that has shipped.
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
- **Priority:** high / medium / low · **Status:** proposed / approved / rejected: why / exception until date · ClickUp: —
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

### R-02 Overlays: alert dialogs and the drawer column (§3)

- **Was:** "Dialog: a confirmation or a short, focused input", a bottom
  drawer on mobile.
- **Now:** a confirmation of something the user did that can't be undone or
  loses unsaved work is an `AlertDialog`, centered at every width, two
  buttons stacked with the primary on top. A dialog is for a short input and
  stays a bottom drawer below 1024px, with the drawer's 608px column.
  Stacked buttons put the primary on top everywhere.
- **Why:** a confirmation stretched into a full-width drawer on a tablet
  reads worse than the small centered alert the outreach flows already use
  ("Discard changes?"), and the styleguide `Drawer` already caps its content
  at 608px.
- **Status:** changed, awaiting review

### R-03 Body text is 14px (learned.md #22)

- **Was:** "Body and input text is 16px."
- **Now:** body text, list rows and table cells are 14px; badges and tags
  12px; inputs keep the styleguide's 16px on a phone and 14px from 768px.
- **Why:** the product is built at 14px (about 960 uses against 210), so the
  rule described a product we don't have and flagged every screen.
- **Status:** changed, awaiting review

### R-04 Flow buttons stack on a phone (§10)

- **Was:** two patterns. The outreach flows keep Back and the primary in
  one row at every width (`OutreachFlowShell.tsx`, "do not stack on
  mobile"); other flows stack below 640px (`StepFooter`).
- **Now:** on a phone the primary is a full-width large button on top, with
  at most two text buttons in one row under it; from 1024px one row. The
  buttons scroll with the step while the keyboard is open.
- **Why:** the row didn't hold a third button: the primary shrank to the
  width of its label and three buttons read as equal choices. It also cut a
  long primary label at 320px. The target is the market pattern, Back at
  the top left of the header (G-69); this is the step toward it.
- **Status:** changed, awaiting review

### R-05 One type scale by role (§8)

- **Was:** no scale written down. The legacy `@shared/typography` set (`H1`
  to `H6`, `Body1`, `Body2`) runs 12, 14, 16, 18, 20, 24, 32 and 36px with
  weights from 500 to 700, and styleguide titles pick their own sizes
  (`Dialog` and `Sheet` 18, `Drawer` and `AlertDialog` 20, `ContentCard` 18).
- **Now:** the same steps, 12, 14, 16, 18, 20, 24 and 32px, each with a
  role; 18px is the overlay title; every heading is 600; no 36px.
- **Why:** these sizes are already the product's; giving each one role stops
  the same step meaning two things (18px is a section title on some pages
  and the dialog title in the styleguide). `Drawer` and `AlertDialog` titles
  at 20px are a styleguide gap.
- **Status:** changed, awaiting review

### G-01 Multi-step flows run inside sheets with no URL per step

- **Rule:** §2 "Every flow is its own page"
- **What the user sees:** Back closes the whole flow instead of going one step
  back; refresh throws away the work; a step can't be linked.
- **Where:** SMS steps are local state inside `OutreachSheet`
  (`dashboard/outreach/v2/sms/SmsFlow.tsx`); the contacts wizard uses a local
  `stepIndex` (`dashboard/contacts/crm/wizard/CreateListWizard.tsx`). Already
  listed as a known gap in §3.
- **Also (audit 2026-11-12):** `dashboard/contacts/crm/shared/CrmSheet.tsx:48`, `dashboard/polls/create/CreatePoll.tsx:650`, `dashboard/team/components/InviteMemberDrawer.tsx:126`, `dashboard/website/create/components/WebsiteCreateFlow.tsx:64`, `dashboard/campaign-verification/components/CampaignVerificationSteps.tsx:100`, and 11 more, see `product-design-gaps-locations.md`.
- **Seen on screen (visual pass 2026-11-12):** Create new list (Win, desktop and mobile); Create new list next to import contacts and the outreach flows (Serve, desktop and mobile).
- **Proposal:** move each to a page with a route per step when it's next
  changed meaningfully.
- **Status:** open · ClickUp: —

### G-69 Flow navigation on a phone doesn't follow the market pattern

- **Rule:** §2 Flows, §10 Mobile
- **What the user sees:** Back sits at the bottom, next to the button that
  moves forward, so the two are easy to mix up. The primary button gets only
  the width Back leaves it, and a long label is cut off at 320px. Flows do
  this two ways: outreach flows keep Back and the primary in one row, while
  pro upgrade, campaign verification, poll expansion and texting compliance
  stack a full-width primary over Back. A second action would sit in the
  row as a third equal button. The phone's back gesture leaves the whole
  flow instead of going one step back (G-01).
- **Where:** `dashboard/outreach/v2/OutreachFlowShell.tsx` (footer row,
  `cta.secondary`), `dashboard/shared/StepFooter.tsx` (stack below 640px, 13
  steps), `dashboard/shared/FullScreenStepChrome.tsx` and
  `dashboard/outreach/v2/OutreachSheet.tsx` (header with the channel label
  and Exit).
- **Also (audit 2026-11-12):** `dashboard/pro-upgrade/components/GuidanceStep.tsx:246`, `dashboard/outreach/v2/OutreachFlowShell.tsx:245`, `dashboard/shared/StepFooter.tsx:31`, and 12 more, see `product-design-gaps-locations.md`.
- **Seen on screen (visual pass 2026-11-12):** Pro upgrade candidate profile (Win, desktop and mobile); New ordinance (Serve, desktop and mobile); create poll (Serve, mobile).
- **Today's rule:** §10 keeps Back at the bottom for now: on a phone, the
  primary at full width on top, then one row of at most two text buttons
  (Back, and one more). That's a step toward the proposal below, not the end
  state.
- **Proposal (the target, migrate to it next):** move Back to the top, the
  pattern used by banking, payments and booking apps. On a
  phone, Back is an arrow at the top left of the flow's header, and the
  bottom holds one or two actions: the primary at full width, with at most
  one secondary action as a text button under it. On desktop, the same
  header arrow, and the primary on the right of the footer. The phone's back
  gesture goes one step back, which needs a URL per step (G-01). The three
  shells above build every flow, so the change lands in those three files.
- **Status:** open · ClickUp: —

### G-70 Stacked buttons put the primary at the bottom

- **Rule:** §10 Mobile (when buttons stack, the primary is on top)
- **What the user sees:** in the poll "low confidence" dialog, "View
  partial results" sits above "Gather more feedback", so the main action is
  the second thing they read and the farthest from where the dialog opened.
- **Where:** `dashboard/polls/shared/components/LowConfidenceModal.tsx`
  builds its own button stack (`flex flex-col`) instead of the styleguide
  `DialogFooter`, which already stacks with the primary on top
  (`flex-col-reverse`).
- **Also (audit 2026-11-12):** `dashboard/polls/shared/components/LowConfidenceModal.tsx:40`, and 3 more, see `product-design-gaps-locations.md`.
- **Proposal:** use `DialogFooter` or `AlertDialogFooter`; any hand-built
  stack lists the primary first.
- **Status:** open · ClickUp: —

## 3. Pages, drawers and dialogs

### G-04 Several responsive modal components, none at 1024px

- **Rule:** §3 "Use one shared responsive component" (known gap there)
- **What the user sees:** the same kind of dialog becomes a drawer at
  different widths on different screens.
- **Where:** `shared/utils/Modal.tsx`, `shared/utils/ResponsiveModal.tsx`,
  `shared/ui/ModalOrDrawer.tsx` (768px), plus features doing their own
  `useIsMobile` switch.
- **Also (audit 2026-11-12):** `shared/utils/Modal.tsx:47`, `dashboard/briefings/components/detail/ShareBriefingDrawer.tsx:199`, `dashboard/website/components/ShareModal.tsx:19`, `dashboard/door-knocking/native/PanelDrawer.tsx:31`, and 15 more, see `product-design-gaps-locations.md`.
- **Across zones:** five overlay builds: `ModalOrDrawer` and `ResponsiveModal` at 768px, feature `useIsMobile` switches (the interim rule), bottom `Sheet`s posing as drawers, `Dialog` at every width, and hand-built fixed divs with a scrim.
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
- **Also (audit 2026-11-12):** `dashboard/outreach/v2/sms/SmsFlow.tsx:2008`, `dashboard/contacts/crm/wizard/CreateListWizard.tsx:783`, `dashboard/website/editor/components/WebsiteEditorPageStepper.tsx:55`, `onboarding/components/OnboardingFlow.tsx:1521`, `dashboard/briefings/components/notes-intake/AddNotesDialog.tsx:452`, and 42 more, see `product-design-gaps-locations.md`.
- **Seen on screen (visual pass 2026-11-12):** the first step of Create new list and import contacts (Win, desktop and mobile); Pro upgrade filing status (Win, desktop and mobile); Questions (Win, desktop and mobile); Add a priority, New ordinance and create poll (Serve, desktop and mobile); Sign up and New ordinance (Win and Serve, desktop and mobile).
- **Proposal:** keep the button active and show what's missing on press;
  disable only during submit, with a loading state.
- **Status:** open · ClickUp: —

### G-06 Form errors shown in a toast

- **Rule:** §4 "Never show a form error in a toast"
- **What the user sees:** a validation message that fades away.
- **Where:** `dashboard/public-profile/components/PublicProfileEditor.tsx`.
- **Also (audit 2026-11-12):** `dashboard/pro-upgrade/components/FilingStatusStep.tsx:91`, `dashboard/profile/texting-compliance/register/components/TextingComplianceRegisterPage.tsx:102`, `onboarding/components/OnboardingFlow.tsx:1336`, and 6 more, see `product-design-gaps-locations.md`.
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
- **Also (audit 2026-11-12):** `dashboard/purchase/components/PromoCodeSection.tsx:114`, `shared/inputs/RenderInputField.tsx:146`, `dashboard/profile/texting-compliance/shared/PinForm.tsx:158`, `shared/inputs/TextField.tsx:155`, `dashboard/public-profile/components/PrioritiesPublicationEditor.tsx:110`, and 15 more, see `product-design-gaps-locations.md`.
- **Across zones:** PIN entry is `InputOTP` in the new compliance card and six hand-built inputs in the legacy form.
- **Seen on screen (visual pass 2026-11-12):** the "Your why" field in Pro upgrade (Win, desktop and mobile); the public profile editor (Serve, desktop).
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
- **Also (audit 2026-11-12):** `dashboard/purchase/components/CheckoutForm.tsx:99`, `dashboard/outreach/v2/robocall/RobocallPayStep.tsx:441`, `dashboard/outreach/v2/sms/SmsReviewStep.tsx:447`, `dashboard/polls/shared/components/PollPayment.tsx:84`, and 13 more, see `product-design-gaps-locations.md`.
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
- **Also (audit 2026-11-12):** `dashboard/purchase/components/PurchaseError.tsx:19`, and 3 more, see `product-design-gaps-locations.md`.
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
- **Also (audit 2026-11-12):** `dashboard/briefings/components/annotations/AddNoteSheet.tsx:504`, `dashboard/team/components/TeamPage.tsx:381`, `dashboard/profile/components/NotificationSection.tsx:211`, `dashboard/campaign-story/components/CampaignStoryPage.tsx:287`, and 5 more, see `product-design-gaps-locations.md`.
- **Seen on screen (visual pass 2026-11-12):** Start over in Campaign story (Win, desktop and mobile).
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
- **Seen on screen (visual pass 2026-11-12):** the website editor (Win, desktop).
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
- **Seen on screen (visual pass 2026-11-12):** Profile (Serve, desktop and mobile).
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
- **Also (audit 2026-11-12):** `dashboard/outreach/v2/sms/SmsComposeStep.tsx:517`, `dashboard/ordinances/components/QualityReport.tsx:363`, `dashboard/door-knocking/native/RecordKnockStepForm.tsx:892`, `onboarding/components/OnboardingFlow.tsx:1517`, and 26 more, see `product-design-gaps-locations.md`.
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
- **Also (audit 2026-11-12):** `dashboard/outreach/v2/OutreachDetailsDrawer.tsx:1632`, `dashboard/shared/ConfirmDeleteDialog.tsx:80`, `shared/utils/AlertDialog.tsx:37`, `dashboard/contacts/crm/lists/DeleteListDialog.tsx:127`, `dashboard/website/editor/components/EditSettingsMenu.tsx:63`, and 19 more, see `product-design-gaps-locations.md`.
- **Across zones:** six builds of the same confirm across outreach, contacts, account, AI workspaces and shared: `variant="destructive"` with named buttons (the reference), a `className`-red action with a bare "Delete", the shared `ConfirmDeleteDialog`, the legacy `shared/utils/AlertDialog.tsx` with "Proceed", a default blue "Delete", and no confirm at all (team, notes, chats, priorities, story, website issues).
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
- **Also (audit 2026-11-12):** `dashboard/briefings/components/detail/ShareBriefingDrawer.tsx:192`. See `product-design-gaps-locations.md`.
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

### G-71 Serve channel tiles don't use the channel colors

- **Rule:** §9 (a channel keeps one color everywhere)
- **What the user sees:** on Serve's Outreach page the SMS and phone banking
  tiles are a lighter blue and pink than the same channels in Win and in the
  history badges right below them.
- **Where:** `dashboard/constituent-outreach/ServeChannelCards.tsx` sets
  its own `iconClassName` (`bg-info-light`, `bg-destructive-light`,
  `bg-secondary-light`) instead of `CHANNEL_META` in
  `dashboard/outreach/v2/channelMeta.tsx`, which Win uses.
- **Also (audit 2026-11-12):** `dashboard/constituent-outreach/ServeChannelCards.tsx:49`, `dashboard/outreach/v2/sms/SmsReviewStep.tsx:288`, and 3 more, see `product-design-gaps-locations.md`.
- **Seen on screen (visual pass 2026-11-12):** Outreach (Win, desktop and mobile); Outreach and the flow badges (Serve, desktop and mobile).
- **Proposal:** take the tint from `CHANNEL_META`, as Win does.
- **Status:** open · ClickUp: —

### G-72 No rule for an accent color

- **Rule:** none yet
- **What the user sees:** decoration borrows status colors, like orange
  `warning` on the Serve onboarding district story, so a color that should
  mean "this needs you" means nothing in particular.
- **Where:** `serve/onboarding/districtStory/DistrictStoryStep.tsx`; the
  `accent` token is green inside styleguide components and near-white
  outside (`packages/styleguide/src/styleguide-scope.css`), and the product
  doesn't use it.
- **Also (audit 2026-11-12):** `serve/onboarding/districtStory/DistrictStoryStep.tsx:298`, and 2 more, see `product-design-gaps-locations.md`.
- **Proposal:** decide whether the product has an accent color at all; until
  then, decoration uses `primary` or `muted`.
- **Status:** open, no decision · ClickUp: —

### G-73 Prompts the product opens on its own look different each time

- **Rule:** none yet
- **What the user sees:** the windows that open without a click (the Pro
  upgrade prompt, the term dates prompt, the website sunset notice) and the
  upgrade and office prompts opened from features each have their own
  layout, title size, buttons and close behavior, so the same kind of moment
  reads as a different product each time.
- **Where:** `dashboard/shared/ProUpgradePrompt.tsx` and
  `ProUpgradeModal.tsx`, `P2PUpgradeModal.tsx`, `AlreadyProUserPrompt.tsx`,
  `ElectedOfficeTermDatesModalController.tsx` and
  `ElectedOfficeTermDatesModal.tsx`, `WebsiteSunsetModalController.tsx` and
  `WebsiteSunsetModal.tsx`, `ElectedOfficeSelectionModal.tsx`,
  `CampaignOfficeSelectionModal.tsx`, `ComplianceModal.tsx` (all in
  `dashboard/shared/`); several are built on the legacy `ResponsiveModal`.
- **Also (audit 2026-11-12):** `dashboard/shared/ElectedOfficeTermDatesModal.tsx:121`, `dashboard/shared/ProUpgradeModal.tsx:210`, `dashboard/outreach/v2/gate/GateExplainerModal.tsx:102`, and 12 more, see `product-design-gaps-locations.md`.
- **Proposal:** keep these prompts; they're how the product asks for an
  upgrade or missing details. Bring them onto one look: either the
  styleguide `Dialog` and `Drawer` as they ship, or one prompt component
  proposed in #tmp-design-agent. Don't remove any of them as part of this.
- **Status:** open · ClickUp: —

### G-74 Reference screens break the rules they're cited for

- **Rule:** §7 step 1, §13
- **What the user sees:** nothing directly; agents copy these screens, so
  their mistakes spread to new screens.
- **Where:** the files `product-design.md` cites as references, and what
  each gets wrong:
  - `dashboard/contacts/crm/import/UploadHistory.tsx` (empty state, §13): a
    hand-built sticky second bar for Back and the action, a failed load with
    no Try again, a restyled Button.
  - `dashboard/outreach/v2/OutreachHistoryTable.tsx` (table to cards): empty
    and no-match as muted text with no Clear filters, an 18px section title,
    the archive switch (G-77), paging faked with `className`; its table
    restyle is already copied into `UploadHistory` (C-32).
  - `dashboard/outreach/v2/outreachHistoryCopy.ts` (empty wording):
    "cancelled", and copy that describes clicking Archive (G-85).
  - `dashboard/outreach/v2/sms/SmsReviewStep.tsx` and
    `dashboard/outreach/v2/robocall/RobocallPayStep.tsx` (payment):
    failures as red-bordered `Card`s, a hand spinner, the charge stated two
    ways, status colors as channel colors (G-08, G-71), a thin robocall
    success view (G-92), "Review & pay".
  - `dashboard/outreach/v2/sms/SmsComposeStep.tsx` (message field): raw
    remove and drop zone buttons, recolored footer actions with negative
    margins (C-39), errors piled under the card (G-109).
  - `dashboard/outreach/v2/OutreachFlowShell.tsx` (confirm, flow shell):
    "Discard" with no object, footer that never stacks (G-69), an overline
    in every header (C-29).
  - `dashboard/shared/FullScreenStepChrome.tsx` (flow width): `bg-white`,
    608px hardcoded three times, 20px padding, required overline.
  - `dashboard/priorities/components/PrioritiesHub.tsx` and
    `dashboard/priorities/page.tsx` (hub): hand-built uppercase filter
    chips, the primary in content, div cards (G-40), 12px faded text, 672px
    with md: edges and `pb-28`, rows whose description is a muted
    instruction cut mid-sentence (G-126), filters shown over an empty list
    (G-128).
  - `dashboard/race-opponent/components/OpponentResearchProgress.tsx` (long
    job): a hand spinner, a title that resizes at sm:, light success green.
  - `dashboard/outreach/v2/channelMeta.tsx` (status): a `lucide-react` icon
    import, "n/a" for no status (G-78).
  - `dashboard/door-knocking/native/TurfDetailsSheet.tsx` (tokens): "Refresh
    to try again" with an em dash, hand pulse and progress bars, a 22px
    title, div panels.
  - `dashboard/contacts/crm/VoterDataUnavailableState.tsx` (someone else acts
    next): a hand-built centered card instead of `EmptyState`.
  - `volunteer/components/AssignmentsPage.tsx` (three states): "Something
    went wrong" under a good title, a hand-built empty card, a 30px title in
    a 768px column.
  - `dashboard/polls/shared/ConstituentDataUnavailable.tsx` (errors):
    "Something went wrong on our end" in a hand-built div.
  - `dashboard/shared/DashboardNavHeader.tsx` (page title): 24px edges at
    every width.
  - Screens that copy a reference's mistake: `WhatWeHeardPage.tsx` copies the
    Voter data second bar. `dashboard/contacts/crm/CrmContactsPage.tsx` is no
    longer a reference (G-15, G-17); `dashboard/shared/ConfirmDeleteDialog.tsx`
    is no longer one either (G-45).
- **Proposal:** one small PR per file that brings each up to the rules, so
  the examples agents copy are right. The rulebook already points at
  components where a screen is wrong.
- **Status:** open, do first after the rulebook lands: until then, copying a
  reference under §7 step 1 copies its restyles too · ClickUp: —

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
- **Also (audit 2026-11-12):** `dashboard/contacts/crm/wizard/VoterFileStep.tsx:273`, `dashboard/chief-of-staff/components/TaskCard.tsx:72`, `dashboard/priorities/components/PrioritiesHub.tsx:209`, `dashboard/shared/agent-chat/chatUI.tsx:510`, `dashboard/contacts/crm/lists/ListCard.tsx:156`, and 143 more, see `product-design-gaps-locations.md`.
- **Across zones:** two patterns built many ways. Choice cards: `RadioCardItem` (onboarding only), a `Card` with `role="button"`, raw `aria-pressed` buttons or clickable divs, a restyled `ToggleGroup`, a restyled `Label`. Filter pills: `FilterPillGroup` as shipped, `FilterPill` restyled, `ToggleGroup` restyled through shared constants, and raw button pills.
- **Seen on screen (visual pass 2026-11-12):** the website editor section list (Win, desktop and mobile); the Create new list Continue button (Win, desktop); Campaign story (Win, desktop and mobile); the Briefings and Chief of Staff cards (Serve, desktop and mobile); the sign-in and Briefings cards (Win and Serve, desktop and mobile).
- **Proposal:** build only from DS components through props and variants; no
  visual overrides (layout and spacing are fine). Missing look → add a
  variant to the styleguide or flag a DS gap.
- **Status:** open · ClickUp: —

### G-68 The secondary Button variant isn't the product's secondary button

- **Rule:** none yet (§7 says use a component as it ships, so the variant
  name has to match its job)
- **What the user sees:** a second action is almost always an outline or
  ghost button, but a few screens show a purple one, which reads as a
  different kind of action.
- **Where:** `Button variant="secondary"` (lavender, `--theme-secondary`) is
  used for a button in only four places, against 233 `outline` and 161
  `ghost`:
  - `dashboard/door-knocking/native/createFlow/DoorsPanel.tsx` (two "Try
    again" buttons)
  - `dashboard/shared/testMode/TestModeSheet.tsx`
  - `shared/layouts/navigation/LeftSide.tsx` (restyled with `bg-secondary`)
- **Also (audit 2026-11-12):** `dashboard/campaign-plan/components/legacy/campaignStrategy/CampaignStrategySection.tsx:232`, and 2 more, see `product-design-gaps-locations.md`.
- **Seen on screen (visual pass 2026-11-12):** texting compliance candidate profile (Win, desktop and mobile); Website (Win, desktop and mobile).
- **Proposal:** decide in the styleguide what the secondary action is. Either
  make `outline` the documented secondary button in `Button`'s `@summary` and
  drop or rename the lavender `secondary`, or redefine `secondary` to look
  like what the product already uses. Then move the four places onto it. An
  agent reading the variant names today would pick the purple one.
- **Status:** open · ClickUp: —

### G-13 Three icon sets

- **Rule:** none yet
- **What the user sees:** icons of different weight and style side by side,
  including in the sidebar.
- **Where:** `react-icons` (about 40 dashboard files, including
  `dashboard/shared/DashboardMenu.tsx`), direct `lucide-react` imports and
  DS icons.
- **Also (audit 2026-11-12):** `dashboard/campaign-details/components/issues/IssuesIcon.tsx:1`, `dashboard/polls/[id]/components/PollAudience.tsx:6`, `dashboard/shared/DashboardMenu.tsx:13`, `dashboard/outreach/v2/channelMeta.tsx:2`, `onboarding/components/PledgeStep.tsx:3`, and 28 more, see `product-design-gaps-locations.md`.
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
- **Also (audit 2026-11-12):** `dashboard/polls/shared/audience-selection.tsx:173`, `dashboard/pro-upgrade/components/FilingStatusStep.tsx:123`, `onboarding/components/StoryFieldBar.tsx:129`, `dashboard/chief-of-staff/components/TaskCard.tsx:132`, `dashboard/outreach/v2/audience/OutreachAudienceStep.tsx:473`, and 41 more, see `product-design-gaps-locations.md`.
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
- **Also (audit 2026-11-12):** `dashboard/pro-upgrade/components/PaymentStep.tsx:42`, `dashboard/priorities/components/PrioritiesHub.tsx:236`, `shared/utils/Paper.tsx:15`, `dashboard/website/components/EmptyState.tsx:18`, `dashboard/polls/[id]/components/PollMessage.tsx:27`, and 41 more, see `product-design-gaps-locations.md`.
- **Across zones:** four card builds: `Card`, `ContentCard` and `ChannelCard` as shipped, `Card` restyled (radius, shadow, borders), div panels or `Paper`, and channel tiles built as links instead of `ChannelCard`.
- **Seen on screen (visual pass 2026-11-12):** Polls (Serve, desktop and mobile); the website notice on Profile (Win, desktop and mobile); the Briefings hero (Serve, desktop and mobile).
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
- **Also (audit 2026-11-12):** `dashboard/community-issues/components/IssueCard.tsx:12`, `dashboard/ordinances/data/statuses.ts:36`, `dashboard/polls/[id]/components/StatusAlert.tsx:17`, `dashboard/polls/components/StatusBadge.tsx:19`, `dashboard/community-issues/components/IssueDetail.tsx:113`, and 25 more, see `product-design-gaps-locations.md`.
- **Across zones:** five status looks: `StatusText` through `HistoryStatusText` (the reference), `Badge` tinted by `className`, hand-built dot pills or solid boxes, `Alert` variants as status, and plain text.
- **Seen on screen (visual pass 2026-11-12):** Ordinances (Serve, desktop and mobile); Priorities and Ordinances (Serve, desktop and mobile); Polls (Serve, desktop and mobile); Know your opponent (Win, desktop and mobile); and 1 more, see the locations file.
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
- **Also (audit 2026-11-12):** `dashboard/pro-upgrade/components/ProUpgradeWizard.tsx:96`, `dashboard/account/components/PersonalInformationCard.tsx:152`, `dashboard/door-knocking/native/TurfDetailsSheet.tsx:352`, `polls/onboarding/components/steps/InsightsStep.tsx:31`, `dashboard/priorities/[priorityId]/components/PriorityWorkspace.tsx:1022`, and 60 more, see `product-design-gaps-locations.md`.
- **Seen on screen (visual pass 2026-11-12):** Poll detail (Serve, desktop and mobile).
- **Proposal:** a type scale in the styleguide (C-15); retire
  `@shared/typography` as screens are touched.
- **Also:** the styleguide has no type tokens. Every size is a Tailwind
  step (12 to 24px), and its own titles disagree: `PageHeader` and
  `EmptyState` 16px, `DialogTitle` 18px, `AlertDialogTitle` and
  `DrawerTitle` 20px, the flow step title (24px) is nowhere in the
  styleguide. The rulebook's scale by role (§8) needs tokens or a `Heading`
  component behind it; propose it in #tmp-design-agent.
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
- **Also (audit 2026-11-12):** `dashboard/polls/components/PollImageUpload.tsx:61`, `dashboard/campaign-details/components/cards/ProfileHeroCard.tsx:36`, `dashboard/outreach/v2/sms/SmsComposeStep.tsx:385`, `shared/inputs/FileDropZone.tsx:112`, and 7 more, see `product-design-gaps-locations.md`.
- **Seen on screen (visual pass 2026-11-12):** the website logo upload (Win, desktop and mobile); import contacts (Win, mobile); import contacts (Serve, mobile).
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
- **Also (audit 2026-11-12):** `dashboard/briefings/components/detail/AgendaItemCard.tsx:30`, `dashboard/race-opponent/components/RaceOpponentList.tsx:113`, `dashboard/door-knocking/native/RecordKnockStepForm.tsx:103`, `dashboard/outreach/v2/audience/OutreachAudienceStep.tsx:655`, `dashboard/outreach/phone-banking/[listId]/PhoneBankingOutcomeStepForm.tsx:629`, and 59 more, see `product-design-gaps-locations.md`.
- **Seen on screen (visual pass 2026-11-12):** Recommended voter lists (Win, desktop and mobile); Create new list and import contacts (Win, desktop and mobile); Pro upgrade (Win, desktop and mobile); Briefing detail (Serve, desktop and mobile); Community issues (Serve, desktop and mobile); and 5 more, see the locations file.
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
- **Also (audit 2026-11-12):** `shared/layouts/navigation/ProfileDropdown.tsx:128`, `volunteer/VolunteerSidebar.tsx:193`, and 5 more, see `product-design-gaps-locations.md`.
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
- **Also (audit 2026-11-12):** `dashboard/polls/[id]/expand/shared/ExpandStepFooter.tsx:25`, and 4 more, see `product-design-gaps-locations.md`.
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
- **Also (audit 2026-11-12):** `dashboard/outreach/v2/robocall/RobocallComposeStep.tsx:173`, `dashboard/door-knocking/native/NativeDoorKnockingPage.tsx:1460`, `dashboard/race-opponent/components/RaceOpponentList.tsx:672`, `polls/onboarding/components/ErrorMessage.tsx:19`, `dashboard/shared/ai-chat/AiChatBody.tsx:410`, and 40 more, see `product-design-gaps-locations.md`.
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
- **Also (audit 2026-11-12):** `dashboard/briefings/components/annotations/AskAiChatBody.tsx:537`, `dashboard/door-knocking/native/useVoterPack.ts:36`, `dashboard/outreach/v2/email/emailApi.ts:283`, `dashboard/door-knocking/native/TurfDetailsSheet.tsx:505`, `dashboard/shared/agent-chat/cards/cardShell.tsx:8`, and 73 more, see `product-design-gaps-locations.md`.
- **Across zones:** seven builds of a failure: `Alert` with Try again (the reference), `Alert` with no action, a red-bordered `Card`, a hand-tinted box, a red paragraph saying refresh, a toast or silent empty, and the legacy `StyledAlert`, `FilledErrorAlert` and `PurchaseError`.
- **Seen on screen (visual pass 2026-11-12):** the Serve sign-in link error (signed out, desktop and mobile).
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
- **Also (audit 2026-11-12):** `dashboard/polls/create/CreatePoll.tsx:258`, `dashboard/profile/texting-compliance/register/components/TextingComplianceRegistrationForm.tsx:803`, `dashboard/shared/navLabels.ts:47`, `dashboard/contacts/crm/person/StatusRow.tsx:40`, `dashboard/polls/components/PollPreview.tsx:29`, and 33 more, see `product-design-gaps-locations.md`.
- **Seen on screen (visual pass 2026-11-12):** the nav and title bars (Win, desktop and mobile); the nav and title bars (Serve, desktop and mobile); texting compliance registration (Win, desktop and mobile); Constituents (Serve, desktop and mobile); Account (Win, desktop and mobile); and 5 more, see the locations file.
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
- **Seen on screen (visual pass 2026-11-12):** Team (Win, desktop and mobile).
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
- **Also (audit 2026-11-12):** `dashboard/outreach/v2/robocall/RobocallComposeStep.tsx:279`, `dashboard/outreach/v2/sms/SmsReviewStep.tsx:273`, and 7 more, see `product-design-gaps-locations.md`.
- **Seen on screen (visual pass 2026-11-12):** the door knocking first step (Win, desktop and mobile); the first step of every outreach flow (Serve, desktop and mobile).
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
- **Also (audit 2026-11-12):** `dashboard/outreach/v2/sms/SmsFlow.tsx:474`, `dashboard/contacts/crm/wizard/CreateListWizard.tsx:477`, `dashboard/purchase/complete/page.tsx:62`, `dashboard/ordinances/components/DraftDetail.tsx:918`, and 17 more, see `product-design-gaps-locations.md`.
- **Across zones:** four endings: a per-channel success screen with "Done", confetti with a receipt card, an auto-redirect with "momentarily" (G-92), and a toast then a redirect.
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
- **Also (audit 2026-11-12):** `dashboard/account/components/DeleteAccountPage.tsx:102`, and 3 more, see `product-design-gaps-locations.md`.
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
- **Also (audit 2026-11-12):** `sign-up/SignUpForm.tsx:272`, and 8 more, see `product-design-gaps-locations.md`.
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
- **Also (audit 2026-11-12):** `dashboard/pro-upgrade/components/ValuePropStep.tsx:148`, `dashboard/pro-upgrade/components/GuidanceStep.tsx:260`, and 4 more, see `product-design-gaps-locations.md`.
- **Seen on screen (visual pass 2026-11-12):** Pro upgrade value prop (Win, desktop and mobile).
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
- **Also (audit 2026-11-12):** `dashboard/profile/texting-compliance/shared/TextingComplianceHeader.tsx:15`, `dashboard/race-opponent/opponents/page.tsx:79`, `dashboard/polls/[id]/components/PollsDetailPage.tsx:52`, `dashboard/website/components/WebsitePage.tsx:40`, `dashboard/account/components/AccountProfilePage.tsx:33`, and 32 more, see `product-design-gaps-locations.md`.
- **Across zones:** four ways to title a page: `navHeader` (the reference), `navHeader` plus a second h1, the legacy `DashboardPageHeader`, and a hand-built sticky bar with its own h1.
- **Seen on screen (visual pass 2026-11-12):** Self-research (Win, desktop and mobile); Website (Win, desktop); the Team, Profile and Account title bars (Win, desktop and mobile); the Chief of Staff archive (Serve, desktop and mobile).
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
- **Also (audit 2026-11-12):** `dashboard/community-issues/components/IssuesNavHeader.tsx:7`, `dashboard/contacts/crm/CrmContactsPage.tsx:167`, `dashboard/campaign-details/components/DetailsPage.tsx:50`, `dashboard/campaign-plan/components/CampaignTrackerHero.tsx:62`, `dashboard/contacts/crm/lists/ListsIndex.tsx:142`, and 18 more, see `product-design-gaps-locations.md`.
- **Seen on screen (visual pass 2026-11-12):** Profile (Win, desktop and mobile); Profile (Serve, desktop and mobile); Profile, Archive and the civic panel (Serve, mobile).
- **Proposal:** one title per page; anything below it is a section heading.
- **Status:** open · ClickUp: —

### G-16 Nav label and page title differ

- **Rule:** none yet
- **What the user sees:** "Team" opens "Team Settings"; "Profile" is "My
  Profile" in the mobile top bar.
- **Where:** `dashboard/shared/navLabels.ts`,
  `dashboard/shared/DashboardLayout.tsx` (mobile titles),
  `dashboard/shared/DashboardMenu.tsx`.
- **Seen on screen (visual pass 2026-11-12):** Profile and Public profile (Win, desktop and mobile); Import history (Win, mobile); every nav title (Serve, desktop and mobile).
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
- **Also (audit 2026-11-12):** `dashboard/ordinances/components/MyOrdinancesSection.tsx:61`, `dashboard/polls/components/PollsPage.tsx:64`, `dashboard/team/components/TeamPage.tsx:271`, and 6 more, see `product-design-gaps-locations.md`.
- **Across zones:** four places for a page's main action: `DashboardNavHeaderAction` (the reference), a Button in the content, a second bar under the title, and a fixed desktop bottom bar.
- **Seen on screen (visual pass 2026-11-12):** Voter data (Win, desktop and mobile); Profile (Win, desktop and mobile); Polls (Serve, desktop and mobile); Ordinances, Priorities and Import history (Serve, desktop and mobile); and 2 more, see the locations file.
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
- **Also (audit 2026-11-12):** `dashboard/community-issues/components/IssueDetail.tsx:102`, `dashboard/outreach/v2/poll/results/PollResultsPage.tsx:401`, `dashboard/contacts/crm/import/UploadHistory.tsx:67`, `dashboard/polls/[id]/issue/[issueIndex]/components/PollIssueDetailPage.tsx:40`, and 14 more, see `product-design-gaps-locations.md`.
- **Across zones:** five back patterns: a ghost `IconButton` with an arrow (closest to the rule), a bordered circle `Link`, a text link, a ghost "Back" button, and a breadcrumb plus arrow.
- **Seen on screen (visual pass 2026-11-12):** Import history (Win, desktop and mobile); texting compliance registration (Win, desktop and mobile); Poll results (Serve, desktop and mobile); Community issues all and trending (Serve, desktop and mobile); Archive and the civic panel (Serve, desktop and mobile); and 2 more, see the locations file.
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
- **Also (audit 2026-11-12):** `dashboard/community-issues/components/IssueFeedList.tsx:153`, `dashboard/campaign-details/components/DetailsPage.tsx:66`, `dashboard/account/components/AccountProfilePage.tsx:38`, `dashboard/contacts/crm/CrmContactsPage.tsx:205`, `dashboard/campaign-manager/CampaignManagerHome.tsx:51`, and 61 more, see `product-design-gaps-locations.md`.
- **Across zones:** columns of 560, 608, 640, 672, 700, 720, 768, 896, 1120 and 1180px across seven zones; edges as the layout's padding plus the page's own, `!p-0` with five different paddings, or `!p-0` with `px-4 lg:px-6` (only `ConstituentOutreachPage.tsx`); bottom space from none to `pb-40`.
- **Seen on screen (visual pass 2026-11-12):** Voter data (Win, desktop and mobile); Team (Win, desktop and mobile); Polls, Archive and Profile (Serve, desktop and mobile); Constituents, Community issues and Public profile (Serve, mobile); and 2 more, see the locations file.
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
- **Also (audit 2026-11-12):** `onboarding/components/OnboardingFlow.tsx:1377`, `dashboard/contacts/crm/assistant/AssistantBar.tsx:72`, `dashboard/chief-of-staff/components/chat/FooterChatBar.tsx:79`, `polls/onboarding/components/OnboardingPage.tsx:278`, `dashboard/website/domain/components/DomainSearch.tsx:166`, and 20 more, see `product-design-gaps-locations.md`.
- **Across zones:** six flow chromes: the `OutreachFlowShell` row, `FullScreenStepChrome` with `StepFooter`, hand-built fixed footers (onboarding, texting compliance, domain checkout, election result, legacy Pro), local steppers (website editor, polls), the `CrmSheet` footer, and a chat-driven flow with no footer.
- **Proposal:** C-12.
- **Status:** open · ClickUp: —

### G-62 Touch targets on a phone are under 44px

- **Rule:** none yet. Best practice is at least 44px for a finger (Apple's
  minimum; Google's is 48px).
- **What the user sees:** in the field tools, used standing, one-handed and
  on the move, the buttons are small enough to hit the wrong one: "Save
  note", "Add a note", "Not a voter", "Do not knock", "Close route" and the
  phone banking script and call buttons are 32px; door outcome pills are
  34px; call outcomes about 32px; door navigation is 40px. A wrong tap logs
  the wrong outcome. Elsewhere some buttons are shrunk to 32px only on a
  phone (`max-sm:h-8`).
- **Where:** `dashboard/door-knocking/native/DoorNotesCard.tsx`,
  `WalkSurface.tsx`, `PersonSheet.tsx`, `RecordKnockStepForm.tsx` (34px
  pills), `NotAVoterControl.tsx`, `DoNotKnockControl.tsx`;
  `dashboard/outreach/phone-banking/[listId]/PhoneBankingCallerPage.tsx`,
  `PhoneBankingOutcomeStepForm.tsx`; `volunteer/door-knocking/[turfId]/VolunteerWalkPage.tsx`;
  phone-only shrink in `chief-of-staff/components/TaskStack.tsx`,
  `campaign-plan/.../NextTaskCard.tsx`, `ElectionResultHomeCard.tsx`.
  `small` is `h-8` in `packages/styleguide/src/components/ui/button.tsx`;
  about 240 small Buttons render below 1024px.
- **Also (audit 2026-11-12):** `dashboard/chief-of-staff/components/TaskStack.tsx:75`, and 2 more, see `product-design-gaps-locations.md`.
- **Proposal:** none agreed. The problem is known; how far a 44px minimum
  should reach (the field tools only, or every control on a phone) is still
  open.
- **Status:** open, no solution chosen · ClickUp: —

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
- **Also (audit 2026-11-12):** `dashboard/door-knocking/native/DoorKnockingPageGate.tsx:80`, `dashboard/race-opponent/components/OpponentProLockedView.tsx:105`, and 3 more, see `product-design-gaps-locations.md`.
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
- **Seen on screen (visual pass 2026-11-12):** Enter PIN (Win, desktop and mobile).
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
- **Also (audit 2026-11-12):** `dashboard/chief-of-staff/components/TaskStack.tsx:326`, `dashboard/website/components/WebsiteVisits.tsx:83`, `dashboard/profile/texting-compliance-agentic/components/ProUpgrade3Compliance.tsx:75`, `dashboard/campaign-story/components/CampaignStoryPage.tsx:89`, `volunteer/door-knocking/[turfId]/VolunteerWalkPage.tsx:257`, and 81 more, see `product-design-gaps-locations.md`.
- **Across zones:** seven builds of a wait across all eight zones: `Skeleton`, `Spinner`, a hand `animate-spin` icon, hand `animate-pulse` divs, bare "Loading..." text, a full-screen branded loader or black overlay, and custom keyframe dots.
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
- **Also (audit 2026-11-12):** `dashboard/ordinances/components/MyOrdinancesSection.tsx:88`, `onboarding/components/OfficeSelectionStep.tsx:487`, `dashboard/polls/components/PollsTable.tsx:42`, `dashboard/contacts/crm/lists/ListsIndex.tsx:157`, `dashboard/contacts/crm/VoterDataUnavailableState.tsx:35`, and 27 more, see `product-design-gaps-locations.md`.
- **Across zones:** five builds of an empty list: `EmptyState` as shipped, `EmptyState` restyled, a muted sentence with no action, local components named `EmptyState` or `SurfaceEmptyState`, and a large centered heading or hero.
- **Seen on screen (visual pass 2026-11-12):** Website visits (Win, desktop and mobile); Campaign plan after the election (Win, desktop and mobile); Team, Public profile and Briefings (Serve, desktop and mobile); Archive and Community issues all (Serve, desktop and mobile); Ordinances and Outreach (Serve, desktop and mobile); and 2 more, see the locations file.
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
- **Also (audit 2026-11-12):** `dashboard/polls/components/PollPreview.tsx:36`, and 1 more, see `product-design-gaps-locations.md`.
- **Seen on screen (visual pass 2026-11-12):** Briefings (Serve, desktop and mobile); Outreach history next to Import history (Win, desktop and mobile).
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
- **Also (audit 2026-11-12):** `dashboard/team/components/TeamPage.tsx:282`, `dashboard/polls/components/PollsTable.tsx:48`, `onboarding/success/components/PlanSections.tsx:159`, `shared/utils/SimpleTable.tsx:29`, and 6 more, see `product-design-gaps-locations.md`.
- **Across zones:** four table builds: `Table` with a hand-built card list under 1024px and `!important` restyles, `Table` with no phone layout, raw tables (`SimpleTable`, `PlanSections`), and `divide-y` link rows in divs.
- **Seen on screen (visual pass 2026-11-12):** Team (Win, desktop and mobile); Polls (Serve, mobile).
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
- **Also (audit 2026-11-12):** `dashboard/questions/components/issues/IssuePosition.tsx:22`, `onboarding/[slug]/[step]/components/ballotOffices/BallotRaces.tsx:356`, `dashboard/election-result/components/ResultOptionButton.tsx:24`, `dashboard/website/domain/components/DomainResult.tsx:30`, and 3 more, see `product-design-gaps-locations.md`.
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
- **Also (audit 2026-11-12):** `dashboard/race-opponent/components/SourceChip.tsx:116`, and 2 more, see `product-design-gaps-locations.md`.
- **Seen on screen (visual pass 2026-11-12):** Community issues (Serve, desktop and mobile); Know your opponent (Win, desktop and mobile).
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
- **Also (audit 2026-11-12):** `dashboard/polls/create/CreatePoll.tsx:550`, and 2 more, see `product-design-gaps-locations.md`.
- **Proposal:** one opt-out line, defined once.
- **Status:** open · ClickUp: —

## Found in the 2026-11-12 audit

Gaps the full audit found that no entry above covered. Every place is in
`product-design-gaps-locations.md` under the same ID.

### G-75 Overlay titles hand-built while the real title is hidden

- **Rule:** §8 type scale, §3
- **What the user sees:** the title of a drawer or call panel is larger and
  bolder than every other overlay title (22px, or 24px bold), and a screen
  reader hears a different, hidden title.
- **Where:** `dashboard/outreach/v2/OutreachDetailsDrawer.tsx:863` (visible
  22px h2, `DrawerTitle` sr-only),
  `dashboard/outreach/phone-banking/[listId]/PhoneBankingEntryPanel.tsx:183`
  (24px bold name, `SheetTitle` and `DrawerTitle` sr-only).
- **Proposal:** show `DrawerTitle`, `SheetTitle` or `DialogTitle` as they
  ship, visible. `DrawerTitle` ships at 20px where §8 says 18px; that's C-15,
  not a call-site fix.
- **Status:** open · ClickUp: —

### G-76 The outreach details footer is rebuilt for every state

- **Rule:** §7, §8
- **What the user sees:** the buttons at the bottom of an outreach's details
  sit at slightly different widths and spacing depending on whether it's a
  draft, a poll in progress, a failed payment or a canceled send.
- **Where:** `dashboard/outreach/v2/OutreachDetailsDrawer.tsx:701` and five
  more footers in the same file (752, 758, 775, 791, 810), beside
  `ListDetailsFooter`, which already exists for this slot.
- **Proposal:** route every state through `ListDetailsFooter` (or
  `DrawerFooter` as it ships).
- **Status:** open · ClickUp: —

### G-77 View switches built from pressed buttons

- **Rule:** `packages/styleguide/COMPONENTS.md` (`ToggleGroup`: never a
  `Button` with `aria-pressed`)
- **What the user sees:** "Archive" in outreach history reads as an action;
  its label flips to "Back to active" instead of showing two views side by
  side.
- **Where:** `dashboard/outreach/v2/OutreachHistoryTable.tsx:684` (a
  reference screen, so agents copy it).
- **Proposal:** `ToggleGroup type="single"` (Active, Archived) or `Tabs`.
- **Status:** open · ClickUp: —

### G-78 A missing value is "n/a" in one cell and a dash in the next

- **Rule:** none yet (`product-copy.md` names no placeholder)
- **What the user sees:** one row of outreach history shows "n/a" for a
  missing date and a dash for other missing values; the status column can
  show "n/a" too.
- **Where:** `dashboard/outreach/v2/OutreachHistoryTable.tsx:744` (also 812
  and the `rowDisplayDate` fallback at 94), `HistoryStatusText` in
  `dashboard/outreach/v2/channelMeta.tsx:220`.
- **Seen on screen (visual pass 2026-11-12):** Outreach history (Serve, desktop and mobile); Outreach history (Win, desktop and mobile); Account (Win, desktop and mobile); Polls (Serve, desktop).
- **Proposal:** pick one placeholder for a missing value and use it in
  tables, drawers and `HistoryStatusText`; never "n/a".
- **Status:** open · ClickUp: —

### G-79 Win and Serve outreach hubs build the channel section differently

- **Rule:** §7 step 1, §10, `product-vocabulary.md`
- **What the user sees:** the same section is "Create a campaign" on Win and
  "Outreach channels" on Serve, with a different caption, tile order and a
  grid that changes at different widths.
- **Where:** `dashboard/constituent-outreach/ServeChannelCards.tsx:128` and
  146, `dashboard/outreach/v2/ChannelTileGrid.tsx:280` and 289.
- **Proposal:** one section pattern and one grid (`grid-cols-2
lg:grid-cols-N`), with a mode-keyed copy object for the heading and
  caption.
- **Status:** open · ClickUp: —

### G-80 Email details open differently from every other channel

- **Rule:** §7 step 1, §3
- **What the user sees:** an email send's details open in a flow shell with
  no steps and a "Done" button, while every other channel opens the details
  drawer; Win opens email as a page and Serve as an overlay.
- **Where:** `dashboard/outreach/v2/email/EmailStatusPage.tsx:34`,
  `dashboard/outreach/v2/OutreachHubPage.tsx:398`,
  `dashboard/constituent-outreach/ConstituentOutreachPage.tsx:281`.
- **Proposal:** email details through the same details view as the other
  channels, opened the same way on both hubs.
- **Status:** open · ClickUp: —

### G-81 Section and hero titles off the type scale

- **Rule:** §8 type scale
- **What the user sees:** section titles at 18px on the outreach hubs, a
  30 to 48px bold title on the campaign plan, 13px and 9 to 11px bold text in
  the sidebar banner and citation pills.
- **Where:** `onboarding/success/components/HeroCard.tsx:48`,
  `dashboard/outreach/v2/ChannelTileGrid.tsx:282`,
  `dashboard/constituent-outreach/ServeChannelCards.tsx:130`,
  `dashboard/shared/membership/MembershipBanner.tsx:156`,
  `shared/citations/SectionSourcePills.tsx`, and 5 more, see the locations file.
- **Seen on screen (visual pass 2026-11-12):** Voter data and Outreach (Win, desktop and mobile); Pro upgrade (Win, desktop and mobile); Profile, Account and Team (Win, desktop and mobile); Chief of Staff, Briefings and Profile (Serve, desktop and mobile); Constituents (Serve, desktop and mobile); Home, where the line above the task card is 24px, larger than the page title (Win, desktop and mobile), `dashboard/campaign-plan/components/campaignStrategy/NextTaskCard.tsx:571`; and 3 more, see the locations file.
- **Proposal:** the §8 scale by role: 16px semibold section titles, 32px
  semibold display, 12 and 14px text, weight 600 at most. C-15.
- **Status:** open · ClickUp: —

### G-82 A closed channel tile is dimmed instead of tagged

- **Rule:** `design-memory/learned.md` #47
- **What the user sees:** when texting is closed, the SMS tile goes gray and
  faded, so it looks broken rather than closed.
- **Where:** `dashboard/outreach/v2/ChannelTileGrid.tsx:348` (and 342).
- **Proposal:** `ChannelCard` as it ships with a muted corner tag ("Texting
  closed") and the channel's own tint; keep the tooltip with the reason.
- **Status:** open · ClickUp: —

### G-83 Logging a call asks too much in one drawer

- **Rule:** §2 recording an outcome (two questions at most in a drawer)
- **What the user sees:** after a call, up to five questions and a notes
  field stack in one drawer.
- **Where:** `dashboard/outreach/phone-banking/[listId]/PhoneBankingOutcomeStepForm.tsx:660`.
- **Proposal:** the answer and one follow-up in the drawer, the rest in the
  issue capture step or a page. Decide together with door knocking's
  `RecordKnockStepForm.tsx`.
- **Status:** open · ClickUp: —

### G-84 Some overlays and steps have no way out

- **Rule:** §2 "leaving is one tap away"
- **What the user sees:** on a phone the call panel has no close button, only
  previous and next; the poll expansion payment step has no Back, so the only
  way out is the breadcrumb.
- **Where:** `dashboard/outreach/phone-banking/[listId]/PhoneBankingEntryPanel.tsx:328`
  (the sr-only `DrawerHeader` hides its close),
  `dashboard/polls/[id]/expand-payment/components/ExpandPaymentPage.tsx:69`.
- **Seen on screen (visual pass 2026-11-12):** Questions (Win, desktop and mobile); Door knocking without district data (Serve, desktop and mobile).
- **Proposal:** a visible `DrawerHeader` with its shipped close; the ghost
  Back on every flow step, payment included.
- **Status:** open · ClickUp: —

### G-85 On-screen copy explains the system or points at the button

- **Rule:** `product-copy.md` (no em dashes, nothing explains how the system
  works), `design-memory/learned.md` #2, #28
- **What the user sees:** em dashes in captions and placeholders, lines like
  "Routing creates a draft only", "showing the frozen name and number from
  when this list was built", "Click Archive to view them" and "Ready? Hit
  Continue to get started."
- **Where:** `dashboard/public-profile/components/PublicProfileEditor.tsx:145`
  and the race opponent screens, `onboarding/components/storyStepCopy.ts:17`,
  `dashboard/outreach/v2/outreachHistoryCopy.ts:24` ("cancelled" too),
  `dashboard/outreach/phone-banking/[listId]/PhoneBankingEntryPanel.tsx:277`,
  `onboarding/components/OnboardingFlow.tsx:321`, and 18 more, see the locations file.
- **Seen on screen (visual pass 2026-11-12):** the first step of every outreach flow (Win, desktop and mobile); Campaign story (Win, desktop and mobile); Briefing detail (Serve, desktop and mobile); Community issues (Serve, desktop and mobile); Public profile (Serve, desktop and mobile); and 8 more, see the locations file.
- **Proposal:** one sentence of 20 words or fewer, no dashes, nothing about
  how the system works; US spelling ("canceled").
- **Status:** open · ClickUp: —

### G-86 Sections of the outreach details fail four different ways

- **Rule:** §6 errors
- **What the user sees:** inside one drawer, a failed section shows red text,
  muted text, muted text with a "Try again" link, or simply disappears.
- **Where:** `dashboard/outreach/v2/CampaignTurfList.tsx:88`,
  `ServeSmsRepliesSection.tsx:169`, `poll/results/PollCommentList.tsx:165`,
  `OutreachAssigneesSection.tsx:201`, `FollowUpOutstandingSection.tsx:152`
  (all in `dashboard/outreach/v2/`), and 1 more, see the locations file.
- **Proposal:** each section shows `Alert variant="destructive"` naming the
  section, with Try again in `AlertAction`.
- **Status:** open · ClickUp: —

### G-87 Failed loads with no retry, or shown as empty

- **Rule:** §6 errors ("never show a failure as something else")
- **What the user sees:** an import's processed rows say there are none when
  the load failed; poll results and impersonation show a failure with
  nothing to press; a priorities error sits above the list, far from the row.
- **Where:** `dashboard/contacts/crm/import/ProcessedRows.tsx:137` (no error
  branch), `dashboard/outreach/v2/poll/results/PollResultsPage.tsx:410`,
  `dashboard/priorities/components/PrioritiesHub.tsx:225`,
  `impersonate/ImpersonatePageContent.tsx:122`, and 5 more, see the locations file.
- **Seen on screen (visual pass 2026-11-12):** Website domain (Win, desktop and mobile).
- **Proposal:** an error branch before the empty check, and `Alert` with Try
  again in `AlertAction` (copy `SkippedRows.tsx` and `AssignmentsPage.tsx`).
- **Status:** open · ClickUp: —

### G-88 Red alerts for things that didn't fail

- **Rule:** §9 (red means something failed)
- **What the user sees:** "Not enough responses yet" and low poll confidence
  are red destructive alerts, with a red "Gather more feedback" button.
- **Where:** `dashboard/polls/shared/ConfidenceAlert.tsx:68` (82, 40, 92, 93),
  `dashboard/outreach/v2/poll/results/PollResultsPage.tsx:193`.
- **Seen on screen (visual pass 2026-11-12):** texting compliance registration (Win, desktop and mobile); Community issues (Serve, desktop and mobile).
- **Proposal:** `Alert variant="info"` with the action in `AlertAction`; no
  red text classes inside the alert.
- **Status:** open · ClickUp: —

### G-89 The outreach Pro gate hides the requirements and uses its own tints

- **Rule:** §9, `design-memory/learned.md` #39
- **What the user sees:** what it takes to verify sits in a collapsed
  section; the channel colors and the badge in the pitch differ from the rest
  of outreach.
- **Where:** `dashboard/outreach/v2/gate/ProPitchPanel.tsx:55` (also 145, 147,
  185), `dashboard/outreach/v2/gate/OutreachGate.tsx:200`,
  `dashboard/outreach/v2/OutreachAssignModal.tsx:219`.
- **Proposal:** requirement rows open (or a prep step); tint from
  `CHANNEL_META`; semantic tokens; `Badge` as it ships. Part of C-02.
- **Status:** open · ClickUp: —

### G-90 Poll review shows an image that won't be sent

- **Rule:** §5 "say exactly what will happen"
- **What the user sees:** with no image added, the review preview shows a
  placeholder landscape picture, so they approve a message that differs from
  the one sent.
- **Where:** `dashboard/polls/components/PollPreview.tsx:75` (hot-linked
  placeholder).
- **Proposal:** show no image when none was added.
- **Status:** open · ClickUp: —

### G-91 Two poll creation flows behind a flag

- **Rule:** §7 step 1, big picture cause 3
- **What the user sees:** "Create poll" opens the outreach poll flow with the
  self-serve flag on, and the legacy create page with it off; the polls they
  make open different result pages.
- **Where:** `dashboard/polls/components/PollsPage.tsx:63` (also 74, 93),
  `dashboard/polls/components/PollsTable.tsx:63`,
  `dashboard/polls/create/CreatePoll.tsx`.
- **Seen on screen (visual pass 2026-11-12):** create poll (Serve, desktop and mobile); Poll detail next to poll results (Serve, desktop and mobile).
- **Proposal:** keep the outreach poll flow (moved to a page per §2), route
  both entry points to it and delete the other.
- **Status:** open · ClickUp: —

### G-92 Flows end on a timer or a thin success screen

- **Rule:** §2 "every flow ends on a success view"
- **What the user sees:** after paying for a poll, the screen says "You will
  be taken to your poll momentarily..." and moves on by itself; the robocall
  success view has a small title, a faint icon and no next step.
- **Where:** `dashboard/polls/shared/components/PollPaymentSuccess.tsx:31`,
  `polls/onboarding/success/components/SuccessPage.tsx:23`,
  `dashboard/purchase/components/PurchaseSuccess.tsx:25`,
  `dashboard/outreach/v2/robocall/RobocallPayStep.tsx:378`.
- **Proposal:** a success view that stays: what was done, the summary, what
  happens next and one primary action that continues the job. C-38.
- **Status:** open · ClickUp: —

### G-93 A few fixed options hidden in a Select

- **Rule:** §4 "show few options, search many"
- **What the user sees:** the four poll introductions are hidden in a
  dropdown.
- **Where:** `dashboard/polls/create/CreatePoll.tsx:282`.
- **Proposal:** `RadioGroup` with `RadioGroupItemLabel`.
- **Status:** open · ClickUp: —

### G-94 Raw palette colors and decoration outside the tokens

- **Rule:** §9 tokens, §11
- **What the user sees:** blues, ambers, reds and grays that are close to but
  not the product's colors; decorative art and colored icon circles; red on
  states that aren't errors; a whole flow painted lavender.
- **Where:** `dashboard/public-profile/components/PublicProfileEditor.tsx:686`,
  `dashboard/profile/texting-compliance-agentic/components/ProUpgrade3Compliance.tsx:150`,
  `onboarding/components/PathToVictoryStep.tsx:305`, `sign-up/StatCard.tsx:48`,
  `dashboard/polls/[id]/expand/shared/ExpandPollLayout.tsx:30`, and 42 more,
  see the locations file.
- **Seen on screen (visual pass 2026-11-12):** Pro upgrade value prop (Win, desktop and mobile); Account (Win, desktop and mobile); Poll detail (Serve, desktop and mobile); Chief of Staff (Serve, desktop and mobile); the page canvas on Home, Campaign plan and Questions (Win, desktop and mobile); and 1 more, see the locations file.
- **Proposal:** semantic tokens only; charts through `BarList`,
  `DonutChart` or C-34; drop decorative art and colored icon circles.
- **Status:** open · ClickUp: —

### G-95 Claims the product can't back

- **Rule:** `design-memory/learned.md` #10, #29
- **What the user sees:** "You can't do any better than this!" on an
  audience option, and an uncited engagement claim behind an asterisk.
- **Where:** `dashboard/polls/shared/audience-selection.tsx:115`,
  `dashboard/polls/components/PollScheduledDateSelector.tsx:104`.
- **Proposal:** state the facts (count and cost); cite a claim with
  `SourceCitation` or cut it. The Pro pitch is G-54.
- **Status:** open · ClickUp: —

### G-96 Candidate words shown to elected officials

- **Rule:** `product-vocabulary.md`
- **What the user sees:** Serve onboarding's party block says GoodParty.org
  is "only for non-partisan and independent candidates"; the Serve poll flow
  asks for a "campaign headshot".
- **Where:** `onboarding/shared/partisanParty.tsx:12` (mounted in
  `serve/onboarding/ServeOnboardingFlow.tsx:1611`),
  `dashboard/polls/create/CreatePoll.tsx:516`,
  `dashboard/polls/components/PollPreview.tsx:68`.
- **Seen on screen (visual pass 2026-11-12):** Sign up (signed out, desktop and mobile); Create new list (Serve, desktop and mobile).
- **Proposal:** mode-keyed copy objects; "official headshot" as
  `AddImageStep` already says. Add the words to `check:serve-vocabulary`.
- **Status:** open · ClickUp: —

### G-97 A fake wait before the next poll step

- **Rule:** §5
- **What the user sees:** the details step shows a loading button for half a
  second while nothing runs.
- **Where:** `dashboard/polls/create/CreatePoll.tsx:225` (a 500ms timeout
  with a TODO).
- **Proposal:** remove the delay; `loading` only while real work runs.
- **Status:** open · ClickUp: —

### G-98 Dead UI files agents may copy

- **Rule:** §7 (agents copy what they find)
- **What the user sees:** nothing; these files are imported nowhere, but
  grep surfaces them as if they were reusable, with palette colors,
  `react-icons` and hand-built tables.
- **Where:** `shared/utils/Table.tsx` with `LoadingList`, `TogglePanel`,
  `ListItem`, `StackedChips`, `shared/ModalFooter.tsx`,
  `shared/inputs/SignupForm.tsx`, `EmailFormV2.tsx`,
  `dashboard/components/UpdateHistorySection.tsx`, `Actions.tsx`,
  `CardProgressPill.tsx`; `onboarding/shared/Stepper.tsx`,
  `ScheduleModal.tsx`, `OnboardingLayout.tsx`;
  `polls/onboarding/components/steps/NonCompliantStep.tsx`;
  `dashboard/campaign-details/components/issues/SuggestedIssues.tsx`;
  `dashboard/pro-upgrade/components/ProUpgradeStepPlaceholder.tsx`; and more,
  see the locations file.
- **Proposal:** delete them in one cleanup PR after confirming no importers.
- **Status:** open · ClickUp: —

### G-99 Campaign strategy is a place shown as a dialog

- **Rule:** §3 (a place is a page)
- **What the user sees:** the whole strategy, every phase with its own
  scroll and section pills, opens in a near full-screen dialog with no
  address, so Back doesn't return to it. The sizing is deliberate per a code
  comment, so this is a structural decision.
- **Where:** `dashboard/campaign-plan/components/CampaignPlanView.tsx:216`
  (trigger at 205).
- **Proposal:** its own page route opened from a link row.
- **Status:** open, needs a designer decision · ClickUp: —

### G-100 Celebrations built by hand

- **Rule:** §11 (celebrate with `ConfettiBurst`; reduced motion)
- **What the user sees:** full-screen confetti after onboarding, the extra
  questions and Pro upgrade, with no reduced-motion handling, where other
  successes use a small burst around the icon.
- **Where:** `dashboard/pro-upgrade/components/SuccessStep.tsx:157` with
  `ConfettiField.tsx`, `onboarding/success/components/PlanView.tsx:199` with
  `ConfettiCanvas.tsx`, `dashboard/questions/components/Done.tsx:14` with
  `Confetti.tsx`, and 4 more, see the locations file.
- **Proposal:** `ConfettiBurst` once around the success icon; full screen
  only for an election win (C-30).
- **Status:** open · ClickUp: —

### G-101 Failures shown only in a toast

- **Rule:** §5 "feedback where it happened"
- **What the user sees:** "Failed to create website" fades away after the
  button stops loading.
- **Where:** `dashboard/website/components/WebsitePage.tsx:34`,
  `dashboard/website/editor/components/AboutStep.tsx:11`. Door knocking is
  G-35; form errors are G-06.
- **Proposal:** `Alert variant="destructive"` next to the button with Try
  again; toasts only for low-stakes confirmations.
- **Status:** open · ClickUp: —

### G-102 The generic purchase page doesn't match the Pro payment step

- **Rule:** §2 payment inside the step, §8
- **What the user sees:** buying a domain shows a legacy "Complete Your
  Purchase" page with a gray amount header, unlike the Pro and outreach pay
  steps.
- **Where:** `dashboard/purchase/components/PurchasePage.tsx:105`,
  `PurchaseHeader.tsx:20`, `CheckoutForm.tsx:115`.
- **Proposal:** copy the Pro payment frame: `FullScreenStepChrome`, an order
  summary `Card`, payment details and a large Button naming the purchase.
- **Status:** open · ClickUp: —

### G-103 Three office pickers

- **Rule:** §7 step 1, §3
- **What the user sees:** choosing an office looks different in Win
  onboarding, Serve onboarding and the dashboard's change-office modal,
  which still runs a legacy picker with indigo cards and a second modal for
  "I don't see my office".
- **Where:** `onboarding/[slug]/[step]/components/ballotOffices/BallotRaces.tsx:325`,
  `RaceCard.tsx:37`, `CantFindRaceModal.tsx:28`, `CustomOfficeForm.tsx:214`,
  mounted by `dashboard/shared/CampaignOfficeSelectionModal.tsx`.
- **Proposal:** reuse `OfficeSelectionStep` and `ManualOfficeEntryStep` in
  the modal and delete the `ballotOffices` folder.
- **Status:** open · ClickUp: —

### G-104 Onboarding steps built twice for Win and Serve

- **Rule:** §7
- **What the user sees:** the pledge step has different padding, icons and
  text color on Win and Serve, and Serve's terms links leave onboarding in
  the same tab.
- **Where:** `serve/onboarding/ServeOnboardingFlow.tsx:1970` (links at 2008,
  2015), `onboarding/components/PledgeStep.tsx:28`. The welcome cards are
  the same story (G-40).
- **Proposal:** one shared step with a mode-keyed copy object; links from
  `getMarketingUrl` opening in a new tab.
- **Status:** open · ClickUp: —

### G-105 Form labels not tied to their fields

- **Rule:** §4, accessibility
- **What the user sees:** with a screen reader, sign-up fields have no name;
  tapping a label doesn't focus its field.
- **Where:** `sign-up/SignUpForm.tsx:48` (the `Field` helper),
  `sign-up/phone/SignUpPhoneForm.tsx:141`. `shared/inputs/RenderInputField.tsx`
  is the same problem (G-07).
- **Proposal:** `Form` with `FormField`, `FormLabel` and `FormControl`, or
  `id` and `htmlFor` as `team-invite/page.tsx` does.
- **Status:** open · ClickUp: —

### G-106 Sign in and sign up look like different products

- **Rule:** `design-memory/learned.md` #15
- **What the user sees:** sign up is a GoodParty form with a marketing
  panel; sign in is Clerk's default widget.
- **Where:** `login/page.tsx:70`, `sign-up/page.tsx:31`.
- **Seen on screen (visual pass 2026-11-12):** Sign in (signed out, desktop and mobile).
- **Proposal:** build sign in on the sign-up layout and components with
  Clerk's hooks, or theme the widget to the styleguide tokens.
- **Status:** open · ClickUp: —

### G-107 The org switcher draws its own logo and radio

- **Rule:** §7
- **What the user sees:** the heart in the sidebar header and the dot next to
  the current organization differ slightly from the logo and radio used
  everywhere else.
- **Where:** `shared/organization-picker.tsx:420` (inline SVG with hex
  fills), 437, 343.
- **Proposal:** `GoodPartyOrgLogo`; `DropdownMenuRadioGroup` with
  `DropdownMenuRadioItem`.
- **Status:** open · ClickUp: —

### G-108 Field checks shown only as an icon

- **Rule:** §9 (status is words first)
- **What the user sees:** a field check ends as a green check or red X with
  no words; the reason sits in a tooltip keyboard users can't always reach.
- **Where:** `dashboard/shared/AsyncValidationIcon.tsx:23`,
  `dashboard/shared/InputHelpIcon.tsx:28`.
- **Proposal:** `Spinner` while checking, then `FormMessage` or `StatusText`
  with words next to the field.
- **Status:** open · ClickUp: —

### G-109 Field errors listed under the card, not at the field

- **Rule:** §4 (errors next to the field)
- **What the user sees:** in the message compose card, up to six small red
  lines pile up under the card, not next to what's wrong.
- **Where:** `dashboard/outreach/v2/sms/SmsComposeStep.tsx:548` (553, 566,
  584, 595), the §13 reference for a message field.
- **Proposal:** each error with its field (`aria-describedby` on
  `TokenField`) at 14px; `Button variant="link"` as it ships for "Add it
  back".
- **Status:** open · ClickUp: —

### G-110 Map panels built three times

- **Rule:** §3, §7 step 3
- **What the user sees:** the walk sheet, the turf panel and the list shape
  panel each drag, snap and look a little different.
- **Where:** `dashboard/door-knocking/native/WalkSurface.tsx:252`,
  `dashboard/door-knocking/native/createFlow/TurfPanel.tsx:286`,
  `dashboard/contacts/crm/map/ListShapePanel.tsx:137`,
  `dashboard/door-knocking/native/useSheetSnap.ts:79`. The door panel
  (`PersonSheet.tsx`) is the modal variant, under C-01.
- **Proposal:** one non-modal map panel. C-36.
- **Status:** open · ClickUp: —

### G-111 Filter group labels styled two ways

- **Rule:** §4 "ask the same question the same way"
- **What the user sees:** building a voter list, the label over a group of
  filter pills is sentence case in contacts and uppercase gray in door
  knocking.
- **Where:** `dashboard/door-knocking/native/createFlow/WhoStep.tsx:112`,
  `dashboard/contacts/crm/shared/constants.ts:52`
  (`FILTER_GROUP_LABEL_CLASSNAME`).
- **Proposal:** one sentence-case `Label` above a `FilterPillGroup` in both.
- **Status:** open · ClickUp: —

### G-112 Icon-only buttons with no tooltip

- **Rule:** `design-memory/learned.md` #24
- **What the user sees:** a trash can, a download arrow, an archive box and
  chat bar icons with nothing to say what they do.
- **Where:** `dashboard/ordinances/components/DraftDetail.tsx:726` (and 738),
  `dashboard/priorities/components/PrioritiesHub.tsx:285`,
  `dashboard/chief-of-staff/components/chat/FooterChatBar.tsx:97` and 121,
  `dashboard/ordinances/components/QualityReport.tsx:397`. More menus are
  under G-12 and G-33.
- **Seen on screen (visual pass 2026-11-12):** Know your opponent (Win, desktop and mobile).
- **Proposal:** `IconButton` as it ships, wrapped in `Tooltip` with the
  action's name.
- **Status:** open · ClickUp: —

### G-113 Changed screens still switch at sm: and md:

- **Rule:** §10 (one breakpoint at 1024px)
- **What the user sees:** inside a flow that switches at 1024px, date and
  time fields, button labels and text sizes change at 640 or 768px, so a
  tablet sees a mix of phone and desktop layouts.
- **Where:** `dashboard/outreach/v2/email/EmailWriteStep.tsx:544`,
  `sms/SmsScheduleStep.tsx:158`, `email/EmailScheduleStep.tsx:85`,
  `robocall/RobocallScheduleStep.tsx:98`, `poll/PollQuestionStep.tsx:229`
  (in `dashboard/outreach/v2/`), and 3 more, see the locations file.
- **Proposal:** `lg:` only for layout; one label at every width.
- **Status:** open · ClickUp: —

## Found in the visual pass

Gaps the visual pass found on screen that no entry above covered. Every
screen is in `product-design-gaps-locations.md` under "Visual pass", with
the same ID.

### G-114 Several primary buttons on one screen

- **Rule:** §5 one primary action per screen, §9 blue means the one primary
- **What the user sees:** a page full of filled blue buttons with no single
  next step: 18 "Send outreach" buttons on Voter data, three full-width
  "Send SMS to voters" on Know your opponent, five "View responses" on poll
  results, two identical "Import contacts" a few pixels apart, and a large
  red "Delete Account" louder than anything else on Account.
- **Where:** Voter data (Win, desktop and mobile)
  `dashboard/contacts/crm/lists/ListCard.tsx:184`; Know your opponent (Win,
  desktop and mobile)
  `dashboard/race-opponent/components/StandoutActionsSection.tsx:92`; Account
  (Win, desktop and mobile)
  `dashboard/account/components/DeleteAccountPage.tsx:75`; election result
  (Win, desktop and mobile)
  `dashboard/election-result/components/ActiveProSubscriptionAlert.tsx:47`;
  Import history (Serve, desktop and mobile)
  `dashboard/contacts/crm/import/UploadHistory.tsx:74`; poll results (Serve,
  desktop and mobile)
  `dashboard/outreach/v2/poll/results/PollResultsPage.tsx:135`.
- **Proposal:** one primary per screen; actions repeated on cards or rows
  are outline, ghost or the row itself; a destructive action is outline or a
  smaller destructive Button on the right, with its confirm carrying the
  red. Cap long card lists at three with See more (§8 working set).
- **Status:** open · ClickUp: —

### G-115 Content runs off the screen on a phone

- **Rule:** §10 no sideways scroll at 375 and 320px
- **What the user sees:** "Manage Subscription" runs past the right edge of
  Account with its icon cut off; on Public profile every card runs off the
  screen, so the page scrolls sideways and the delete buttons can't be
  reached without it.
- **Where:** Account (Win, mobile)
  `dashboard/account/components/AccountInformationCard.tsx:38`; Public
  profile (Serve, mobile)
  `dashboard/public-profile/components/PublicProfileEditor.tsx:488`.
- **Proposal:** card header rows wrap below 1024px with the buttons kept on
  the right (`justify-end`, G-127); nothing sets a minimum width wider than
  the screen; check every changed screen at 320px. Public profile was seen
  with generated data.
- **Status:** open. Decided 2026-11-13: Account stays in wave 1; Public
  profile moves to wave 3 and returns to wave 1 if it reproduces on a real
  Serve account. · ClickUp: —

### G-116 Titles and names cut short on a phone

- **Rule:** §10 same content on the phone, title in the top bar
- **What the user sees:** the "Schedule your text" chip squeezes page titles
  to "Voter Outr...", "Campaign ..." and "Team Setti..."; outreach history,
  briefing rows and issue cards cut names until rows can't be told apart;
  the chat placeholder stops mid-word.
- **Where:** the top bar on every Win page (Win, mobile)
  `dashboard/shared/DashboardLayout.tsx:239` with
  `dashboard/shared/membership/MembershipChip.tsx`; Outreach history (Win,
  mobile) `dashboard/outreach/v2/OutreachHistoryTable.tsx`; Voter data (Win,
  mobile) `dashboard/contacts/crm/lists/ListCard.tsx:184`; Briefings (Serve,
  mobile) `dashboard/briefings/components/BriefingListRow.tsx:41`; Community
  issues all (Serve, mobile)
  `dashboard/community-issues/components/IssueCard.tsx:50`; the chat dock on
  Chief of Staff, Community issues, Ordinances and the civic panel (Serve,
  mobile).
- **Proposal:** row titles wrap to two lines (`line-clamp-2`) with meta
  below them; a mobile chat placeholder that fits one line at 375px.
- **Status:** open. Decided 2026-11-13: the top bar and its membership chip
  stay as they are, so the cut page title is accepted; the rows and the chat
  placeholder are still open. · ClickUp: —

### G-118 Jobs that need district data start as if it were there

- **Rule:** §6 something not set up yet gets the action that fixes it, §1
- **What the user sees:** on an office with no matched district (the test
  account), Constituents says the data isn't available for this office, yet
  Chief of Staff leads with "Build my civic panel", the civic panel promises
  "0 of 250 residents", and the SMS, email and phone banking flows start
  normally. The official learns the data is missing on a later screen, or
  never.
- **Where:** Chief of Staff
  (`dashboard/chief-of-staff/components/chat/chatConstants.ts`,
  `managedPanelWidgets.tsx`), the civic panel
  (`dashboard/contacts/citizens-panel/citizensPanelCopy.ts:154`), and the
  Serve SMS, email and phone banking tiles
  (`dashboard/constituent-outreach/ServeChannelCards.tsx`). Door knocking's
  blank page is G-84.
- **Proposal:** where a job needs district data, show the missing-data state
  at the entry point, before the job starts (copy
  `VoterDataUnavailableState`, with Contact support); one check shared by
  every entry point. C-03.
- **Status:** open · ClickUp: —

### G-119 The civic panel shows different numbers on desktop and phone

- **Rule:** §10 same content, same order at both widths, §6 empty
- **What the user sees:** desktop shows an empty seat chart and no total;
  the phone hides the chart and shows "0 of 98 residents have joined" with
  a progress bar (another account shows 250). Neither offers a way to start
  filling the panel.
- **Where:** the civic panel (Serve, desktop and mobile)
  `dashboard/contacts/citizens-panel/citizensPanelCopy.ts:154`.
- **Proposal:** the same count and progress at both widths; one primary
  "Build my civic panel" that starts the same managed setup as the Chief of
  Staff card (or the G-118 missing-data state when the district isn't
  matched). The raw district name is in Product bugs.
- **Status:** open · ClickUp: —

### G-120 The website editor opens a section by itself on a phone

- **Rule:** none yet; closest is §1 (every screen answers "what do I do
  now?"). G-73 covers how prompts that open on their own look, not whether
  they should.
- **What the user sees:** on a phone the editor opens with the logo upload
  sheet already covering it, before the user picked a section.
- **Where:** the website editor and create (Win, mobile),
  `dashboard/website/editor/components/WebsiteEditFlow.tsx`.
- **Proposal:** open no section by default below 1024px; show the section
  list and open the sheet on tap.
- **Status:** open · ClickUp: —

### G-121 A broken dashboard link shows the marketing 404

- **Rule:** §6, §8 start from the shell, `product-copy.md`
- **What the user sees:** a purchase link without its parameters leaves the
  dashboard for the marketing 404: "Error: 404 Not Found" in bold title
  case, "Whoops!", a joke about the two major parties and "Back to our
  homepage".
- **Where:** `/dashboard/purchase` with no parameters (Win, desktop and
  mobile), `not-found.tsx:25`.
- **Proposal:** when the §6 404 template is built, a dashboard not-found
  sits inside the shell: `EmptyState` with one sentence and a Button back
  to where the user came from, with no jokes about parties. Until then,
  `/dashboard/purchase` with missing parameters sends the user back to the
  page that linked there instead of a 404.
- **Status:** open, waits on the §6 404 template · ClickUp: —

### G-122 Pro upgrade steps that repeat themselves or ask nothing

- **Rule:** §2 one question per step, `product-copy.md`, `design-memory/learned.md` #28
- **What the user sees:** a filing title that is a long statement with a
  two-sentence caption and the fee said twice; a whole step that only says
  "Your details are saved"; a lone "Ready when you are." under a checklist.
- **Where:** Pro upgrade (Win, desktop and mobile)
  `dashboard/pro-upgrade/components/FilingInstructionsStep.tsx:88`,
  `dashboard/campaign-verification/verificationCopy.ts:112`,
  `dashboard/pro-upgrade/components/GuidanceStep.tsx:183`.
- **Proposal:** a short title and one-sentence caption; drop the saved step
  and carry its confirmation into the next one; remove filler lines.
- **Status:** open · ClickUp: —

### G-123 Add controls look like empty slots

- **Rule:** `design-memory/learned.md` #25
- **What the user sees:** "Add a policy priority" is a gray dashed box with
  gray text, so it reads as an empty slot, not a button. Onboarding's copy
  of the same control is a hand-built dashed box with blue text, so one
  control looks two ways.
- **Where:** texting compliance and Pro upgrade candidate profile (Win,
  desktop and mobile)
  `dashboard/profile/texting-compliance/candidate-profile/components/PolicyPriorities.tsx:136`;
  onboarding and Campaign story `onboarding/components/StoryIssuesCard.tsx:88`.
- **Proposal:** `Button variant="outline"` with a plus icon under the list,
  as "Add experience" (`public-profile/components/ListEditors.tsx:94`),
  "Add condition" (`contacts/crm/wizard/ActivityStep.tsx:396`) and "Add
  turf" already do.
- **Status:** open. Decided 2026-11-13: the outline Button with a plus
  everywhere, no dashed variant. · ClickUp: —

### G-124 A character counter drawn over the answer

- **Rule:** `design-memory/learned.md` #23
- **What the user sees:** "667 chars" sits on top of the answer text inside
  the field, so words and the count overlap, worse on a phone.
- **Where:** Campaign story (Win, desktop and mobile)
  `onboarding/components/StoryIntakeCard.tsx:71`, also `StoryIssueRow.tsx:96`.
- **Proposal:** the count in the compose card footer, as the outreach
  compose card does (C-39, C-40).
- **Status:** open · ClickUp: —

### G-125 Empty profile fields can't be pressed

- **Rule:** `design-memory/learned.md` #4, §9 muted is never for what the
  user needs
- **What the user sees:** empty fields say "Add Information" in faded title
  case and aren't a link; party shows lowercase "nonpartisan".
- **Where:** Profile (Win, desktop and mobile)
  `dashboard/campaign-details/components/cards/ReadField.tsx:37`. The Serve
  Profile is under G-43.
- **Proposal:** an inline link named for the field ("Add your website")
  that opens the edit; capitalize stored values on display.
- **Status:** open · ClickUp: —

### G-126 Priority rows show an instruction instead of the priority

- **Rule:** §9 muted is never for instructions the user needs
- **What the user sees:** each priority row's description is an
  instruction in muted gray, cut mid-sentence, with a "The problem" pill
  that drops under the text on a phone.
- **Where:** Priorities (Serve, desktop and mobile),
  `dashboard/priorities/components/PrioritiesHub.tsx`.
- **Proposal:** the priority's own summary as the description; the next
  step on the row's chevron or a Button named for it.
- **Status:** open · ClickUp: —

### G-127 Buttons wrap to the left on a phone

- **Rule:** `design-memory/learned.md` #37
- **What the user sees:** buttons that sit on the right on desktop drop to
  the left under the title on a phone.
- **Where:** Account (Win, mobile)
  `dashboard/account/components/PersonalInformationCard.tsx:150`; Outreach
  Filters and Archive (Serve, mobile).
- **Proposal:** keep button groups right-aligned when they wrap
  (`justify-end`).
- **Status:** open · ClickUp: —

### G-128 Filters shown over an empty list

- **Rule:** §7 earn every element
- **What the user sees:** six status pills all at (0), three source pills
  at (0), and Filters and Archive above an empty history.
- **Where:** Ordinances, Priorities and Outreach (Serve, desktop and
  mobile), `dashboard/priorities/components/PrioritiesHub.tsx:38`.
- **Proposal:** on a first visit with no records at all, show only the
  `EmptyState` and hide the filters; once any record exists, filters stay,
  and a filter with no results says so and offers Clear filters (§6).
  Priorities' chips are fixed with G-74.
- **Status:** open · ClickUp: —

### G-129 A label that shows on every visit

- **Rule:** `design-memory/learned.md` #18, #28
- **What the user sees:** "Start here" above the Chief of Staff onboarding
  card on every visit.
- **Where:** Chief of Staff (Serve, desktop and mobile)
  `dashboard/chief-of-staff/components/TaskStack.tsx:133`.
- **Proposal:** one line that speaks to the card, or nothing.
- **Status:** open · ClickUp: —

### G-130 Polls named and drawn two ways

- **Rule:** §7 same thing, same words, `design-memory/learned.md` #15
- **What the user sees:** the outreach tile and history badge say "Poll /
  Survey" with a clipboard icon; the polls page says "Polls" with a paper
  plane and isn't in the nav.
- **Where:** Outreach and Polls (Serve, desktop and mobile)
  `dashboard/constituent-outreach/ServeChannelCards.tsx:67`,
  `dashboard/outreach/v2/OutreachHistoryTable.tsx`.
- **Proposal:** one name ("Poll") and one icon across tile, badge, flow
  chip and page.
- **Status:** open · ClickUp: —

### G-131 The same ranked list or card action looks three ways

- **Rule:** §7 same job, same look, `design-memory/learned.md` #15
- **What the user sees:** trending issues are chevron rows, top issues are
  cards with numbered blue circles and a "See details" link per row, poll
  themes use a "#1" overline or tinted circles; the same issue card has an
  outline button on Priorities and a blue text link on Ordinances.
- **Where:** Community issues, Priorities and Ordinances (Serve, desktop and
  mobile) `dashboard/community-issues/components/IssueFeedList.tsx:166`,
  `dashboard/ordinances/components/MyPriorityIssuesSection.tsx:77`,
  `dashboard/priorities/components/PrioritiesHub.tsx:336`.
- **Proposal:** the trending-issue chevron rows are the pattern (rank in
  the title text, rows in one card per C-27, `Button variant="outline"` as
  the card action). Extract them into one styleguide component (C-41) and
  use it on every ranked list.
- **Status:** open. Decided 2026-11-13: reuse the trending rows, built as a
  new global component. · ClickUp: —

### G-132 Door knocking opens straight into the create flow

- **Rule:** §2 leaving is always one tap away, §6 no dead ends
- **What the user sees:** on a Serve account with district data but no
  turfs (generated data), the door knocking route drops straight into the
  create flow with no hub behind it, so Exit has nowhere obvious to return
  to. Without district data the same route is the blank page in G-84.
- **Where:** Door knocking (Serve, desktop and mobile)
  `dashboard/door-knocking/native/createFlow/CreateListFlow.tsx:386`.
- **Proposal:** land on the Outreach hub (or an `EmptyState` hub) and start
  the flow from the Door knocking tile.
- **Status:** open · ClickUp: —

### G-133 Poll topics don't start from the official's priorities

- **Rule:** §8 group six or more items, `design-memory/learned.md` #11, #34
- **What the user sees:** the first poll step lists seven generic topics
  plus Write my own, ungrouped, and none of the official's own priorities
  or community issues.
- **Where:** the Poll flow, first step (Serve, desktop and mobile), the
  topic step `dashboard/outreach/v2/poll/PollTopicStep.tsx`.
- **Proposal:** lead with the official's priorities as the first group,
  then generic topics, in the same row component.
- **Status:** open, needs a product decision · ClickUp: —

### G-134 A list heading and caption that don't match the rows

- **Rule:** `product-copy.md` rule 9, §6 (each state gets its own words)
- **What the user sees:** "Active campaigns" is captioned "Every campaign
  you've sent, most recent first", but the top rows are emails that were
  never sent, and Done rows sit under Active.
- **Where:** Outreach (Win, desktop and mobile)
  `dashboard/outreach/v2/outreachHistoryCopy.ts:23`.
- **Proposal:** group rows by their real status (drafts, active, done) or
  drop the Active heading; the caption matches the rows. Change it in the
  mode-keyed copy object: Win "Your campaigns, most recent first.", Serve
  "Your outreach, most recent first." Fix with G-74, since this file is the
  empty-wording reference.
- **Status:** open · ClickUp: —

### Product bugs seen during the visual pass

Not design gaps; listed so they reach the right team. All but the first are
also rows in the locations file.

- Win `/dashboard/chief-of-staff` and `/dashboard/polls` silently switch
  the active organization to an elected office; seen while capturing.
  Status: TBD (noted 2026-11-13; ticket and scope not decided yet).
- Self-research shows empty name, office and district though the campaign
  has them (Win, `dashboard/race-opponent/self-research/page.tsx:40`).
- Opening Pro upgrade as an active Pro user shows the "Welcome to Pro"
  success view and receipt again
  (Win, `dashboard/pro-upgrade/components/SuccessStep.tsx:163`). It can read
  as a second charge on a payment surface, so ticket it next to the org
  switch.
- Website domain renders nothing for a campaign that already has a domain
  (Win, `dashboard/website/domain/components/DomainPage.tsx:64`; G-87).
- Know your opponent's summary says District 3 and two candidates while
  the page says District 1 and three
  (Win, `dashboard/race-opponent/components/RaceOpponentList.tsx:713`; G-30).
- Community issue summaries show the agent's internal scoring and sourcing
  notes (Serve, `dashboard/community-issues/components/IssueCard.tsx:65`;
  G-30).
- The civic panel shows the office as a raw, abbreviated district name (Serve,
  `dashboard/contacts/citizens-panel/citizensPanelCopy.ts:154`; G-119).

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

- **Status:** `proposed` until the team decides in #tmp-design-agent, then
  `approved`, `rejected: <why, in one line>` or `exception until <date>`.
- **Exception:** a one-time allowance with an end date. Every open exception
  is tracked to zero.
- **Approved:** once the component ships in the styleguide, set the status
  to `shipped in #<PR>`; the sprint cleanup removes it.
- **Rejected:** keep the entry, so nobody proposes it again.

### C-01 ResponsiveOverlay (the modal component)

- **Solves:** G-04, G-73
- **Job:** the one modal component for everything that isn't a
  confirmation: a short task, a prompt the product opens (Pro upgrade, term
  dates, website sunset), a picker. A bottom drawer below 1024px with the
  styleguide's 608px column, a dialog from 1024px, with the same header
  (title, description), body and footer slots at both widths, a visible
  close button, Back closing it, full height when it holds an `Input` or
  `Textarea`, and buttons stacked with the primary on top when they stack.
  Confirmations stay `AlertDialog` (C-14).
- **Replaces today:** `shared/utils/Modal.tsx`, `shared/utils/ResponsiveModal.tsx`,
  `shared/ui/ModalOrDrawer.tsx` (switches at 768px), local `useIsMobile`
  switches, bottom `Sheet`s used as drawers, and the hand-built layouts of
  the prompts in G-73.
- **Also (audit 2026-11-12):** `dashboard/door-knocking/native/PersonSheet.tsx:397`, and 1 more, see `product-design-gaps-locations.md`.
- **Exists in DS?** Partly: `Dialog` and `Drawer` exist separately, with
  different title sizes (18 and 20px) and no shared slots.
- **Priority:** high · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

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
- **Owner:** design, later (on touch)

### C-03 RequirementNotice

- **Solves:** G-21, G-05
- **Job:** explains what's needed before something can be used, with one
  action that goes to it ("Connect a domain first").
- **Replaces today:** silent server redirects and disabled buttons with no
  reason.
- **Exists in DS?** No (`Alert` and `EmptyState` cover parts of it).
- **Priority:** high · **Status:** proposed · ClickUp: —
- **Owner:** design, now

### C-04 PaymentErrorState

- **Solves:** G-08, G-09
- **Job:** an inline error in the pay step that says what happened and
  offers retry, another card, or a way out.
- **Replaces today:** `dashboard/purchase/components/PurchaseError.tsx` and
  the per-flow decline handling. The robocall pay step is the model.
- **Exists in DS?** No.
- **Priority:** high · **Status:** proposed · ClickUp: —
- **Owner:** design, now

### C-05 AiContentActions

- **Solves:** G-30
- **Job:** the footer for any AI-generated block: an "AI-generated" label,
  regenerate (one name), thumbs up/down with a text field.
- **Replaces today:** `RegenerateContrasts`, briefing `FeedbackRow`, chat
  `MessageActionBar` actions, per-surface disclaimers.
- **Exists in DS?** Partly: `AiIcon` exists.
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-06 ResponsiveTable (DataList)

- **Solves:** G-26
- **Job:** a table on desktop that becomes a list of cards below 1024px,
  from one column definition.
- **Replaces today:** the hand-built switch in `dashboard/outreach/v2/OutreachHistoryTable.tsx`
  and horizontally scrolling tables.
- **Exists in DS?** Partly: `DataTable` and `Table` exist, without a mobile
  layout.
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-07 DatePicker

- **Solves:** two hand-built pickers
- **Job:** pick a date (and optionally a time and time zone) with one
  control.
- **Replaces today:** the Serve term-date picker (pill button plus restyled
  calendar) and the SMS/robocall schedule pickers (a Button styled as an
  input, see G-12).
- **Also (audit 2026-11-12):** `dashboard/outreach/v2/sms/SmsScheduleStep.tsx:165`, `serve/onboarding/termDates.shared.tsx:131`, and 4 more, see `product-design-gaps-locations.md`.
- **Seen on screen (visual pass 2026-11-12):** the date range in Create new list (Serve, desktop and mobile).
- **Exists in DS?** Partly: `Calendar` and `CalendarButton` exist; check
  whether `CalendarButton` already covers this before building.
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-08 CheckboxCard

- **Solves:** checkbox cards assembled from `Checkbox` + `Label` with
  overridden classes (Serve onboarding priorities)
- **Job:** the multi-select counterpart of `RadioCardItem`.
- **Also (audit 2026-11-12):** `dashboard/chief-of-staff/components/chat/ChiefOfStaffChatBody.tsx:1947`, and 3 more, see `product-design-gaps-locations.md`.
- **Exists in DS?** No.
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** design, later (on touch)

### C-09 StepList

- **Solves:** hand-built numbered lists (Serve district story)
- **Job:** a numbered list of steps (number in a circle plus text), with or
  without a card per item. Not a progress indicator; `Stepper` is that.
- **Exists in DS?** No.
- **Priority:** low · **Status:** proposed · ClickUp: —
- **Owner:** design, later (on touch)

### C-10 MapLegend

- **Solves:** hand-built legends on maps (district story, door knocking)
- **Job:** colored marker plus label pairs that sit on or next to a map.
- **Exists in DS?** No.
- **Priority:** low · **Status:** proposed · ClickUp: —
- **Owner:** design, later (on touch)

### C-11 StatusBadge

- **Solves:** G-56
- **Job:** shows a status in words with one of a fixed set of tones
  (neutral, active, done, warning, failed).
- **Replaces today:** `StatusText`, polls `StatusBadge`, website
  `StatusChip`, `AgendaStatusPill`, the door knocking pill.
- **Exists in DS?** Partly: `Badge` exists, without status tones.
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-12 BottomBar

- **Solves:** G-59
- **Job:** a fixed bottom bar that clears the sidebar and the phone's safe
  area and tells the toast to sit above it.
- **Replaces today:** the per-page bars and the route list in
  `shared/utils/Snackbar.tsx`.
- **Exists in DS?** No (`StepFooter` covers flows only).
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-13 UserAvatar

- **Solves:** G-60
- **Job:** a person's picture, or their initials, or an icon, in one shape
  and set of sizes.
- **Replaces today:** `shared/user/UserAvatar.tsx`, the sidebar avatars and
  three copies of initials code.
- **Exists in DS?** Partly: check `avatar.tsx` in the styleguide first.
- **Priority:** low · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

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
- **Owner:** design, now

### C-15 Type scale (Heading, Text)

- **Solves:** G-57, part of G-14
- **Job:** the rulebook's type scale (§8) as tokens by role: 32 display, 24
  step title, 20 large heading, 18 overlay title, 16 page and section title,
  14 body and card title, 12 badge, with headings at 600. Styleguide titles
  move onto it: `DrawerTitle` and `AlertDialogTitle` 20 to 18px,
  `ContentCard` title 18 to 14px, overlay descriptions 16 to 14px. Add the
  matching classes to the prototype CSS (`gp-ui.css`), which defaults to
  16px today.
- **Replaces today:** `@shared/typography` and hand-picked `text-*` sizes on
  titles.
- **Also (audit 2026-11-12):** `onboarding/components/OnboardingFlow.tsx:1393`, `sign-up/SignUpForm.tsx:248`, `dashboard/chief-of-staff/components/TaskStack.tsx:403`, `dashboard/chief-of-staff/components/chat/ChiefOfStaffChatBody.tsx:2032`, and 23 more, see `product-design-gaps-locations.md`.
- **Exists in DS?** No.
- **Priority:** high · **Status:** proposed · ClickUp: —
- **Owner:** design, now

### C-16 CopyButton

- **Solves:** G-46
- **Job:** copies text, shows an inline check for about two seconds, falls
  back when the clipboard API fails, and says so when copying fails.
- **Replaces today:** `CopyToClipboard`, `CopyToClipboardButton` and
  per-surface copy code.
- **Exists in DS?** No.
- **Priority:** low · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-17 Leave guard

- **Solves:** G-42
- **Job:** warns before leaving an editor with unsaved changes, on in-app
  navigation and on closing the tab.
- **Replaces today:** per-flow "Discard changes?" dialogs.
- **Exists in DS?** No (a hook plus `ConfirmDialog`).
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-18 FileDropzone

- **Solves:** G-67
- **Job:** a dashed area that takes a dropped or picked file, with one
  hover look (`border-primary/50`, `bg-muted`), a drag-over look
  (`border-primary`), an error look and a busy state; the whole area opens
  the file picker.
- **Replaces today:** the hand-built zones listed in G-67 and
  `shared/inputs/FileDropZone.tsx`.
- **Also (audit 2026-11-12):** `dashboard/outreach/v2/sms/SmsComposeStep.tsx:386`, and 3 more, see `product-design-gaps-locations.md`.
- **Exists in DS?** No.
- **Priority:** low · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-19 Page width and edges

- **Solves:** G-55
- **Job:** `DashboardLayout` takes a width (`flow` 608px, `page` 720px, `wide` 1280px, `full`) as container tokens (`max-w-flow` and so on), and owns the page edges (16px below 1024px, 24px from 1024px) and the 128px end space.
- **Replaces today:** Bracketed `max-w-[Npx]` on pages, `wrapperClassName="!p-0"` overrides, per-page padding.
- **Exists in DS?** No.
- **Priority:** high · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-20 Side panel slot

- **Solves:** §8 side panels
- **Job:** A 280px panel slot: a left navigation panel hidden below 1024px, a right context panel beside the content from 1280px and under it below that.
- **Replaces today:** Hand-built `aside` and `w-80` panels in Priority, Citizens panel, briefings, pro upgrade.
- **Also (audit 2026-11-12):** `onboarding/components/OnboardingFlow.tsx:1420`, and 3 more, see `product-design-gaps-locations.md`.
- **Exists in DS?** No.
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-21 Neutral tokens at the root and a canvas token

- **Solves:** G-40
- **Job:** Define `border`, `muted`, `muted-foreground`, `foreground`, `background`, `card` and `ring` at `:root` (and `.dark`) with the values the styleguide uses inside components, and add a `canvas` token for the page behind cards. Muted text must reach 4.5:1 on the canvas.
- **Replaces today:** `bg-[#f5f5f5]` in `DashboardLayout`; the slightly different grays a token renders outside a styleguide component.
- **Also (audit 2026-11-12):** `dashboard/shared/DashboardLayout.tsx:192`. See `product-design-gaps-locations.md`.
- **Exists in DS?** Partly: the tokens exist only inside `[data-slot]`.
- **Priority:** high · **Status:** proposed · ClickUp: —
- **Owner:** design, now

### C-22 StatusText tones that pass contrast

- **Solves:** §9 status
- **Job:** Move `StatusText`'s `warning` and `success` tones to a step that reads at 4.5:1 on white (they're about 3.5:1 at 12px today).
- **Replaces today:** Nothing; a component fix.
- **Exists in DS?** Partly.
- **Priority:** high · **Status:** proposed · ClickUp: —
- **Owner:** design, now

### C-23 Alert warning variant

- **Solves:** G-63
- **Job:** Add `warning` (and a muted notice) to `Alert`, so a deadline or a needed action isn't a hand-built panel.
- **Replaces today:** Hand-built notice panels; `Card` with a red border in the pay steps.
- **Also (audit 2026-11-12):** `dashboard/components/AlertBanner.tsx:9`, and 3 more, see `product-design-gaps-locations.md`.
- **Exists in DS?** Partly: default, info, success and destructive exist.
- **Priority:** high · **Status:** proposed · ClickUp: —
- **Owner:** design, now

### C-24 Badge and Button variant cleanup

- **Solves:** G-68
- **Job:** Remove the lavender `secondary` variant from `Button` and `Badge`, put `soft` on a token, and document `outline` as the tag.
- **Replaces today:** 8 `secondary` uses; default blue badges used as tags.
- **Exists in DS?** Partly.
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-25 One selected state

- **Solves:** §9 selected
- **Job:** Align the selected look of `ToggleGroup` pills, `Calendar` (today `bg-gray-800`) and `Command` with `tertiary`, as `FilterPillGroup` ships.
- **Replaces today:** Six selected looks across the styleguide.
- **Also (audit 2026-11-12):** `dashboard/outreach/v2/sms/SmsPurposeStep.tsx:35`, `dashboard/shared/ListCard.tsx:71`, `dashboard/outreach/v2/audience/OutreachAudienceStep.tsx:670`, and 14 more, see `product-design-gaps-locations.md`.
- **Exists in DS?** Partly.
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** design, later (on touch)

### C-26 Surface radius

- **Solves:** §8 cards
- **Job:** Radius tokens: 12px for surfaces (cards, panels, tiles), the styleguide's sizes for controls. `ContentCard` moves from 16 to 12px.
- **Replaces today:** 41 radius overrides on `Card`.
- **Also (audit 2026-11-12):** `dashboard/campaign-plan/components/campaignStrategy/NextTaskCard.tsx:618`, `dashboard/shared/smsCutoff/SmsCutoffNoticeDialog.tsx:27`, and 5 more, see `product-design-gaps-locations.md`.
- **Exists in DS?** Partly.
- **Priority:** low · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-27 Card list variant

- **Solves:** G-40
- **Job:** A flush `Card` with rows divided by a border, for "records as rows in one card".
- **Replaces today:** Div panels with `rounded-xl border bg-card`.
- **Exists in DS?** No.
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** design, later (on touch)

### C-28 Channel prop on ChannelCard and ChannelBadge

- **Solves:** G-71
- **Job:** Pass the channel, not a class, so the tint always comes from `channelMeta` in Win and Serve.
- **Replaces today:** Hand-copied tints in `ServeChannelCards.tsx` and `SmsCutoffNotice.tsx`.
- **Exists in DS?** No.
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-29 Stepper without an overline

- **Solves:** G-58
- **Job:** The flow name in the step header becomes plain text, and `Overline` is deprecated.
- **Replaces today:** The uppercase label on every flow step.
- **Also (audit 2026-11-12):** `dashboard/shared/FullScreenStepChrome.tsx:39`, and 3 more, see `product-design-gaps-locations.md`.
- **Exists in DS?** Partly.
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** design, now

### C-30 Election win celebration

- **Solves:** §11
- **Job:** A styleguide full-screen celebration with reduced-motion handling for winning the election.
- **Replaces today:** `ConfettiField`, `react-canvas-confetti`.
- **Exists in DS?** No.
- **Priority:** low · **Status:** proposed · ClickUp: —
- **Owner:** design, later (on touch)

### C-31 Button text size

- **Solves:** §8 type
- **Job:** Decide whether buttons stay 16px or get a 14px size; 45 buttons are restyled to `text-sm` today.
- **Replaces today:** `text-sm` overrides on `Button`.
- **Also (audit 2026-11-12):** `dashboard/briefings/components/detail/DesktopBottomBar.tsx:35`, and 15 more, see `product-design-gaps-locations.md`.
- **Exists in DS?** Partly.
- **Priority:** low · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-32 Table density and muted cells

- **Solves:** C-06
- **Job:** A compact `Table` density (44px rows) and a muted cell tone, so tables don't restyle `th` and cells.
- **Replaces today:** Table restyles in the outreach history and import tables.
- **Also (audit 2026-11-12):** `dashboard/outreach/v2/OutreachHistoryTable.tsx:698`, `dashboard/contacts/crm/import/UploadHistory.tsx:105`, and 8 more, see `product-design-gaps-locations.md`.
- **Exists in DS?** Partly.
- **Priority:** low · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-33 Focus ring migration

- **Solves:** §9 focus
- **Job:** Move the styleguide's 20 components from `ring-ring` and `ring-components-input-focus` to `ring-primary-focus`.
- **Replaces today:** Two banned rings inside the styleguide.
- **Exists in DS?** Partly.
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-34 Line chart and chart palette

- **Solves:** §9 charts
- **Job:** A `LineChart`, and a chart palette ordered so the first colors reach 3:1 on white; one series is one color.
- **Replaces today:** Hand-built Recharts with hex colors (`VisitsChart.tsx`).
- **Also (audit 2026-11-12):** `dashboard/website/components/VisitsChart.tsx:25`, and 1 more, see `product-design-gaps-locations.md`.
- **Exists in DS?** Partly.
- **Priority:** low · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-35 Overlay stacking

- **Solves:** §3 layers
- **Job:** An overlay opened later stacks above an earlier one without `z-*` classes.
- **Replaces today:** `z-[2000]` and `z-[1302]` overrides.
- **Also (audit 2026-11-12):** `dashboard/contacts/crm/person/PersonOverlay.tsx:657`, and 4 more, see `product-design-gaps-locations.md`.
- **Exists in DS?** No.
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-36 MapPanel

- **Solves:** G-110, part of C-01
- **Job:** a non-modal panel over a map: a bottom sheet with a grip and snap
  points below 1024px, a side panel from 1024px, the map still usable
  behind it.
- **Replaces today:** the hand-built panels in `WalkSurface.tsx`,
  `TurfPanel.tsx` and `ListShapePanel.tsx`, and `useSheetSnap.ts`.
- **Exists in DS?** No (`Drawer` is modal).
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-37 ColorSwatchPicker

- **Solves:** the turf color swatches in G-07
- **Job:** pick one color from a fixed set, keyboard reachable, with the
  selected swatch marked by more than color.
- **Replaces today:** raw swatch buttons with inline colors in
  `dashboard/door-knocking/native/createFlow/TurfCard.tsx` and
  `EditTurfDialog.tsx`, and the website theme swatches.
- **Exists in DS?** No (`ToggleGroup` covers the behavior, not the look).
- **Priority:** low · **Status:** proposed · ClickUp: —
- **Owner:** design, later (on touch)

### C-38 SuccessView

- **Solves:** G-51, G-92
- **Job:** the end of a flow: what was done, a summary card, what happens
  next, one primary action that continues the job, and an optional
  `ConfettiBurst` around the icon.
- **Replaces today:** per-channel success screens in the outreach flows,
  `PollPaymentSuccess`, `PurchaseSuccess`, `purchase/complete`, the Pro
  upgrade and verification success steps.
- **Exists in DS?** No (`ConfettiBurst` exists).
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** developers (design reviews the component PR)

### C-39 Card footer slot

- **Solves:** part of G-12 (the compose card reference)
- **Job:** a footer row inside a `Card`, under a rule, flush with the card
  edges, for actions that belong to the field above (AI draft, add image).
- **Replaces today:** `-mx-4 -mb-4` negative margins in
  `dashboard/outreach/v2/sms/SmsComposeStep.tsx` and its copies.
- **Exists in DS?** No.
- **Priority:** low · **Status:** proposed · ClickUp: —
- **Owner:** design, now

### C-40 Composer Textarea variant

- **Solves:** part of G-12, G-59
- **Job:** a borderless, auto-growing `Textarea` for chat composers that
  keeps 16px text below 1024px, so iPhone doesn't zoom.
- **Replaces today:** the restyled `Textarea` in
  `dashboard/shared/agent-chat/chatUI.tsx` and the hand-built chat bars.
- **Seen on screen (visual pass 2026-11-12):** New ordinance (Serve, desktop and mobile).
- **Exists in DS?** No.
- **Priority:** medium · **Status:** proposed · ClickUp: —
- **Owner:** design, now

### C-41 RankedRow

- **Solves:** G-131
- **Job:** one row in a ranked list, built from the trending-issue chevron
  rows in `IssueFeedList.tsx`: the rank in the title text, one muted meta
  line, the whole row clickable with a chevron, rows grouped in one card
  (C-27). Used for every ranked list, not only these screens.
- **Replaces today:** the numbered issue cards in
  `dashboard/community-issues/components/IssueFeedList.tsx`, the poll theme
  cards in `PollResultsPage.tsx` and `PollsIssueCard.tsx`.
- **Exists in DS?** No (`ContentCard` rows come close but have no rank).
- **Priority:** low · **Status:** proposed, decided 2026-11-13: extract
  the existing trending rows, no new look. · ClickUp: —
- **Owner:** developers (design reviews the component PR)

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
- **Also (audit 2026-11-12):** `dashboard/profile/components/SubscriptionPendingCancellationAlert.tsx:13`, and 1 more, see `product-design-gaps-locations.md`.

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
