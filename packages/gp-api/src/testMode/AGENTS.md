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
| `POST /v1/test-mode/organizations`         | Create a test campaign (on a real race) or test elected office in a preset bundle               |
| `POST /v1/test-mode/apply`                 | Apply one family preset to the active (`X-Organization-Slug`) test org                          |
| `DELETE /v1/test-mode/organizations/:slug` | Delete a test org (cascade), refusing on a real subscription, live domain or in-flight outreach |

`TestModeGuard` authorizes on the **session** user (`req.user`): internal email,
not impersonating, not an M2M or agent token, and the `staff-test-mode`
Amplitude flag on. Every write 409s unless the target org carries
`Organization.testModeCreatedAt`.

## Gotchas

- Org creation reuses `StateTransitionsService` (`src/testFixtures/`), the
  same recipes the dev fixtures use: `createForUser` inside an outer
  transaction so HubSpot never sees the org, `launch` with tracking off.
- Elected-office test orgs are inserted directly, never through
  `ElectedOfficeService.create`, which dispatches real agent runs and 409s on
  term overlap with the owner's real office.
- `pro` writes `isPro` directly; `setIsPro` would announce the upgrade in
  Slack.
- Presets that drop JSON keys (`wonGeneral`, the onboarding markers) go
  through `rewriteCampaignJson`, which holds the campaign row lock the way
  `updateJsonFields` does. `updateJsonFields` cannot delete keys.
- `tenDlc` presets write synthetic `TcrCompliance` rows stamped with
  `internalTestingAt`; every Peerly caller, compliance cron and the P2P send
  gate skip those rows (`src/campaigns/tcrCompliance/`). A test org that
  holds a real registration (no marker) is refused rather than overwritten.
- Deleting a test campaign org first nulls `ElectedOffice.campaignId` on any
  office pointing at it: that FK is `onDelete: NoAction`.
- There is no undo. The presets are the reset.
