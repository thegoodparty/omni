import { Injectable, NotFoundException } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { formatInTimeZone } from 'date-fns-tz'
import { setTimeout as sleep } from 'timers/promises'
import {
  Campaign,
  Prisma,
  TcrCompliance,
  TcrComplianceStatus,
  User,
} from '../../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { QueueProducerService } from '../../../queue/producer/queueProducer.service'
import {
  CvStatusPollMessage,
  MessageGroup,
  QueueType,
} from '../../../queue/queue.types'
import { EASTERN_TIMEZONE } from '../../../shared/util/date.util'
import { INTERNAL_EMAIL_SUFFIXES } from '../../../users/util/users.util'
import { PeerlyCvVerificationStatus } from '../../../vendors/peerly/peerly.types'
import { PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE } from '../../../vendors/peerly/services/peerly.const'
import { PeerlyIdentityService } from '../../../vendors/peerly/services/peerlyIdentity.service'
import { CampaignTcrComplianceService } from './campaignTcrCompliance.service'

// The scan owns every scheduled Peerly retrieve_cv read. Cadence, set size,
// and pacing were agreed with Peerly (James/Patrick, 2026-08-17): poll only
// identities still awaiting a CV transition, twice a day, at an absolute rate
// of 1 retrieve_cv call per minute across all identities. Both prod replicas'
// crons fire; the slot-keyed FIFO deduplicationId collapses them to one
// handled message (nightly10DlcReport pattern), so exactly one replica scans.
const CV_STATUS_SCAN_CRON = '0 8,20 * * *'

// ET date-hour of the cron slot — both the FIFO deduplicationId suffix and
// the log correlation key.
const SCAN_SLOT_FORMAT = 'yyyy-MM-dd-HH'

// Peerly's requested absolute rate limit for retrieve_cv: 1 call/minute
// regardless of identity (60 identities take 60 minutes). Env-overridable so
// tests can zero it out; `parseInt(x) || default` so a non-numeric value
// falls back instead of NaN reaching sleep().
const RETRIEVE_CV_SPACING_MS =
  parseInt(process.env.CV_SCAN_RETRIEVE_SPACING_MS ?? '') || 60_000

// getProfile is not rate-limited; this spacing only keeps the profile pass
// from bursting (matches the old nightly-poll spacing).
const PROFILE_READ_SPACING_MS =
  parseInt(process.env.CV_SCAN_PROFILE_SPACING_MS ?? '') || 350

// At 1 call/minute a full-cap CV pass takes ~5 hours — comfortably inside the
// 12-hour slot. The steady-state in-flight set is a few dozen records; the
// cap is a runaway backstop, and records past it (oldest-touched poll first)
// get their turn next slot.
const SCAN_RECORD_CAP = 300

// Only Pro, non-internal registrations are live Peerly work — pre-payment
// records sit idle by design and staff walk-throughs are noise (mirrors the
// nightly report's scoping).
const scannableCampaign = {
  isPro: true,
  user: {
    NOT: INTERNAL_EMAIL_SUFFIXES.map((suffix) => ({
      email: { endsWith: suffix, mode: Prisma.QueryMode.insensitive },
    })),
  },
}

type RecordWithCampaignUser = TcrCompliance & {
  campaign: Campaign & { user: User | null }
}

