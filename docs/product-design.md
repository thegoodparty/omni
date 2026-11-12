# Product design

> **Draft, under review.** The root `AGENTS.md` points agents here when they
> design a screen or flow, and the `ux-review-options` prototyping skill follows
> this file directly instead of keeping its own rules, so a change here reaches
> the next prototype. Sections 1 to 4 are agreed. Sections 5 to 13 are
> proposed. Send feedback to Eugene.

**The goal:** narrow the user's focus so they know exactly what to do at any
moment, for whatever job they're doing. Every rule below serves that. When a
rule doesn't cover a case, choose the option that leaves the user with fewer
things to look at and fewer decisions to make.

UX (how it works) comes first, then UI (how it looks). Copy rules are in
`product-copy.md`, and Win vs Serve words are in `product-vocabulary.md`.
Where to look when a question isn't answered here: `design-sources.md`.

# Part 1: UX

## 1. Who we design for

- **Candidates (Win).** Often running for the first time, for a local office,
  with little or no staff.
- **Elected officials (Serve).** Part-time officials in small towns, serving
  alongside another job.
- **Their team (Win only, for now).** The person who created the account is the
  owner, and they can invite two team roles:
  - **Campaign managers (team role)** run everything on the campaign except
    billing and account settings. Not to be confused with the Campaign Manager
    AI assistant.
  - **Volunteers (team role)** run only the door knocking or phone banking they
    were assigned, and see nothing else.

They use it in short sessions that get interrupted, often on a phone, sometimes
on a doorstep. They scan, decide, and move on.

What follows from that:

- **Design mobile first, even though most use is on desktop.** The phone isn't
  the majority. It's a constraint that forces simplicity: one column, one
  primary action, nothing extra. A screen that works on a phone only needs more
  room on desktop, not more things.
- **Design the journey, not the screen.** A feature is one stop in one app.
  Before designing it, know where the user came from, what job they're in the
  middle of, and where they go next. A screen that's fine on its own but adds a
  detour, a duplicate entry point or a new way of doing an existing thing makes
  the app worse.
- **Every screen answers "what do I do now?"** within a few seconds, for someone
  with five minutes who'll be interrupted halfway through.
- **Assume no training and no prior visit.** If a feature needs a tour to be
  understood, the feature is wrong.
- **They are not technical.** Nothing should require understanding how the
  system works.

## 2. Flows

**A flow is an ordered set of decisions with something to commit at the end.**
Anything else is a single screen.

- **Every flow is its own page.** Each step has its own URL, so Back goes to the
  previous step, refresh keeps the user where they were, and a step can be
  linked. Never put a flow inside a drawer or dialog.
- **One question per step.** Titles and captions follow `product-copy.md`.
- **When the step changes, scroll to the top.**
- **Leaving is always one tap away.** If the user has typed something, ask
  before throwing it away.
- **Don't save progress by default.** The exception is a flow that asks for
  something the user may have to go find, like an EIN or filing details. That
  kind of flow saves each step's answers on the server when the step is
  completed, so leaving and coming back loses nothing. Outreach drafts are a
  separate, intentional pattern for free accounts.
- **Payment happens inside the step,** like a checkout: what they're buying, the
  total, and the pay button together. There's no separate review step.
- **Every flow ends on a success view,** never a toast. It shows:
  1. What was done.
  2. A summary to refer back to (receipt, reach count, what was submitted).
  3. What happens next, and when, if the outcome is out of the user's hands.
  4. One primary action that continues the job, like "Start knocking". A plain
     "Done" that returns to the hub is the weak version.

The outreach flows are the reference for copy, not for structure.

## 3. Pages, drawers and dialogs

**First ask: is this a place, or a quick look?**

A **place** is somewhere the user goes to do a job. It's a place if any of these
is true:

- It has its own actions, results or sub-items.
- It has more than one step.
- The user works in it for more than a moment, or comes back to it later.
- Someone would send the user straight to it: a teammate, an email, a
  notification, a success view, the AI chat.

A **quick look** is something the user checks or changes without leaving the job
they're in. They're done in seconds, and when it closes they're exactly where
they were. Examples: one contact while working through a list, confirming a
delete, picking a date.

**A place is a page, and a quick look is an overlay.** Here's why a place must be
a page:

- **Focus.** A page gives the job the whole screen. An overlay keeps the last
  screen showing behind it, so the user is half in two places. That works
  against the goal of this doc.
- **The browser works.** A page has a URL. Back goes back, refresh keeps the
  work, and a link takes someone straight there. In an overlay, Back closes
  everything and refresh throws away what they did.
- **It can be reached.** Success views, notifications, emails, teammates and the
  AI chat all need somewhere to send the user. An overlay has no address.
- **It has room to grow.** Places gain features over time. A page absorbs them.
  An overlay stacks them on top as more layers, until the user can't tell what
  closing will do.

**The warning sign:** when an overlay starts collecting tabs, steps, tables or
jobs of its own, it has become a place. Make it a page.

