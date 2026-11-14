import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  checkSmsStandards,
  findSmsRestrictedWords,
  type ApproveSmsOutreachRequest,
  type CancelSmsOutreachRequest,
  type DenySmsOutreachRequest,
  type EditSmsOutreachDateRequest,
  type EditSmsOutreachRequest,
  SMS_JOB_REPLACE_REASON_LABELS,
  type LinkSmsOutreachJobRequest,
  type ReplaceSmsOutreachJobRequest,
  type SmsAdminDetailResponse,
  type SmsAdminJobStats,
  type SmsApprovalQueueItem,
  type SmsApprovalStatus,
  type SmsJobReplaceReason,
  type SmsTestMessageRequest,
  type SmsTestMessageResponse,
  type SmsVendorAccount,
} from '@goodparty_org/contracts'
import {
  addDays,
  format,
  isAfter,
  isBefore,
  parseISO,
  subDays,
  subMilliseconds,
} from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { EASTERN_TIMEZONE } from 'src/shared/util/date.util'
import {
  OutreachStatus,
  OutreachType,
  P2pSmsSettleState,
  Prisma,
} from '../../generated/prisma'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { PeerlyP2pJobService } from 'src/vendors/peerly/services/peerlyP2pJob.service'
import { PeerlyAccountService } from 'src/vendors/peerly/services/peerlyAccount.service'
import { PeerlyTestListService } from 'src/vendors/peerly/services/peerlyTestList.service'
import { OutreachService } from './outreach.service'
import {
  HoldStillSettlingException,
  OutreachP2pSmsCancelService,
} from './outreachP2pSmsCancel.service'
import { OutreachNotificationService } from './outreachNotification.service'
import { PeerlyJob, PeerlyJobStatus } from 'src/vendors/peerly/peerly.types'
import {
  resolveSendWindowStart,
  SEND_WINDOW_END,
} from 'src/vendors/peerly/utils/sendWindowStart.util'
import { resolveSendWindowTimeZone } from 'src/shared/util/sendWindowTimeZone.util'
import { hasPeerlyCanvassersBooked } from '../util/peerlyCanvassersBooked.util'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { CrmCampaignsService } from 'src/campaigns/services/crmCampaigns.service'
import { S3Service } from 'src/vendors/aws/services/s3.service'
import { ASSET_DOMAIN } from 'src/shared/util/appEnvironment.util'

const queueInclude = {
  campaign: { include: { user: true } },
} satisfies Prisma.OutreachInclude

type QueueRow = Prisma.OutreachGetPayload<{ include: typeof queueInclude }>

type RegistrationNames = {
  candidateName: string | null
  committeeName: string | null
}

// Live vendor reads are additive detail, but Peerly has shown 45s-4min
// detailedstats responses on the shared test account, so every live read
// is bounded (boundedRead below) and a stalling vendor can never hold the
// queue or review page. A function (not a plain const), read at call
// time, so tests can shrink it via env instead of waiting out a real 10s
// bound — same pattern as ordinanceDispatch.service.ts's
// ORDINANCE_RESOLVE_TIMEOUT_MS.
const vendorReadTimeoutMs = () =>
  Number(process.env.VENDOR_READ_TIMEOUT_MS ?? 10_000)

const DATE_FMT = 'yyyy-MM-dd'

// Send-date floor for the console: everything scheduled before the CAS
// team's chosen cutoff predates the console and was resolved (or
// abandoned) through the old manual process.
const SMS_ADMIN_QUEUE_CUTOFF = new Date('2026-06-02T00:00:00Z')

// The hourly completion sweep (outreachCompletion.service.ts) ratchets a
// row pending -> in_progress at UTC midnight of its Peerly start_date
// whether or not CAS ever approved it, so on the send day an unapproved
// request reads `in_progress` with a still-unbooked vendor job. The
// console keys on approval state, not lifecycle status: both statuses are
// reviewable (Marshall Travis, 2026-09-14, dropped out of the queue ~20h
// before its send and had to be booked in Peerly by hand).
const REVIEWABLE_STATUSES: OutreachStatus[] = [
  OutreachStatus.pending,
  OutreachStatus.in_progress,
]

// The Sent tab is an after-the-fact record (CAS request, 2026-09-30), not
// an archive: every queue row costs a registration and HubSpot owner read,
// so completed sends fall off after this window rather than accumulating
// forever behind the tab nobody works from.
const SMS_ADMIN_SENT_LOOKBACK_DAYS = 90

// Peerly flagged (2026-09-04) that our detail reads were rapidly piling
// duplicate long-running requests — a slow read gets abandoned client-side
// by the timebox above, but the request keeps computing at Peerly, and the
// next page view (or gp-admin's post-approve/deny/edit router.refresh())
// fired another one on top of it. Their contract: one outstanding request
// per job, wait for it, retry a dead one only after ~10 minutes of silence.
// These four constants back that: a short cache so a refresh right after an
// action serves the last answer, and two cool-offs — Peerly's own 10-minute
// guidance for a request that never came back, and a shorter one for a
// request that came back with an error (safe to retry sooner than a still-
// running one).
const DETAIL_CACHE_TTL_MS = 2 * 60 * 1000
// Stats drift slowly (delivery counters over a send window) while the live
// job carries booking/activation state the review flow acts on, so stats
// tolerate a much longer TTL than the job read (QA flagged 4-6s
// detailed_stats reads on most detail views under the 2-minute TTL).
const STATS_CACHE_TTL_MS = 10 * 60 * 1000
// The queue's one account-wide jobs read: short enough that readiness is
// near-live, long enough that a detail-then-back navigation is instant.
// Approval state itself derives from our own DB stamps, so a stale entry
// here is cosmetic; mutations also invalidate it outright. Env-overridable
// like the cool-offs so tests can cross the TTL without waiting it out.
const queueJobsCacheTtlMs = () =>
  Number(process.env.QUEUE_JOBS_CACHE_TTL_MS ?? 60_000)
// The vendor balance moves per send, not per second; a minute keeps the
// header near-live while a refresh after an approve serves the last read.
const balanceCacheTtlMs = () =>
  Number(process.env.BALANCE_CACHE_TTL_MS ?? 60_000)
// HubSpot company-owner assignments change on human timescales.
const ownerCacheTtlMs = () =>
  Number(process.env.OWNER_CACHE_TTL_MS ?? 10 * 60 * 1000)
// Functions, not plain consts — same reason as vendorReadTimeoutMs() above:
// tests shrink these via env rather than waiting out the real cool-offs.
const detailFailedRetryCooldownMs = () =>
  Number(process.env.DETAIL_FAILED_RETRY_COOLDOWN_MS ?? 60_000)
const detailOutstandingRetryCooldownMs = () =>
  Number(process.env.DETAIL_OUTSTANDING_RETRY_COOLDOWN_MS ?? 10 * 60 * 1000)
// A test send is a real vendor text; a double-click or impatient retry
// must not spam it. Env-overridable like the other knobs, for tests.
const testSendCooldownMs = () =>
  Number(process.env.TEST_SEND_COOLDOWN_MS ?? 30_000)
// A job replacement's claim outlives a crashed request only this long. Job
// creation is a handful of vendor calls (seconds); a claim older than this
// belongs to a request that died, and a retry may take it over.
const jobReplaceClaimStaleMs = () =>
  Number(process.env.JOB_REPLACE_CLAIM_STALE_MS ?? 10 * 60 * 1000)

// A candidate's edit claim outlives a crashed request only this long. The
// edit is one Peerly template write (seconds); approve treats an older
// claim as abandoned, and so does the candidate's next edit.
const candidateEditClaimStaleMs = () =>
  Number(process.env.CANDIDATE_EDIT_CLAIM_STALE_MS ?? 10 * 60 * 1000)

// The whole account's job list is one cache entry; so is its balance.
const ACCOUNT_JOBS_KEY = 'account'

// HubSpot owner reads distinguish "unassigned" (ok) from "read failed"
// so a legitimate ownerless company caches for the full TTL while an
// outage retries on the failed cool-off.
type OwnerRead = { ok: boolean; name: string | null }

type DetailCacheEntry<T> = { value: T; expiresAt: number }
type DetailInFlightEntry<T> = { promise: Promise<T>; startedAt: number }

// The CAS approval back office (gp-admin). Scope is deliberately the cancel
// window: a p2p row at spine `pending` with a vendor job — the state where
// the job exists at Peerly but nothing sends until canvassers are requested.
@Injectable()
export class OutreachSmsAdminService extends createPrismaBase(MODELS.Outreach) {
  // Keyed by Peerly jobId (Outreach.projectId). One process per ECS task per
  // env, so an in-memory map single-flights within a task; it does not
  // coordinate across replicas, which this problem doesn't need — the goal
  // is one outstanding request per job, not a cluster-wide lock.
  private readonly jobCache = new Map<
    string,
    DetailCacheEntry<PeerlyJob | null>
  >()
  private readonly jobInFlight = new Map<
    string,
    DetailInFlightEntry<PeerlyJob | null>
  >()
  private readonly statsCache = new Map<
    string,
    DetailCacheEntry<SmsAdminJobStats | null>
  >()
  private readonly statsInFlight = new Map<
    string,
    DetailInFlightEntry<SmsAdminJobStats | null>
  >()
  private readonly accountJobsCache = new Map<
    string,
    DetailCacheEntry<PeerlyJob[] | null>
  >()
  private readonly accountJobsInFlight = new Map<
    string,
    DetailInFlightEntry<PeerlyJob[] | null>
  >()
  private readonly balanceCache = new Map<
    string,
    DetailCacheEntry<SmsVendorAccount | null>
  >()
  private readonly balanceInFlight = new Map<
    string,
    DetailInFlightEntry<SmsVendorAccount | null>
  >()
  // Keyed by HubSpot company id.
  private readonly ownerCache = new Map<string, DetailCacheEntry<OwnerRead>>()
  private readonly ownerInFlight = new Map<
    string,
    DetailInFlightEntry<OwnerRead>
  >()
  // Per-row test-send claims (outreachId -> claimed-at ms), same
  // per-process posture as the vendor-read maps above: the goal is one
  // test text per click, not a cluster-wide lock.
  private readonly testSendClaims = new Map<number, number>()

