# src/managedWaveFunding/

The one code path that makes a send free: `ManagedWaveFundingService.claimFree`
claims a managed civic panel wave's send with `fundedBy: goodparty_pilot`
and no checkout. What it checks and why: `src/contacts/AGENTS.md`, "Managed
civic panel"; the decision: `docs/adr/2026-10-22-managed-panel-free-sends-and-guards.md`.

- **Never reachable from a request.** No route, no chat tool, no service a
  controller calls. `managedWaveFunding.imports.test.ts` holds the list of
  files allowed to import the service or its module; the wave job is the only
  caller that may be added.
- **Never set `fundedBy` anywhere else.** The delivery layer refuses a free
  send that lacks a live wave, and the daily reconciliation pages on one.
- **Tests create waves and sends directly**, since nothing in the app makes
  them yet.
