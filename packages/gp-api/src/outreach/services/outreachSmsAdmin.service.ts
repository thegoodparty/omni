import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  checkSmsStandards,
  type ApproveSmsOutreachRequest,
  type CancelSmsOutreachRequest,
  type DenySmsOutreachRequest,
  type EditSmsOutreachDateRequest,
  type EditSmsOutreachRequest,
  type SmsAdminDetailResponse,
  type SmsAdminJobStats,
  type SmsApprovalQueueItem,
  type SmsApprovalStatus,
  type SmsTestMessageRequest,
  type SmsTestMessageResponse,
} from '@goodparty_org/contracts'
import { addDays, format, isAfter, subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { EASTERN_TIMEZONE } from 'src/shared/util/date.util'
import { OutreachStatus, OutreachType, Prisma } from '../../generated/prisma'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { PeerlyP2pJobService } from 'src/vendors/peerly/services/peerlyP2pJob.service'
import { OutreachService } from './outreach.service'
import { OutreachNotificationService } from './outreachNotification.service'
import { PeerlyJob } from 'src/vendors/peerly/peerly.types'
import { resolveSendWindowStart } from 'src/vendors/peerly/utils/sendWindowStart.util'
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

// The whole account's job list is one cache entry.
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
    private readonly analytics: AnalyticsService,
    private readonly crmCampaigns: CrmCampaignsService,
    private readonly s3: S3Service,
    private readonly outreachService: OutreachService,
    private readonly notifications: OutreachNotificationService,
  ) {
    super()
  }

  private queueWhere(): Prisma.OutreachWhereInput {
    return {
      outreachType: OutreachType.p2p,
      // Canceled rows stay visible (the Canceled tab's audit trail); only
      // reviewable rows are actionable.
      status: { in: [...REVIEWABLE_STATUSES, OutreachStatus.canceled] },
      projectId: { not: null },
      // The pre-console backlog is noise, not work: rows stranded pending
      // from before the console existed are hidden behind a fixed cutoff
      // (CAS request, 2026-09-09). Dateless rows stay visible — a pending
      // row with no send date is an anomaly worth seeing, not backlog.
      OR: [{ date: null }, { date: { gte: SMS_ADMIN_QUEUE_CUTOFF } }],
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
   * promo restore) with staff attribution. The past-send-time guard
   * inside cancelOutreach applies to staff too — a mid-send vendor
   * delete is a mess regardless of who clicks — but only for a booked
   * send; an unbooked row past its date never sends and stays cancelable.
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

    const claimed = await this.model.updateMany({
      where: {
        id: outreachId,
        status: { in: REVIEWABLE_STATUSES },
        approvedAt: null,
        deniedAt: null,
      },
      data: { approvedAt: new Date(), approvedBy: input.approvedBy },
    })
    if (claimed.count === 0) {
      throw new ConflictException('This campaign was just decided elsewhere')
    }

    const startTime = resolveSendWindowStart(row.scheduledLocalTime)
    try {
      await this.peerlyP2pJobService.requestCanvassers(row.projectId, {
        date: row.scheduledLocalDate ?? undefined,
        startTime,
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
        { channel: 'sms' },
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

    // Peerly's template update is a destructive overwrite, so it always
    // needs the image bytes — a script-only edit re-sends the stored one.
    if (!row.imageUrl) {
      throw new BadRequestException(
        'This campaign has no stored image; it must be edited by the candidate',
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
      scriptText: input.script,
      identityId: row.identityId,
      name: row.name ?? undefined,
    })
    this.invalidateVendorReads(row.projectId)

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
   * CAS's pre-approval check: send the campaign's live template to the
   * reviewer's own handset, the way Peerly's platform "send test" button
   * does. Find-or-create the job's test job (reused across clicks —
   * every test job is a real vendor object), then fire the test text to
   * ONLY the explicitly typed phone — never a number derived from
   * campaign or contact data. Nothing we cache changes, so no
   * invalidateVendorReads.
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
      const existingTestJobIds = await this.peerlyP2pJobService.listTestJobIds(
        row.projectId,
      )
      const testJobId =
        existingTestJobIds[0] ??
        (await this.peerlyP2pJobService.createTestJob(row.projectId))
      await this.peerlyP2pJobService.sendTestMessage(testJobId, phone)
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
    // Parallel + cached per company: the old serial loop paid two HubSpot
    // round trips per campaign on every queue view — with a full queue,
    // the dominant page cost (QA 2026-09-09). Each read is single-flighted
    // and bounded like the Peerly reads, so a stalling CRM can't hold the
    // queue either.
    await Promise.all(
      [...campaigns].map(async ([campaignId, campaign]) => {
        const hubspotId = campaign?.data?.hubspotId
        if (!hubspotId) {
          byCampaign.set(campaignId, null)
          return
        }
        const owner = await this.boundedRead(
          this.singleFlightCached(
            this.ownerCache,
            this.ownerInFlight,
            hubspotId,
            (value) => !value.ok,
            async () => {
              try {
                const name =
                  await this.crmCampaigns.getCrmCompanyOwnerName(hubspotId)
                return { ok: true, name: name?.trim() ? name.trim() : null }
              } catch (err) {
                this.logger.warn(
                  { err, campaignId },
                  'Admin queue: HubSpot owner read failed; rendering ' +
                    'unassigned',
                )
                return { ok: false, name: null }
              }
            },
            ownerCacheTtlMs(),
          ),
        )
        byCampaign.set(campaignId, owner?.name ?? null)
      }),
    )
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
      canceledAt: row.canceledAt,
      canceledBy: row.canceledBy,
      canceledByAdmin: row.canceledByAdmin,
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
    if (row.deniedAt) return 'denied'
    if (job?.canvassers_schedule?.approved) return 'peerly_approved'
    if (row.canvassRequestedAt) return 'canvass_requested'
    return 'awaiting_review'
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
