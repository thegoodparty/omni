# Test Mode Module

Staff-only API behind the gp-webapp "Test mode" panel: creates test
organizations owned by the signed-in staff member in a named product state,
rewrites them into other states, and deletes them. It never touches a real
organization. TDD: ClickUp doc `2ky4jq2q-145653` (Implementation Notes
`2ky4jq2q-145673`).

## Endpoints (all `TestModeGuard`, all live in prod behind the flag)

| Route                                      | Purpose                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `GET /v1/test-mode`                        | The user's test orgs, plus the current preset per family for the active org                     |
| `POST /v1/test-mode/organizations`         | Create a test campaign or test elected office on a real race, in a preset bundle                |
| `POST /v1/test-mode/apply`                 | Apply one family preset to the active (`X-Organization-Slug`) test org                          |
| `DELETE /v1/test-mode/organizations/:slug` | Delete a test org (cascade), refusing on a real subscription, live domain or in-flight outreach |

`TestModeGuard` authorizes on the **session** user (`req.user`): internal email,
not impersonating, not an M2M or agent token, and the `staff-test-mode`
Amplitude flag on. Every write 409s unless the target org carries
`Organization.testModeCreatedAt`.

The UI is `gp-webapp/app/dashboard/shared/testMode/` (its own `AGENTS.md`).
Coverage: `tests/testMode.routes.test.ts` (routes on real Postgres),
`guards/TestMode.guard.test.ts`, and the Playwright spec
`gp-webapp/e2e-tests/tests/app/dashboard/test-mode/test-mode.spec.ts`.

## Gotchas

- Org creation reuses `StateTransitionsService` (`src/testFixtures/`), the
  same recipes the dev fixtures use: `createForUser` inside an outer
  transaction so HubSpot never sees the org, `launch` with tracking off.
- The picked race supplies only the position. It resolves whatever the date
  (next upcoming race, else the most recent past one), so an office whose
  election has passed can still be picked. The election date always comes
  from the `election` preset, written before launch, and the preset math lives
  in `StateTransitionsService.electionPresetDate` / `applyElectionPreset`,
  shared with the e2e fixture route. Only `passed_won`'s office link stays
  here.
- Elected-office test orgs are inserted directly, never through
  `ElectedOfficeService.create`, which dispatches real agent runs and 409s on
  term overlap with the owner's real office. They still bind the picked
  race's real position (`positionId`, resolved the way Serve onboarding
  does), because outreach and list building read the district from it.
- `pro` writes `isPro` directly; `setIsPro` would announce the upgrade in
  Slack.
- Presets that drop JSON keys (`wonGeneral`, the onboarding markers) go
  through `StateTransitionsService.rewriteCampaignJson`, which holds the
  campaign row lock the way `updateJsonFields` does. `updateJsonFields`
  cannot delete keys.
- `tenDlc` presets write synthetic `TcrCompliance` rows stamped with
  `internalTestingAt`; every Peerly caller, compliance cron and the P2P send
  gate skip those rows (`src/campaigns/tcrCompliance/`). A test org that
  holds a real registration (no marker) is refused rather than overwritten.
- Deleting a test campaign org first nulls `ElectedOffice.campaignId` on any
  office pointing at it: that FK is `onDelete: NoAction`.
- `civicPanel` (elected office only, `services/testModeCivicPanel.service.ts`)
  walks one managed civic panel through its milestones (`building` to
  `full`) and then one shared priority through its answers (`asked`,
  `answers_coming`, `answers_in`). Members, replies, coded answers and
  themes are rows on the test org for made-up people (uuid v5 of the slug
  and an index, never voter file ids), worded by
  `fixtures/civicPanel.fixture.ts`. A preset rewrites only the members it
  wrote (their join events carry `sourceId` `test-mode-fixture:<personId>`),
  keeps a panel the official approved and its goal, and keeps the priority
  so its page stays open while answers change. The wave fan-out, the answer
  coding sweep and the priority read skip test orgs, so nothing is texted,
  coded by a model or read from the warehouse; with no read, the answer
  count alone decides the results page
  (`docs/adr/2026-11-26-test-mode-civic-panel-writes-made-up-rows.md`).
- There is no undo. The presets are the reset.
