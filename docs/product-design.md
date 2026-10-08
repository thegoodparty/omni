# Product design

> **Draft, under review.** This file is not linked from `CLAUDE.md` or any
> `AGENTS.md` yet, so agents only read it when asked. To try it, tell Claude
> Code: "Read `docs/product-design.md` and follow it" when building UI, or
> "Review these files against `docs/product-design.md`" to check existing
> work. Sections 1 to 4 are agreed. Section 5 is proposed. The rest is not
> written yet. Send feedback to Justin.

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
dialogs of its own, it has become a place. Make it a page.

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

- **At most one layer on top,** and only for a confirmation or a quick pick,
  never a second form. Otherwise, replace the drawer's content or close it
  first.
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
- The styleguide's `Sheet` (`packages/styleguide/src/components/ui/sheet.tsx`)
  defaults to 75% width on mobile, not full screen.

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

## Not written yet

- 6. States and dead ends: empty, loading, error, offline
- 7. Components by job
- 8. Layout and hierarchy
- 9. Tokens and color
- 10. Mobile: one breakpoint at 1024px (`useIsMobile`)
- 11. Motion and illustration
- 12. Patterns we've rejected
- 13. Reference screens
