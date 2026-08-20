Clear a candidate's rejected 10DLC / CampaignVerify compliance record so the
`compliance_setup` agent can resubmit, after the data that caused the rejection has
been corrected.

A candidate's `compliance_setup` agent keeps failing and their `tcr_compliance` row is
`rejected`. The rejection was caused by data we control (wrong `filing_url`, committee
name mismatch) and the data has since been corrected — but re-dispatching the agent
does nothing except cost money. This is how to actually clear it.

## Prerequisites

**Tools**: read/write access to the gp-api production Postgres (VPN + `gp-admin` AWS
profile for the DB secret), gp-admin access with the `write_agent_runs` permission (or
an `mt_*` Clerk M2M token for the target environment).

**Written 2026-08 after campaign 325819 (William Bayer).** CampaignVerify rejected the
submission because we sent a `goodparty.org/candidate/...` filing URL. We corrected
`tcr_compliance.filing_url` and hit Retry in gp-admin. The run re-dispatched, burned
$0.43, completed only `compliance_state_read`, and failed — identically to the run
before it, with nothing in the UI saying why. The missing step was a database write
nobody had written down.

## Why a data fix alone does nothing

Three layers disagree about whether `rejected` is recoverable:

| Layer                                                | Treats `rejected` as       | Evidence                                                                        |
| ---------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| gp-api `createAgentic`                               | retryable                  | `error`/`rejected` → delete + recreate the row                                  |
| Admin retry `POST /v1/admin/agent-runs/:runId/retry` | retryable, until it wasn't | queued a real billable run that could never succeed; now 409s at `tcr_rejected` |
| The `compliance_setup` agent                         | terminal                   | `experiments/compliance_setup/instruction.md` Step 1, `tcr_rejected`            |

The agent is following its instructions correctly, and the instruction is right in
the general case: resubmitting an uncorrected record just re-fails and spams the
vendor. What was missing is the operator path once the data _has_ been corrected.

The mechanism, in gp-api:

1. `deriveComplianceStage` (`campaigns/tcrCompliance/services/complianceState.service.ts`)
   maps **both** `rejected` and `error` to stage `tcr_rejected`, and it does so
   _before_ any domain/website check. Nothing about a corrected `filing_url` changes
   the derived stage.
2. `submitToPeerlyForAgent` refuses with 422 unless the derived stage is
   `awaiting_pin`.
3. The agent reads the stage first (Step 1) and, on `tcr_rejected`, skips Steps 2-6
   and writes `stage: "failed"`.

So the record has to leave `rejected` for anything to move. The status is the lock,
not the filing URL.

## Step 0 — classify the rejection: is it ours to fix?

Two different failures both land on `status = 'rejected'`, and only one of them is
recoverable on our side. **`peerly_identity_id` is the discriminator.**

```sql
SELECT id, campaign_id, status, filing_url, peerly_identity_id,
       peerly_cv_verification_id, peerly_cv_status, internal_testing_approved_at,
       kickoff_sent_at, agentic_run_id, updated_at
FROM tcr_compliance
WHERE campaign_id = <campaign_id>;
```

**`peerly_identity_id IS NULL` → recoverable here.** CampaignVerify rejected the
submission synchronously; `submitToPeerlyForAgent`'s rollback stamped `rejected` and
never persisted the identity (`rejection_source: cv_submit`). No CV request exists at
Peerly, so a clean resubmit is possible. Continue to Step 1.

**`peerly_identity_id IS NOT NULL` → stop; this is a Peerly-side problem.** The CV was
accepted at submit and later flipped `REJECTED`/`WITHDRAWN`, and
the CV status scan's `applyCvDetection` stamped the record
(`rejection_source: cv_status_check`).
A status reset here is a **no-op**: `submitToPeerlyForAgent` short-circuits on a
non-null `peerly_identity_id` and returns the persisted response without calling
Peerly at all. Nulling the identity column doesn't rescue it either — the resubmit
finds the same identity by `identity_name`, then `getCampaignVerifyRequest` returns
the existing rejected CV with a `verification_status`, so the helper **skips** CV
submission entirely and the corrected filing URL never reaches CampaignVerify. The CV
request has to be withdrawn/recreated on Peerly's side: escalate in the shared Slack
Connect channel (`SlackChannel.sharedGoodpartyPeerly10Dlc`), same channel the nightly
report's vendor escalations use.

