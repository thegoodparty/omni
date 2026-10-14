# testMode/

Staff-only "Test mode" sidebar item and sheet. Creates test organizations
owned by the signed-in staff member, rewrites the active one into other
product states (one family at a time), and deletes them. The API side, its
guard and every exclusion live in `gp-api/src/testMode/AGENTS.md`; read that
before changing what a preset does.

## Files

| File                   | Role                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `TestModeMenuItem.tsx` | Sidebar button, rendered in the `DashboardMenu` footer (desktop only)                    |
| `TestModeSheet.tsx`    | Create form (campaign or elected office, both on a real race), org list, family presets  |
| `useTestMode.ts`       | React Query hooks over `GET/POST/DELETE /v1/test-mode*` and the post-mutation navigation |

## Gates

- The item renders only when `staff-test-mode` is on **and** the email ends
  in `@goodparty.org`. `@test.goodparty.org` accounts do not see it, though
  gp-api's `TestModeGuard` would let them through (`isInternalUser` covers
  both domains). The UI gate is the narrower one on purpose.
- gp-api evaluates the flag itself. The e2e override cookie only flips the
  webapp side, so a spec also needs the API to serve the flag to its user.

## Gotchas

- Keep the item in its own component, never as an `id:` entry in
  `DashboardMenu.tsx`. CI scrapes those ids into the assistants' product map,
  and Test mode is not a product feature.
- Every mutation runs a full `invalidateQueries()`. A create or delete changes
  the org list and eligibility, which `setSelectedSlug` alone does not
  refresh.
- Create reads the new slug from `data.active.slug`: the response is the
  whole `TestModeState`, not the created org.
- Create navigates to `/post-auth-redirect` (or `/serve/onboarding` for a
  not-onboarded elected office) so routing decides the landing page from the
  new org's state. Apply clears the election-result dismissal so a
  `passed_*` preset shows the result screen again.
- `data-testid`s on the org row (`test-mode-org-<slug>`) and family row
  (`test-mode-family-<family>`) are the e2e contract
  (`e2e-tests/tests/app/dashboard/test-mode/`).