  constructor(
    private readonly peerlyP2pJobService: PeerlyP2pJobService,
    private readonly peerlyAccountService: PeerlyAccountService,
    private readonly peerlyTestListService: PeerlyTestListService,
    private readonly analytics: AnalyticsService,
    private readonly crmCampaigns: CrmCampaignsService,
    private readonly s3: S3Service,
    private readonly outreachService: OutreachService,
    private readonly p2pSmsCancel: OutreachP2pSmsCancelService,
    private readonly notifications: OutreachNotificationService,
  ) {
    super()
  }

  // Null on a failed or stalled vendor read: the console header degrades
  // to "unavailable" the way the queue's readiness column does.
  getVendorBalance(): Promise<SmsVendorAccount | null> {
    return this.boundedRead(
      this.singleFlightCached(
        this.balanceCache,
        this.balanceInFlight,
        ACCOUNT_JOBS_KEY,
        (value) => value === null,
        async () => {
          const read = await this.loggedVendorRead(
            'account_balance',
            {},
            this.peerlyAccountService.getBalance(),
          )
          return read ? { ...read, readAt: new Date() } : null
        },
        balanceCacheTtlMs(),
      ),
    )
  }

  private queueWhere(): Prisma.OutreachWhereInput {
    return {
      outreachType: OutreachType.p2p,
      projectId: { not: null },
      AND: [
        {
          // Canceled rows stay visible (the Canceled tab's audit trail);
          // only reviewable rows are actionable. A completed row is the
          // Sent tab's record — but only a BOOKED one: before the sweep
          // learned to hold unbooked rows at in_progress it completed them
          // on their send day, and those rows sent nothing.
          OR: [
            {
              status: { in: [...REVIEWABLE_STATUSES, OutreachStatus.canceled] },
            },
            {
              status: OutreachStatus.completed,
              canvassRequestedAt: { not: null },
              date: { gte: subDays(new Date(), SMS_ADMIN_SENT_LOOKBACK_DAYS) },
            },
          ],
        },
        {
          // The pre-console backlog is noise, not work: rows stranded
          // pending from before the console existed are hidden behind a
          // fixed cutoff (CAS request, 2026-09-09). Dateless rows stay
          // visible — a pending row with no send date is an anomaly worth
          // seeing, not backlog.
          OR: [{ date: null }, { date: { gte: SMS_ADMIN_QUEUE_CUTOFF } }],
        },
      ],
    }
  }

  async listQueue(): Promise<SmsApprovalQueueItem[]> {
    const rows = await this.model.findMany({
      where: this.queueWhere(),
      include: queueInclude,
      orderBy: [{ date: Prisma.SortOrder.asc }],
    })

    const registrations = await this.registrationsByCampaign(rows)
    const owners = await this.ownersByCampaign(rows)
    const jobsByProjectId = await this.liveJobsFor(rows)
    return rows.map((row) =>
      this.toQueueItem(
        row,
        registrations.get(row.campaignId ?? -1),
        row.projectId ? (jobsByProjectId.get(row.projectId) ?? null) : null,
        owners.get(row.campaignId ?? -1) ?? null,
      ),
    )
  }

  async getDetail(outreachId: number): Promise<SmsAdminDetailResponse> {
    const row = await this.model.findFirst({
      where: { id: outreachId, ...this.queueWhere() },
      include: queueInclude,
    })
    if (!row || !row.projectId) {
      throw new NotFoundException('Scheduled SMS campaign not found')
    }

    const registrations = await this.registrationsByCampaign([row])
    const owners = await this.ownersByCampaign([row])

    // A canceled row's vendor job was deleted with the cancel — both live
    // reads can only fail, so skip them and render from our own record.
    if (row.status === OutreachStatus.canceled) {
      return {
        item: this.toQueueItem(
          row,
          registrations.get(row.campaignId ?? -1),
          null,
          owners.get(row.campaignId ?? -1) ?? null,
        ),
        stats: null,
      }
    }

    const jobId = row.projectId

    // Live reads are additive detail — either failing (or stalling past
    // the timebox) must not 404 or hang the row. Parallel: neither read
    // depends on the other. Each is single-flighted + cached per jobId
    // (see the constants above) so a rapid refresh or a concurrent page
    // view shares one outstanding Peerly request instead of stacking a
    // new one; the 10s timebox below still bounds how long THIS call
    // waits for an answer, but the shared read itself keeps running.
    const [job, stats] = await Promise.all([
      this.boundedRead(
        this.singleFlightCached(
          this.jobCache,
          this.jobInFlight,
          jobId,
          (value) => value === null,
          () =>
            this.loggedVendorRead(
              'live_job',
              { outreachId },
              this.peerlyP2pJobService.getJob(jobId),
            ),
        ),
      ),
      this.boundedRead(
        this.singleFlightCached(
          this.statsCache,
          this.statsInFlight,
          jobId,
          (value) => value === null,
          () =>
            this.loggedVendorRead(
              'detailed_stats',
              { outreachId },
              // Scoped to the row's lifetime: Peerly scans the requested
              // span server-side, and the default THIS_YEAR over a busy
              // account is what stalled this read for minutes. Window
              // mirrors the inbound sweep's convention — padded a day each
              // side (Peerly evaluates the range in its account timezone)
              // and anchored on the send date (a backdated row's events
              // can predate createdAt).
              this.peerlyP2pJobService.getJobDetailedStats(jobId, {
                startDate: format(
                  subDays(row.date ?? row.createdAt, 1),
                  DATE_FMT,
                ),
                endDate: format(addDays(new Date(), 1), DATE_FMT),
              }),
            ),
          STATS_CACHE_TTL_MS,
        ),
      ),
    ])

    return {
      item: this.toQueueItem(
        row,
        registrations.get(row.campaignId ?? -1),
        job,
        owners.get(row.campaignId ?? -1) ?? null,
      ),
      stats,
    }
  }

  /**
   * Admin cancel runs the candidate's own unwind (vendor delete, refund,
   * promo restore) with staff attribution. Staff may cancel any unsent
   * campaign, booked or past its send time: they unbook canvassers through
   * this console, not Peerly, so cancelOutreach skips the candidate's
   * send-time refusals for them and the console warns instead.
   */
  async cancel(
    outreachId: number,
    input: CancelSmsOutreachRequest,
  ): Promise<SmsApprovalQueueItem> {
    const row = await this.model.findFirst({
      where: { id: outreachId, outreachType: OutreachType.p2p },
      include: queueInclude,
    })
    if (!row || !row.campaignId) {
      throw new NotFoundException('Scheduled SMS campaign not found')
    }
    await this.outreachService.cancelOutreach(outreachId, row.campaignId, {
      canceledBy: input.canceledBy,
      byAdmin: true,
    })
    if (row.projectId) this.invalidateVendorReads(row.projectId)
    const updated = await this.model.findFirstOrThrow({
      where: { id: outreachId },
      include: queueInclude,
    })
    const registrations = await this.registrationsByCampaign([updated])
    return this.toQueueItem(
      updated,
      registrations.get(updated.campaignId ?? -1),
      null,
    )
  }

