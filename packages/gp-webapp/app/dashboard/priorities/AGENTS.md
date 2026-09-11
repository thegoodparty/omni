# app/dashboard/priorities/

The Serve Priorities tab: where an elected official holds what they want to get
done, and where they open one to work it forward. Gated by `serveAccess()`.

**Half of this is real and half is scripted.** Read the table before changing
anything here.

| Piece                       | State                                                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The list, create, seed lane | Real. `GET/POST /v1/priorities`, `POST /v1/community-issues/:id/prioritize`                                                                                                  |
| Rank                        | Display order of what the API returns. `Priority` has no `rank` column, so there is no reorder control yet; the first three rows carry the top-N marker                      |
| The public toggle           | Session state in the flow header. No `isPublic` column either, so it resets on reload                                                                                        |
| The guided flow             | Scripted. No backend, no persistence, no agent. `StepPanel` and `ListeningStep` are stand-ins shaped like the cards the agent will fill                                      |
| The composer                | Disabled, with a placeholder saying so. It is there because the shell is chat-shaped and an empty bottom bar reads as broken                                                  |
| Step state                  | `useState` in `PriorityFlowShell`. Becomes a route segment once gp-api owns the record, the way `ordinances/solve/[slug]/[step]` does                                        |

## Files

| File                            | Role                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `page.tsx`                      | The list. Priorities are required; the issue feed is best-effort so a feed miss cannot blank the page |
| `[priorityId]/page.tsx`         | One priority. There is no `GET /v1/priorities/:id`, so it finds the record in the list |
| `components/PrioritiesHub.tsx`  | The list: lane chips, rows, and the community-issue seed lane below                     |
| `components/AddPriorityForm.tsx`| Inline create, opened by the header button                                             |
| `components/PriorityFlowShell.tsx` | The chat shell: scroll region, stepper, title, visibility toggle, pinned composer   |
| `components/StepPanel.tsx`      | Scripted output per step, rendered as assistant turns                                  |
| `components/ListeningStep.tsx`  | The listening step, with all four answers: run it, already heard, not yet, move on     |
| `data/steps.ts`                 | Step order, stage grouping, labels, and CTAs. The only source of the spine until contracts owns the step union |

## Why the flow looks like this

`docs/serve-priority-flow-prompt.md` is the design: the step spine, the prompt
blocks, and the product decisions behind them. Two of those decide most of what
is on screen here.

- **Listening is asked once per stage, never once per turn, and it is not a
  gate.** "Not yet" is a first-class answer that gets held and brought back at
  the method and plan steps. A flat no gets one honest line and then gets out of
  the way. `ListeningStep` models all four outcomes on purpose.
- **The flow ends in a decision and a handoff, not an artifact.** The plan step
  hands off to Ordinances rather than drafting anything here.

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
  bottom. Turns are built from `shared/agent-chat/chatUI` (`AssistantRow`,
  `ASSISTANT_BUBBLE`, `UserBubble`, `ChatComposer`) so a scripted turn is
  structurally identical to a streamed one. The advance affordance is the same
  full-width outline row, and its label comes from the DESTINATION step.
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