@Injectable()
export class CvStatusPollService extends createPrismaBase(
  MODELS.TcrCompliance,
) {
  constructor(
    private readonly queueService: QueueProducerService,
    private readonly peerlyIdentityService: PeerlyIdentityService,
    private readonly tcrComplianceService: CampaignTcrComplianceService,
  ) {
    super()
  }

  // Fixed wall-clock cron (an @Interval resets on every deploy and drifts
  // apart across replicas, which is how the old hourly sweeps double-polled
  // every identity).
  @Cron(CV_STATUS_SCAN_CRON, {
    name: 'cvStatusPollScan',
    timeZone: EASTERN_TIMEZONE,
  })
  async triggerScan() {
    // Prod-only (mirrors triggerNightlyReport): dev/qa would run real
    // retrieve_cv calls against their own SQS queue, and every call counts
    // against the vendor budget this scan exists to respect. Non-prod Peerly
    // flows are stubbed anyway, so there is nothing meaningful to poll.
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') {
      return
    }
    const scanKey = formatInTimeZone(
      new Date(),
      EASTERN_TIMEZONE,
      SCAN_SLOT_FORMAT,
    )
    try {
      await this.queueService.sendMessage(
        {
          type: QueueType.CV_STATUS_POLL,
          data: { scanKey },
        },
        MessageGroup.cvStatusPoll,
        {
          deduplicationId: `cvStatusPoll-${scanKey}`,
          throwOnError: true,
        },
      )
    } catch (err) {
      this.logger.error(
        { err, scanKey },
        '[CV status scan] Failed to enqueue scan message',
      )
    }
  }

  // Called by the queue consumer. The paced scan (~1 minute per record)
  // cannot be awaited here: it would outlive the SQS visibility timeout
  // (300s, deploy/index.ts) and redeliver mid-run, spawning a duplicate
  // concurrent scan — the exact bulk-read behavior this service exists to
  // remove. So the handler acks immediately and the scan runs detached; a
  // process restart mid-scan leaves the tail for the next slot (records are
  // polled oldest-touched first, so the tail is not starved).
  handleCvStatusPoll({ scanKey }: CvStatusPollMessage): boolean {
    void this.runScan(scanKey).catch((err: Error) =>
      this.logger.error({ err, scanKey }, '[CV status scan] Scan failed'),
    )
    return true
  }

  async runScan(scanKey: string) {
    // Pre-VERIFIED, non-terminal registrations are the only identities a
    // retrieve_cv read can still move: null (submitted, no status observed
    // yet — a persisting null past the first scan is a dropped submission,
    // surfaced by the nightly report's case-1 section), REQUESTED/IN_REVIEW
    // (waiting on CV), and APPROVED (PIN issued, awaiting entry — the read
    // also carries the PIN delivery channel and catches late rejections).
    // VERIFIED and rejected/withdrawn records never re-enter the set:
    // everything after VERIFIED is tracked via getProfile below.
    const cvCandidates: RecordWithCampaignUser[] = await this.model.findMany({
      where: {
        campaign: scannableCampaign,
        peerlyIdentityId: { not: null },
        status: {
          in: [TcrComplianceStatus.submitted, TcrComplianceStatus.pending],
        },
        OR: [
          { peerlyCvStatus: null },
          {
            peerlyCvStatus: {
              in: [
                PeerlyCvVerificationStatus.REQUESTED,
                PeerlyCvVerificationStatus.IN_REVIEW,
                PeerlyCvVerificationStatus.APPROVED,
              ],
            },
          },
        ],
      },
      include: { campaign: { include: { user: true } } },
      orderBy: { updatedAt: Prisma.SortOrder.asc },
    })
    if (cvCandidates.length > SCAN_RECORD_CAP) {
      this.logger.warn(
        { total: cvCandidates.length, polled: SCAN_RECORD_CAP, scanKey },
        '[CV status scan] In-flight backlog exceeds per-scan cap',
      )
    }
    for (const record of cvCandidates.slice(0, SCAN_RECORD_CAP)) {
      try {
        await this.pollCvRecord(record)
      } catch (err) {
        this.logger.error(
          { err, tcrComplianceId: record.id, scanKey },
          '[CV status scan] CV poll failed for record',
        )
      }
      await sleep(RETRIEVE_CV_SPACING_MS)
    }

    // VERIFIED in-flight records still need their identity-profile state
    // tracked (case 3a/3b stall detection + finalize escalation), but never
    // another retrieve_cv read. Queried after the CV pass so a record that
    // just reached VERIFIED gets its first profile read in the same scan.
    const profileCandidates: RecordWithCampaignUser[] =
      await this.model.findMany({
        where: {
          campaign: scannableCampaign,
          peerlyIdentityId: { not: null },
          status: {
            in: [TcrComplianceStatus.submitted, TcrComplianceStatus.pending],
          },
          peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
        },
        include: { campaign: { include: { user: true } } },
        orderBy: { updatedAt: Prisma.SortOrder.asc },
      })
    for (const record of profileCandidates.slice(0, SCAN_RECORD_CAP)) {
      try {
        await this.pollProfileStatus(record)
      } catch (err) {
        this.logger.error(
          { err, tcrComplianceId: record.id, scanKey },
          '[CV status scan] Profile poll failed for record',
        )
      }
      await sleep(PROFILE_READ_SPACING_MS)
    }

    this.logger.info(
      {
        scanKey,
        cvPolled: Math.min(cvCandidates.length, SCAN_RECORD_CAP),
        profilesPolled: Math.min(profileCandidates.length, SCAN_RECORD_CAP),
      },
      '[CV status scan] Scan complete',
    )
  }

  private async pollCvRecord(record: RecordWithCampaignUser) {
    const { peerlyIdentityId } = record
    if (!peerlyIdentityId) {
      return
    }

    // Suppress per-identity Slack alerts — a Peerly outage during the scan
    // would otherwise page once per record; logs are the surface here.
    const details =
      await this.peerlyIdentityService.retrieveCampaignVerifyDetails(
        peerlyIdentityId,
        record.campaign,
        { suppressSlackAlert: true },
      )

    // The same observation drives PIN-delivery detection and late-rejection
    // handling — one retrieve_cv read serves all three consumers. Detection
    // runs before the status persist: persisting REJECTED/VERIFIED first
    // would drop the record out of the next scan's poll set even if the
    // detection write failed, silently stranding the internal status.
    // Detection itself is idempotent (atomic claims), so a re-run after a
    // failed persist is safe.
    await this.tcrComplianceService.applyCvDetection(
      record,
      record.campaign,
      details,
    )

    await this.persistObservedCvStatus(record, details.status)

    if (details.status === PeerlyCvVerificationStatus.VERIFIED) {
      await this.pollProfileStatus(record)
    }
  }

  // Persist "how long in this state" (ENG-10793). Unchanged values must not
  // touch the row at all — the nightly report's awaiting-PIN section keys off
  // updatedAt, so a no-op poll can't bump it.
  private async persistObservedCvStatus(
    record: TcrCompliance,
    cvStatus: PeerlyCvVerificationStatus | null,
  ) {
    if (cvStatus === record.peerlyCvStatus) {
      return
    }
    // A Peerly "no CV request" null after a real status was already observed
    // is not authoritative (the CV request may have been cleaned up on
    // Peerly's side) — erasing history here would flip the record into the
    // nightly report's case-1 "never reached CV" section.
    if (cvStatus === null && record.peerlyCvStatus !== null) {
      return
    }
    const data: Prisma.TcrComplianceUpdateInput = {
      peerlyCvStatus: cvStatus,
      peerlyCvStatusChangedAt: new Date(),
    }
    // Leaving IN_REVIEW is progress — a later re-stall is a new incident and
    // must re-escalate (ENG-10796).
    if (record.peerlyCvStatus === PeerlyCvVerificationStatus.IN_REVIEW) {
      data.cvInReviewEscalatedAt = null
    }
    // Leaving VERIFIED while waiting_to_finalize is also progress — the
    // profile poll is skipped when cvStatus !== VERIFIED, so the claim must
    // be cleared here or a future re-entry into VERIFIED+waiting_to_finalize
    // could never re-escalate.
    if (
      record.peerlyCvStatus === PeerlyCvVerificationStatus.VERIFIED &&
      record.peerlyProfileStatus === PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE
    ) {
      data.finalizeStalledEscalatedAt = null
    }
    await this.model.update({ where: { id: record.id }, data })
  }

  private async pollProfileStatus(record: RecordWithCampaignUser) {
    const { peerlyIdentityId } = record
    if (!peerlyIdentityId) {
      return
    }
    // A 404 (NotFoundException) means the identity is gone on Peerly's side —
    // a definitive answer, not a failed read. Clear the stale profile status
    // rather than preserving it, or case 3a would flag the record forever.
    const profileResponse = await this.peerlyIdentityService
      .getIdentityProfile(peerlyIdentityId, record.campaign, {
        suppressSlackAlert: true,
      })
      .catch((err: Error) => {
        if (err instanceof NotFoundException) {
          return undefined
        }
        throw err
      })
    // A `null` response is an empty-body success or a swallowed API error
    // upstream (`data || null`) — a transient non-answer, so keep the stored
    // value (mirrors the null-CV guard above). The 404 path resolves to
    // `undefined` and IS definitive: the identity is gone, so fall through
    // and clear the stale status.
    if (profileResponse === null) {
      return
    }
    const profileStatus = profileResponse?.profile?.status ?? null
    if (profileStatus === record.peerlyProfileStatus) {
      return
    }
    const data: Prisma.TcrComplianceUpdateInput = {
      peerlyProfileStatus: profileStatus,
      peerlyProfileStatusChangedAt: new Date(),
    }
    // Same reset as the CV transition above — leaving waiting_to_finalize
    // re-arms the case-3b escalation for a future stall.
    if (
      record.peerlyProfileStatus === PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE
    ) {
      data.finalizeStalledEscalatedAt = null
    }
    await this.model.update({ where: { id: record.id }, data })
  }
}
