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
  type EditSmsOutreachRequest,
  type SmsAdminDetailResponse,
  type SmsAdminJobStats,
  type SmsApprovalQueueItem,
  type SmsApprovalStatus,
} from '@goodparty_org/contracts'
import { addDays, format, subDays } from 'date-fns'
import { OutreachStatus, OutreachType, Prisma } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { PeerlyP2pJobService } from 'src/vendors/peerly/services/peerlyP2pJob.service'
import { OutreachService } from './outreach.service'
import { PeerlyJob } from 'src/vendors/peerly/peerly.types'
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
// detailedstats responses on the shared test account. Every live read is
// timeboxed so a stalling vendor can never hold the queue or review page.
// A function (not a plain const), read at call time, so tests can shrink it
// via env instead of waiting out a real 10s bound — same pattern as
// ordinanceDispatch.service.ts's ORDINANCE_RESOLVE_TIMEOUT_MS.
const vendorReadTimeoutMs = () =>
  Number(process.env.VENDOR_READ_TIMEOUT_MS ?? 10_000)

const timeboxed = <T>(read: Promise<T>): Promise<T> => {
  // A read that loses the race is abandoned, not cancelled — hold its
  // eventual rejection so it can't surface as an unhandled rejection.
  void read.catch(() => undefined)
  return Promise.race([
    read,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Peerly read exceeded the timebox')),
        vendorReadTimeoutMs(),
      )
      timer.unref?.()
    }),
  ])
}

const DATE_FMT = 'yyyy-MM-dd'

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
// Functions, not plain consts — same reason as vendorReadTimeoutMs() above:
// tests shrink these via env rather than waiting out the real cool-offs.
const detailFailedRetryCooldownMs = () =>
  Number(process.env.DETAIL_FAILED_RETRY_COOLDOWN_MS ?? 60_000)
const detailOutstandingRetryCooldownMs = () =>
  Number(process.env.DETAIL_OUTSTANDING_RETRY_COOLDOWN_MS ?? 10 * 60 * 1000)

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

  constructor(
    private readonly peerlyP2pJobService: PeerlyP2pJobService,
    private readonly analytics: AnalyticsService,
    private readonly crmCampaigns: CrmCampaignsService,
    private readonly s3: S3Service,
    private readonly outreachService: OutreachService,
  ) {
    super()
  }

  private queueWhere(): Prisma.OutreachWhereInput {
    return {
      outreachType: OutreachType.p2p,
      // Canceled rows stay visible (the Canceled tab's audit trail); only
      // pending rows are actionable.
      status: { in: [OutreachStatus.pending, OutreachStatus.canceled] },
      projectId: { not: null },
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
   * delete is a mess regardless of who clicks.
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
      row.status !== OutreachStatus.pending ||
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
        status: OutreachStatus.pending,
        approvedAt: null,
        deniedAt: null,
      },
      data: { approvedAt: new Date(), approvedBy: input.approvedBy },
    })
    if (claimed.count === 0) {
      throw new ConflictException('This campaign was just decided elsewhere')
    }

    try {
      await this.peerlyP2pJobService.requestCanvassers(row.projectId, {
        date: row.scheduledLocalDate ?? undefined,
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

    const registrations = await this.registrationsByCampaign([updated])
    if (updated.campaign?.user) {
      await this.tryTrack(
        updated.campaign.user.id,
        'Voter Outreach - Campaign Approved',
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
        status: OutreachStatus.pending,
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
    if (row.status !== OutreachStatus.pending) {
      throw new BadRequestException('Only scheduled campaigns can be edited')
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

    const edited = await this.model.updateMany({
      where: { id: outreachId, status: OutreachStatus.pending },
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
    for (const [campaignId, campaign] of campaigns) {
      const hubspotId = campaign?.data?.hubspotId
      if (!hubspotId) {
        byCampaign.set(campaignId, null)
        continue
      }
      try {
        const name = await this.crmCampaigns.getCrmCompanyOwnerName(hubspotId)
        byCampaign.set(campaignId, name?.trim() ? name.trim() : null)
      } catch (err) {
        this.logger.warn(
          { err, campaignId },
          'Admin queue: HubSpot owner read failed; rendering unassigned',
        )
        byCampaign.set(campaignId, null)
      }
    }
    return byCampaign
  }

  // One vendor list-read per identity, never per row; a failed identity
  // renders its rows with job: null rather than failing the queue.
  private async liveJobsFor(rows: QueueRow[]): Promise<Map<string, PeerlyJob>> {
    const identityIds = [
      ...new Set(
        rows
          // A canceled row's vendor job was deleted with the cancel — a
          // read for it can only fail.
          .filter((row) => row.status === OutreachStatus.pending)
          .map((row) => row.identityId)
          .filter((id): id is string => id !== null),
      ),
    ]
    const byProjectId = new Map<string, PeerlyJob>()
    // Parallel so the queue waits one timebox total, not one per identity.
    const reads = await Promise.all(
      identityIds.map((identityId) =>
        this.timedVendorRead(
          'jobs_by_identity',
          { identityId },
          this.peerlyP2pJobService.getJobsByIdentityId(identityId),
        ),
      ),
    )
    for (const jobs of reads) {
      for (const job of jobs ?? []) {
        byProjectId.set(job.id, job)
      }
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

  // Used by the queue listing's per-identity reads, which aren't part of the
  // single-flight/cache layer below (one read per identity per queue page,
  // not per row per page view — not the pattern Peerly flagged).
  private timedVendorRead<T>(
    read: string,
    context: Record<string, number | string>,
    vendorRead: Promise<T>,
  ): Promise<T | null> {
    return this.loggedVendorRead(read, context, timeboxed(vendorRead))
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
            (isFailure(value)
              ? detailFailedRetryCooldownMs()
              : DETAIL_CACHE_TTL_MS),
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
