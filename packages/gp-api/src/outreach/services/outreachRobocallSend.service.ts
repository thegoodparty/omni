import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { addMinutes, isBefore, subMinutes } from 'date-fns'
import { ZodError } from 'zod'
import Stripe from 'stripe'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { estimateRobocallDialCompletion } from '@/shared/util/robocallDialCompletion.util'
import { sleep } from '@/shared/util/sleep.util'
import { CallhubCampaignService } from '@/vendors/callhub/services/callhubCampaign.service'
import { CallhubCampaignReportService } from '@/vendors/callhub/services/callhubCampaignReport.service'
import { CALLHUB_VB_STATUS } from '@/vendors/callhub/schemas/callhubCampaign.schema'
import {
  CallhubPermanentError,
  CallhubRecoverableError,
  isLowCreditDetail,
  isOverCpsLimitDetail,
} from '@/vendors/callhub/services/callhubErrorHandling.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import {
  OutreachStatus,
  OutreachType,
  RobocallSettleState,
} from '../../generated/prisma'
import { OutreachRobocallHoldService } from './outreachRobocallHold.service'
import { OutreachNotificationService } from './outreachNotification.service'

// Every 10 minutes, offset :04 so the sweep neither joins the top-of-hour herd
// nor collides with the staging sweep (:07,:17,…) or the tcr sweep (:23).
// Explicit timeZone per docs/scheduled-jobs.md; the minute offset is what
// matters here.
const ROBOCALL_SEND_SWEEP_CRON = '4,14,24,34,44,54 * * * *'
const ROBOCALL_SEND_SWEEP_JOB = 'robocallSendSweep'

// SERIAL SEND QUEUE. CallHub's account calls/min pool is SHARED across every
// running voice-broadcast campaign, so two campaigns dialing at once contend for
// it and the second's START 400s `over_cps_limit` (incident 2026-10-08). The
// model is therefore strictly serial: at most ONE robocall dials at a time. The
// sweep launches the single oldest-due run only when NO run is in flight, and
// frees the shared pool (ABORTs the finished CallHub campaign) once the dialing
// run's ESTIMATED completion has passed, letting the next queued run launch.
//
// ROBOCALL_SEND_MAX_PER_SWEEP is retained purely as the kill-switch the serial
// model also honors: 0 pauses every launch with no deploy (`take: 0` selects no
// rows); any value >= 1 launches the single oldest-due run (the serial gate caps
// it at one — see `take` below). ROBOCALL_SEND_LAUNCH_SPACING_MS and the in-pass
// `over_cps_limit` back-off are kept as a defensive multi-launch safety net: the
// serial gate means only one run launches per pass, so neither normally fires,
// but startCampaign's own throttle revert (the money-safe half of the back-off)
// still protects the rare case where the gate lets two overlap. Read at CALL time
// (functions, not consts) so a test can stub the env.
const envInt = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  // Floor to an integer so a fractional value never reaches `take` (which
  // expects an Int). A non-finite / negative value falls back to the default.
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback
}
const robocallSendMaxPerSweep = () =>
  envInt(process.env.ROBOCALL_SEND_MAX_PER_SWEEP, 2)
const robocallSendLaunchSpacingMs = () =>
  envInt(process.env.ROBOCALL_SEND_LAUNCH_SPACING_MS, 3000)

// A CONSERVATIVE buffer added to the estimated dial-completion instant before the
// sweep frees (ABORTs) a dialed run's CallHub campaign. The one real risk of the
// early free is aborting a run that is STILL dialing (estimate ran short) → calls
// cut off (under-delivery) while the 48h completion sweep still captures the full
// authorized estimate. So we err LONG: the dial-completion estimate itself is
// already conservative (a single-zone walk — CallHub dials per contact timezone,
// use_contact_tz, which spreads a national list wider and finishes SOONER than
// the estimate), and this buffer adds slack on top for dial-rate variance and
// vendor lag. 3h frees the pool ~16x sooner than the 48h settlement floor while
// staying a small fraction of ROBOCALL_RUN_HOURS (48), so it can never approach
// settlement timing. Env-overridable so ops can trade throughput against safety;
// NEVER set it so short that the estimate biases toward an early abort. Read at
// call time.
const robocallDialEstimateBufferMinutes = () =>
  envInt(process.env.ROBOCALL_DIAL_ESTIMATE_BUFFER_MINUTES, 180)

// A `dialing` row whose updatedAt is older than this is assumed stranded — a
// process that died between winning the dial claim and committing/reverting, or
// a launch whose outcome the status read could not yet resolve — and is
// recovered by a later sweep via a fresh CallHub status read. It MUST comfortably
// exceed a healthy startCampaign's dialing window (a single launch PUT + commit,
// seconds) AND the sweep interval, so a merely-in-flight healthy run is never
// reclaimed and reconciled underneath itself. 15 min is many times the healthy
// window while still recovering a stranded hold long before it matters.
const ROBOCALL_DIALING_STALE_MINUTES = 15

