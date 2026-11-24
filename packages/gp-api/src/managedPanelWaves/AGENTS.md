# src/managedPanelWaves/

The hourly managed civic panel wave job, `ManagedPanelWaveJobService`: draws,
sends, closes and finishes each building panel's waves. The `managedPanelWaves`
schedule (`src/jobs/jobs.registry.ts`, `fanOutWaves`) sends one
`managedPanelWaveAdvance` job per panel not stopped (`advanceWave`: the wave
step, the confirmation text, the milestones), grouped by panel; a panel whose
job throws retries and dead-letters on its own. Timing (two-day
lead, the official's chosen first send date, 48-hour replies, waiting on a
manual wave's upload, the stall alert and the five-day backstop):
`docs/adr/2026-11-17-managed-panel-first-wave-on-the-chosen-day.md`. What each step does:
`src/contacts/AGENTS.md`, "The wave job"; the decision:
`docs/adr/2026-10-22-managed-panel-wave-job-derives-each-step.md`.

- **The only caller of `claimFree`.** No controller, no chat tool, no
  test-fixtures run-job, and nothing that serves a request imports this
  module. `managedWaveFunding.imports.test.ts` lists these two files. The
  same goes for the `managedPanelWaveAdvance` job: only `fanOutWaves` sends
  it, and nothing a request reaches may.
- **Never set `fundedBy` or move a send past `pending_payment` here.** The
  job makes the unpaid draft; `claimFree` alone makes it free.
- **Every step re-reads the rows.** No step trusts what an earlier run meant
  to do, so a pass that died partway is finished by the next one.
- **Milestones are read off the rows too.** Each panel's job, after its
  step and its confirmation text, records each step of contracts
  `CIVIC_PANEL_MILESTONES` the members have reached and has no
  `ManagedPanelMilestone` row for, firing Civic Panel Milestone Reached once
  per row. The unique `(enrollmentId, milestone)` is what keeps it to once.
- **Agent waves leave `replyWindowEndsAt` null** until `OutreachPanelRepliesService`
  sets it (`openAgentReplyWindow`) from the swarm's reply export or a staff results upload (outreach `docs/text-delivery.md`). Under the
  `serve-panel-wave-agent` flag (`shadow`/`auto` for the swarm agent,
  `api_shadow`/`api_auto` for the Scale to Win API handler; anything else is
  off) the
  job sets only `sentAt` and passes `agentHandoff` through `claimFree` and the
  `outreachTextSend` job, and fires Wave Sent only for manual waves. The step
  treats a null window as waiting until the hand-off row is
  `replies_submitted` (or, with no row, while the send is still
  `pending`/`in_progress`), then closes the wave. Detail: `src/contacts/docs/flows-managed-civic-panel.md`.
- **The api variants are gated.** They stay manual unless
  `S2W_PANEL_WAVE_API_ENABLED=true`, because nothing advances an `api` row
  until the Scale to Win sweep ships; the sweep's PR removes the gate. The
  handler and mode are frozen on the hand-off row, `api_auto` acts as shadow
  outside prod, and an org owned by a `@goodparty.org` address stays manual:
  `docs/adr/2026-11-23-api-panel-waves-progress-on-the-text-handoff.md`.