As of 2026-08 all three currently-`rejected` prod rows are the second kind. Do not
assume the incident's shape is the common one.

Also bail out if `internal_testing_approved_at` is set — that's a staff marker row,
not a real registration, and it never reaches `rejected` legitimately.

### Finding the rejection reason

There is **no rejection-reason column**, and `ComplianceStateOutput` carries no
`rejection_reason` field. Read it from one of:

- the `ComplianceRejected` Segment event (`rejection_reason`, `rejection_source`) —
  the authoritative record of _why_;
- the `bot-10dlc-compliance` Slack alert fired at submit time;
- the FAILED run's artifact blocker `detail` in gp-admin.

Data-fixable reasons look like: `"FEC filing URLs are not allowed."`, a filing URL
pointing at `goodparty.org` or the candidate's own campaign site, a committee-name or
candidate-name mismatch against the state filing. Genuinely terminal reasons look
like: the candidate isn't in the state's filing record at all, or CampaignVerify
disputes the candidate's identity. When in doubt, ask in
`bot-10dlc-compliance` before spending a run.

## Step 1 — correct the underlying data first

Never reset the status before the data is right — you'll just re-fail and burn a
second run. Fix `filing_url` (and `committee_name` / `fec_committee_id` if those were
the mismatch) on `tcr_compliance`.

`filing_url` must be an **official election-authority filing page**. gp-api re-applies
its guards to the persisted value at submit time (`submitToPeerlyFilingSchema`), so a
bad value 400s rather than reaching Peerly: no `goodparty.org` host, no URL with
credentials, no `fec.gov` URL for a non-federal office (federal _requires_ one), and
not the candidate's own registered domain.

## Step 2 — clear the rejection

`rejected` and `error` both derive `tcr_rejected`, but they do **not** take the same
fix. Run the block that matches the record's `status`.

```sql
-- status = 'rejected' — CampaignVerify rejected at submit time.
UPDATE tcr_compliance
SET status = 'submitted'
WHERE campaign_id = <campaign_id>
  AND status = 'rejected'
  AND peerly_identity_id IS NULL;
```

```sql
-- status = 'error' — the kickoff handler rejected the record before Peerly.
-- `kickoff_sent_at` must also be cleared: sweepStrandedAgenticKickoffs only
-- re-dispatches records with status = 'submitted' AND kickoff_sent_at IS NULL,
-- so a status reset alone leaves the record stranded with no dispatcher.
UPDATE tcr_compliance
SET status = 'submitted',
    kickoff_sent_at = NULL
WHERE campaign_id = <campaign_id>
  AND status = 'error'
  AND peerly_identity_id IS NULL;
```

Preconditions, all enforced in the `WHERE` clauses above so a wrong-shaped record is a
0-row update rather than a bad write:

- currently `rejected` or `error`, matching the block you ran;
- `peerly_identity_id IS NULL`, per Step 0;
- the data from Step 1 is already corrected and committed.

A 0-row update means the record is not the shape you assumed — re-check Step 0 rather
than loosening the `WHERE`.

`submitted` is the right target, not `pending`/`approved`: those derive
`tcr_in_review`/`tcr_approved` and would make the agent skip submission entirely.
`submitted` + registered domain + published live site derives `awaiting_pin`, which is
exactly the precondition `submit-to-peerly` enforces.

Side effects of returning to `submitted`, all intended: the record re-enters
the twice-daily CV status scan (so the PIN gets detected and `CompliancePinSent`
fires), and it becomes eligible again for the nightly 10DLC report's stuck sections.

## Step 3 — verify the derived stage before spending a run

```
GET /v1/campaigns/tcr-compliance/admin/<campaignId>/compliance-state
```

`AdminOrM2MGuard` — reachable from gp-admin's user page 10DLC widget, or directly
with an `mt_*` M2M token. Expect:

