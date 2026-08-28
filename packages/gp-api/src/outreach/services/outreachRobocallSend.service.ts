import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subMinutes } from 'date-fns'
import Stripe from 'stripe'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { CallhubCampaignService } from '@/vendors/callhub/services/callhubCampaign.service'
import { CallhubCampaignReportService } from '@/vendors/callhub/services/callhubCampaignReport.service'
import { CALLHUB_VB_STATUS } from '@/vendors/callhub/schemas/callhubCampaign.schema'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { OutreachType, RobocallSettleState } from '../../generated/prisma'

// Every 10 minutes, offset :04 so the sweep neither joins the top-of-hour herd
// nor collides with the staging sweep (:07,:17,…) or the tcr sweep (:23).
// Explicit timeZone per docs/scheduled-jobs.md; the minute offset is what
// matters here.
const ROBOCALL_SEND_SWEEP_CRON = '4,14,24,34,44,54 * * * *'
const ROBOCALL_SEND_SWEEP_JOB = 'robocallSendSweep'

// A `dialing` row whose updatedAt is older than this is assumed stranded — a
// process that died between winning the dial claim and committing/reverting, or
// a launch whose outcome the status read could not yet resolve — and is
// recovered by a later sweep via a fresh CallHub status read. It MUST comfortably
// exceed a healthy startCampaign's dialing window (a single launch PUT + commit,
// seconds) AND the sweep interval, so a merely-in-flight healthy run is never
// reclaimed and reconciled underneath itself. 15 min is many times the healthy
// window while still recovering a stranded hold long before it matters.
const ROBOCALL_DIALING_STALE_MINUTES = 15

// The deliberate enable-switch for the hand-supervised live dial test, matching
// the MEETINGS_AUTOMATION_ENABLED feature-flag pattern. Default OFF: the send
// cron dials real phones, so it stays a no-op until this is explicitly set AND
// the persisted compliance-pass gate (below) is wired. Not a substitute for the
// prod-only guard — both must pass.
const isRobocallSendEnabled = (): boolean =>
  process.env.ROBOCALL_SEND_ENABLED === 'true'

// The send-time dial slice: STARTs a staged, still-paid robocall's CallHub
// voice-broadcast campaign once its send time has arrived. THIS is the step that
// dials real phones and spends the authorized hold, so it guards two invariants
// absolutely: NEVER dial an unpaid run (a fresh Stripe re-read of the hold gates
// the launch), and NEVER dial the same run twice (a single-owner claim CAS
// elects one dialer, and a launch whose response is lost is resolved by a CallHub
// status read — never a blind retry). No capture, no void, no CallHub completion
// poll, no compliance table — those are other slices; this only READS the hold
// and STARTs the campaign.
@Injectable()
export class OutreachRobocallSendService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    private readonly campaigns: CallhubCampaignService,
    private readonly campaignReport: CallhubCampaignReportService,
    private readonly stripe: StripeService,
    private readonly analytics: AnalyticsService,
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
  // Prod-only (docs/scheduled-jobs.md § Prod-only guard) AND behind the
  // ROBOCALL_SEND_ENABLED kill-switch: this sweep DIALS REAL PHONES against a
  // rate-limited vendor and spends the authorized hold, so it must never fire on
  // dev/preview, nor on prod until the dial test is deliberately enabled. The
  // Pro/paywall gate is inherited: a draft only reaches `authorized` + a staged
  // campaign by passing the Pro-gated authorize + staging path.
  @Cron(ROBOCALL_SEND_SWEEP_CRON, {
    name: ROBOCALL_SEND_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepRobocallSend(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return
    if (!isRobocallSendEnabled()) return

    const now = new Date()
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
    })

    for (const { outreachId } of arrived) {
      try {
        await this.startCampaign(outreachId)
      } catch (err) {
        // Per-record isolation: one draft's Stripe/DB failure must not abort
        // dialing the rest. The next sweep retries it.
        this.logger.error(
          { err, outreachId },
          'robocall send failed for a draft; continuing sweep',
        )
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

  async startCampaign(outreachId: number): Promise<void> {
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
    if (claim.count === 0) return

    const draft = await this.findFirst({
      where: { outreachId },
      include: { outreach: { include: { campaign: true } } },
    })
    if (!draft?.callhubCampaignPkStr) {
      // Unreachable in practice (the claim matched a non-null pk_str), but never
      // launch without a campaign handle — release the claim so a later sweep
      // can retry rather than stranding the row in `dialing`.
      await this.revertClaim(outreachId)
      return
    }
    const pkStr = draft.callhubCampaignPkStr
    // The candidate to email if the hold turns out dead — the sweep has no user
    // in scope, so it comes off the draft's campaign.
    const userId = draft.outreach.campaign.userId

    // MONEY RE-CHECK (never dial unpaid — THE critical gate). Re-read the hold
    // from Stripe AFTER winning the claim and BEFORE the launch; the persisted
    // settleState is not trusted. Only a manual-capture PaymentIntent still in
    // `requires_capture` (the hold live and uncaptured) may dial.
    const intentId = draft.authorizationIntentId
    if (!intentId) {
      await this.markHoldNotLive(outreachId, userId, null)
      return
    }
    let intent: Stripe.PaymentIntent
    try {
      intent = await this.stripe.retrievePaymentIntent(intentId)
    } catch (err) {
      // A Stripe read failure BEFORE the launch is infra, not a dead hold, and
      // nothing has dialed — release the claim so a later sweep retries rather
      // than stranding `dialing`, and rethrow so the sweep logs it per-record.
      await this.revertClaim(outreachId)
      throw err
    }
    if (intent.status !== 'requires_capture') {
      await this.markHoldNotLive(outreachId, userId, intent.status)
      return
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
      return
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
        'robocall launch response lost; reconciling against CallHub status',
      )
      await this.reconcileDialing(outreachId, pkStr)
      return
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
      return
    }

    await this.commitDialed(outreachId, pkStr)
  }

  // Recovers a `dialing` row stranded past the stale window. First re-claims it
  // with a stale-guarded CAS (writing `dialing` bumps @updatedAt, so a concurrent
  // recoverer finds updatedAt no longer < cutoff and loses — electing exactly one
  // reconciler), then reconciles it against CallHub's status. Only the winner
  // touches the row, so reconcile's own commit/revert CAS never races a sibling.
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
    await this.reconcileDialing(outreachId, pkStr)
  }

  // Resolves a `dialing` row against CallHub's actual campaign status — the ONLY
  // safe way to conclude a launch whose response was lost. STARTED means the dial
  // DID happen → commit `dialed` idempotently (no re-dial). PAUSED means it did
  // NOT → revert to `authorized`, safe to relaunch next sweep. A read failure or
  // any other status is unresolved: LEAVE the row in `dialing` (never relaunch
  // without a PAUSED read, never mark dialed without a STARTED read) for the
  // stale-dialing sweep to retry, and alert.
  private async reconcileDialing(
    outreachId: number,
    pkStr: string,
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
      await this.revertClaim(outreachId)
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
