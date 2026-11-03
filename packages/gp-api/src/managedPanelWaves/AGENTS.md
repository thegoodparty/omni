# src/managedPanelWaves/

The daily managed civic panel wave job, `ManagedPanelWaveJobService`: draws,
sends, closes and finishes each building panel's waves. What each step does:
`src/contacts/AGENTS.md`, "The wave job"; the decision:
`docs/adr/2026-10-22-managed-panel-wave-job-derives-each-step.md`.

- **The only caller of `claimFree`.** No controller, no chat tool, no
  test-fixtures run-job, and nothing that serves a request imports this
  module. `managedWaveFunding.imports.test.ts` lists these two files. The one
  request-side reach is the results upload calling `runPanel` through
  `ModuleRef` (not a module import), so a committed upload steps its panel;
  the daily lock stays on `runDaily` only.
- **Never set `fundedBy` or move a send past `pending_payment` here.** The
  job makes the unpaid draft; `claimFree` alone makes it free.
- **Every step re-reads the rows.** No step trusts what an earlier run meant
  to do, so a pass that died partway is finished by the next one.
- **The ready email is read off the rows too.** `sendReadyEmails` runs after
  the steps and mails every `ready` panel with `readyEmailSentAt` null,
  claiming the stamp first and handing it back on a failed send.
