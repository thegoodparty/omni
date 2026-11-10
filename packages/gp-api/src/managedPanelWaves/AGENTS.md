# src/managedPanelWaves/

The hourly managed civic panel wave job, `ManagedPanelWaveJobService`: draws,
sends, closes and finishes each building panel's waves. Timing (two-day
lead, 48-hour replies, waiting on a manual wave's upload):
`docs/adr/2026-11-10-managed-panel-waves-run-hourly-on-a-short-cycle.md`. What each step does:
`src/contacts/AGENTS.md`, "The wave job"; the decision:
`docs/adr/2026-10-22-managed-panel-wave-job-derives-each-step.md`.

- **The only caller of `claimFree`.** No controller, no chat tool, no
  test-fixtures run-job, and nothing that serves a request imports this
  module. `managedWaveFunding.imports.test.ts` lists these two files.
- **Never set `fundedBy` or move a send past `pending_payment` here.** The
  job makes the unpaid draft; `claimFree` alone makes it free.
- **Every step re-reads the rows.** No step trusts what an earlier run meant
  to do, so a pass that died partway is finished by the next one.
- **The ready email is read off the rows too.** `sendReadyEmails` runs after
  the steps and mails every `ready` panel with `readyEmailSentAt` null,
  claiming the stamp first and handing it back on a failed send.
- **Agent waves leave `replyWindowEndsAt` null** until `OutreachPanelRepliesService`
  sets it from the swarm's reply export (outreach `docs/text-delivery.md`). Under the
  `serve-panel-wave-agent` flag (`shadow`/`auto`; anything else is off) the
  job sets only `sentAt` and passes `agentHandoff` through `claimFree` and the
  `outreachTextSend` message, and fires Wave Sent only for manual waves. The step
  treats a null window as waiting until the hand-off row is
  `replies_submitted` (or, with no row, while the send is still
  `pending`/`in_progress`), then closes the wave. Detail: `src/contacts/docs/flows-managed-civic-panel.md`.