**These are places, so each one is a page:**

- **The outreach flows:** SMS, robocall, phone banking, social, and creating a
  door knocking campaign.
- **An outreach effort's details:** its progress, results, turfs and team.
- **Creating a contact list.**
- **The AI chat.** It gets the full screen. Whatever it's working on, like a
  draft, appears inside the conversation, not in a separate panel.

**Known gap: every one of these is an overlay today.** The outreach flows run
in a full-screen drawer (`packages/gp-webapp/app/dashboard/outreach/v2/OutreachSheet.tsx`),
and so does door knocking create
(`packages/gp-webapp/app/dashboard/door-knocking/native/createFlow/CreateListFlow.tsx`).
Outreach details is a drawer that opens dialogs of its own
(`packages/gp-webapp/app/dashboard/outreach/v2/OutreachDetailsDrawer.tsx`).
Creating a contact list is a stepped drawer
(`packages/gp-webapp/app/dashboard/contacts/crm/wizard/CreateListWizard.tsx`).
The chats are tall bottom drawers on desktop
(`packages/gp-webapp/app/dashboard/shared/ai-chat/AiChatSurface.tsx`,
`packages/gp-webapp/app/dashboard/chief-of-staff/components/chat/ChiefOfStaffChatSurface.tsx`).
Don't copy their structure. If you're changing one of them in a meaningful way,
move it to a page.

Then pick the lightest option that fits:

| Use              | When                                                                         | Mobile (under 1024px)                            | Desktop                  |
| ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------ |
| **Page**         | A flow, or a place                                                           | Full page                                        | Full page                |
| **Side sheet**   | A quick look at one item while the list behind it stays in view              | Full screen                                      | Slides in from the right |
| **Drawer**       | Quick inputs, a few actions, or short information                            | Bottom drawer. Full height if it has text inputs | Becomes a dialog         |
| **Alert dialog** | Confirming something the user did that can't be undone or loses unsaved work | Centered dialog                                  | Centered dialog          |
| **Dialog**       | A short, focused input                                                       | Bottom drawer                                    | Centered dialog          |
| **Popover**      | A small menu or hint tied to one element. Never a form                       | Bottom drawer                                    | Popover                  |
| **Inline**       | Optional detail or a simple edit, shown in place                             | Inline                                           | Inline                   |

- **An alert dialog is the styleguide `AlertDialog`,** like "Discard
  changes?" in the outreach flows: two buttons, stacked, the primary on
  top, at every width.
- **A bottom drawer keeps its 608px column.** The styleguide `Drawer` does
  this by default; put content in its header, body and footer.
- **When buttons stack, anywhere, the primary is on top.**
- **At most two layers.** A drawer or sheet can open one more drawer for a
  single focused task that belongs to the same job, like recording the
  outcome of a call. A confirmation can sit on top of either. Never a third
  layer, and never a second drawer that starts a different job: close the
  first one, or move the job to a page. Closing the top layer returns the
  user to the one below exactly as they left it. On desktop the same limit
  applies to sheets and dialogs.
- **Every drawer and sheet has a visible close button,** not just a drag handle.
  The phone's Back gesture closes it, not the whole page.
- **Closing with unsaved typed input asks first.**
- **Use one shared responsive component:** a drawer below 1024px and a dialog
  above.

**Known gap: that shared component doesn't exist yet.** Today there are
competing versions, and none of them switches at 1024px:

- `packages/gp-webapp/app/shared/ui/ModalOrDrawer.tsx` (and its alias
  `packages/gp-webapp/app/shared/utils/ResponsiveModal.tsx`) switches at 768px.
- Several features build the switch themselves with `useIsMobile`, for example
  `SharePlanModal.tsx`, `DownloadReminderModal.tsx` and
  `PhoneBankingEntryPanel.tsx`.
- Several "drawers" are built from `Sheet side="bottom"`, which doesn't swipe to
  close, for example `ShareBriefingDrawer.tsx` and `AddNotesDialog.tsx`.
- The styleguide's side sheets (`Sheet` with `side="right"` or `side="left"`,
  `packages/styleguide/src/components/ui/sheet.tsx`) default to 75% width on
  mobile, not full screen. Bottom and top sheets are full width.

If you're building or changing a drawer or dialog, close this gap first: put one
component in the styleguide that switches with `useIsMobile`
(`packages/styleguide/src/hooks/use-mobile.ts`, 1024px), move your feature onto
it, and delete this note once nothing else uses the old versions.

## 4. Asking for input

- **Don't ask for what we already know.** Fill it in from what we have and let
  them correct it.
- **Ask at the moment it's needed, not up front.** An EIN comes up when they
  upgrade, not during onboarding. Known exception: sign-up asks for a phone
  number because sales uses it.
- **Pre-select a sensible default** when most people pick the same thing.
- **Show few options, search many.** Up to about five choices appear as visible
  cards or toggles. More than that, use a searchable list. Never a dropdown for
  two or three options.
