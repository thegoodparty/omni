# app/dashboard/priorities/

The Serve Priorities tab: where an elected official holds what they want to get
done, and where they open one to work it forward. Gated by `serveAccess()`.

**The content is real; the plumbing is borrowed.** Read the table before
changing anything here.

| Piece                       | State                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The list, create, seed lane | Real. `GET/POST /v1/priorities`, `POST /v1/community-issues/:id/prioritize`                                                                                               |
| The flow's content          | Real. Every step sends its ask to the live agent with the user's own priority in it, so the questions, evidence, options, and plan are about that priority                 |
| The step interaction        | Real. Each step asks before it can settle, and the Continue row appears only once the agent says the step is settled. The ordinance flow does this with tools; here the agent ends each turn with a fenced block the client parses (`data/stepProtocol.ts`) |
| The flow's scope            | Borrowed. It runs on `chief_of_staff`, so flow conversations land in that history and the answers come back as prose, not the design's structured cards                    |
| Step state                  | `useState` in `PriorityFlowShell`, and the conversation is per visit. A reload starts over. Both land properly once gp-api owns a `priority_flow` scope and a flow record  |
| Rank                        | Display order of what the API returns. `Priority` has no `rank` column, so there is no reorder control yet; the first three rows carry the top-N marker                    |
| The public toggle           | Session state in the flow header. No `isPublic` column either, so it resets on reload                                                                                     |

## Files

| File                            | Role                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `page.tsx`                      | The list. Priorities are required; the issue feed is best-effort so a feed miss cannot blank the page |
| `[priorityId]/page.tsx`         | One priority. There is no `GET /v1/priorities/:id`, so it finds the record in the list |
| `components/PrioritiesHub.tsx`  | The list: lane chips, rows, and the community-issue seed lane below                     |
| `components/AddPriorityForm.tsx`| Inline create, opened by the header button                                             |
| `components/PriorityFlowShell.tsx` | The chat wrapper: conversation bootstrap, a hidden ask per step, transcript, composer |
| `components/PriorityQuestion.tsx` | A step question as option cards plus write-your-own, mirroring the ordinance clarify widget |
| `data/stepProtocol.ts`          | The ask/settle block the agent ends each turn with, and the parser that pulls it out of a turn |
| `data/stepPrompts.ts`           | What each step asks the agent for, with the priority in it. Each one is a miniature of its rule block in the design doc |
| `data/chat-api.ts`              | The flow's chat client, bound to `chief_of_staff` until the flow has its own scope      |
| `data/steps.ts`                 | Step order, stage grouping, labels, and CTAs. The only source of the spine until contracts owns the step union |

## Why the flow looks like this

`docs/serve-priority-flow-prompt.md` is the design: the step spine, the prompt
blocks, and the product decisions behind them. Two of those decide most of what
is on screen here.

- **Listening is asked once per stage, never once per turn, and it is not a
  gate.** The two listening steps ask who should be heard from and then offer
  the routes; "not yet" is a first-class answer. Holding a deferral across
  sessions needs state this flow does not have yet, so today the agent only
  offers the choice — see the design doc's build note.
- **The flow ends in a decision and a handoff, not an artifact.** The plan step
  points at Ordinances rather than drafting anything here.

## Chrome comes from Ordinances

This feature deliberately wears the ordinance flow's clothes rather than its own,
so the two Serve workflows feel like one product.

- **The list** mirrors `ordinances/page.tsx`: a header with the caption and a
  pill CTA on the right, a row of tally chips, then one bordered card of
  `divide-y` rows (title, sub-line, badge, chevron), with a secondary "seed"
  section below. The chips tally lanes (`PrioritySource`) where ordinances tally
  statuses, since a priority has no status yet.
- **The flow** mirrors `OrdinanceFlowChat`: a full-height column, the stepper and
  title scrolling away with the conversation, and the composer pinned at the
  bottom. It runs on the one chat kit (`useStreamingTurn` + `chatUI`) rather
  than a second stream loop, per `shared/agent-chat/AGENTS.md`. The advance
  affordance is the same full-width outline row, and its label comes from the
  DESTINATION step.
- The flow route passes no `navHeader`, like `ordinances/solve/[slug]/[step]`:
  the shell owns the viewport and carries its own title.

## Conventions this directory follows

- Step titles are questions the user can answer, captions are one sentence
  (`docs/product-copy.md`). `PRIORITY_STEP_LABELS` holds the questions, spoken by
  the agent in its opening bubble rather than printed as a page heading;
  `PRIORITY_STEP_SHORT_LABELS` holds the stepper names, which are shorter for
  space, not friendlier.
- A step change scrolls to top (`PriorityFlowShell`), per the gp-webapp rule for
  multi-step flows. The scroller is the shell's own element, not the window.
- The nav entry, mobile title, and serve-route prefix all have to be added
  together: `shared/DashboardMenu.tsx`, `MOBILE_PAGE_TITLES` in
  `shared/DashboardLayout.tsx`, `shared/serveRoutes.ts`.

## Gotchas

- **Step asks are sent hidden and filtered by content.** `hiddenSent` collects
  each prompt and the transcript drops any message whose content matches, the
  same trick the Chief of Staff body uses. Change how a prompt is built and the
  filter still works, because both read the same builder.
- **The bootstrap effects take no dependencies on purpose.** `askStep`'s identity
  changes every turn; with it in the create effect's deps, each turn opened a
  new conversation. The create runs once and a separate effect fires the first
  ask when the id lands, so a kickoff aborted by React's dev double-mount fires
  again on the mount that survives. You will still see one extra empty
  conversation per visit in dev from that double-mount.
- **Turns are slow and cost money.** A step's ask is a full agent turn with
  research behind it, 10 to 40 seconds, against whatever API the webapp points
  at. Do not add an ask that fires on render.
