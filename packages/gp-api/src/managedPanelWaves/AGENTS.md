# src/managedPanelWaves/

The daily managed civic panel wave job, `ManagedPanelWaveJobService`: draws,
sends, closes and finishes each building panel's waves. What each step does:
`src/contacts/AGENTS.md`, "The wave job"; the decision:
`docs/adr/2026-10-22-managed-panel-wave-job-derives-each-step.md`.

- **The only caller of `claimFree`.** No controller, no chat tool, no
  test-fixtures run-job, and nothing that serves a request imports this
  module. `managedWaveFunding.imports.test.ts` lists these two files.
- **Never set `fundedBy` or move a send past `pending_payment` here.** The
  job makes the unpaid draft; `claimFree` alone makes it free.
- **Every step re-reads the rows.** No step trusts what an earlier run meant
  to do, so a pass that died partway is finished by the next one.