// Why a launch attempt did not cleanly commit `dialed`, which decides how a
// reconcile treats a PAUSED / unresolved status read (see `reconcileDialing`):
//   - `permanent`: a definitive 4xx reject — the START was refused, so the
//     campaign is guaranteed still PAUSED (never dialed) whatever the status
//     read says. Safe to fail on ANY read.
//   - `shape`: the launch response could not be parsed (a ZodError — a garbage /
//     unexpected body), so the dial state is UNKNOWN. Safe to fail ONLY when a
//     status read CONFIRMS PAUSED; an unresolved read must not fail (it may have
//     dialed).
//   - `transient`: a lost/5xx response or a non-STARTED 200 — retry via the
//     status read (revert on PAUSED, leave dialing on unresolved).
type LaunchOutcome = 'permanent' | 'shape' | 'transient'

// The sweep's per-row signal from startCampaign. `throttled` means CallHub
// rejected the START with `over_cps_limit` — it is actively throttling — so the
// sweep stops launching more rows THIS pass (adaptive back-off). Every other
// outcome (launched, reverted, failed, skipped) is `done` and lets the sweep
// continue. startCampaign's own money/dial handling is identical either way;
// this only governs whether the next row in the pass is attempted.
type StartCampaignResult = 'throttled' | 'done'