  /**
   * The one human gate: claim the row (CAS-style, so two admins can't both
   * book the send), request Peerly's canvassers, then stamp the request. A
   * vendor failure reverts the claim so the queue row stays actionable.
   */
  async approve(
    outreachId: number,
    input: ApproveSmsOutreachRequest,
  ): Promise<SmsApprovalQueueItem> {
    const row = await this.model.findFirst({
      where: { id: outreachId },
      include: queueInclude,
    })
    if (!row) {
      throw new NotFoundException('Outreach not found')
    }
    if (row.approvedAt) {
      throw new ConflictException('This campaign is already approved')
    }
    if (row.deniedAt) {
      throw new ConflictException(
        'This campaign was denied — edit the message to re-queue it',
      )
    }
    if (
      !row.status ||
      !REVIEWABLE_STATUSES.includes(row.status) ||
      row.outreachType !== OutreachType.p2p ||
      !row.projectId
    ) {
      throw new BadRequestException(
        'Only scheduled SMS campaigns can be approved',
      )
    }
    // A send day that has already passed would book canvassers for a window
    // Peerly has closed: it accepts the request, auto-approves it and stamps
    // canvassRequestedAt, which then locks the row out of every reschedule
    // (editDate refuses a booked in_progress row). Refuse BEFORE the claim, so
    // a stale row stays untouched and staff can still move its date.
    const sendDay = row.scheduledLocalDate
    if (
      sendDay &&
      isBefore(
        parseISO(sendDay),
        parseISO(formatInTimeZone(new Date(), EASTERN_TIMEZONE, DATE_FMT)),
      )
    ) {
      throw new BadRequestException(
        `The send date (${sendDay}) has already passed — set a new date ` +
          'before approving',
      )
    }
    // Same-day approval inside the window is allowed on purpose (product call,
    // ENG-11614): Peerly starts sending as soon as canvassers are booked. Only
    // a send day whose window has already closed is refused, because booking
    // it locks the row the same way a passed day does. The close is read in
    // the zone approve hands to request_canvassers (the row's didState).
    if (sendDay) {
      const sendWindowZone = resolveSendWindowTimeZone(row.didState)
      const windowEnd = fromZonedTime(
        `${sendDay}T${SEND_WINDOW_END}:00`,
        sendWindowZone,
      )
      if (!isBefore(new Date(), windowEnd)) {
        throw new BadRequestException(
          `The send window for ${sendDay} closed at ${SEND_WINDOW_END} ` +
            `${sendWindowZone}. Set a new date before approving.`,
        )
      }
    }
    // Approval is what books canvassers, which is the vendor spend — so it is
    // the last gate before money is committed to the send. Two funding models
    // reach this console, told apart by whether the row has an OutreachP2pSms
    // satellite — NOT by the flag:
    //
    //  - HOLD MODEL (the row has a satellite): the paid `cs_` checkout placed a
    //    manual-capture authorization HOLD. The funding marker
    //    (stripeCheckoutSessionId) is stamped at AUTHORIZATION, not capture, so
    //    it CANNOT gate the send: an `authorized` or `capturing` hold still
    //    carries the marker yet has taken no money, and if it is never captured
    //    the hold lapses and the texts go out free. Gate on the committed
    //    `captured` state instead — the satellite is the source of truth
    //    (capture commits it under a CAS). Any other state is non-approvable:
    //    `capturing` is money mid-flight (retry once it commits),
    //    `authorized`/`hold_pending`/`pending_payment` is not yet captured, and
    //    `voided`/`hold_failed`/`refunded` is a terminal non-send.
    //
    //  - FUNDING-MARKER MODEL (no satellite — the whole flag-off/default
    //    population, and every free/forgiven send on the `free_confirmed_*`
    //    path): the paid checkout stamps stripeCheckoutSessionId, a zero-amount
    //    redemption stamps freePurchaseSessionId. Neither present means nothing
    //    funded the send, so it is refused rather than read as "free".
    //
    // The satellite read is UNCONDITIONAL, never flag-gated: a satellite exists
    // only if the send went through the hold path, so an uncaptured hold must be
    // blocked even on a flag rollback (flag ON at checkout, flipped OFF before
    // approve) — gating this read on the flag would turn the kill switch itself
    // into a free-send trigger (the read is skipped, the authorization-time
    // marker passes, and an uncaptured hold sends). The flag still gates ENTRY
    // into the hold model (checkout, recordHold, capture); only this gate's read
    // is unconditional. A non-hold row has no satellite, so `holdSms` is null
    // and the marker gate runs byte-for-byte as before.
    const holdSms = await this.client.outreachP2pSms.findUnique({
      where: { outreachId },
      select: { settleState: true },
    })
    if (holdSms) {
      if (holdSms.settleState !== P2pSmsSettleState.captured) {
        throw new BadRequestException(
          this.holdBlockMessage(holdSms.settleState),
        )
      }
    } else if (!row.stripeCheckoutSessionId && !row.freePurchaseSessionId) {
      throw new BadRequestException(
        'This campaign has no completed purchase on record',
      )
    }

    const claimed = await this.model.updateMany({
      where: {
        id: outreachId,
        status: { in: REVIEWABLE_STATUSES },
        approvedAt: null,
        deniedAt: null,
        OR: [
          { candidateEditClaimedAt: null },
          { candidateEditClaimedAt: { lt: this.candidateEditStaleCutoff() } },
        ],
      },
      data: { approvedAt: new Date(), approvedBy: input.approvedBy },
    })
    if (claimed.count === 0) {
      const current = await this.model.findFirst({
        where: { id: outreachId },
        select: { candidateEditClaimedAt: true },
      })
      if (
        current?.candidateEditClaimedAt &&
        isAfter(current.candidateEditClaimedAt, this.candidateEditStaleCutoff())
      ) {
        throw new ConflictException(
          'The candidate is editing this text, refresh in a moment.',
        )
      }
      throw new ConflictException('This campaign was just decided elsewhere')
    }

    const startTime = resolveSendWindowStart(row.scheduledLocalTime)
    try {
      await this.peerlyP2pJobService.requestCanvassers(row.projectId, {
        date: row.scheduledLocalDate ?? undefined,
        startTime,
        state: row.didState,
      })
    } catch (error) {
      await this.model.update({
        where: { id: outreachId },
        data: { approvedAt: null, approvedBy: null },
      })
      throw error
    }

    const updated = await this.model.update({
      where: { id: outreachId },
      data: { canvassRequestedAt: new Date() },
      include: queueInclude,
    })

    // A booked job stays paused at the vendor until explicitly activated,
    // and nothing on Peerly's side flips it. Best-effort AFTER the stamp:
    // the booking is the unrepeatable half of the approval; a failed
    // activation is recoverable by hand in Peerly and must not unwind it.
    // Rows with a stored time also get their job schedule aligned to it
    // here, for jobs created before the schedule honored the send time.
    const window =
      row.scheduledLocalTime && row.scheduledLocalDate && row.campaignId
        ? {
            campaignId: row.campaignId,
            date: row.scheduledLocalDate,
            startTime,
            state: row.didState,
          }
        : null
    try {
      await this.peerlyP2pJobService.activateJob(row.projectId, window)
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'Approve booked canvassers but could not activate the vendor ' +
          'job — it will not send until activated manually in Peerly',
      )
    }
    this.invalidateVendorReads(row.projectId)