- `stage: "awaiting_pin"` — the reset worked; proceed.
- `stage: "tcr_rejected"` — the update didn't land (0 rows, or you're on the wrong
  environment). Re-check Step 2.
- `stage: "pending_domain_purchase"` / `"pending_website_live"` — the rejection was
  masking a separate problem: the domain or the live site. The agent will now do that
  work itself on re-dispatch, which is fine, just expect a longer, pricier run.

This read also fires a live Peerly `retrieve_cv` **once the stage is `awaiting_pin`**
(and only then), so `peerlyCvStatus` in the response is the real current CV state.
That is the cheapest confirmation available that the reset was legitimate: if it comes
back `REJECTED`, the rejection is still live at Peerly and you are in the Step 0
second case after all — revert the status and escalate instead of re-dispatching.

Note that at stage `tcr_rejected` the same field always reads `null` — the nightly
poll only covers `submitted`/`pending` and `resolvePeerlyCvState` only queries Peerly
at `awaiting_pin`. A null there is not evidence of anything.

## Step 4 — re-dispatch the agent

Easiest path: the **Retry** button on the run detail page in gp-admin
(`/dashboard/agent-runs/<runId>`), on the most recent FAILED run for that campaign.
Requires the `write_agent_runs` permission.

Directly:

```
POST /v1/admin/agent-runs/<runId>/retry
```

`M2MOnly` — needs an `mt_*` Clerk M2M token for the target environment. **The route
takes no body, but sending `Content-Type: application/json` with an empty body is
rejected — send `{}`.** Retry re-dispatches the stored params with `trigger` forced to
`recovery_resume` (so the agent consults durable gp-api state and skips completed
steps) and returns the new run.

It refuses (409) if the run is `QUEUED`, `RUNNING`, `AWAITING_RESUME`, or
`SUPERSEDED`. To recover a dead resume chain, retry the latest **FAILED** run, not the
`SUPERSEDED` predecessor.

It also refuses (409, "unresolved CampaignVerify rejection") while the campaign's
derived stage is still `tcr_rejected` — i.e. if you get here without having done Step
2, or Step 2 didn't land. That is the safety net, not the check: run Step 3 first
anyway, because a stage of `pending_domain_purchase` or `pending_website_live` passes
this guard and still means the run will do more (and cost more) than you expected.

## Step 5 — confirm the resubmit actually reached Peerly

A successful run leaves `stage: "tcr_submitted"` on the artifact. On the record:

```sql
SELECT status, peerly_identity_id, peerly_cv_verification_id, peerly_cv_status,
       pin_delivery_method, updated_at
FROM tcr_compliance WHERE campaign_id = <campaign_id>;
```

`peerly_identity_id` and a **new** `peerly_cv_verification_id` should now be
populated. The identity is expected to be one Peerly already had: the submit helper
looks up identities by `identity_name` and reuses a match, so the orphan minted during
the failed submission is adopted rather than duplicated. A second identity appearing
for the same committee means the identity name changed between attempts — flag it,
Peerly has to clean those up by hand.

Then the normal flow resumes: Peerly issues the PIN, the CV status scan
records the channel and fires `CompliancePinSent`, and the candidate enters the PIN in
the app.

## Known gaps

- **No admin endpoint resets the status.** Step 2 is a direct production database
  write, done by hand, with no audit trail and no guard rails beyond the `WHERE`
  clause. A `POST /v1/campaigns/tcr-compliance/admin/:campaignId/clear-rejection`
  (M2M-guarded, enforcing the `peerly_identity_id IS NULL` precondition) is the
  obvious fix and does not exist.
- **The rejection reason isn't stored anywhere queryable.** Step 0 sends you to
  Segment, Slack, and the run artifact to answer "why was this rejected", which makes
  the data-fixable-versus-terminal call slower than it should be.

## Related

- `packages/gp-api/src/campaigns/tcrCompliance/AGENTS.md` — the compliance flow,
  stage derivation, sweeps, and the Peerly submit invariants.
- `packages/runbooks/experiments/compliance_setup/instruction.md` — the agent's own
  Step 1 stage table, including why it refuses at `tcr_rejected`.