- **A commitment is the user's own act.** Consent, a pledge or an agreement is
  an unchecked box they tick themselves, never pre-checked.
- **Mark optional fields, not required ones.** Optional fields say "(optional)"
  in the label; required fields carry no asterisk. Keep optional fields rare: if
  a field isn't worth requiring, ask whether it's worth asking at all.
- **Ask the same question the same way everywhere.** Same wording, same options,
  same control. Copy rule 7 in `product-copy.md`, applied to inputs.
- **Check an answer when they leave the field or submit, not while they're
  typing.**
- **Errors appear next to the field,** written as what happened, then what to do,
  with an example when the format is strict ("Must be C followed by 8 digits,
  like C00123456"). On submit, move to the first field with an error.
- **Never show a form error in a toast.** People miss messages that fade away.
- **Don't disable the submit button to signal missing input.** Keep it active
  and, when pressed, show the errors. A greyed-out button doesn't say what's
  wrong, can't be reached by keyboard, and is hard to see. Disable it only while
  the submit is in progress, with a loading state, so nobody pays twice.

## 5. Actions and what happens next

> **Proposed, not agreed yet.** Review these and send feedback.

- **One primary action per screen.** It's the thing they're most likely to do
  next. Everything else is visually secondary.
- **Buttons name what happens.** Verb plus object, as in `product-copy.md` rule 6. Never "Submit", "OK" or "Yes", and never "Continue" when something specific
  or irreversible is about to happen.
- **Every action gets feedback where it happened.** The button shows it's
  working (the styleguide `Button` has a `loading` prop), then the result
  appears in place. A toast is only for low-stakes confirmations.
- **Anything that costs money or reaches voters says exactly what will happen
  before they commit:** who it reaches, how many people, the cost, and when it
  goes out. The robocall and SMS review and pay steps are the reference.
- **Undo instead of "are you sure?" for anything reversible,** like archiving.
  Confirm only actions that can't be undone, naming the thing and what's lost,
  with a confirm button that names the action ("Delete list", not "Yes").
- **Never leave them wondering if it's working.** Anything longer than about a
  second shows progress. Long jobs, like AI generation or building a list, say
  roughly how long they'll take and let the user leave and come back. Opponent
  research ("usually takes under a minute. We'll keep working in the
  background") is the reference.

**Known gap: there's no undo yet.** Nothing offers undo for deletes or archives,
and the toast (`packages/gp-webapp/app/shared/utils/Snackbar.tsx`) can't hold an
action button. The first feature that needs undo adds it there.

## 6. States and dead ends

> **Proposed, not agreed yet.** Review these and send feedback.

Every screen has four more versions than the full one: nothing yet, still
loading, failed, and no signal. Design all of them. Each one still answers
"what do I do now?"

- **Only the part that's waiting changes.** The page title, navigation and
  page actions stay in place while a list loads, fails or comes back empty.
  A section that fails shows it in that section, and the rest of the page
  keeps working. The volunteer assignments page does all three states this
  way (`packages/gp-webapp/app/volunteer/components/AssignmentsPage.tsx`).
- **Never show a failure as empty.** "No campaigns yet" after a failed load
  says something that isn't true. Failed, empty and not ready yet are three
  different states, and each gets its own words.

### Empty

- **Use the styleguide `EmptyState`.** One sentence, then the one thing to
  do, as a button (`product-copy.md` rule 8). The reference is
  `packages/gp-webapp/app/dashboard/contacts/crm/import/UploadHistory.tsx`.
- **"Nothing yet" and "nothing matches" are different.** A first visit says
  how to start: "No outreach yet. Pick a channel above to send your first."
  A filter or search with no results says so and offers to clear it. Reuse
  the wording in `packages/gp-webapp/app/dashboard/outreach/v2/outreachHistoryCopy.ts`.
- **When someone else acts next, say who and when.** Say who fixes it, how
  long it usually takes, and how to reach them: "Contact support" and
  "Typical setup time: 1-2 business days"
  (`packages/gp-webapp/app/dashboard/contacts/crm/VoterDataUnavailableState.tsx`).

### Loading

- **Skeleton when you know the layout, `Spinner` when you don't.** A
  `Skeleton` takes the shape of what's coming, so nothing jumps when it
  arrives. A wait with nothing to preview, like a route loading or a map,
  gets one centered `Spinner`
  (`packages/gp-webapp/app/shared/utils/RouteLoading.tsx`). A button that's
  working uses `Button loading` (section 5). Never "Loading..." on its own, a
  hand-built pulse or spinner, or a full-screen branded loader.
- **Optional content waits quietly.** A card that may not show at all
  appears only once it's ready. It gets no skeleton, because a skeleton
  that then disappears looks broken.
- **A wait of more than a few seconds says how long,** as section 5 says. It
  never shows progress it can't measure: "Large districts can take up to 30
  seconds." (`packages/gp-webapp/app/dashboard/door-knocking/native/useVoterPack.ts`).

### Errors and dead ends

- **Name what failed, then give the way forward.** Use a styleguide `Alert`
  with "Couldn't load your assignments" and a "Try again" button in
  `AlertAction` that retries in place. Don't write "Something went wrong" or
  "Refresh the page": a refresh drops whatever isn't saved yet, like a
  walk in progress, call answers or onboarding steps. Never show a raw error
  message or code (`product-copy.md` rules 3 and 8).
- **Try again restarts the whole check.** If a background check keeps
  failing, its Try again restarts the check, not just one request. A slow,
  expensive load, like the door knocking voter map, retries only when the
  user presses Try again, never on its own.
- **Show the error only when there's nothing to show.** If a refetch fails
  while the screen still has data, keep the data and what the user is
  editing on screen.
- **"Try again" is for failed requests only.** A request that failed gets
  Try again. Something that's gone, isn't set up yet, or changed access or
  plan gets the action that fixes it, never a retry that will fail the same
  way. The
  reference is `packages/gp-webapp/app/dashboard/polls/shared/ConstituentDataUnavailable.tsx`.
- **A failed save keeps what they entered.** Say it failed next to the
  button they pressed, keep their answers, and let them press it again
  (sections 4 and 5).
- **No dead ends.** Every error, empty, not-found and locked state has at
  least one action that moves the job forward or goes back. The app's 404
  and error pages get their own template first; until then, leave them as
  they are.

### No signal

- **Field work keeps going without signal.** When a canvasser or caller
  logs a door or a call, it's saved on the phone, the walk moves on, and it
  sends once signal returns. Say so in plain words: "Saved on your device.
  It will be sent when you have signal." (`OFFLINE_MEMO_COPY` in
  `packages/gp-webapp/app/dashboard/shared/dictation/useOfflineMemo.ts`).
  Never keep anyone standing at a door waiting for a save. When signal
  returns, the page doesn't reload and nobody loses their place.
- **Everywhere else, name the connection.** A load or save that fails while
  the phone is offline says "Check your connection and try again", with a
  Try again button.

**Known gap:** loading is shown four ways (G-22), empty states are built by
hand (G-23), and the app's error and not-found pages break these rules. See
`product-design-gaps.md`.

## 7. Reuse, never invent

> **Proposed, not agreed yet.** Review these and send feedback.

The same job should look and work the same everywhere. Each new version of
it is one more thing users have to learn and one more thing we have to fix.

### Pick in this order

Stop at the first that fits:

1. **The solution the product already uses for the same job** (a multi-step
   task, a list of records, one record's details, a set of counts, a
   confirmation), copied exactly, even if it modified a component. Check
   section 13 first: if it names a reference for the job, copy that. Name that
   screen and its file path. When the product does the job more than one way,
   copy the one in a sibling flow (the same area, like the other outreach
   channels), or else the most recently shipped, and list the others in the
   proposal below. Wording follows `product-vocabulary.md` for Win and Serve.
   Copy how it looks, never behavior that breaks sections 1 to 6: follow
   those, and list the difference. A reference is copied for the job it's
   named for, never for something this file rules out; where a reference
   breaks a rule, the rule wins, and you list the difference as a gap. One known
   modification in two places is fixed once; a second look for the same job is
   not. Then propose extending the component so both places use it as it
   ships. If this file names that feature as a known gap, reuse its components
   and wording, not the structure this file rules out.
2. **A styleguide component, as it ships.** `packages/styleguide/COMPONENTS.md`
   says what job each one is for. Documented props and variants only, never a
   className that changes how it looks. In a canvas or prototype, the
   styleguide is `.claude/skills/ux-review-options/assets/gp-ui.css`.
3. **Propose a new component or variant,** only if it replaces hand-rolled or
   modified UI in two or more places, or two or more flows need it. Until
   the team approves it, build from the closest fit.

If none fits yet, build from the closest one and list the gap. Never a
stand-in of your own: no new components, no hand-rolled UI, no restyled
components. CI counts restyled components (`check:design-system` in
gp-webapp) and fails when the count rises. Only two things raise its
baseline, in the same PR: copying a restyled solution under step 1, with a
note naming the screen copied, or an exception the team granted, with a note
giving its end date.

**Every component proposal, new or extending one, comes first in the design
or PR description, and its author posts the link in #tmp-design-agent in
Slack.** An agent that can't post asks its human to. Bryan, Olly and Eugene
decide there, in the thread: use an existing component, add the new one, or
allow a one-time exception with an end date. Nothing in it is built until
they decide. Record the decision in the proposal's Part 4 entry. First check Part 4 (Components) of `product-design-gaps.md`, a list
of proposals, not rules, and read nothing else in that file. If the component
is already there, add your places to its entry. If it was rejected, don't
propose it. Otherwise add it there as a new entry with status `proposed`. The
proposal says:

1. The job, and why no existing component or variant can do it as it ships.
2. Every place it would replace or be used, with file paths.
3. The props or variant it adds, as few as possible.
4. What changes on each of those screens once it lands.

### Invent nothing

- **Every element is an existing pattern or component,** and a new action
  reuses the flow that already does that job (a social post opens the social
  outreach flow from an outreach proposal card). Labels, badges and button
  words come from the product too. Icons come only from the styleguide's
  lucide set, as inline SVG. Only the content is new.
- **Every design shows what it's built from.** With the design, list each
  element and its source: the component's name, or the file of the screen whose
  solution it copies. An element with no source is a gap: it goes on the list
  of gaps, built from the closest fit, never as something new.
- **Earn every element.** No helper text, banner or summary number unless the
  product already shows it there or the ticket asks for it. A ticket decides
  what to show, never how: it's still built in the order above. Each one is
  something to look at and something to defend.

### Changing what's there

- **Never invent a screen that exists.** When a design changes an existing
  page, panel or the navigation, start from its source: same layout,
  components, labels and way back. Compare it to today's page (the preview
  or a screenshot) before changing anything. A reviewer who can't recognize
  today's screen can't judge the change.