    // The approval notice (CAS request 2026-09-09): the schedule-request
    // block set under a "P2P Campaign Approved to Send" header, so the
    // team's Slack workflow sees approvals where requests land. Re-read
    // with the notification shape (voterFileFilter drives the audience
    // block); best-effort end to end — a notice failure never fails an
    // approval that already booked and activated.
    try {
      const notifRow = await this.model.findFirst({
        where: { id: outreachId },
        include: {
          campaign: { include: { user: true } },
          voterFileFilter: true,
        },
      })
      if (notifRow?.campaign?.user) {
        await this.notifications.notifyApproved({
          user: notifRow.campaign.user,
          campaign: notifRow.campaign,
          outreach: notifRow,
          textCount: notifRow.textCount ?? undefined,
          billableTextCount: notifRow.billableTextCount ?? undefined,
        })
      }
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'Approval Slack notice failed; the approval itself is unaffected',
      )
    }

    const registrations = await this.registrationsByCampaign([updated])
    if (updated.campaign?.user) {
      await this.tryTrack(
        updated.campaign.user.id,
        EVENTS.Outreach.CampaignApproved,
        { channel: 'sms', medium: 'text' },
      )
    }
    return this.toQueueItem(
      updated,
      registrations.get(updated.campaignId ?? -1),
      null,
    )
  }

  async deny(
    outreachId: number,
    input: DenySmsOutreachRequest,
  ): Promise<SmsApprovalQueueItem> {
    // Hold model: a row carrying an OutreachP2pSms satellite was funded by a
    // manual-capture hold that is by this point captured (the approve gate only
    // lets a `captured` row reach canvasser booking), so denying it must RELEASE
    // the money — refund if captured, void if still authorized — and neutralize
    // the vendor job so a denied send can never go out. This is distinct from the
    // send-back-for-edits deny below: a non-satellite row keeps that behavior
    // byte-for-byte. SATELLITE-gated, not flag-gated — a captured/authorized hold
    // is released even if win_sms_hold_billing is since turned off.
    const satellite = await this.client.outreachP2pSms.findUnique({
      where: { outreachId },
      select: { outreachId: true },
    })
    if (satellite) {
      return this.denyHold(outreachId, input)
    }

    const denied = await this.model.updateMany({
      where: {
        id: outreachId,
        status: { in: REVIEWABLE_STATUSES },
        outreachType: OutreachType.p2p,
        approvedAt: null,
        deniedAt: null,
      },
      data: {
        deniedAt: new Date(),
        deniedBy: input.deniedBy,
        deniedReason: input.reason,
      },
    })
    if (denied.count === 0) {
      const current = await this.findFirst({ where: { id: outreachId } })
      if (!current) {
        throw new NotFoundException('Outreach not found')
      }
      throw new ConflictException(
        'This campaign is not awaiting review any more',
      )
    }

    const updated = await this.model.findFirstOrThrow({
      where: { id: outreachId },
      include: queueInclude,
    })
    const registrations = await this.registrationsByCampaign([updated])
    return this.toQueueItem(
      updated,
      registrations.get(updated.campaignId ?? -1),
      null,
    )
  }

  // Terminal deny for a hold-model row: CLAIM the denial via a guarded CAS FIRST
  // (symmetric with approve, so the two can never interleave — see the claim
  // below), and only on a won claim neutralize the vendor job then release the
  // money through the shared charge-keyed refund terminal. The denial is
  // committed by the claim, so the catch distinguishes TWO failure classes. A
  // `capturing` refusal (money mid-flight, HoldStillSettlingException) commits no
  // release and moves no money, so it self-heals: the denial stamp is reverted
  // and a retry succeeds once the capture settles. EVERY other delete/release
  // failure may already have moved money (a refund committed, then a DB write
  // threw), so the denial stays committed and the row is left denied-but-
  // unreleased for the slice-F reconcile — never reverted, so it can never
  // become sendable again while a refund is outstanding (a revert would reopen a
  // refund-and-also-send window). This is the better trade than a read-only
  // pre-check, which would let a concurrent approve book/send between the read
  // and the action and then refund an already-booked send.
  private async denyHold(
    outreachId: number,
    input: DenySmsOutreachRequest,
  ): Promise<SmsApprovalQueueItem> {
    const row = await this.model.findFirst({
      where: { id: outreachId, outreachType: OutreachType.p2p },
      include: queueInclude,
    })
    if (!row || !row.campaignId) {
      throw new NotFoundException('Scheduled SMS campaign not found')
    }
    // Claim the denial FIRST via a guarded CAS, SYMMETRIC with approve's claim —
    // so approve and deny can never interleave on one row. A read-only pre-check
    // would leave a TOCTOU window where a concurrent approve commits `approvedAt`
    // and books/sends canvassers between the read and deny's action, after which
    // deny would delete the job and refund an already-booked/sent campaign. The
    // CAS closes that: only a still-reviewable, un-approved, un-denied row claims,
    // and the row ends with exactly one of approvedAt/deniedAt. REVIEWABLE_STATUSES
    // also excludes a completed (sent) row, so a delivered send is never refunded.
    // NOTE: deny intentionally still permits `in_progress` (the sweep ratchets an
    // unapproved row there on its send day), matching the hand-booking window the
    // console works from; a completed row is the terminal that is refused.
    const claimed = await this.model.updateMany({
      where: {
        id: outreachId,
        status: { in: REVIEWABLE_STATUSES },
        approvedAt: null,
        deniedAt: null,
      },
      data: {
        deniedAt: new Date(),
        deniedBy: input.deniedBy,
        deniedReason: input.reason,
      },
    })
    if (claimed.count === 0) {
      // A concurrent approve (or deny) already decided this row, or it is sent:
      // abort WITHOUT deleting the job or moving any money.
      throw new ConflictException(
        'This campaign is not awaiting review any more',
      )
    }

    // We own the denial (committed above). Neutralize the job FIRST and throw on
    // failure (the cancel discipline), so a denied send can never fire: releasing
    // the money before the job is gone would risk a free delivered send if the
    // delete then failed.
    try {
      if (row.projectId) {
        await this.peerlyP2pJobService.deleteJob(row.projectId)
        this.invalidateVendorReads(row.projectId)
      }

      // Release the hold (refund if captured, void if authorized). Refuses a
      // `capturing` row (money mid-flight) with a throw — no state transition is
      // committed on that path, so there is never money moved without a denial.
      await this.p2pSmsCancel.releaseForDeny(outreachId, row.campaignId)
    } catch (err) {
      // ONLY the `capturing` refusal is safe to heal by reverting the denial: it
      // throws BEFORE any release transition commits, so no money moved, and the
      // revert lets a retry succeed once the capture settles (the vendor job
      // delete is idempotent, so re-running is safe). ANY other failure here may
      // already have moved money — a refund can commit and then a DB write throw
      // — so reverting would make the row reviewable/approvable again and open a
      // refund-and-also-send window; instead keep the denial committed and leave
      // the row denied-but-unreleased for the slice-F reconcile. approvedAt stays
      // null throughout (approve requires deniedAt null), making the guard
      // belt-and-suspenders. The original error is rethrown unchanged either way.
      if (err instanceof HoldStillSettlingException) {
        await this.model.updateMany({
          where: { id: outreachId, approvedAt: null },
          data: { deniedAt: null, deniedBy: null, deniedReason: null },
        })
      }
      throw err
    }

    const updated = await this.model.findFirstOrThrow({
      where: { id: outreachId },
      include: queueInclude,
    })
    const registrations = await this.registrationsByCampaign([updated])
    return this.toQueueItem(
      updated,
      registrations.get(updated.campaignId ?? -1),
      null,
    )
  }

  /**
   * CAS's fix path: correct the message in place — the same thing the team
   * does in Peerly's platform today. The editor IS the approver, so an
   * existing canvasser booking and approval are KEPT (product decision
   * 2026-09-02); only a denial is cleared, so a denied campaign becomes
   * approvable again. Vendor first, then DB: a Peerly failure leaves the
   * row untouched. Name, date, image, and audience are untouched.
   */
  async editScript(
    outreachId: number,
    input: EditSmsOutreachRequest,
  ): Promise<SmsApprovalQueueItem> {
    const row = await this.model.findFirst({
      where: { id: outreachId, ...this.queueWhere() },
      include: queueInclude,
    })
    if (!row || !row.projectId) {
      throw new NotFoundException('Scheduled SMS campaign not found')
    }
    // A canceled row is in queue scope for the audit trail, but its vendor
    // job is deleted — the edit's vendor write must never fire for it.
    if (row.status === OutreachStatus.canceled) {
      throw new BadRequestException('Only scheduled campaigns can be edited')
    }
    // A sent row is in scope for the Sent tab's record; its texts are gone.
    if (row.status === OutreachStatus.completed) {
      throw new BadRequestException('This campaign has already sent')
    }
    // Once the send day has begun AND canvassers are booked, Peerly may be
    // mid-send: a template overwrite would change copy under live agents.
    if (
      row.status === OutreachStatus.in_progress &&
      row.canvassRequestedAt !== null
    ) {
      throw new BadRequestException(
        'This campaign is already sending and cannot be edited',
      )
    }
    if (!row.identityId || row.campaignId === null) {
      throw new BadRequestException(
        'This campaign is missing its sending identity and cannot be edited',
      )
    }

    this.assertScriptAccepted(input.script)
    await this.writeScriptToVendor(
      {
        projectId: row.projectId,
        identityId: row.identityId,
        campaignId: row.campaignId,
        imageUrl: row.imageUrl,
        title: row.title,
        name: row.name,
      },
      input.script,
    )

    const edited = await this.model.updateMany({
      where: { id: outreachId, status: { in: REVIEWABLE_STATUSES } },
      data: {
        script: input.script,
        message: input.script,
        deniedAt: null,
        deniedBy: null,
        deniedReason: null,
        adminEditedAt: new Date(),
        adminEditedBy: input.editedBy,
      },
    })
    if (edited.count === 0) {
      this.logger.error(
        `Outreach ${outreachId} advanced past pending during admin edit; ` +
          'Peerly job has the new content but the row kept the old — ' +
          'manual reconciliation required',
      )
      throw new ConflictException('This campaign is no longer editable')
    }

    const updated = await this.model.findFirstOrThrow({
      where: { id: outreachId },
      include: queueInclude,
    })
    const registrations = await this.registrationsByCampaign([updated])
    return this.toQueueItem(
      updated,
      registrations.get(updated.campaignId ?? -1),
      null,
    )
  }

  /**
   * The candidate's own edit of a text staff have not approved yet. Peerly
   * is written before the DB (the admin edit's order), so the row is
   * claimed first: approve refuses a row while the claim is fresh, and
   * staff can never book the old script mid-edit. The final write and any
   * rollback are scoped to the exact claim stamp, so a request that outlived
   * its claim cannot clear or overwrite a newer one.
   */
  async candidateEditScript(
    outreachId: number,
    campaignId: number,
    script: string,
  ): Promise<void> {
    const row = await this.model.findFirst({
      where: { id: outreachId, campaignId },
      include: queueInclude,
    })
    if (!row) {
      throw new NotFoundException('Outreach not found')
    }
    if (row.status === OutreachStatus.canceled) {
      throw new ConflictException('This text was canceled')
    }
    if (row.status === OutreachStatus.completed) {
      throw new ConflictException('This text has already sent')
    }
    if (
      row.outreachType !== OutreachType.p2p ||
      !row.projectId ||
      !row.identityId ||
      row.campaignId === null
    ) {
      throw new BadRequestException('This text cannot be edited')
    }
    if (row.approvedAt || row.canvassRequestedAt) {
      throw new ConflictException(
        'This text is already queued for sending and cannot be edited',
      )
    }
    this.assertScriptAccepted(script)

    const claimedAt = new Date()
    const claimed = await this.model.updateMany({
      where: {
        id: outreachId,
        status: { in: REVIEWABLE_STATUSES },
        approvedAt: null,
        canvassRequestedAt: null,
        OR: [
          { candidateEditClaimedAt: null },
          { candidateEditClaimedAt: { lt: this.candidateEditStaleCutoff() } },
        ],
      },
      data: { candidateEditClaimedAt: claimedAt },
    })
    if (claimed.count === 0) {
      throw new ConflictException(
        'This text is already being edited or was just queued for sending',
      )
    }

    try {
      await this.writeScriptToVendor(
        {
          projectId: row.projectId,
          identityId: row.identityId,
          campaignId: row.campaignId,
          imageUrl: row.imageUrl,
          title: row.title,
          name: row.name,
        },
        script,
      )
    } catch (error) {
      await this.model.updateMany({
        where: { id: outreachId, candidateEditClaimedAt: claimedAt },
        data: { candidateEditClaimedAt: null },
      })
      throw error
    }

    const edited = await this.model.updateMany({
      where: {
        id: outreachId,
        candidateEditClaimedAt: claimedAt,
        approvedAt: null,
        canvassRequestedAt: null,
      },
      data: {
        script,
        message: script,
        deniedAt: null,
        deniedBy: null,
        deniedReason: null,
        candidateEditedAt: new Date(),
        candidateEditClaimedAt: null,
      },
    })
    if (edited.count === 0) {
      this.logger.error(
        { outreachId },
        'Candidate edit lost its claim after Peerly took the new script; ' +
          'the row kept the old one — manual reconciliation required',
      )
      throw new ConflictException(
        'This text changed while you were editing it, refresh and try again',
      )
    }

    try {
      const notifRow = await this.model.findFirst({
        where: { id: outreachId },
        include: {
          campaign: { include: { user: true } },
          voterFileFilter: true,
        },
      })
      if (notifRow?.campaign?.user) {
        await this.notifications.notifyEdited({
          user: notifRow.campaign.user,
          campaign: notifRow.campaign,
          outreach: notifRow,
          textCount: notifRow.textCount ?? undefined,
          billableTextCount: notifRow.billableTextCount ?? undefined,
        })
      }
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'Candidate edit Slack notice failed; the edit itself is unaffected',
      )
    }
  }

  private candidateEditStaleCutoff(): Date {
    return subMilliseconds(new Date(), candidateEditClaimStaleMs())
  }

  // The vendor refuses a shortened link or a restricted word outright, and
  // the template update is a destructive overwrite — so an edit carrying one
  // fails at the vendor with the vendor's wording, after we have already
  // started writing to a live job. Refuse it here instead. Only these rules
  // are enforced: the rest of the standards check stays advisory in the
  // console, where the human approval is the gate.
  private assertScriptAccepted(script: string): void {
    const { failures } = checkSmsStandards(script)
    if (failures.includes('link_shortener')) {
      throw new BadRequestException(
        'Links must not use a shortener like bit.ly — paste the full web ' +
          'address instead',
      )
    }
    if (failures.includes('restricted_word')) {
      throw new BadRequestException(
        `Remove ${findSmsRestrictedWords(script)
          .map((word) => `"${word}"`)
          .join(
            ' and ',
          )} — the texting provider rejects messages that contain it`,
      )
    }
  }

  // Shared by the staff and candidate edits. Peerly's template update is a
  // destructive overwrite, so it always needs the image bytes — a
  // script-only edit re-sends the stored one.
  private async writeScriptToVendor(
    row: {
      projectId: string
      identityId: string
      campaignId: number
      imageUrl: string | null
      title: string | null
      name: string | null
    },
    script: string,
  ): Promise<void> {
    if (!row.imageUrl) {
      throw new BadRequestException(
        'This campaign has no stored image, so it cannot be edited',
      )
    }
    const imageKey = decodeURIComponent(new URL(row.imageUrl).pathname.slice(1))
    const image = await this.s3.getFileBytesWithContentType(
      ASSET_DOMAIN,
      imageKey,
    )
    if (!image) {
      throw new BadRequestException(
        'The stored image could not be read; the campaign cannot be edited',
      )
    }

    await this.peerlyP2pJobService.updatePeerlyP2pJob({
      jobId: row.projectId,
      campaignId: row.campaignId,
      imageInfo: {
        fileStream: image.bytes,
        fileName: imageKey.split('/').pop() ?? 'outreach-image',
        mimeType: image.contentType ?? 'image/jpeg',
        title: row.title ?? undefined,
      },
      scriptText: script,
      identityId: row.identityId,
      name: row.name ?? undefined,
    })
    this.invalidateVendorReads(row.projectId)
  }

  /**
   * Staff reschedule: move the send to a new day without touching the
   * message. Vendor first, then DB — a Peerly failure leaves the row
   * untouched (the editScript convention). Approval stamps are KEPT (the
   * editor is the approver, same product decision as the script edit); a
   * booked row is rebooked on the new day (clear then re-request, since
   * Peerly allows one open canvasser request per job) and its
   * canvassRequestedAt re-stamped.
   */
  async editDate(
    outreachId: number,
    input: EditSmsOutreachDateRequest,
  ): Promise<SmsApprovalQueueItem> {
    const row = await this.model.findFirst({
      where: { id: outreachId, ...this.queueWhere() },
      include: queueInclude,
    })
    if (!row || !row.projectId) {
      throw new NotFoundException('Scheduled SMS campaign not found')
    }
    // A canceled row is in queue scope for the audit trail, but its vendor
    // job is deleted — there is no send left to move.
    if (row.status === OutreachStatus.canceled) {
      throw new ConflictException('A canceled campaign cannot be rescheduled')
    }
    // A sent row is in scope for the Sent tab's record; its texts are gone.
    if (row.status === OutreachStatus.completed) {
      throw new ConflictException('A sent campaign cannot be rescheduled')
    }
    // Once the send day has begun AND canvassers are booked, Peerly may be
    // mid-send: moving the window under live agents is not recoverable.
    if (
      row.status === OutreachStatus.in_progress &&
      row.canvassRequestedAt !== null
    ) {
      throw new BadRequestException(
        'This campaign is already sending and cannot be rescheduled',
      )
    }
    if (row.campaignId === null) {
      throw new BadRequestException(
        'This campaign is missing its campaign scope and cannot be rescheduled',
      )
    }
    if (!isAfter(input.sendAt, new Date())) {
      throw new BadRequestException('The new send time must be in the future')
    }
    // The two fields must name the same ET calendar day: the DB stores the
    // instant while Peerly's window is set from scheduledLocalDate, so an
    // incoherent pair (possible from a raw M2M caller — the console picker
    // derives both from one input) would permanently split them. Checked
    // here, not in contracts: the timezone authority is server-side.
    if (
      formatInTimeZone(input.sendAt, EASTERN_TIMEZONE, DATE_FMT) !==
      input.scheduledLocalDate
    ) {
      throw new BadRequestException(
        'scheduledLocalDate must match the Eastern calendar day of sendAt',
      )
    }

    const startTime = resolveSendWindowStart(row.scheduledLocalTime)
    await this.peerlyP2pJobService.updateJobSchedule({
      jobId: row.projectId,
      campaignId: row.campaignId,
      date: input.scheduledLocalDate,
      startTime,
      state: row.didState,
    })

    // Re-read the booking flag after the vendor window write: a concurrent
    // approve can book canvassers between the entry read above and here
    // (its claim CAS guards approvedAt, not this flow), and skipping the
    // rebook then would leave Peerly's booking on the old day while the
    // window moved. This narrows the race to the canvasser calls below.
    const requeried = await this.model.findFirstOrThrow({
      where: { id: outreachId },
      select: { canvassRequestedAt: true },
    })
    const wasBooked = requeried.canvassRequestedAt !== null
    if (wasBooked) {
      try {
        await this.peerlyP2pJobService.clearCanvassers(row.projectId)
      } catch (error) {
        // The vendor window already moved but the DB is deliberately left
        // unchanged (vendor-first contract). Retrying the date edit is
        // safe: clearCanvassers no-ops when there is nothing to clear.
        this.logger.error(
          { err: error, outreachId },
          'Reschedule moved the vendor schedule window but could not ' +
            'clear the canvasser booking; retry the date edit to complete ' +
            'the reschedule',
        )
        throw error
      }
      try {
        // The rebook keeps the candidate's chosen wall-clock window start
        // (honor-send-time), same as approve — only the day moved.
        await this.peerlyP2pJobService.requestCanvassers(row.projectId, {
          date: input.scheduledLocalDate,
          startTime,
          state: row.didState,
        })
      } catch (error) {
        // The old booking is already cleared at the vendor and the DB is
        // deliberately left unchanged (vendor-first contract): the row
        // still reads booked, so staff must retry the reschedule (or
        // re-approve) to restore a real booking.
        this.logger.error(
          { err: error, outreachId },
          'Reschedule cleared the canvasser booking but could not rebook ' +
            'the new day; retry the date edit to restore the booking',
        )
        throw error
      }
    }
    this.invalidateVendorReads(row.projectId)

    const edited = await this.model.updateMany({
      where: { id: outreachId, status: { in: REVIEWABLE_STATUSES } },
      data: {
        date: input.sendAt,
        scheduledLocalDate: input.scheduledLocalDate,
        ...(wasBooked && { canvassRequestedAt: new Date() }),
        // Any edit wipes a denial and re-queues (the console convention
        // editScript follows) — a date-edited denied row must not stay
        // parked with approve refusing it.
        deniedAt: null,
        deniedBy: null,
        deniedReason: null,
        adminEditedAt: new Date(),
        adminEditedBy: input.editedBy,
      },
    })
    if (edited.count === 0) {
      this.logger.error(
        `Outreach ${outreachId} advanced past pending during admin ` +
          'reschedule; Peerly has the new window but the row kept the old ' +
          'date — manual reconciliation required',
      )
      throw new ConflictException('This campaign is no longer editable')
    }

    const updated = await this.model.findFirstOrThrow({
      where: { id: outreachId },
      include: queueInclude,
    })
    const registrations = await this.registrationsByCampaign([updated])
    return this.toQueueItem(
      updated,
      registrations.get(updated.campaignId ?? -1),
      null,
    )
  }

  /**
   * Replace a send's Peerly job before it sends (2026-11-02: Peerly flagged
   * a job's sending number as bad and asked CAS to clone the job and submit
   * it again). Makes a new job from what the row already stores (script,
   * image, identity, phone list) through the same submit the purchase
   * finalize uses, on the day picked, cancels the current job, and points
   * the row at the new one, so the send ends with exactly one live job. No
   * money moves: the send was paid once and the payment record is
   * untouched. The row goes back to awaiting review, because approval is
   * what books canvassers on the new job, and CAS can send a test from the
   * new number before it does.
   */
  async replaceJob(
    outreachId: number,
    input: ReplaceSmsOutreachJobRequest,
  ): Promise<SmsApprovalQueueItem> {
    const row = await this.findReplaceableRow(outreachId, input.currentJobId)
    const oldJobId = row.projectId
    // A finished or sending job cannot be canceled, and replacing it would
    // leave two jobs for one send. A send already out is linked instead.
    if (row.status === OutreachStatus.completed) {
      throw new ConflictException(
        'This campaign has already sent, so its job cannot be canceled. If ' +
          'a new job was made in Peerly, link it instead.',
      )
    }
    if (row.status === OutreachStatus.in_progress) {
      const current =
        row.canvassRequestedAt === null
          ? await this.peerlyP2pJobService.findJob(oldJobId)
          : null
      if (
        row.canvassRequestedAt !== null ||
        (current !== null && hasPeerlyCanvassersBooked(current))
      ) {
        throw new BadRequestException(
          'This campaign is already sending, so its job cannot be canceled',
        )
      }
    }
    if (!isAfter(input.sendAt, new Date())) {
      throw new BadRequestException('The new send time must be in the future')
    }
    if (
      formatInTimeZone(input.sendAt, EASTERN_TIMEZONE, DATE_FMT) !==
      input.scheduledLocalDate
    ) {
      throw new BadRequestException(
        'scheduledLocalDate must match the Eastern calendar day of sendAt',
      )
    }

    const claimedAt = await this.claimForReplacement(outreachId, oldJobId)
    const releaseClaim = () =>
      this.model.updateMany({
        where: { id: outreachId, jobReplaceClaimedAt: claimedAt },
        data: { jobReplaceClaimedAt: null },
      })

    // New job first: until canvassers are booked on it, it cannot send, so
    // for this moment two jobs exist but only the old one could go out.
    let newJobId: string
    try {
      newJobId = await this.outreachService.submitDraftToPeerly({
        ...row,
        scheduledLocalDate: input.scheduledLocalDate,
      })
    } catch (err) {
      await releaseClaim()
      throw err
    }

    try {
      await this.peerlyP2pJobService.deleteJob(oldJobId)
    } catch (err) {
      // The old job is still live, so the new one must go: a send never
      // ends with two jobs.
      this.logger.error(
        { err, outreachId, oldJobId, newJobId },
        'Replace job could not cancel the current vendor job; removing the ' +
          'new one',
      )
      await this.deleteOrphanJob(outreachId, newJobId)
      await releaseClaim()
      throw new BadGatewayException(
        'Peerly could not cancel the current job, so nothing changed. Try ' +
          'again.',
      )
    }

    // Back to awaiting review on the new job: every approval stamp belonged
    // to the old one, and a denial no longer describes anything.
    const swapped = await this.swapToReplacementJob(outreachId, {
      oldJobId,
      newJobId,
      claimedAt,
      by: input.replacedBy,
      reason: this.replaceReasonText(input),
      date: input.sendAt,
      scheduledLocalDate: input.scheduledLocalDate,
      bookedAt: null,
    })
    if (!swapped) {
      // Canceled mid-flight, or a stale-claim takeover won: the new job
      // belongs to nothing.
      await this.deleteOrphanJob(outreachId, newJobId)
      throw new ConflictException(
        'This campaign changed while its job was being replaced',
      )
    }

    this.invalidateVendorReads(oldJobId)
    this.invalidateVendorReads(newJobId)
    this.logger.info(
      {
        outreachId,
        oldJobId,
        newJobId,
        replacedBy: input.replacedBy,
        reason: input.reason,
      },
      'CAS replaced the vendor job of an SMS send',
    )
    return this.queueItemFor(outreachId)
  }

  /**
   * The same recovery when staff already made the replacement job by hand
   * in Peerly (cloned it and requested canvassers there): point the row at
   * that job so the sweeps, results and this console follow it. Nothing is
   * written to Peerly. The current job must be finished or gone, so the
   * send still ends with one live job. The phone list stays the row's own:
   * replies map to people through the recipients we captured when it was
   * built, and a hand-uploaded copy of the list holds the same numbers.
   */
  async linkReplacementJob(
    outreachId: number,
    input: LinkSmsOutreachJobRequest,
  ): Promise<SmsApprovalQueueItem> {
    const row = await this.findReplaceableRow(outreachId, input.currentJobId)
    const oldJobId = row.projectId
    const jobId = input.jobId
    if (jobId === oldJobId) {
      throw new BadRequestException(
        'That job is already linked to this campaign',
      )
    }
    const holder = await this.model.findFirst({
      where: { projectId: jobId },
      select: { id: true },
    })
    if (holder) {
      throw new ConflictException(
        `That Peerly job is already linked to campaign ${holder.id}`,
      )
    }

    const job = await this.peerlyP2pJobService.findJob(jobId)
    if (!job || job.status === PeerlyJobStatus.DELETED) {
      throw new BadRequestException('Peerly has no live job with that id')
    }
    if (job.identity_id !== row.identityId) {
      throw new BadRequestException(
        'That Peerly job sends from a different identity than this campaign',
      )
    }
    const current = await this.peerlyP2pJobService.findJob(oldJobId)
    if (
      current &&
      current.status !== PeerlyJobStatus.DELETED &&
      (current.leads_remaining ?? 0) > 0
    ) {
      throw new BadRequestException(
        'The current Peerly job still has texts to send. Cancel it in ' +
          'Peerly first, or replace the job here instead.',
      )
    }

    // The job's own day becomes the row's, so the sweeps anchor on it. A
    // booking made in Peerly stamps nothing on our row, so it is recorded
    // here; an unbooked job goes to awaiting review for approve to book.
    const jobDay = /^\d{4}-\d{2}-\d{2}$/.test(job.start_date ?? '')
      ? job.start_date
      : null
    const booked = hasPeerlyCanvassersBooked(job)
    const claimedAt = await this.claimForReplacement(outreachId, oldJobId)
    const swapped = await this.swapToReplacementJob(outreachId, {
      oldJobId,
      newJobId: jobId,
      claimedAt,
      by: input.linkedBy,
      reason: this.replaceReasonText(input),
      date: jobDay
        ? fromZonedTime(
            `${jobDay}T${row.scheduledLocalTime ?? '09:00'}:00`,
            EASTERN_TIMEZONE,
          )
        : row.date,
      scheduledLocalDate: jobDay ?? row.scheduledLocalDate,
      bookedAt: booked ? claimedAt : null,
    })
    if (!swapped) {
      throw new ConflictException(
        'This campaign changed while the job was being linked',
      )
    }
    this.invalidateVendorReads(oldJobId)
    this.invalidateVendorReads(jobId)
    this.logger.info(
      {
        outreachId,
        oldJobId,
        newJobId: jobId,
        booked,
        linkedBy: input.linkedBy,
        reason: input.reason,
      },
      'CAS linked an SMS send to a replacement vendor job made in Peerly',
    )
    return this.queueItemFor(outreachId)
  }

  private async findReplaceableRow(outreachId: number, currentJobId: string) {
    const row = await this.model.findFirst({
      where: { id: outreachId, ...this.queueWhere() },
      include: queueInclude,
    })
    if (!row || !row.projectId || row.campaignId === null) {
      throw new NotFoundException('Scheduled SMS campaign not found')
    }
    if (row.status === OutreachStatus.canceled) {
      throw new ConflictException('A canceled campaign has no job to replace')
    }
    if (row.projectId !== currentJobId) {
      throw new ConflictException(
        'This campaign is already on a different Peerly job. Reload to see it.',
      )
    }
    return { ...row, projectId: row.projectId }
  }

  private replaceReasonText(input: {
    reason: SmsJobReplaceReason
    otherReason?: string
  }): string {
    return input.reason === 'other' && input.otherReason
      ? input.otherReason
      : SMS_JOB_REPLACE_REASON_LABELS[input.reason]
  }

  // A new job nothing points at. It has no canvassers, so it cannot send,
  // but it must not sit at the vendor either.
  private async deleteOrphanJob(
    outreachId: number,
    jobId: string,
  ): Promise<void> {
    try {
      await this.peerlyP2pJobService.deleteJob(jobId)
    } catch (err) {
      this.logger.error(
        { err, outreachId, jobId },
        'Replace job could not remove a vendor job nothing points at; ' +
          'delete it by hand in Peerly',
      )
    }
  }

  // Claimed before any vendor write, so a double click or a retry while the
  // first request is still working is refused rather than making a second
  // job. A claim older than the stale window belongs to a request that died.
  private async claimForReplacement(
    outreachId: number,
    oldJobId: string,
  ): Promise<Date> {
    const claimedAt = new Date()
    const claimed = await this.model.updateMany({
      where: {
        id: outreachId,
        projectId: oldJobId,
        status: { not: OutreachStatus.canceled },
        OR: [
          { jobReplaceClaimedAt: null },
          {
            jobReplaceClaimedAt: {
              lt: subMilliseconds(claimedAt, jobReplaceClaimStaleMs()),
            },
          },
        ],
      },
      data: { jobReplaceClaimedAt: claimedAt },
    })
    if (claimed.count === 0) {
      throw new ConflictException(
        'This campaign is already having its job replaced',
      )
    }
    return claimedAt
  }

  // The status returns to pending so the completion sweep and the inbound
  // sweep follow the new job from its own send day.
  private async swapToReplacementJob(
    outreachId: number,
    swap: {
      oldJobId: string
      newJobId: string
      claimedAt: Date
      by: string
      reason: string
      date: Date | null
      scheduledLocalDate: string | null
      bookedAt: Date | null
    },
  ): Promise<boolean> {
    const swapped = await this.model.updateMany({
      where: {
        id: outreachId,
        projectId: swap.oldJobId,
        jobReplaceClaimedAt: swap.claimedAt,
        status: { not: OutreachStatus.canceled },
      },
      data: {
        projectId: swap.newJobId,
        status: OutreachStatus.pending,
        date: swap.date,
        scheduledLocalDate: swap.scheduledLocalDate,
        approvedAt: swap.bookedAt,
        approvedBy: swap.bookedAt ? swap.by : null,
        canvassRequestedAt: swap.bookedAt,
        deniedAt: null,
        deniedBy: null,
        deniedReason: null,
        jobReplacedAt: swap.claimedAt,
        jobReplacedBy: swap.by,
        previousJobId: swap.oldJobId,
        jobReplaceReason: swap.reason,
        jobReplaceClaimedAt: null,
      },
    })
    return swapped.count > 0
  }

  private async queueItemFor(outreachId: number) {
    const updated = await this.model.findFirstOrThrow({
      where: { id: outreachId },
      include: queueInclude,
    })
    const registrations = await this.registrationsByCampaign([updated])
    return this.toQueueItem(
      updated,
      registrations.get(updated.campaignId ?? -1),
      null,
    )
  }

  /**
   * CAS's pre-approval check: send the campaign's live template to the
   * reviewer's own handset, the way Peerly's platform "send test" button
   * does. Create a fresh test job on the real job for every send (see
   * below for why one is never reused) AND the identity's Peerly test
   * list holding the typed number (Peerly only texts a number that sits on
   * one, and names the list in the send), then fire the test text to ONLY
   * the explicitly typed phone — never a number derived from campaign or
   * contact data. Nothing we cache changes, so no invalidateVendorReads.
   */
  async sendTestMessage(
    outreachId: number,
    input: SmsTestMessageRequest,
  ): Promise<SmsTestMessageResponse> {
    const phone = this.normalizeUsPhone(input.phone)
    const row = await this.findFirst({
      where: { id: outreachId, ...this.queueWhere() },
    })
    if (!row || !row.projectId) {
      throw new NotFoundException('Scheduled SMS campaign not found')
    }
    // A canceled row is in queue scope for the audit trail, but its
    // vendor job was deleted with the cancel — nothing exists to test.
    if (row.status === OutreachStatus.canceled) {
      throw new BadRequestException(
        'This campaign was canceled and its vendor job deleted',
      )
    }
    // A sent row is in scope for the Sent tab's record; there is nothing
    // left to preview.
    if (row.status === OutreachStatus.completed) {
      throw new BadRequestException('This campaign has already sent')
    }
    // The test list Peerly sends to lives inside the campaign's identity,
    // so a row whose job predates identity capture cannot be tested.
    if (!row.identityId) {
      throw new BadRequestException(
        'This campaign has no Peerly identity recorded, so a test cannot ' +
          'be sent',
      )
    }

    // Claim BEFORE the vendor calls so a double-click's second request is
    // refused rather than racing the first to two texts; released on a
    // vendor failure so a real error stays retryable immediately.
    const now = Date.now()
    for (const [id, claimedAt] of this.testSendClaims) {
      if (now - claimedAt >= testSendCooldownMs()) {
        this.testSendClaims.delete(id)
      }
    }
    const claimedAt = this.testSendClaims.get(outreachId)
    if (claimedAt !== undefined && now - claimedAt < testSendCooldownMs()) {
      throw new ConflictException(
        'A test was just sent for this campaign — wait a moment before ' +
          'sending another',
      )
    }
    this.testSendClaims.set(outreachId, now)

    try {
      const testListId = await this.peerlyTestListService.resolveTestListId({
        identityId: row.identityId,
        phone,
      })
      // A fresh test job every send, never a reused one: Peerly clones the
      // parent job's content when the test job is created, so a reused one
      // shows the script as it was before an edit, and each send records the
      // number as a lead on it, so a second test to the same number is
      // refused with "Lead already exists" (Peerly, 2026-11-06).
      const testJobId = await this.peerlyP2pJobService.createTestJob(
        row.projectId,
      )
      await this.peerlyP2pJobService.sendTestMessage(
        testJobId,
        phone,
        testListId,
      )
    } catch (error) {
      this.testSendClaims.delete(outreachId)
      throw error
    }
    return { sent: true }
  }

  // Peerly's test send takes the national 10-digit form ("3217891234").
  private normalizeUsPhone(raw: string): string {
    const digits = raw.replace(/\D/g, '')
    const national =
      digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
    if (national.length !== 10) {
      throw new BadRequestException(
        'Enter a US phone number: 10 digits, or 11 starting with 1',
      )
    }
    return national
  }

  private async registrationsByCampaign(
    rows: QueueRow[],
  ): Promise<Map<number, RegistrationNames>> {
    const campaignIds = [
      ...new Set(
        rows
          .map((row) => row.campaignId)
          .filter((id): id is number => id !== null),
      ),
    ]
    if (campaignIds.length === 0) return new Map()
    const records = await this.client.tcrCompliance.findMany({
      where: { campaignId: { in: campaignIds } },
      select: { campaignId: true, committeeName: true, candidateName: true },
    })
    return new Map(
      records.map((r) => [
        r.campaignId,
        { candidateName: r.candidateName, committeeName: r.committeeName },
      ]),
    )
  }

  // The HubSpot company owner is the campaign's assigned success person.
  // Live CRM reads, so strictly best-effort: any failure renders the row
  // with assignedPa null rather than failing the queue.
  private async ownersByCampaign(
    rows: QueueRow[],
  ): Promise<Map<number, string | null>> {
    const byCampaign = new Map<number, string | null>()
    const campaigns = new Map<number, QueueRow['campaign']>()
    for (const row of rows) {
      if (row.campaignId !== null && row.campaign) {
        campaigns.set(row.campaignId, row.campaign)
      }
    }
    // One batched HubSpot read per view, cached + single-flighted per
    // company: a read per company blew through HubSpot's 190 requests/10s
    // limit on a cold queue, and every 429 rendered as Unassigned for the
    // full owner TTL. A cache miss's produce only queues its id; the batch
    // is released after the synchronous loop, so it holds exactly the ids
    // whose produce ran. Don't pre-check ownerCache here instead:
    // singleFlightCached sweeps expired entries itself, and an id it
    // treats as a miss but the batch skipped would read as failed.
    const toRead: string[] = []
    let releaseBatch!: (read: Promise<Map<string, string | null>>) => void
    const batch = new Promise<Map<string, string | null>>((resolve) => {
      releaseBatch = resolve
    }).catch((err: Error) => {
      this.logger.warn(
        { err, companyCount: toRead.length },
        'Admin queue: HubSpot owner read failed; rendering unassigned',
      )
      return null
    })
    const reads = [...campaigns].map(([campaignId, campaign]) => {
      const hubspotId = campaign?.data?.hubspotId
      if (!hubspotId) return Promise.resolve({ campaignId, owner: null })
      return this.boundedRead(
        this.singleFlightCached(
          this.ownerCache,
          this.ownerInFlight,
          hubspotId,
          (value) => !value.ok,
          () => {
            toRead.push(hubspotId)
            return batch.then((names) =>
              names?.has(hubspotId)
                ? { ok: true, name: names.get(hubspotId) ?? null }
                : { ok: false, name: null },
            )
          },
          ownerCacheTtlMs(),
        ),
      ).then((owner) => ({ campaignId, owner }))
    })
    releaseBatch(
      toRead.length > 0
        ? this.crmCampaigns.getCrmCompanyOwnerNames(toRead)
        : Promise.resolve(new Map<string, string | null>()),
    )
    for (const { campaignId, owner } of await Promise.all(reads)) {
      byCampaign.set(campaignId, owner?.name ?? null)
    }
    return byCampaign
  }

  // One vendor list-read per identity, never per row; a failed identity
  // renders its rows with job: null rather than failing the queue.
  private async liveJobsFor(rows: QueueRow[]): Promise<Map<string, PeerlyJob>> {
    // A canceled row's vendor job was deleted with the cancel — a read
    // for it can only fail, and a queue of only canceled rows needs none.
    // Any non-canceled reviewable row (pending or in_progress — the sweep
    // ratchet, see REVIEWABLE_STATUSES) still has a live job to read.
    const wantsJobs = rows.some((row) => row.status !== OutreachStatus.canceled)
    const byProjectId = new Map<string, PeerlyJob>()
    if (!wantsJobs) return byProjectId
    // One account-wide read replaces the old per-identity fan-out
    // (identity_id is only an optional filter on GET /1to1/jobs): the
    // queue's Peerly cost is a single sub-second call, single-flighted +
    // cached so a detail-then-back navigation inside the TTL pays nothing.
    const jobs = await this.boundedRead(
      this.singleFlightCached(
        this.accountJobsCache,
        this.accountJobsInFlight,
        ACCOUNT_JOBS_KEY,
        (value) => value === null,
        () =>
          this.loggedVendorRead(
            'account_jobs',
            {},
            this.peerlyP2pJobService.listAccountJobs(),
          ),
        queueJobsCacheTtlMs(),
      ),
    )
    for (const job of jobs ?? []) {
      byProjectId.set(job.id, job)
    }
    return byProjectId
  }

  /**
   * Every vendor read on the console goes through here so prod slowness
   * is diagnosable from Loki alone: one line per read with its label,
   * elapsed ms, and outcome — success included, since a read creeping
   * toward the timebox is invisible in the request's total time. The
   * vendor layer's own per-request logs are debug-level, which prod
   * does not emit.
   */
  private async loggedVendorRead<T>(
    read: string,
    context: Record<string, number | string>,
    vendorRead: Promise<T>,
  ): Promise<T | null> {
    const startedAt = performance.now()
    try {
      const result = await vendorRead
      this.logger.info(
        {
          ...context,
          read,
          elapsedMs: Math.round(performance.now() - startedAt),
          outcome: 'ok',
        },
        'Admin console vendor read',
      )
      return result
    } catch (err) {
      this.logger.warn(
        {
          err,
          ...context,
          read,
          elapsedMs: Math.round(performance.now() - startedAt),
          outcome: 'failed',
        },
        'Admin console vendor read failed; rendering without it',
      )
      return null
    }
  }

  /**
   * Single-flight + short-TTL cache + cool-off for a per-jobId vendor read,
   * used by getDetail's live-job and detailed-stats reads. `cache`/`inFlight`
   * are the caller's own maps (kept separate per read so an in-flight job
   * read never blocks on a slow stats read, or vice versa); `key` is the
   * Peerly jobId.
   *
   * A cache hit or an already-in-flight read short-circuits below with no
   * new vendor call — that's the single-flight/cache half of the contract.
   * Otherwise a fresh read is fired and registered in `inFlight` BEFORE any
   * `await` in this function, so two callers racing for the same key can
   * never both pass the checks above and both fire a vendor read. Its
   * settle-time cache write is guarded on `startedAt` still matching the
   * live `inFlight` entry, so a read abandoned by the sweep below (Peerly
   * never answered within the 10-minute cool-off) can't clobber a newer
   * attempt's result if it eventually does answer.
   */
  private singleFlightCached<T>(
    cache: Map<string, DetailCacheEntry<T>>,
    inFlight: Map<string, DetailInFlightEntry<T>>,
    key: string,
    isFailure: (value: T) => boolean,
    produce: () => Promise<T>,
    ttlMs: number = DETAIL_CACHE_TTL_MS,
  ): Promise<T> {
    this.sweepStaleEntries(cache, inFlight)

    const cached = cache.get(key)
    if (cached) return Promise.resolve(cached.value)

    const existing = inFlight.get(key)
    if (existing) return existing.promise

    const startedAt = Date.now()
    const promise = produce().then((value) => {
      const current = inFlight.get(key)
      if (current?.startedAt === startedAt) {
        inFlight.delete(key)
        cache.set(key, {
          value,
          expiresAt:
            Date.now() +
            (isFailure(value) ? detailFailedRetryCooldownMs() : ttlMs),
        })
      }
      return value
    })
    inFlight.set(key, { promise, startedAt })
    return promise
  }

  // Bounds every OTHER key's stale bookkeeping too (not just the one this
  // call is about), so the maps stay sized to currently-relevant jobs
  // instead of growing for the life of the process.
  private sweepStaleEntries<T>(
    cache: Map<string, DetailCacheEntry<T>>,
    inFlight: Map<string, DetailInFlightEntry<T>>,
  ): void {
    const now = Date.now()
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key)
    }
    for (const [key, entry] of inFlight) {
      if (now - entry.startedAt >= detailOutstandingRetryCooldownMs()) {
        inFlight.delete(key)
      }
    }
  }

  // Bounds how long THIS getDetail call waits on a single-flighted read —
  // the shared read itself (registered in inFlight above) keeps running
  // regardless, so a page view that times out here never spawns a
  // duplicate; it just renders without this field until a later call picks
  // up the now-cached (or still-shared) result.
  // A mutation that changes vendor state (booking + activation on
  // approve, template overwrite on edit, job delete on cancel) drops the
  // caches that could echo the pre-mutation answer, so the refresh
  // gp-admin fires right after an action reads fresh instead of serving
  // a stale entry for the rest of its TTL. In-flight reads are left
  // registered — single-flight, not correctness.
  private invalidateVendorReads(jobId: string): void {
    this.jobCache.delete(jobId)
    this.statsCache.delete(jobId)
    this.accountJobsCache.delete(ACCOUNT_JOBS_KEY)
  }

  private boundedRead<T>(read: Promise<T | null>): Promise<T | null> {
    return Promise.race([
      read,
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), vendorReadTimeoutMs())
        timer.unref?.()
      }),
    ])
  }

  private toQueueItem(
    row: QueueRow,
    registration: RegistrationNames | undefined,
    job: PeerlyJob | null,
    assignedPa: string | null = null,
  ): SmsApprovalQueueItem {
    const user = row.campaign?.user ?? null
    const candidateName = user
      ? `${(user.firstName ?? '').trim()} ${(user.lastName ?? '').trim()}`.trim() ||
        null
      : null
    const candidateNames = [candidateName, registration?.candidateName].filter(
      (name): name is string => !!name,
    )
    return {
      id: row.id,
      campaignId: row.campaignId ?? -1,
      campaignSlug: row.campaign?.slug ?? '',
      candidateName,
      assignedPa,
      name: row.name,
      createdAt: row.createdAt,
      sendAt: row.date,
      scheduledLocalDate: row.scheduledLocalDate,
      scheduledLocalTime: row.scheduledLocalTime,
      script: row.script,
      imageUrl: row.imageUrl,
      textCount: row.textCount,
      billableTextCount: row.billableTextCount,
      paid: row.stripeCheckoutSessionId !== null,
      approvalStatus: this.deriveStatus(row, job),
      approvedAt: row.approvedAt,
      approvedBy: row.approvedBy,
      deniedAt: row.deniedAt,
      deniedBy: row.deniedBy,
      deniedReason: row.deniedReason,
      canvassRequestedAt: row.canvassRequestedAt,
      adminEditedAt: row.adminEditedAt,
      adminEditedBy: row.adminEditedBy,
      candidateEditedAt: row.candidateEditedAt,
      canceledAt: row.canceledAt,
      canceledBy: row.canceledBy,
      canceledByAdmin: row.canceledByAdmin,
      jobReplacedAt: row.jobReplacedAt,
      jobReplacedBy: row.jobReplacedBy,
      previousJobId: row.previousJobId,
      jobId: row.projectId,
      jobReplaceReason: row.jobReplaceReason,
      standards: row.script
        ? checkSmsStandards(row.script, {
            candidateNames,
            committeeName: registration?.committeeName ?? null,
          })
        : null,
      job: job
        ? {
            status: job.status,
            deliverabilityCheckError: job.deliverability_check_error ?? null,
            hasCanvassersScheduled: job.has_canvassers_scheduled,
            peerlyApproved: job.canvassers_schedule?.approved ?? null,
            leadsRemaining: job.leads_remaining ?? null,
          }
        : null,
    }
  }

  private deriveStatus(
    row: QueueRow,
    job: PeerlyJob | null,
  ): SmsApprovalStatus {
    if (row.status === OutreachStatus.canceled) return 'canceled'
    if (row.status === OutreachStatus.completed) return 'sent'
    if (row.deniedAt) return 'denied'
    if (job?.canvassers_schedule?.approved) return 'peerly_approved'
    if (row.canvassRequestedAt) return 'canvass_requested'
    return 'awaiting_review'
  }

  // The CAS-facing reason a hold-model send is not yet approvable, keyed by
  // the satellite's settle state so the console shows whether to wait or stop.
  private holdBlockMessage(state: P2pSmsSettleState): string {
    switch (state) {
      case P2pSmsSettleState.capturing:
        return (
          'The payment for this campaign is still being captured — try ' +
          'again shortly once it settles'
        )
      case P2pSmsSettleState.voided:
      case P2pSmsSettleState.hold_failed:
      case P2pSmsSettleState.refunded:
        return 'The payment for this campaign did not complete, so it cannot be sent'
      default:
        return 'The payment for this campaign has not been captured yet, so it cannot be sent'
    }
  }

  private async tryTrack(
    userId: number,
    event: string,
    properties: Record<string, string>,
  ) {
    try {
      await this.analytics.track(userId, event, properties)
    } catch (err) {
      this.logger.error({ err, event }, 'CAS console analytics track failed')
    }
  }
}
