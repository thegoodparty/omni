import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subMinutes } from 'date-fns'
import Stripe from 'stripe'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { FREE_TEXTS_OFFER } from 'src/shared/constants/freeTextsOffer'
import {
  calcTextAmountInCents,
  maxTextsForAmountInCents,
} from 'src/shared/util/textPricing.util'
import {
  isWinSmsHoldBillingEnabled,
  WIN_SMS_HOLD_MIN_CENTS,
} from 'src/shared/util/winSmsHold.util'
import {
  OutreachStatus,
  P2pSmsSettleState,
  PhoneListBuildStatus,
  Prisma,
} from '../../generated/prisma'
import { OutreachService } from './outreach.service'

// Backstop only — capture fires inline from both edges, so a quarter-hour net
// is enough to catch a dropped signal. The minute space is saturated by the
// robocall sweep family (grep -rn '@Cron(' before changing); this shares no
// instant with the sibling p2p build/finish sweeps. See docs/scheduled-jobs.md.
const P2P_SMS_CAPTURE_SWEEP_CRON = '0,15,30,45 * * * *'
const P2P_SMS_CAPTURE_SWEEP_JOB = 'p2pSmsCaptureSweep'
// Bounds the Stripe calls one pass issues so a backlog can't overrun the cron
// cadence; the remainder capture on the next pass, expiry-priority first.
const P2P_SMS_CAPTURE_BATCH_SIZE = 100
// A `capturing` row older than this is assumed stranded (a process that died
// between the Stripe capture and the DB commit) and is reconciled. Comfortably
// exceeds a healthy capture (a re-read + capture + commit, seconds) and the
// sweep interval, so a merely-in-flight run is never reclaimed underneath
// itself. Mirrors the robocall capture's stale window.
const P2P_SMS_CAPTURING_STALE_MINUTES = 15
// The backstop skips authorized holds younger than this so it never races the
// recording webhook's own discount stamp + inline capture (see sweepCaptures).
// A handful of synchronous queries complete far inside this window.
const P2P_SMS_CAPTURE_MIN_AGE_MINUTES = 2
// Deploys the sweep runs on: dev as well as prod (like the build finisher),
// because it moves money only under the flag — the gate is the flag, not the
// environment. Fail-closed: an absent/unexpected value (local, vitest) isn't in
// the set, so it skips.
const P2P_SMS_CAPTURE_DEPLOY_ENVIRONMENTS = new Set(['dev', 'prod'])

const getDeployEnvironment = (): string =>
  process.env.OTEL_SERVICE_ENVIRONMENT ?? ''

// Stripe's `latest_charge` is the durable charge id the charge-keyed refund
// path resolves against (it survives a lapsed hold). Normalize the string |
// Charge | null the SDK returns to a string id, or null when absent.
const resolveChargeId = (intent: Stripe.PaymentIntent): string | null => {
  const charge = intent.latest_charge
  if (!charge) return null
  return typeof charge === 'string' ? charge : charge.id
}

interface CaptureBilling {
  peerlyPhoneListId: string
  leadsLoaded: number
  offerApplied: boolean
}