- **Check the siblings first.** Before changing a pattern in one flow, find
  every flow that has it. Say "same in X" and change them together, or say
  "only here" and why. One fix, not a new copy.
- **A shared component changes every screen.** Before changing one, list where
  it's used and ask. Otherwise fix it where you were asked to.
- **Say what a change drops.** When you replace a component or a screen, list
  any behavior the old one had that the new one doesn't, even a small one.

## 8. Layout and hierarchy

> **Proposed, not agreed yet.** Review these and send feedback.

**A page reads top to bottom as one column: its title, the one thing to do
now, then the rest.** If you can't say how a page is organized in one
sentence, it isn't ready.

- **Start from the shell.** Every dashboard page is a `DashboardLayout` with
  a `navHeader`, so the sidebar, top bar and title bar are the same
  everywhere. The page's primary action goes in through
  `DashboardNavHeaderAction`. Copy the components, not a page. Don't build a
  header of your own.
- **One title per page, and it's the nav label,** word for word. Nothing
  below it is a second title or a hero headline. Everything below it is a
  section heading.
- **The page's primary action sits on the right of the title bar,** through
  `DashboardNavHeaderAction`. Not in a second bar or the middle of the
  content. A fixed bottom bar is for flow steps only (`StepFooter`).
- **A page you step into and back out of** (a story, a profile, one
  record's results) drops the sidebar and opens on a back arrow and its
  title. The arrow sits in the margin, so the title lines up with the
  content. One back pattern everywhere, never a breadcrumb on one page and a
  text link on the next.
- **The width comes from what the page holds.** 608px by default: flows,
  forms, chat and anything read top to bottom (`FullScreenStepChrome.tsx`).
  720px for the home pages and pages built around a table. Up to 1280px for
  a grid of cards in a row (the outreach hubs). A map fills the screen. The
  column sits centered.
- **One type scale: 12, 14, 16, 18, 20, 24 and 32px, nothing in between.**
  By role:
  - 32px: a rare display title, like a success view or winning the election.
  - 24px: a flow step's title (the question).
  - 20px: a large heading inside a page, like a card or block that leads it.
  - 18px: an overlay's title, as `Dialog` and `Sheet` ship it.
  - 16px: the page title, in the title bar, and a section title on a page.
  - 14px: body text, list rows, table cells, and secondary detail in muted
    gray; a card title is 14px semibold.
  - 12px: badges, tags and status.

  Every heading is 600, the 32px title included; body text is 400. Never
  700 (bold). Buttons and inputs keep the size the
  styleguide gives them; an input is 16px on a phone, so iPhone doesn't zoom
  in on focus. Never change a styleguide component's text size where you use
  it: where one is off the scale, use it as it ships and list the gap; the
  fix goes in the component. A question on a form page is a label, not a
  heading. No overlines. Muted gray is never for instructions the user
  needs.

- **Edges: 16px on a phone, 24px from 1024px; flows 24px.** On a wide page
  the content's left edge then sits under the page title in the title bar.
- **Space shows what belongs together.** 16px between items in a group,
  32px between sections. Six or more items get grouped under named section
  titles.
- **Show a working set.** The top one to three things, then "See more". Cap
  a list and collapse the rest.
- **Cards use the styleguide as it ships:** `Card`, `ContentCard` or
  `ChannelCard`, with a border and no shadow, and the same corner radius as
  the surfaces around them.
- **Buttons sit on the right of their row,** unless long content or a
  branded image takes that spot.
- **End a long page with about 128px of space,** so the end reads as the end
  and nothing sits under a bottom bar.

The reference for a hub page is Priorities
(`packages/gp-webapp/app/dashboard/priorities/page.tsx`,
`packages/gp-webapp/app/dashboard/priorities/components/PrioritiesHub.tsx`):
one column, the title in the bar, 16px section titles, and records as rows
in one card. Copy that structure only: its width, edges and hand-built cards
are gaps. For a flow step, the reference is
`packages/gp-webapp/app/dashboard/shared/FullScreenStepChrome.tsx`; the
uppercase label over its title is a gap, not something to copy.

## 9. Tokens and color

> **Proposed, not agreed yet.** Review these and send feedback.

Color tells the user what something is or what state it's in. Everything
else on the screen is black, gray and white. Every color is a token, so a
change in the styleguide reaches every screen at once.

- **Components bring their own color.** Pick a variant or tone (section 7).
  Color utilities are only for the elements you lay out yourself, like a line
  of text, a divider or a panel.
- **Name the role, never the hue.** Use semantic tokens only: `foreground`,
  `muted-foreground`, `background`, `card`, `muted`, `border`, `primary`,
  `tertiary`, `destructive`, `warning`, `success`, `info`. Never a Tailwind
  palette color (`blue-600`, `gray-300`), a scale step (`base-*`, `tw-*`,
  `grayscale-*`), a hex value or a bracketed variable. The tokens and their
  utilities are in `packages/styleguide/src/design-tokens.css` and
  `packages/styleguide/src/tailwind-theme.css`. CI counts hex classes.
- **Neutral by default.** Content is `text-foreground`, secondary text is
  `text-muted-foreground` (on `bg-card` too), edges are `border-border`
  (borders, not shadows: `design-memory/learned.md` #21). A quiet panel or
  highlight is `bg-muted`. There is no yellow highlight.
- **Blue means "you can act here."** `primary` is for the one primary action
  (section 5), links, the selected item and focus. Never decoration.
- **Selected and active states use `tertiary`:** `bg-tertiary-dark` or
  `border-tertiary-dark` with `text-tertiary-foreground`. Hover is opacity on
  the same token (`hover:bg-tertiary-dark/90`), never a new color.
- **Focus rings are `ring-primary-focus`.** Inside a colored family, use that
  family's `-focus` (`ring-destructive-focus`). Never `ring-ring` or
  `ring-components-input-focus`, and never remove a focus ring.
- **Status is words and an icon first, color second.** Color alone never
  carries meaning: not for color-blind users, not on a phone in the sun. A
  record's status is `StatusText` (section 13), with these tones:
  - `primary`: in progress, scheduled, done.
  - `warning`: waiting on the user, or a date that's close or past.
  - `destructive`: an error or a failure, nothing else.
  - `muted`: draft, canceled, archived.
  - `success`: a check that just passed, like a validated field.
  - `info`: an offer or a neutral notice (`learned.md` #47).
- **Red means something failed or will be lost.** Never a deadline, a tag or
  emphasis (`learned.md` #30, #47). GoodParty brand red is for the logo and
  phone banking's channel tint, nothing else.
- **Colored text you set yourself uses the `-dark` step.** Base `success` and
  `warning` are too light to read on white. A tinted panel is
  `bg-{tone}-background` or `bg-{tone}/10` with `text-{tone}-dark`, as
  `Alert` does.
- **A channel keeps one color everywhere, in Win and Serve.** Each outreach
  channel's tint is set once in
  `packages/gp-webapp/app/dashboard/outreach/v2/channelMeta.tsx`: tiles,
  history badges, chat cards and flows all take it from there. Never pick a
  new one per screen, and never use it for status. These tints are brand
  palette colors on purpose; that file is the one place they're allowed.
  Each channel has its own hue at the 200 step, so no two channels share a
  color; phone banking is red because every other hue is taken.
- **Don't use the `secondary` variant** of `Button` or `Badge` (lavender)
  in the product. A quieter button is `outline` or `ghost`.
- **Charts use the styleguide's `BarChart`, `BarList`, `DonutChart` or
  `PieChart`,** which color series from `data-chart-1` to `-7` in order.
  Never hand-color a chart.
- **Light theme only, built to switch.** We design and ship light
  (`learned.md` #16). The tokens already change under `.dark`, so a screen
  built only from tokens needs no `dark:` classes. Don't add them.
- **A color you can't find is a gap, not a new value.** Don't add a token or
  change a shared variable (`--border`, `--input`) for one screen. List the
  gap and propose it as section 7 says.

Reference: door knocking uses tokens throughout, for example
`packages/gp-webapp/app/dashboard/door-knocking/native/TurfDetailsSheet.tsx`
and `packages/gp-webapp/app/dashboard/outreach/v2/sms/SmsReviewStep.tsx`.
For status, `packages/gp-webapp/app/dashboard/contacts/crm/import/UploadStatusText.tsx`.

**Known gap: about 1 in 6 color classes is off-token.** In `gp-webapp/app`
there are about 460 Tailwind palette classes, 180 `base-*`, 25 hex classes
and about 100 hex strings, against about 3,700 semantic ones. Most are in
Pro upgrade, onboarding and polls. Replace them with tokens as you touch
those screens.

## 10. Mobile: one breakpoint at 1024px (`useIsMobile`)

> **Proposed, not agreed yet.** Review these and send feedback.

**Under 1024px is mobile. 1024px and up is desktop. There is no tablet
layout.** The shell already switches there: the sidebar becomes a menu in
the top bar (`DashboardLayout`, the styleguide `Sidebar`). Content switches
at the same point, so a phone-style shell never wraps a desktop layout.
Overlays follow the table in section 3.

- **Use `lg:` in CSS and `useIsMobile` in code,** nothing else. No `md:`,
  no hand-written `matchMedia`, no `useTailwindBreakpoints`. Show and hide
  with `lg:` classes. Use the hook only when the two widths need different
  components: it assumes mobile on the first render.
- **Same content, same order, same actions.** Desktop gets more room, never
  more things, and the phone never loses a feature. If something doesn't
  fit, it moves into a drawer or a page (section 3), not off the phone.
- **Design the phone first, fold first.** At 375px, decide what sits above
  the fold before anything else: the title, the one primary action, and the
  start of the content.
- **One column on mobile.** Side-by-side panels stack, with the primary
  content first.
- **The title lives in the top bar on mobile.** Don't repeat it in the
  content. A title bar that carries the page's primary action stays as an
  action-only strip (`DashboardNavHeader`).
- **Tables become a list of cards under 1024px,** one card per row, with
  the same fields. Never sideways scrolling. The reference is
  `packages/gp-webapp/app/dashboard/outreach/v2/OutreachHistoryTable.tsx`:
  copy its switch to cards, not its empty state or table styling.
- **Flow buttons are 48px (`size="large"`) at every width:** the primary
  filled, the others `ghost`. Buttons inside a step keep the default size.
- **Flow buttons on a phone stack.** The primary is full width on top.
  Under it, one row of at most two `ghost` buttons: Back, and one more
  action if the step needs it. More than that goes to the header. From
  1024px they sit in one row: Back on the left, the primary on the right, at
  least 240px wide.
- **The target is the market pattern, and flows move to it next:** on a
  phone, Back is an arrow at the top left of the flow's header, and the
  bottom holds only the primary action and at most one secondary one
  (`product-design-gaps.md` G-69). Until a flow moves, Back stays in the
  stack above.
- **While the keyboard is open on a phone, the flow buttons scroll with the
  step** instead of staying pinned above the keyboard, so the field being
  typed into keeps the room.
- **One fixed bar at the bottom at a time,** and the page leaves room under
  its last element so nothing hides behind it. A page that owns the bottom
  of the screen, like the door knocking walk, turns off the chat dock
  (`hideChatDock` on `DashboardLayout`).
- **Inputs stay 16px on a phone,** as the styleguide ships them, so iPhone
  doesn't zoom in when a field gets focus. Never shrink one.
- **Check every screen at 375px and 1280px,** and once at 1023px and
  1024px, before calling it done.

## 11. Motion and illustration

> **Proposed, not agreed yet.** Review these and send feedback.

Motion and pictures confirm what the words already say. With every animation
and image removed, a screen still says everything it needs to.

- **Motion is a design decision, not a default.** Stop at the first that does
  the job: a motion token (`--animate-*` in
  `packages/styleguide/src/tailwind-theme.css`), motion a styleguide component
  already has, a static icon. A Lottie only when a designer asked for it, with
  a note in the PR saying who and what it does that an icon can't.
  `check:animation-assets` refuses any other.
- **Each token keeps its one job.** `animate-pop-in` for something that just
  became true, like the check on a finished step. `animate-shake` for "this
  won't work" while it stays true, like too many stops on a turf, always next
  to the words that say why (section 4). `text-shimmer` for an AI step that is
  running, `animate-spin-gradient` for the AI chat bar only. Never reuse one
  as decoration.
- **Overlays, accordions and tabs move the way the styleguide ships them.**
  Don't add or change their transitions (section 7).
- **Celebrate only a finish that matters,** like launching outreach, paying, or
  marking a task done. Use `ConfettiBurst` once, around the success view's
  icon. It has one size and no red, because red means something went wrong.
  Never for a routine save, and never as decoration. The one full-screen
  celebration is winning the election.
- **Respect reduced motion.** Anything that moves on its own adds
  `motion-reduce:animate-none` (tokens don't do it for you). A celebration
  disappears entirely; what it surrounds stays.
- **Waiting is section 5, shown with the styleguide:** `Skeleton` for content
  loading into a known layout, `Spinner` for an unknown wait, `Progress` for
  known progress, `Button loading` on a button. No hand-rolled spinners or
  pulses.
- **No decorative illustration.** A static picture meets the same bar as a
  Lottie: a designer asked for it, with a note in the PR. An empty list is
  `EmptyState`, with at most
  an icon that names the empty thing (section 13). A picture earns its place by
  carrying content: a person's photo (`Avatar`), a map, a chart, a video that
  says something.
- **Icons come only from the styleguide set (section 7), and never in place of
  words,** except an icon-only button with a tooltip. No emoji, and no text
  characters used as icons (✓, ✕).

## 12. Patterns we've rejected

> **Proposed, not agreed yet.** Review these and send feedback.

Each of these was tried, or proposed, and turned down. Don't build or propose
them again. The section in the last column holds the full rule.

| Pattern                                                                                                                                               | Why we rejected it                                                          | Use instead                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A multi-step flow in a drawer, sheet or dialog                                                                                                        | Back closes everything, refresh loses the work, a step can't be linked      | A page with a URL per step (section 2)                                                              |
| A place (own actions, steps, or somewhere people get sent) as an overlay                                                                              | The user is half in two places, it has no address, and it grows layers      | A page (section 3)                                                                                  |
| A third overlay layer, or a second drawer that starts a different job                                                                                 | The user can't tell what closing will do                                    | Close the first, or move the job to a page (section 3)                                              |
| A drawer or sheet with only a drag handle                                                                                                             | Nothing visible says how to leave                                           | A visible close button, and Back closes it (section 3)                                              |
| A flow that ends on a toast                                                                                                                           | No summary to refer back to and no next step                                | A success view (section 2)                                                                          |
| A form error in a toast                                                                                                                               | People miss messages that fade away                                         | The error next to the field (section 4)                                                             |
| A submit button disabled until the form is complete                                                                                                   | It doesn't say what's wrong, keyboards can't reach it, and it's hard to see | An active button that shows the errors on press (section 4)                                         |
| A pre-checked consent box                                                                                                                             | A commitment has to be the user's own act                                   | An unchecked box (section 4)                                                                        |
| A dropdown for two or three options; asterisks on required fields                                                                                     | Hides the choice; marks the common case                                     | Visible cards or toggles; "(optional)" on optional fields (section 4)                               |
| "Submit", "OK", "Yes", or "Continue" before something irreversible                                                                                    | The button doesn't say what happens                                         | Verb plus object (section 5, `product-copy.md` rule 6)                                              |
| A restyled component, hand-rolled UI, or a new component nobody approved                                                                              | Each new version is one more thing to learn and to fix; CI counts restyles  | The product's existing solution, then the styleguide as it ships, then a proposal (section 7)       |
| A trimmed copy of a shared record on another page                                                                                                     | Two records drift apart, and the copy lost the person's status row          | Open the one person sheet by its id (`docs/adr/2026-11-04-one-person-sheet-opened-by-person-id.md`) |
| Renaming a shared string to fix Serve                                                                                                                 | It breaks Win, since both mount the same components                         | A mode-keyed copy object (`product-vocabulary.md`)                                                  |
| Icons from `lucide-react` or `react-icons` directly, emoji                                                                                            | Mixed weights and styles side by side                                       | The styleguide's icon set (sections 7 and 11)                                                       |
| An animation or illustration added by default                                                                                                         | Nine Lotties piled up, five unused, one 2.4MB on an empty state             | The order in section 11                                                                             |
| Overlines; shadows on cards                                                                                                                           | Overlines stopped meaning anything; shadows aren't our surface              | The title leads; borders (`learned.md` #19, #21)                                                    |
| A date as a badge, or red or orange for a deadline; dimming a tile to lock it                                                                         | Red means an error; a deadline is a reminder, not an alarm                  | Muted text with a calendar icon; one corner tag (`learned.md` #30, #47)                             |
| A label that shows on every visit ("Start here", "High priority"); the same helper line under every field; a second line that only points at the card | Says nothing, so it's noise                                                 | Cut it (`learned.md` #17, #18, #28)                                                                 |
| Instructions as small gray text inside accordions                                                                                                     | Nobody opens them                                                           | A prep screen before a demanding flow (`learned.md` #39)                                            |

## 13. Reference screens

> **Proposed, not agreed yet.** Review these and send feedback.

When a screen does one of these jobs, copy the reference (section 7, step 1).

| Job                                 | Component     | Reference                                                                                                                                         |
| ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| An empty list or table              | `EmptyState`  | `packages/gp-webapp/app/dashboard/contacts/crm/import/UploadHistory.tsx`                                                                          |
| Payment inside a flow               |               | `packages/gp-webapp/app/dashboard/outreach/v2/sms/SmsReviewStep.tsx`, `packages/gp-webapp/app/dashboard/outreach/v2/robocall/RobocallPayStep.tsx` |
| A long job (AI, building a list)    |               | `packages/gp-webapp/app/dashboard/race-opponent/components/OpponentResearchProgress.tsx`                                                          |
| A record's status                   | `StatusText`  | `HistoryStatusText` in `packages/gp-webapp/app/dashboard/outreach/v2/channelMeta.tsx`                                                             |
| Confirming an action you can't undo | `AlertDialog` | "Discard changes?" in `packages/gp-webapp/app/dashboard/outreach/v2/OutreachFlowShell.tsx`                                                        |
| A field for writing a message       |               | The outreach compose card, `packages/gp-webapp/app/dashboard/outreach/v2/sms/SmsComposeStep.tsx`                                                  |
| A tab's page title                  | `navHeader`   | `packages/gp-webapp/app/dashboard/shared/DashboardNavHeader.tsx`, through `DashboardLayout`                                                       |
