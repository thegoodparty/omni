# app/dashboard/door-knocking/

Door-knocking / canvassing dashboard. Tracks volunteer interactions logged in the field, summarizes by day / rating / survey, and lets campaigns design custom door-knocking surveys.

## Key files

| File                                                                | Role                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| `page.tsx`                                                          | Route entry                                             |
| `components/DoorKnockingPage.tsx`                                   | Top-level layout                                        |
| `shared/DoorKnockingTabs.tsx`                                       | Tab navigation (overview / surveys / individual record) |
| `components/InteractionsByDay.tsx`                                  | Time-series chart                                       |
| `components/InteractionsSummary.tsx` + `InteractionsSummaryPie.tsx` | Aggregate counts + breakdown chart                      |
| `components/RatingSummary.tsx`                                      | Voter sentiment distribution                            |
| `components/interactionsColors.ts`                                  | Color tokens for charts (single source)                 |
| `surveys/`                                                          | Custom survey designer (per-campaign question sets)     |
| `print/[turfId]/page.tsx` + `print/WalkSheet.tsx`                   | Printable walk list (the v1 offline story)              |
| `shared/`                                                           | Cross-tab primitives                                    |
| `components/`                                                       | Page-level widgets                                      |

## Patterns

- **Charts use shared color tokens** from `components/interactionsColors.ts` — keep palette centralized; don't inline hex values.
- **Surveys are campaign-scoped**: each campaign authors its own survey questions, used by canvassers in the field. Survey CRUD lives in `surveys/`.
- **Aggregations come from gp-api**, not computed client-side. The components display rather than compute.

## Gotchas

- The legacy tabs on this page only _display_ data sourced from third-party canvassing tools (eCanvasser etc.) via gp-api. Knocks are logged in-app from `native/` (`RecordKnockForm` → `POST /v1/door-knocking/interactions`), which writes to the CRM's own tables and never to eCanvasser.
- **Analytics live under `EVENTS.DoorKnocking`** (`Door Knocking - *`), not the legacy `EVENTS.Dashboard.VoterContact.DoorKnocking` group, which belongs to the script/eCanvasser surface. A completed walk also fires the canonical `Voter Outreach - Campaign Completed` with `medium: 'doorKnocking', method: 'native'` — that's what the door-knocking activation metric counts, so don't remove it while refactoring the walk exit.
- `components/interactionsColors.ts` is the only place colors should be defined for charts in this feature.
- **The voter pack and every turf read resolve a district server-side** (`resolveEligibleDistrictId` in gp-api's `doorKnockingPack` / `doorKnockingKnock` services), so an org with no resolvable district can only 400. `NativeDoorKnockingPage` gates both queries on `useDistrictResolution` (`app/dashboard/shared/`) and explains instead. Gating at the shell also covers the write paths (`POST turfs`, `POST turfs/:id/knock`, `POST interactions`) because their affordances never render. The unavailable branch has to come **before** `packQuery.isPending`, or that branch claims to be loading forever.
- **Offline means paper.** `print/` is a server component with no `'use client'` anywhere in it, deliberately: it has to render and print on a phone with one bar, and it sits outside `DashboardLayout` so no nav chrome hits the page. Its tick-boxes are generated from `native/knockQuestions.ts`, the same constants `RecordKnockForm` renders — the paper is transcribed back into that form, so the two must not drift. Nothing written on the sheet reaches gp-api until someone re-keys it.
- `doorKnockingServe.service.ts` in gp-api is about **serving a route** to a canvasser — it is not the Serve product. Door knocking is Win-only (`v2Category: 'campaign'` in `DashboardMenu.tsx`).

## Related

- `app/shared/hooks/EcanvasserProvider.tsx` + `EcanvasserSurveyProvider.tsx` — eCanvasser auth/data.
- `helpers/` — eCanvasser-related helpers if any are added (currently none specific).