// The send-time dial slice: STARTs a staged, still-paid robocall's CallHub
// voice-broadcast campaign once its send time has arrived. THIS is the step that
// dials real phones and spends the authorized hold, so it guards two invariants
// absolutely: NEVER dial an unpaid run (a fresh Stripe re-read of the hold gates
// the launch), and NEVER dial the same run twice (a single-owner claim CAS
// elects one dialer, and a launch whose response is lost is resolved by a CallHub
// status read — never a blind retry). No capture, no void, no CallHub completion
// poll, no compliance table — those are other slices; this only READS the hold
// and STARTs the campaign.
//
// The sweep runs this as a SERIAL QUEUE (serial-send phases 2+3, built on the
// merged dial-completion estimator): at most one robocall dials at a time, since
// CallHub's account calls/min pool is shared across running campaigns. It frees
// that pool (ABORTs the finished campaign) once a dialing run's ESTIMATED
// completion + a conservative buffer has passed, then launches the next queued
// run. The early abort is OPERATIONAL ONLY — settlement and capture are untouched
// and still fire at dialedAt + 48h.
@Injectable()
export class OutreachRobocallSendService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    private readonly campaigns: CallhubCampaignService,
    private readonly campaignReport: CallhubCampaignReportService,
    private readonly stripe: StripeService,
    private readonly analytics: AnalyticsService,
    private readonly hold: OutreachRobocallHoldService,
    private readonly notification: OutreachNotificationService,
  ) {
    super()
  }

  // No CronLockService / whole-job lock: every unit of work is idempotent per
  // record behind an atomic claim (the dial claim in startCampaign, the
  // stale-dialing reclaim CAS in recoverStaleDialing), so two replicas racing
  // this sweep both SELECT the same candidates but only ONE wins each row — the
  // campaign is launched/reconciled once. @Cron (not @Interval) so the schedule
  // survives deploys and every replica fires on the same instant.
  //
  // Prod-only (docs/scheduled-jobs.md § Prod-only guard): this sweep DIALS REAL
  // PHONES against a rate-limited vendor and spends the authorized hold, so it
  // must never fire on dev/preview. The Pro/paywall gate is inherited: a draft
  // only reaches `authorized` + a staged campaign by passing the Pro-gated
  // authorize + staging path.
  @Cron(ROBOCALL_SEND_SWEEP_CRON, {
    name: ROBOCALL_SEND_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepRobocallSend(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return

    const now = new Date()

    // FREE-AND-ADVANCE: for every dialed run whose ESTIMATED completion + buffer
    // has passed, ABORT its CallHub campaign to release the shared account pool
    // slot and stamp `poolFreedAt`. This is OPERATIONAL ONLY — the run stays
    // `dialed` and the completion sweep still settles + captures the full
    // authorized estimate at dialedAt + 48h. Runs BEFORE the serial gate so a
    // run freed this pass no longer counts as in flight and the next queued run
    // can launch below.
    await this.freeCompletedDialingRuns(now)

    // SERIAL GATE: at most ONE robocall dials at a time, because CallHub's
    // account calls/min pool is shared across running campaigns. A run is "in
    // flight" while it holds that pool: a `dialing` claim (actively launching or
    // being stale-recovered), or a `dialed` run whose pool has NOT yet been freed
    // (still estimated-dialing). When any is in flight, launch nothing this pass —
    // the pool belongs to it. Bias toward NOT launching when unsure: a `dialing`
    // row always blocks even though it may resolve back to authorized, and if the
    // gate ever lets two overlap the second simply `over_cps_limit`s and reverts
    // (startCampaign's throttle revert), losing no calls.
    const inFlight = await this.hasRunInFlight()

    const launchSpacingMs = robocallSendLaunchSpacingMs()
    // The serial model launches ONE run per pass: the single oldest-due run, and
    // only when nothing is in flight. ROBOCALL_SEND_MAX_PER_SWEEP is kept as the
    // kill-switch — 0 selects no rows (every launch paused, no deploy) — but is
    // capped at one here so the per-pass maximum is always a single dial.
    const take = inFlight ? 0 : Math.min(robocallSendMaxPerSweep(), 1)
    const arrived = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.authorized,
        callhubCampaignPkStr: { not: null },
        outreach: {
          outreachType: OutreachType.robocall,
          date: { lte: now },
        },
      },
      select: { outreachId: true },
      // Oldest-due first so the most overdue (soonest to lapse) dials first.
      // `outreachId` breaks ties into a TOTAL order so both prod replicas pick
      // the identical oldest run — otherwise a date tie could order differently
      // per replica and two could launch at once. take: 0 selects no rows.
      orderBy: [{ outreach: { date: 'asc' } }, { outreachId: 'asc' }],
      take,
    })

    for (const [index, { outreachId }] of arrived.entries()) {
      // Space launches within a pass so N near-simultaneous STARTs don't trip
      // CallHub's CPS limit; not before the first, not after the last.
      if (index > 0) await sleep(launchSpacingMs)
      let result: StartCampaignResult
      try {
        result = await this.startCampaign(outreachId)
      } catch (err) {
        // Per-record isolation: one draft's Stripe/DB failure must not abort
        // dialing the rest. The next sweep retries it.
        this.logger.error(
          { err, outreachId },
          'robocall send failed for a draft; continuing sweep',
        )
        continue
      }
      if (result === 'throttled') {
        // ADAPTIVE BACK-OFF: CallHub rejected this START with over_cps_limit, so
        // it is actively throttling right now. Stop launching the rest of this
        // pass rather than firing more STARTs that would also 400 and revert —
        // do not keep firing into a vendor we KNOW is throttling. The throttled
        // row reverted to `authorized` via reconcile, and every un-attempted row
        // is untouched, so the next 10-min pass retries the oldest-due again:
        // the fixed cap + spacing bound each pass, and the cron cadence is the
        // cross-pass convergence back toward the limit.
        this.logger.warn(
          { outreachId },
          'robocall send backing off: CallHub over_cps_limit; ending this pass',
        )
        break
      }
    }

    // STALE-DIALING RECOVERY: a row stuck in `dialing` past the stale window is a
    // stranded claim (a crashed run, or a launch whose outcome was left
    // unresolved). It is invisible to the dial claim above (which matches only
    // `authorized`) and its hold is live, so it must be reconciled — never
    // re-launched blind — via a CallHub status read.
    const staleCutoff = subMinutes(now, ROBOCALL_DIALING_STALE_MINUTES)
    const stale = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.dialing,
        updatedAt: { lt: staleCutoff },
        callhubCampaignPkStr: { not: null },
      },
      select: { outreachId: true, callhubCampaignPkStr: true },
    })

    for (const { outreachId, callhubCampaignPkStr } of stale) {
      if (!callhubCampaignPkStr) continue
      try {
        await this.recoverStaleDialing(outreachId, callhubCampaignPkStr)
      } catch (err) {
        this.logger.error(
          { err, outreachId },
          'robocall stale-dialing recovery failed; continuing sweep',
        )
      }
    }
  }

  // Is any robocall still holding the shared CallHub account pool? A `dialing`
  // claim (launching now, or stranded awaiting stale recovery) or a `dialed` run
  // whose pool has not been freed (still estimated-dialing) both count. A run that
  // has been freed (poolFreedAt set), settled, captured, or failed does not — its
  // CallHub campaign no longer dials. The serial gate launches nothing while this
  // is true. Conservative by construction: a transient `dialing` row blocks the
  // queue for at most the stale window before recovery resolves it.
  private async hasRunInFlight(): Promise<boolean> {
    const count = await this.model.count({
      where: {
        OR: [
          { settleState: RobocallSettleState.dialing },
          { settleState: RobocallSettleState.dialed, poolFreedAt: null },
        ],
      },
    })
    return count > 0
  }

  // FREE-AND-ADVANCE: ABORT the CallHub campaign of every dialed run whose
  // estimated dial completion + buffer has passed, releasing the shared account
  // pool for the next queued run. OPERATIONAL ONLY — never touches settleState or
  // money; the completion sweep still settles + captures the full authorized
  // estimate at dialedAt + 48h, and its own best-effort abort becomes a harmless
  // no-op on an already-aborted campaign.
  private async freeCompletedDialingRuns(now: Date): Promise<void> {
    // One source for the dial rate the estimate assumes AND the rate CallHub
    // actually dials at (createVoiceBroadcast's frequency), so the estimate can
    // never predict a finish the real dial has not reached.
    const callsPerMinute = this.campaigns.getConfiguredCallsPerMinute()
    const bufferMinutes = robocallDialEstimateBufferMinutes()

    const dialing = await this.model.findMany({
      where: {
        settleState: RobocallSettleState.dialed,
        poolFreedAt: null,
        callhubCampaignPkStr: { not: null },
      },
      select: {
        outreachId: true,
        callhubCampaignPkStr: true,
        billableCount: true,
        dialedAt: true,
      },
    })

    for (const row of dialing) {
      // dialedAt is stamped at the dialing → dialed commit, and billableCount is
      // non-null off the draft state; guard defensively rather than estimate on a
      // missing input (which would throw) — such a row is simply left in flight.
      if (!row.callhubCampaignPkStr || row.dialedAt === null) continue
      if (row.billableCount === null || row.billableCount <= 0) continue

      const estimatedDoneAt = addMinutes(
        estimateRobocallDialCompletion({
          audienceSize: row.billableCount,
          callsPerMinute,
          startAt: row.dialedAt,
        }),
        bufferMinutes,
      )
      // Still (estimated) dialing — leave the pool to it. Bias LONG: never free
      // early, since an early abort cuts calls while the 48h capture charges full.
      if (isBefore(now, estimatedDoneAt)) continue

      try {
        await this.freePool(row.outreachId, row.callhubCampaignPkStr)
      } catch (err) {
        // A transient CallHub abort failure must not abort freeing the rest; the
        // run stays unfreed (poolFreedAt null) so it is retried next pass AND
        // still counts as in flight — the money-safe direction: never advance the
        // queue while the pool may still be occupied.
        this.logger.error(
          { err, outreachId: row.outreachId },
          'robocall free-and-advance abort failed; leaving run in flight',
        )
      }
    }
  }

  // ABORTs a dialed run's CallHub campaign to release its pool slot, then stamps
  // `poolFreedAt` ONLY on a clean abort (abortVoiceBroadcast treats a 404 as
  // already-retired and swallows it; a transient failure throws, so poolFreedAt
  // stays null and the run is retried + stays in flight next pass). The stamp CAS
  // is guarded on `dialed` + poolFreedAt null, so a row the completion sweep moved
  // to `settling` under us is a harmless no-op (its abort already fired there).
  private async freePool(outreachId: number, pkStr: string): Promise<void> {
    await this.campaigns.abortVoiceBroadcast(pkStr)
    const freed = await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.dialed,
        poolFreedAt: null,
      },
      data: { poolFreedAt: new Date() },
    })
    if (freed.count > 0) {
      this.logger.info(
        { outreachId, campaignPkStr: pkStr },
        'robocall estimated dial completion passed; freed CallHub pool slot',
      )
    }
  }

  async startCampaign(outreachId: number): Promise<StartCampaignResult> {
    // DIAL CLAIM (never dial twice): elect exactly one dialer. Only a staged,
    // paid draft (authorized AND a CallHub campaign already created) can
    // transition to `dialing`; a row already dialing/dialed, or one not yet
    // staged (pk_str null), or in any other state fails the predicate and yields
    // count 0 → not ours, return without dialing.
    const claim = await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.authorized,
        callhubCampaignPkStr: { not: null },
      },
      data: { settleState: RobocallSettleState.dialing },
    })
    if (claim.count === 0) return 'done'

    const draft = await this.findFirst({
      where: { outreachId },
      include: { outreach: { include: { campaign: true } } },
    })
    if (!draft?.callhubCampaignPkStr) {
      // Unreachable in practice (the claim matched a non-null pk_str), but never
      // launch without a campaign handle — release the claim so a later sweep
      // can retry rather than stranding the row in `dialing`.
      await this.revertClaim(outreachId)
      return 'done'
    }
    const pkStr = draft.callhubCampaignPkStr
    // The candidate to email if the hold turns out dead — the sweep has no user
    // in scope, so it comes off the draft's campaign. A robocall row is always
    // campaign-scoped (only social outreach can be org-only, outreach.prisma).
    const userId = draft.outreach.campaign!.userId

    // MONEY RE-CHECK (never dial unpaid — THE critical gate). Re-read the hold
    // from Stripe AFTER winning the claim and BEFORE the launch; the persisted
    // settleState is not trusted. Only a manual-capture PaymentIntent still in
    // `requires_capture` (the hold live and uncaptured) may dial.
    // A run a reward code paid for in full carries no hold at all (Stripe
    // refuses one under 50 cents), so there is nothing at Stripe to re-read: the
    // redeemed code IS the payment. Every other run must show a live hold.
    if (!draft.promoCoversTotal) {
      const intentId = draft.authorizationIntentId
      if (!intentId) {
        await this.markHoldNotLive(outreachId, userId, null)
        return 'done'
      }
      let intent: Stripe.PaymentIntent
      try {
        intent = await this.stripe.retrievePaymentIntent(intentId)
      } catch (err) {
        // A Stripe read failure BEFORE the launch is infra, not a dead hold,
        // and nothing has dialed — release the claim so a later sweep retries
        // rather than stranding `dialing`, and rethrow so the sweep logs it
        // per-record.
        await this.revertClaim(outreachId)
        throw err
      }
      if (intent.status !== 'requires_capture') {
        await this.markHoldNotLive(outreachId, userId, intent.status)
        return 'done'
      }
    }

    // COMPLIANCE GATE (never dial non-compliant — ANDed with the live-hold
    // re-check above). createDraft already requires a passing compliance verdict
    // before a draft can exist and stamps compliancePassedAt at that point, so a
    // dialing draft with a null stamp should be impossible. Belt-and-suspenders:
    // a crafted write or data anomaly that reaches dial without it must NOT dial.
    // Nothing has launched, so release the claim back to authorized (never
    // hold_failed — the hold is fine) and alert CRITICAL for manual review.
    if (!draft.compliancePassedAt) {
      await this.revertClaim(outreachId)
      this.logger.error(
        { outreachId, dialingCampaignPkStr: pkStr },
        'CRITICAL robocall reached dial with no compliance pass; not dialing',
      )
      return 'done'
    }

    // LAUNCH (outside any DB transaction): START the PAUSED campaign so it dials.
    // pk_str stays a STRING end-to-end.
    let launchStatus: number | null | undefined
    try {
      launchStatus = (await this.campaigns.launchVoiceBroadcast(pkStr)).status
    } catch (err) {
      // The launch response was lost (502 / timeout / reset), so we do NOT know
      // whether the START reached CallHub. NEVER blind-retry — a second START
      // could re-dial the entire audience. Reconcile against CallHub's actual
      // status: only an explicit PAUSED authorizes a retry; only an explicit
      // STARTED commits dialed; anything unresolved is left in `dialing` for the
      // stale-dialing sweep. Log the launch error for the record.
      this.logger.error(
        { err, outreachId, dialingCampaignPkStr: pkStr },
        'robocall launch failed; reconciling against CallHub status',
      )
      // Classify why the launch failed so reconcile knows how far to trust an
      // unresolved status read. A 4xx reject (`permanent`) never STARTs → fail on
      // any read. A ZodError parsing the launch response (`shape`) leaves the dial
      // state unknown → fail only on a CONFIRMED PAUSED read, never on an
      // unresolved one. Anything else is `transient` → reconcile + retry. Either
      // way we NEVER blind-retry (a second START could re-dial) and NEVER fail a
      // campaign that reads STARTED — reconcile commits that to dialed.
      // A low-credit reject is permanent for retry, but the account just needs
      // topping up — alert CAS in the channel they watch so it can be fixed.
      if (
        err instanceof CallhubPermanentError &&
        isLowCreditDetail(err.callhubDetail)
      ) {
        await this.notification.notifyRobocallLowCredit(
          draft.outreach.campaign!.slug,
          outreachId,
        )
      }
      // A CPS throttle is a transient recoverable-by-body reject
      // (CallhubRecoverableError, NOT CallhubPermanentError), so reconcile
      // treats it as `transient` and reverts the row to `authorized` on the
      // confirmed-PAUSED read — unchanged money handling. The only new behavior:
      // signal the sweep to back off the rest of this pass so it stops firing
      // STARTs into a vendor that is actively throttling. A genuine permanent
      // failure is NOT a throttle and still fails via reconcile below.
      const throttled =
        err instanceof CallhubRecoverableError &&
        isOverCpsLimitDetail(err.callhubDetail)
      try {
        await this.reconcileDialing(
          outreachId,
          pkStr,
          err instanceof CallhubPermanentError
            ? 'permanent'
            : err instanceof ZodError
              ? 'shape'
              : 'transient',
        )
      } catch (reconcileErr) {
        // A reconcile DB write (revert/commit/failSend) can throw. If it
        // escaped here, the sweep's outer catch would `continue` instead of
        // `break` and keep firing STARTs at a throttling vendor — the burst
        // this feature prevents. Swallow it so the throttle signal below is
        // always reached; the row is left in `dialing` for the stale-dialing
        // sweep to recover, exactly as an unresolved reconcile already is.
        this.logger.error(
          { err: reconcileErr, outreachId },
          'robocall reconcile after launch failure threw; preserving signal',
        )
      }
      return throttled ? 'throttled' : 'done'
    }

    // A 200 is not proof of a START: CallHub can echo PAUSE / null / {} (all of
    // which parse through the nullish response schema). Only an explicit STARTED
    // status commits dialed. Anything else re-reads the real status and resolves
    // exactly as the lost-response path does, rather than trusting the 2xx.
    if (launchStatus !== CALLHUB_VB_STATUS.START) {
      this.logger.error(
        { outreachId, dialingCampaignPkStr: pkStr, launchStatus },
        'robocall launch did not read back STARTED; reconciling',
      )
      await this.reconcileDialing(outreachId, pkStr)
      return 'done'
    }

    await this.commitDialed(outreachId, pkStr)
    return 'done'
  }

  // Recovers a `dialing` row stranded past the stale window. First re-claims it
  // with a stale-guarded CAS (writing `dialing` bumps @updatedAt, so a concurrent
  // recoverer finds updatedAt no longer < cutoff and loses — electing exactly one
  // reconciler), then reconciles it against CallHub's status. Only the winner
  // touches the row, so reconcile's own commit/revert CAS never races a sibling.
  // Reads the persisted `permanentSendFailure` marker and passes it through: a
  // row stranded by a permanent launch reject (whose failSend could not commit)
  // must FAIL the send, never revert-and-relaunch into the same 4xx.
  private async recoverStaleDialing(
    outreachId: number,
    pkStr: string,
  ): Promise<void> {
    const staleCutoff = subMinutes(new Date(), ROBOCALL_DIALING_STALE_MINUTES)
    const claim = await this.model.updateMany({
      where: {
        outreachId,
        settleState: RobocallSettleState.dialing,
        updatedAt: { lt: staleCutoff },
      },
      data: { settleState: RobocallSettleState.dialing },
    })
    if (claim.count === 0) return
    const row = await this.model.findUnique({
      where: { outreachId },
      select: { permanentSendFailure: true },
    })
    // A marked row was already confirmed not-dialed when the marker was set
    // (either a 4xx, or a `shape` failure whose status read was PAUSED), so it is
    // safe to fail on any read → `permanent`. An unmarked stale row is treated as
    // `transient`: reconcile against a fresh status read, which re-derives the
    // real outcome on the next launch attempt.
    await this.reconcileDialing(
      outreachId,
      pkStr,
      row?.permanentSendFailure ? 'permanent' : 'transient',
    )
  }

  // Persists the permanent-failure marker (best-effort) then fails the send. The
  // marker is set BEFORE failSend so that if failSend cannot commit its terminal
  // (a transient DB error inside it), the flag survives on the still-`dialing`
  // row and the stale sweep re-enters this path (permanent=true) rather than
  // reverting to `authorized` and relaunching into the same permanent reject. The
  // marker write is CAS'd on `dialing` and best-effort: if IT fails too, the row
  // stays `dialing` with the flag unset and the next stale cycle re-derives
  // permanence from a fresh launch attempt and retries the marker — it converges.
  private async failPermanentSend(outreachId: number): Promise<void> {
    try {
      await this.model.updateMany({
        where: {
          outreachId,
          settleState: RobocallSettleState.dialing,
        },
        data: { permanentSendFailure: true },
      })
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'robocall: failed to persist the permanent send-failure marker; ' +
          'stale recovery retries it next pass',
      )
    }
    await this.hold.failSend(outreachId, 'send')
  }

  // Resolves a `dialing` row against CallHub's actual campaign status — the ONLY
  // safe way to conclude a launch whose response was lost, garbage, or rejected.
  // STARTED means the dial DID happen → commit `dialed` idempotently (no re-dial),
  // regardless of `outcome`. What a PAUSED or unresolved read does depends on WHY
  // the launch didn't cleanly succeed (`outcome`, see the type above):
  //   - `permanent` (a 4xx reject): fail the send on BOTH a PAUSED read AND an
  //     unresolved read — a 4xx never dialed whatever the read says.
  //   - `shape` (an unparseable launch body, dial state UNKNOWN): fail ONLY on a
  //     confirmed PAUSED read; on an unresolved read leave it `dialing`, because
  //     the run MIGHT have dialed and we must never void a live run on a guess.
  //   - `transient` (lost/5xx, or a non-STARTED 200): revert on PAUSED to
  //     relaunch; leave `dialing` on an unresolved read.
  // Invariants throughout: never relaunch without a PAUSED read, never mark dialed
  // without a STARTED read, and never fail on an unresolved read unless the launch
  // was a definitive 4xx.
  private async reconcileDialing(
    outreachId: number,
    pkStr: string,
    outcome: LaunchOutcome = 'transient',
  ): Promise<void> {
    const status = await this.readVbStatus(pkStr)
    // PAUSE is the ONLY status that means the START never took effect, so it is
    // the only one safe to relaunch. START = still dialing; ABORT/END = the
    // campaign already left PAUSED and dialed (a small list can finish before we
    // read it), so both resolve to dialed — we never un-dial. Only a failed read
    // (null) or an unrecognized code stays in dialing for stale recovery.
    if (
      status === CALLHUB_VB_STATUS.START ||
      status === CALLHUB_VB_STATUS.ABORT ||
      status === CALLHUB_VB_STATUS.END
    ) {
      await this.commitDialed(outreachId, pkStr)
      return
    }
    if (status === CALLHUB_VB_STATUS.PAUSE) {
      // Confirmed the START never took effect (no calls dialed). A launch that
      // can't be retried into success — a 4xx reject (`permanent`) OR an
      // unreadable response body (`shape`) — is failed here: the PAUSED read
      // authoritatively confirms no dial, so voiding the hold is money-safe even
      // when the launch body itself was garbage. A `transient` failure just
      // releases the claim to relaunch next sweep.
      if (outcome !== 'transient') {
        await this.failPermanentSend(outreachId)
        return
      }
      await this.revertClaim(outreachId)
      return
    }
    // Unresolved status (a failed/garbage status read, or an unrecognized code).
    // ONLY a definitive 4xx (`permanent`) is failed here: a 4xx guarantees the
    // campaign never STARTED, so an unresolved read introduces no uncertainty —
    // it did not dial. Fail via the marker-persisting path so a failSend that
    // can't commit still leaves the stale sweep able to fail it (rather than
    // reverting + relaunching into the same 4xx). A `shape` or `transient` failure
    // with an unresolved read leaves the dial state UNKNOWN — the run may have
    // dialed — so it stays `dialing` for the stale sweep, never failed on a guess.
    if (outcome === 'permanent') {
      await this.failPermanentSend(outreachId)
      return
    }
    this.logger.error(
      { outreachId, dialingCampaignPkStr: pkStr, vbStatus: status },
      'robocall dialing unresolved; left in dialing for stale recovery',
    )
  }

  // Reads the CallHub campaign's lifecycle status (a GET, no side effect).
  // Returns null when the read itself fails so the caller can treat "unknown"
  // distinctly from a definitive STARTED/PAUSED.
  private async readVbStatus(pkStr: string): Promise<number | null> {
    try {
      return (await this.campaignReport.getCampaignStatus(pkStr)).status
    } catch (err) {
      this.logger.error(
        { err, dialingCampaignPkStr: pkStr },
        'robocall CallHub status read failed while reconciling dialing',
      )
      return null
    }
  }

  // COMMIT (never dial twice): `dialing → dialed`, stamping dialedAt, only if the
  // draft is still the dialing row we own.
  private async commitDialed(outreachId: number, pkStr: string): Promise<void> {
    const commit = await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.dialing },
      data: { settleState: RobocallSettleState.dialed, dialedAt: new Date() },
    })
    if (commit.count === 0) {
      // The draft moved out of `dialing` while we launched/reconciled, so the
      // campaign may be dialing at CallHub with no `dialed` record. There is no
      // safe un-dial — do NOT attempt to un-launch; log a CRITICAL alert with the
      // pk_str for manual reconciliation. FORWARD NOTE: when the cancel/void
      // slice lands it must not silently move a `dialing` row (a live dial with
      // no dialed record) — it must block during dialing or reconcile via the
      // CallHub status read, or it will orphan exactly this case.
      this.logger.error(
        { outreachId, dialingCampaignPkStr: pkStr },
        'CRITICAL robocall launched but commit matched no row; campaign may be ' +
          'dialing with no dialed record — reconcile by hand',
      )
      return
    }
    // The dial committed here — calls are actually going out (or already did,
    // for the reconcile/stale-recovery callers that land in this same commit on
    // a confirmed STARTED read). Advance the spine so the history UI shows the
    // run is "Sending" during the run window rather than staying "Scheduled". NO
    // per-contact ContactInteractionRobocall rows are written: this billing model
    // does not know WHO was reached (CallHub reports no per-call disposition), so
    // the robocall records only the aggregate audience/billable count on its
    // OutreachRobocall row, never a per-person feed entry.
    const advanced = await this.markSpineInProgress(outreachId)
    if (advanced) await this.notifyDialing(outreachId)
  }

  // Advance the spine `pending → in_progress` so the history UI shows "Sending"
  // for the run window (a robocall otherwise sits at "Scheduled" from
  // markSpineScheduled until capture flips it to "Completed"). Best-effort +
  // CAS-guarded on `pending` so it is idempotent and never flips a
  // canceled/failed row — mirrors markSpineScheduled/markSpineFailed in the hold
  // service. A miss only leaves the row showing "Scheduled"; log it, never fail
  // the dial (the call already went out).
  private async markSpineInProgress(outreachId: number): Promise<boolean> {
    try {
      const res = await this.client.outreach.updateMany({
        where: { id: outreachId, status: OutreachStatus.pending },
        data: { status: OutreachStatus.in_progress },
      })
      return res.count > 0
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'robocall: failed to advance spine to in_progress',
      )
      return false
    }
  }

  // A short CAS "now dialing" line, only on the real pending -> in_progress
  // transition so it fires once per run. Best-effort: the dial already went out,
  // so a Slack or context-load failure must never touch it.
  private async notifyDialing(outreachId: number): Promise<void> {
    try {
      const row = await this.model.findUnique({
        where: { outreachId },
        select: {
          billableCount: true,
          outreach: { select: { campaign: { select: { slug: true } } } },
        },
      })
      if (!row) return
      // Null billing belongs to the `draft` state alone, which the send
      // path's settleState scope can never reach.
      if (row.billableCount === null) {
        throw new Error('robocall billing missing on a non-draft row')
      }
      await this.notification.notifyRobocallDialing(
        row.outreach.campaign?.slug ?? 'unknown',
        outreachId,
        row.billableCount,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'robocall: CAS dialing notify failed',
      )
    }
  }

  // Releases the dialing claim back to authorized so a retry (or a later sweep)
  // can dial the still-PAUSED campaign — the money-safe rollback when CallHub
  // confirms (PAUSED) or infra confirms (pre-launch) that no dial happened.
  private async revertClaim(outreachId: number): Promise<void> {
    await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.dialing },
      data: { settleState: RobocallSettleState.authorized },
    })
  }

  // The hold is not live (expired / canceled / already captured, or no intent
  // recorded), so the run must NOT dial. Reached BEFORE any launch, so the staged
  // campaign is still PAUSED and a later re-auth + re-dial is safe. Move to
  // `hold_failed` — the re-auth-needed terminal — AND clear the now-stale
  // authorization fields: the hold service's new-card retry CAS requires
  // `authorizationIntentId IS NULL`, so leaving the dead intent set would strand
  // the row where no actor could re-pick it. `hold_failed` is reached from two
  // paths — a card decline at authorize time (hold service) and a dead hold at
  // dial time (here) — and both now leave a null intent.
  private async markHoldNotLive(
    outreachId: number,
    userId: number | null,
    paymentIntentStatus: Stripe.PaymentIntent.Status | null,
  ): Promise<void> {
    await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.dialing },
      data: {
        settleState: RobocallSettleState.hold_failed,
        authorizationIntentId: null,
        authorizedAmountInCents: null,
        captureBefore: null,
      },
    })
    this.logger.error(
      { outreachId, paymentIntentStatus },
      'robocall hold not live at dial time; not dialing',
    )
    // The candidate is NOT in the app when the sweep runs, so without this
    // milestone they never learn the hold lapsed and a new-card retry is needed.
    if (userId != null) {
      await this.emitHoldFailed(userId, outreachId)
    }
  }

  // Emits the HoldFailed milestone for a dead hold caught at dial time, mirroring
  // the hold service's emitMilestone. Deterministic Segment messageId so a replay
  // dedups to one email; the `_at_dial` suffix distinguishes this from the
  // authorize-time decline (`<id>:hold_failed`) so both can legitimately fire
  // once each. Best-effort: the money-state transition already committed, so a
  // Segment failure must log and continue, never throw and strand it.
  private async emitHoldFailed(
    userId: number,
    outreachId: number,
  ): Promise<void> {
    try {
      await this.analytics.track(
        userId,
        EVENTS.Robocall.HoldFailed,
        { outreachId },
        undefined,
        `${outreachId}:hold_failed_at_dial`,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId, event: EVENTS.Robocall.HoldFailed },
        'robocall dial-time hold_failed milestone emit failed',
      )
    }
  }
}
