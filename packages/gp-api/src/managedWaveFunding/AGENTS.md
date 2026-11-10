# src/managedWaveFunding/

The one code path that makes a send free: `ManagedWaveFundingService.claimFree`
claims a managed civic panel wave's send with `fundedBy: goodparty_pilot`,
and `claimConfirmationFree` a ready panel's one confirmation text with
`fundedBy: goodparty_panel_confirmation`, both with no checkout. What it
checks and why: `src/contacts/AGENTS.md`, "Managed civic panel"; the decision: `docs/adr/2026-11-10-managed-panel-confirmation-is-a-second-free-send.md`.

- **Never reachable from a request.** No route, no chat tool, no service a
  controller calls. `managedWaveFunding.imports.test.ts` holds the list of
  files allowed to import the service or its module; the wave job
  (`src/managedPanelWaves/`) is the one caller.
- **Never set `fundedBy` anywhere else.** The delivery layer refuses a free
  send that lacks a live wave or panel, and the daily reconciliation pages on
  one.
- **Tests here create waves and sends directly**, to reach each refusal; the
  wave job's tests make them the way the job does.
