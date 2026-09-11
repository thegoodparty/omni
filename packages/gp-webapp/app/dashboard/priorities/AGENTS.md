# app/dashboard/priorities/

The Serve Priorities tab: where an elected official holds what they want to get
done, and where they open one to work it forward. Gated by `serveAccess()`.

**Half of this is real and half is scripted.** Read the table before changing
anything here.

| Piece                        | State                                                                     |
| ---------------------------- | ------------------------------------------------------------------------- |
| The list, create, seed lane  | Real. `GET/POST /v1/priorities`, `POST /v1/community-issues/:id/prioritize` |
| Rank and the public toggle   | Session state in `PrioritiesHub`. `Priority` has no `rank` or `isPublic` column, so both reset on reload, and the page says so |
| The guided flow              | Scripted. No backend, no persistence, no agent. `StepPanel` and `ListeningStep` are stand-ins shaped like the cards the agent will fill |
| Step state                   | `useState` in `PriorityFlowShell`. Becomes a route param once gp-api owns the record, the way `ordinances/solve/[slug]/[step]` does |

## Files

| File                            | Role                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `page.tsx`                      | The list. Priorities are required; the issue feed is best-effort so a feed miss cannot blank the page |
| `[priorityId]/page.tsx`         | One priority. There is no `GET /v1/priorities/:id`, so it finds the record in the list |
| `components/PrioritiesHub.tsx`  | Ranked list, visibility toggle, and the community-issue seed lane                      |
| `components/AddPriorityForm.tsx`| Inline create                                                                          |
| `components/PriorityFlowShell.tsx` | Step rail, stepper, and the step panel. Owns the current step                       |
| `components/StepPanel.tsx`      | Scripted output per step                                                               |
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

## Conventions this directory follows

- Step titles are questions the user can answer, captions are one sentence
  (`docs/product-copy.md`). `PRIORITY_STEP_LABELS` holds the questions and
  `PRIORITY_STEP_SHORT_LABELS` the rail names, which are shorter for space, not
  friendlier.
- A step change scrolls to top (`PriorityFlowShell`), per the gp-webapp rule for
  multi-step flows.
- The nav entry, mobile title, and serve-route prefix all have to be added
  together: `shared/DashboardMenu.tsx`, `MOBILE_PAGE_TITLES` in
  `shared/DashboardLayout.tsx`, `shared/serveRoutes.ts`.
