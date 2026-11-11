# Product design

> **Draft, under review.** The root `AGENTS.md` points agents here when they
> design a screen or flow, and the `ux-review-options` prototyping skill follows
> this file directly instead of keeping its own rules, so a change here reaches
> the next prototype. Sections 1 to 4 are agreed. Sections 5, 7 and 13 are
> proposed. The rest is not written yet. Send feedback to Eugene.

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

| Use            | When                                                            | Mobile (under 1024px)                            | Desktop                  |
| -------------- | --------------------------------------------------------------- | ------------------------------------------------ | ------------------------ |
| **Page**       | A flow, or a place                                              | Full page                                        | Full page                |
| **Side sheet** | A quick look at one item while the list behind it stays in view | Full screen                                      | Slides in from the right |
| **Drawer**     | Quick inputs, a few actions, or short information               | Bottom drawer. Full height if it has text inputs | Becomes a dialog         |
| **Dialog**     | A confirmation or a short, focused input                        | Bottom drawer                                    | Centered dialog          |
| **Popover**    | A small menu or hint tied to one element. Never a form          | Bottom drawer                                    | Popover                  |
| **Inline**     | Optional detail or a simple edit, shown in place                | Inline                                           | Inline                   |

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
   those, and list the difference. One known
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

## 13. Reference screens

> **Proposed, not agreed yet.** Review these and send feedback.

When a screen does one of these jobs, copy the reference (section 7, step 1).

| Job                                 | Component     | Reference                                                                                                                                         |
| ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| An empty list or table              | `EmptyState`  | `packages/gp-webapp/app/dashboard/outreach/v2/OutreachHistoryTable.tsx`                                                                           |
| Payment inside a flow               |               | `packages/gp-webapp/app/dashboard/outreach/v2/sms/SmsReviewStep.tsx`, `packages/gp-webapp/app/dashboard/outreach/v2/robocall/RobocallPayStep.tsx` |
| A long job (AI, building a list)    |               | `packages/gp-webapp/app/dashboard/race-opponent/components/OpponentResearchProgress.tsx`                                                          |
| A record's status                   | `StatusText`  | `HistoryStatusText` in `packages/gp-webapp/app/dashboard/outreach/v2/channelMeta.tsx`                                                             |
| Confirming an action you can't undo | `AlertDialog` | `packages/gp-webapp/app/dashboard/shared/ConfirmDeleteDialog.tsx`                                                                                 |
| A field for writing a message       |               | The outreach compose card, `packages/gp-webapp/app/dashboard/outreach/v2/sms/SmsComposeStep.tsx`                                                  |
| A tab's page title                  | `navHeader`   | Voter Data, through `packages/gp-webapp/app/dashboard/shared/DashboardLayout.tsx`                                                                 |

## Not written yet

- 6. States and dead ends: empty, loading, error, offline
- 8. Layout and hierarchy
- 9. Tokens and color
- 10. Mobile: one breakpoint at 1024px (`useIsMobile`)
- 11. Motion and illustration
- 12. Patterns we've rejected