// The capture half of the Win p2p SMS hold. B1 placed a manual-capture
// authorization on the UNDISCOUNTED estimate and stamped the satellite
// `authorized`; this service captures it once the recipient count is final —
// clamped to the authorized amount, with the free-texts discount applied at
// capture (the hold was placed without it). It never charges above the hold.
//
// TWO-EDGE RENDEZVOUS. Capture fires only when BOTH the hold is `authorized`
// AND its phone-list build is `ready` (a stable count). The two facts land in
// either order, so the capture is attempted from both edges — right after the
// hold records (is the build ready?), and right after the build finisher
// stamps the list ready (is a hold authorized for it?) — and whichever lands
// second wins. A backstop @Cron re-selects any authorized-and-ready row that
// never captured, so a dropped signal is still caught. The single-owner
// `authorized → capturing` claim elects exactly one capturer across all three
// entry points.
//
// Everything money-moving is gated on WIN_SMS_HOLD_BILLING (default off): the
// trigger points no-op when the flag is off, so this ships inert in prod. The
// @Cron runs on dev+prod (like the build finisher) because it reads/moves
// money only under the flag — the gate is the flag, not the environment.
@Injectable()
export class OutreachP2pSmsCaptureService extends createPrismaBase(
  MODELS.OutreachP2pSms,
) {
  constructor(
    private readonly stripe: StripeService,
    private readonly outreachService: OutreachService,
  ) {
    super()
  }

  // No whole-job lock: capture is idempotent per record behind the
  // `authorized → capturing` claim, so two replicas racing both SELECT the
  // same candidates but only ONE wins each row's claim. @Cron (not @Interval)
  // so the schedule survives deploys. dev+prod (not every preview stack);
  // process.env read live so a test can stub it. The money move itself is
  // gated again on the flag inside captureHold.
  @Cron(P2P_SMS_CAPTURE_SWEEP_CRON, {
    name: P2P_SMS_CAPTURE_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepCaptures(): Promise<void> {
    if (!P2P_SMS_CAPTURE_DEPLOY_ENVIRONMENTS.has(getDeployEnvironment())) return

    // Expiry-priority (captureBefore asc), NOT FIFO: under a backlog the holds
    // nearest Stripe's auto-expiry must capture first so none lapse. Bounded so
    // one pass issues a bounded number of Stripe calls. captureHold re-checks
    // readiness and the flag, so an authorized-but-not-ready row here is a
    // cheap no-op.
    //
    // GRACE-AGE FLOOR (updatedAt < now − grace): the recording webhook stamps
    // `authorized` and then, a few queries later in the SAME call, writes the
    // per-send free-texts discount stamp and fires the inline capture (edge a).
    // Skipping rows younger than the grace window keeps this backstop from
    // racing that window and capturing before the discount is recorded (which
    // would overcharge). A genuinely-dropped signal is older than the grace by
    // the time it needs this net, so none are missed.
    const graceCutoff = subMinutes(new Date(), P2P_SMS_CAPTURE_MIN_AGE_MINUTES)
    const candidates = await this.model.findMany({
      where: {
        settleState: P2pSmsSettleState.authorized,
        updatedAt: { lt: graceCutoff },
      },
      orderBy: { captureBefore: Prisma.SortOrder.asc },
      take: P2P_SMS_CAPTURE_BATCH_SIZE,
      select: { outreachId: true },
    })

    for (const { outreachId } of candidates) {
      // FINALIZE backstop: a pre-build draft paid before its build finished is
      // submitted to Peerly only at the build-ready edge, which (unlike the
      // webhook's build-before-pay finalize) has no Stripe redelivery behind it.
      // Re-attempt it here so a dropped build-ready edge still sends the paid
      // draft. Idempotent + single-owner (the pending_payment -> pending claim),
      // so an already-finalized draft is a no-op. Isolated from the capture
      // below: a send failure must not stop the money capture, and vice versa.
      try {
        await this.finalizePreBuildDraft(outreachId)
      } catch (err) {
        this.logger.error(
          { err, outreachId },
          'win sms pre-build finalize failed in sweep; continuing',
        )
      }

      try {
        await this.captureHold(outreachId)
      } catch (err) {
        // Per-record isolation: one hold's Stripe/DB failure must not abort
        // capturing the rest. The next sweep re-claims and retries it.
        this.logger.error(
          { err, outreachId },
          'win sms capture failed for a hold; continuing sweep',
        )
      }
    }

    // STALE-CAPTURING RECOVERY: a row stranded in `capturing` past the stale
    // window is a crashed run (a process that died between the Stripe capture
    // and the DB commit). It is invisible to the `authorized` claim yet its
    // hold may already be captured, so it MUST be reconciled — never left with
    // money taken and no record. The recovery re-reads the PI and settles
    // idempotently (a `succeeded` PI records amount_received; a
    // `requires_capture` PI re-captures under the stable key, so no double
    // charge).
    const staleCutoff = subMinutes(new Date(), P2P_SMS_CAPTURING_STALE_MINUTES)
    const stale = await this.model.findMany({
      where: {
        settleState: P2pSmsSettleState.capturing,
        updatedAt: { lt: staleCutoff },
      },
      orderBy: { captureBefore: Prisma.SortOrder.asc },
      select: { outreachId: true },
    })

    for (const { outreachId } of stale) {
      try {
        await this.recoverStaleCapturing(outreachId)
      } catch (err) {
        this.logger.error(
          { err, outreachId },
          'win sms stale-capturing recovery failed; continuing sweep',
        )
      }
    }
  }

  // EDGE (a): called right after the hold is stamped `authorized`. If the
  // build is already `ready`, this captures now; if not, it no-ops and edge (b)
  // or the backstop fires once the list finishes. Safe to call unconditionally
  // from the purchase handler — it gates itself on the flag and the state.
  async captureHold(outreachId: number): Promise<void> {
    if (!isWinSmsHoldBillingEnabled()) return

    // READINESS GATE (before the claim): resolve the build and confirm it is
    // ready with a stable leads_loaded. A not-yet-ready build leaves the hold
    // `authorized` for a later edge/sweep. Reading the build here (not after
    // the claim) means an unready row is never moved into `capturing` and back.
    const ready = await this.resolveReadyBuild(outreachId)
    if (!ready) return

    // CLAIM: elect exactly one capturer. Only an `authorized` hold transitions
    // to `capturing`; a concurrent winner or an already-advanced hold makes
    // count 0 (a replay no-op).
    const claim = await this.model.updateMany({
      where: { outreachId, settleState: P2pSmsSettleState.authorized },
      data: { settleState: P2pSmsSettleState.capturing },
    })
    if (claim.count === 0) return
    await this.settleClaimed(outreachId)
  }

  // SEND CAP (team decision 2 — never oversend). The money-safe recipient cap for
  // a build's send: the largest text count the authorized hold covers
  // (maxTextsForAmountInCents on authorizedAmountInCents). The phone-list build
  // reads this before uploading recipients to Peerly and truncates to it, so the
  // uploaded list — and the Peerly send that reads it — can never exceed what was
  // billed, even if re-resolving the filter yields a larger audience than the
  // pre-pay estimate. Returns null when the flag is off or no hold is authorized
  // for this build yet, so the caller applies no cap. The hold is found through
  // the satellite link set at hold time (peerlyPhoneListId), the same handle the
  // capture half uses; capturing/captured are included so a re-run after the
  // money moved still caps.
  async resolveSendCapForBuild(buildId: string): Promise<number | null> {
    if (!isWinSmsHoldBillingEnabled()) return null
    const hold = await this.model.findFirst({
      where: {
        peerlyPhoneListId: buildId,
        authorizedAmountInCents: { not: null },
        settleState: {
          in: [
            P2pSmsSettleState.authorized,
            P2pSmsSettleState.capturing,
            P2pSmsSettleState.captured,
          ],
        },
      },
      select: { authorizedAmountInCents: true },
      // Deterministic + conservative: a build is linked 1:1 to its hold, but if
      // two satellites ever pointed at one build, cap to the SMALLEST authorized
      // amount so the send can never exceed any hold that paid for it.
      orderBy: { authorizedAmountInCents: 'asc' },
    })
    if (hold?.authorizedAmountInCents == null) return null
    return maxTextsForAmountInCents(hold.authorizedAmountInCents)
  }

  // EDGE (b): called right after the build finisher stamps a list `ready`. Finds
  // the authorized holds against the just-ready list through the SATELLITE link
  // (OutreachP2pSms.peerlyPhoneListId, stamped at hold time by recordHold), not
  // Outreach.phoneListId. A pre-build draft's Outreach.phoneListId is null until
  // this same build-ready edge stamps it moments earlier, so the satellite link
  // is the order-independent handle; a build-before-pay draft is linked just the
  // same. Whichever of edge (a)/(b) runs second is the one that captures.
  async captureHoldsForReadyList(peerlyListId: number): Promise<void> {
    if (!isWinSmsHoldBillingEnabled()) return

    const build = await this.client.peerlyPhoneList.findUnique({
      where: { peerlyListId },
      select: { id: true },
    })
    if (!build) return

    const holds = await this.model.findMany({
      where: {
        peerlyPhoneListId: build.id,
        settleState: P2pSmsSettleState.authorized,
      },
      select: { outreachId: true },
    })

    for (const { outreachId } of holds) {
      try {
        await this.captureHold(outreachId)
      } catch (err) {
        this.logger.error(
          { err, outreachId, peerlyListId },
          'win sms capture failed from the build-ready edge; continuing',
        )
      }
    }
  }

  // FINALIZE build-ready edge: called right after the build finisher stamps a
  // list `ready`, from BOTH finisher paths (the browser status poll and the
  // server cron), BEFORE the capture edge above. A p2p draft paid before its
  // build finished was NOT submitted to Peerly at the payment webhook (finalize
  // deferred on a null phoneListId); now the list exists, so stamp its numeric
  // id onto the draft and submit it. Finds the drafts through the satellite link
  // and defers each to finalizePreBuildDraft. Self-gated; a build-before-pay
  // draft was already finalized at the webhook and is a no-op here.
  async finalizeDraftsForReadyList(peerlyListId: number): Promise<void> {
    if (!isWinSmsHoldBillingEnabled()) return

    const build = await this.client.peerlyPhoneList.findUnique({
      where: { peerlyListId },
      select: { id: true },
    })
    if (!build) return

    // Only `authorized` holds can have a deferred, unsent paid draft: once the
    // send is submitted and the money captured the row leaves `authorized`, and
    // the projectId gate on capture keeps an unsent draft here until it sends.
    const holds = await this.model.findMany({
      where: {
        peerlyPhoneListId: build.id,
        settleState: P2pSmsSettleState.authorized,
      },
      select: { outreachId: true },
    })

    for (const { outreachId } of holds) {
      try {
        await this.finalizePreBuildDraft(outreachId)
      } catch (err) {
        this.logger.error(
          { err, outreachId, peerlyListId },
          'win sms pre-build finalize failed from the build-ready edge; ' +
            'the backstop sweep will retry',
        )
      }
    }
  }

  // Finalizes ONE pre-build paid draft once its build is ready: stamp the numeric
  // Peerly list id onto the Outreach (only when still null, so a build-before-pay
  // draft the client already stamped is untouched), then submit it to Peerly.
  // Idempotent + single-owner: the stamp fills a null phoneListId, and
  // finalizeOutreachPurchase's pending_payment -> pending claim elects exactly
  // one finalizer across the two edges and the backstop. Only a draft that
  // actually completed checkout (a recorded Stripe session) and is still
  // pending_payment is submitted; an already-finalized or never-paid draft is a
  // no-op. Resolves readiness through the satellite link so it never trusts a
  // not-yet-stamped Outreach.phoneListId.
  private async finalizePreBuildDraft(outreachId: number): Promise<void> {
    if (!isWinSmsHoldBillingEnabled()) return

    const outreach = await this.client.outreach.findUnique({
      where: { id: outreachId },
      select: {
        id: true,
        campaignId: true,
        status: true,
        phoneListId: true,
        stripeCheckoutSessionId: true,
        p2pSms: { select: { peerlyPhoneListId: true } },
      },
    })
    // A finalize needs a campaign (p2p is always campaign-scoped), a completed
    // checkout (the recorded session), and a draft still awaiting its send.
    if (
      !outreach?.campaignId ||
      !outreach.stripeCheckoutSessionId ||
      outreach.status !== OutreachStatus.pending_payment
    ) {
      return
    }

    // Stamp the numeric list id from the linked build when the draft has none
    // yet. The link is the satellite's own FK, so this never depends on a count
    // the capture half reads.
    if (outreach.phoneListId === null) {
      const linkedBuildId = outreach.p2pSms?.peerlyPhoneListId
      if (!linkedBuildId) return
      const build = await this.client.peerlyPhoneList.findUnique({
        where: { id: linkedBuildId },
        select: { peerlyListId: true, buildStatus: true },
      })
      if (
        !build ||
        build.buildStatus !== PhoneListBuildStatus.ready ||
        build.peerlyListId === null
      ) {
        return
      }
      await this.client.outreach.updateMany({
        where: { id: outreachId, phoneListId: null },
        data: { phoneListId: build.peerlyListId },
      })
    }

    await this.outreachService.finalizeOutreachPurchase(
      outreachId,
      outreach.campaignId,
      outreach.stripeCheckoutSessionId,
    )
  }

  // Recovers a `capturing` row stranded past the stale window. First re-claims
  // it with a stale-guarded CAS (writing `capturing` bumps @updatedAt, so a
  // concurrent recoverer finds updatedAt no longer < cutoff and loses —
  // electing exactly one settler), then settles it via the SAME path
  // captureHold uses. The fresh PI re-read there resolves whether the pre-crash
  // capture landed, so recovery never double-charges.
  private async recoverStaleCapturing(outreachId: number): Promise<void> {
    const staleCutoff = subMinutes(new Date(), P2P_SMS_CAPTURING_STALE_MINUTES)
    const reclaim = await this.model.updateMany({
      where: {
        outreachId,
        settleState: P2pSmsSettleState.capturing,
        updatedAt: { lt: staleCutoff },
      },
      data: { settleState: P2pSmsSettleState.capturing },
    })
    if (reclaim.count === 0) return
    await this.settleClaimed(outreachId)
  }

  // Settles a row THIS caller already owns in `capturing`: re-read the PI and
  // capture / reconcile / void / revert. Every branch moves the row out of
  // `capturing` (to a terminal, or back to `authorized` to retry) so it never
  // strands. The capture amount applies the free-texts discount to the STAMPED
  // stable leads_loaded count and clamps to the authorized hold.
  private async settleClaimed(outreachId: number): Promise<void> {
    const sms = await this.model.findUnique({ where: { outreachId } })
    if (!sms) {
      this.logger.error(
        { outreachId },
        'CRITICAL win sms capture: claimed row vanished; cannot capture',
      )
      return
    }
    const { authorizationIntentId, authorizedAmountInCents } = sms

    // An `authorized`/`capturing` row MUST carry both. A null here is a data
    // anomaly, never a reason to charge blind: nothing was captured, so park
    // `voided` (the hold, if any, auto-expires within the auth lifetime).
    if (authorizationIntentId == null || authorizedAmountInCents == null) {
      this.logger.error(
        { outreachId },
        'CRITICAL win sms capture: capturing row missing intent/amount; ' +
          'parked voided, not charged',
      )
      await this.transitionFromCapturing(outreachId, P2pSmsSettleState.voided)
      return
    }

    // Resolve the stable billable count + whether the free-texts offer applied
    // to this send. A build that is no longer resolvable/ready (should not
    // happen once claimed — `ready` is terminal) reverts to `authorized` for a
    // later sweep rather than charging off an unknown count.
    const billing = await this.resolveCaptureBilling(outreachId)
    if (!billing) {
      this.logger.error(
        { outreachId },
        'win sms capture: build/count unresolved on a claimed row; ' +
          'reverted to authorized to retry',
      )
      await this.transitionFromCapturing(
        outreachId,
        P2pSmsSettleState.authorized,
      )
      return
    }

    // The discounted amount, clamped to the hold (defense-in-depth: the hold is
    // undiscounted and promo codes are disabled on hold sessions, but never
    // capture above what was authorized).
    const discountedAmount = this.computeDiscountedAmount(billing)
    const captureAmount = Math.min(discountedAmount, authorizedAmountInCents)

    // FRESH re-read: never trust the persisted state before moving money. The
    // live PI status decides the branch (preferring Stripe's own state over the
    // stored capture_before for the lapse decision).
    let intent: Stripe.PaymentIntent
    try {
      intent = await this.stripe.retrievePaymentIntent(authorizationIntentId)
    } catch (err) {
      // Transient read failure: no money moved. Release the claim back to
      // `authorized` so a later sweep retries.
      this.logger.error(
        { err, outreachId },
        'win sms capture PI read failed; reverting to authorized to retry',
      )
      await this.transitionFromCapturing(
        outreachId,
        P2pSmsSettleState.authorized,
      )
      return
    }

    // ALREADY CAPTURED (idempotent reconcile): a prior capture committed at
    // Stripe but lost its DB commit. Record the real captured amount and
    // settle; do NOT capture again.
    if (intent.status === 'succeeded') {
      await this.commitCaptured(
        outreachId,
        intent.amount_received ?? captureAmount,
        resolveChargeId(intent),
        billing.peerlyPhoneListId,
      )
      return
    }

    // HOLD LAPSED: expired / canceled / never capturable. Nothing was captured,
    // so park `voided` and surface CRITICAL — a fresh-charge recovery is a
    // later concern, never a blind charge here.
    // TODO(win-sms-hold slice E): a void here must restore the free-texts offer
    // redeemed at hold time (the release/cancel slice owns that restore).
    if (intent.status !== 'requires_capture') {
      this.logger.error(
        { outreachId, intentStatus: intent.status },
        'CRITICAL win sms capture: hold not capturable at capture time; ' +
          'parked voided, send uncharged',
      )
      await this.transitionFromCapturing(outreachId, P2pSmsSettleState.voided)
      return
    }

    // KILL-SWITCH on a live hold: everything below moves or releases money on a
    // `requires_capture` hold. If the flag was flipped OFF after this row entered
    // `capturing` (a rollback mid-settlement), do NOT issue a fresh Stripe call —
    // revert to `authorized` and let a sweep settle it when the flag is back on.
    // The `succeeded` reconcile above stays UNCONDITIONAL: it only records a
    // capture that already happened, which must never be lost to a rollback.
    if (!isWinSmsHoldBillingEnabled()) {
      this.logger.warn(
        { outreachId },
        'win sms capture: flag off on a live hold; reverting to authorized',
      )
      await this.transitionFromCapturing(
        outreachId,
        P2pSmsSettleState.authorized,
      )
      return
    }

    // ZERO / SUB-MINIMUM: Stripe refuses a capture under its 50c floor, so a
    // final amount below it is released, not captured — void the hold and park
    // `voided`. Covers a $0 amount (e.g. every contact free or scrubbed) too.
    // TODO(win-sms-hold slice E): restore the free-texts offer on this void.
    if (captureAmount < WIN_SMS_HOLD_MIN_CENTS) {
      await this.stripe.voidHold(authorizationIntentId)
      await this.transitionFromCapturing(outreachId, P2pSmsSettleState.voided)
      this.logger.info(
        { outreachId, captureAmount },
        'win sms capture: final amount below the floor; voided the hold',
      )
      return
    }

    try {
      // Stable idempotency key (deterministic per send), so a retried capture
      // replays instead of double-charging.
      intent = await this.stripe.capturePaymentIntent(
        authorizationIntentId,
        captureAmount,
        `p2p-sms-capture-${outreachId}`,
      )
    } catch (err) {
      // Capture failed. No commit yet, so revert to `authorized` and retry next
      // sweep — the re-read there sees `succeeded` (if it in fact captured) and
      // reconciles, or `canceled` (if the auth died) and parks voided.
      this.logger.error(
        { err, outreachId },
        'win sms capture call failed; reverting to authorized to retry',
      )
      await this.transitionFromCapturing(
        outreachId,
        P2pSmsSettleState.authorized,
      )
      return
    }

    await this.commitCaptured(
      outreachId,
      intent.amount_received ?? captureAmount,
      resolveChargeId(intent),
      billing.peerlyPhoneListId,
    )
  }

  // Commits capturing → captured and records what was charged. CAS-guarded on
  // `capturing` so a lost race (the row moved from under the claim) writes
  // nothing and is surfaced — money already moved at Stripe, so a missed commit
  // must never be silently swallowed.
  private async commitCaptured(
    outreachId: number,
    capturedAmountInCents: number,
    chargeIntentId: string | null,
    peerlyPhoneListId: string,
  ): Promise<void> {
    const commit = await this.model.updateMany({
      where: { outreachId, settleState: P2pSmsSettleState.capturing },
      data: {
        settleState: P2pSmsSettleState.captured,
        capturedAmountInCents,
        chargeIntentId,
        peerlyPhoneListId,
      },
    })
    if (commit.count === 0) {
      this.logger.error(
        { outreachId, capturedAmountInCents },
        'CRITICAL win sms capture: captured at Stripe but commit found no ' +
          'capturing row; charged amount may be unrecorded',
      )
      return
    }
    this.logger.info(
      { outreachId, capturedAmountInCents },
      'win sms hold captured',
    )
  }

  // Moves the row out of the capturing claim to a terminal (or back to
  // `authorized` to retry). CAS-guarded on `capturing` so a row that somehow
  // moved is a no-op.
  private async transitionFromCapturing(
    outreachId: number,
    to: P2pSmsSettleState,
  ): Promise<void> {
    await this.model.updateMany({
      where: { outreachId, settleState: P2pSmsSettleState.capturing },
      data: { settleState: to },
    })
  }

  // The discounted capture amount, computed the SAME way the immediate-charge
  // path bills (calcTextAmountInCents on the count reduced by the free-texts
  // allotment) so hold-billed and non-hold sends charge identically. The offer
  // is read from the durable per-send stamp, not a live eligibility check —
  // the offer is already redeemed by capture time, so a live check would read
  // `false` and silently drop the discount.
  private computeDiscountedAmount(billing: CaptureBilling): number {
    const billableCount = billing.offerApplied
      ? Math.max(0, billing.leadsLoaded - FREE_TEXTS_OFFER.COUNT)
      : billing.leadsLoaded
    return calcTextAmountInCents(billableCount)
  }

  // True only when the build is `ready` with a stamped leads_loaded — the
  // readiness half of the rendezvous. Joined via Outreach.phoneListId, which
  // equals the numeric Peerly list id (PeerlyPhoneList.peerlyListId).
  private async resolveReadyBuild(outreachId: number): Promise<boolean> {
    const billing = await this.resolveCaptureBilling(outreachId)
    return billing !== null
  }

  // Resolves everything capture needs from the build + satellite + campaign: the
  // stable leads_loaded count, whether the free-texts offer was applied to this
  // send, and the build's own id (stamped on the satellite as the durable
  // billing record). Returns null when the rendezvous is incomplete — the build
  // is not yet `ready` with a stable count, OR this send's free-texts redemption
  // has not finalized yet — so capture waits rather than billing off a half-
  // settled state.
  private async resolveCaptureBilling(
    outreachId: number,
  ): Promise<CaptureBilling | null> {
    const outreach = await this.client.outreach.findUnique({
      where: { id: outreachId },
      select: {
        phoneListId: true,
        projectId: true,
        campaign: { select: { hasFreeTextsOffer: true } },
        p2pSms: { select: { freeTextsApplied: true } },
      },
    })
    if (!outreach?.phoneListId) return null

    // NEVER CAPTURE AN UNSENT SEND. projectId is the Peerly job id, stamped only
    // once submitDraftToPeerly succeeds. In the pre-build flow finalize (the
    // send) and capture (the money) both fire at the build-ready edge; if the
    // send submission fails, finalize reverts the row to pending_payment but the
    // hold is still `authorized`, so without this gate the capture that runs next
    // in the same pass would charge for a send that never went out and settle the
    // row out of `authorized`, hiding it from the finalize backstop forever. This
    // keeps the hold `authorized` until the send is confirmed, so the backstop
    // re-finalizes. In the build-before-pay flow projectId is always set before
    // capture runs, so this is a no-op there.
    if (!outreach.projectId) return null

    const build = await this.client.peerlyPhoneList.findUnique({
      where: { peerlyListId: outreach.phoneListId },
      select: { id: true, buildStatus: true, leadsLoaded: true },
    })
    if (
      !build ||
      build.buildStatus !== PhoneListBuildStatus.ready ||
      build.leadsLoaded == null
    ) {
      return null
    }

    // The ONLY discount signal: the per-send, server-set flag the purchase
    // handler stamps the moment THIS send redeems the offer. Never the
    // client-writable billableTextCount, and never a campaign-level marker that
    // a later same-campaign send could ride to an unearned discount.
    const offerApplied = outreach.p2pSms?.freeTextsApplied ?? false

    // REDEMPTION-PENDING GATE: the hold is recorded `authorized` before the
    // recording webhook redeems this send's offer. If the campaign still has the
    // offer available and this send has not stamped the per-send flag, that
    // redemption has not run yet (the webhook is mid-flight, or a retry is
    // pending after a crash between authorize and redeem) — capturing now would
    // bill an eligible send at full price. Wait: a later edge/sweep captures
    // once the retry finalizes the offer. The stamp lands before redeemFreeTexts
    // flips the flag, so there is no window where both are "off" for an eligible
    // send mid-redemption.
    if (outreach.campaign?.hasFreeTextsOffer && !offerApplied) return null

    return {
      peerlyPhoneListId: build.id,
      leadsLoaded: build.leadsLoaded,
      offerApplied,
    }
  }
}
