import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { Cron, Interval } from '@nestjs/schedule'
import { formatISO, isAfter, isValid, parseISO, subMinutes } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import {
  Campaign,
  ExperimentRun,
  OfficeLevel,
  Prisma,
  TcrCompliance,
  TcrComplianceStatus,
  User,
} from '../../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { isPrismaError } from 'src/prisma/util/prismaErrors.util'
import { QueueProducerService } from '../../../queue/producer/queueProducer.service'
import {
  MessageGroup,
  QueueType,
  TcrComplianceStatusCheckMessage,
} from '../../../queue/queue.types'
import { getUserFullName, isInternalUser } from '../../../users/util/users.util'
import { EASTERN_TIMEZONE } from '../../../shared/util/date.util'
import {
  BrandApprovalResult,
  PeerlyCvVerificationStatus,
  PeerlyIdentityProfile,
  PeerlyIdentityProfileResponseBody,
  PeerlyIdentityUseCase,
} from '../../../vendors/peerly/peerly.types'
import {
  PEERLY_PROFILE_STATUS_PENDING,
  PEERLY_USECASE,
} from '../../../vendors/peerly/services/peerly.const'
import { PeerlyIdentityService } from '../../../vendors/peerly/services/peerlyIdentity.service'
import {
  WebsitesService,
  wouldBePublishableAfterFallbacks,
} from '../../../websites/services/websites.service'
import {
  CreateAgenticTcrCompliancePayload,
  CreateTcrCompliancePayload,
} from '../campaignTcrCompliance.types'
import { CampaignsService } from '../../services/campaigns.service'
import { CrmCampaignsService } from '../../services/crmCampaigns.service'
import { ComplianceStateService } from './complianceState.service'
import { submitToPeerlyFilingSchema } from '../schemas/submitToPeerlyDto.schema'
import {
  FEC_COMMITTEE_ID_PATTERN,
  formatManualFilingAddress,
  ManualFilingAddress,
} from '../schemas/tcrComplianceBase.schema'
import {
  ComplianceStage,
  MIN_BIO_LENGTH,
  SubmitToPeerlyOutput,
} from '@goodparty_org/contracts'
import { DerivedPinDelivery } from '../../../vendors/peerly/utils/peerlyPinDelivery.util'
import { isGenericComplianceContent } from '../../../websites/util/genericContent.util'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { CronLockService } from '@/cron/services/cronLock.service'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { ExperimentRunsService } from '../../../agentExperiments/services/experimentRuns.service'
import { AgenticComplianceKickoffMessage } from '../../../queue/queue.types'
import { ExperimentRunStatus } from '../../../generated/prisma'
import {
  PeerlyBillingException,
  PEERLY_NO_PAYMENT_METHOD_MESSAGE,
} from '../../../vendors/peerly/utils/peerlyBillingError.util'
import { PeerlyCvRejectionException } from '../../../vendors/peerly/utils/peerlyCvRejection.util'
import { CampaignVerifyPinNotIssuedException } from '../utils/campaignVerifyPinNotIssued.util'
import { CvPreSubmissionValidationException } from '../utils/cvPreSubmissionValidation.util'
import { CvPreSubmissionValidationService } from './cvPreSubmissionValidation.service'
import { SlackService } from '../../../vendors/slack/services/slack.service'
import {
  SlackChannel,
  SlackMessageType,
} from '../../../vendors/slack/slackService.types'

// `parseInt(x) || default` (not `x ? parseInt(x) : default`) so a non-numeric
// env value yields NaN and falls back to the default rather than reaching
// setInterval, which coerces NaN to ~1ms and hot-loops the sweep.
const AGENTIC_KICKOFF_SWEEP_INTERVAL =
  parseInt(process.env.AGENTIC_KICKOFF_SWEEP_INTERVAL ?? '') || 10 * 60

const AGENTIC_KICKOFF_STALENESS_MINUTES = 10

// Hourly on a fixed wall clock, at :23 so the pass doesn't pile onto the
// on-the-hour crons. Guarded by the hourly cron lock (see the sweep) because
// every replica fires this and the pass has no per-record claim of its own.
const UNSUBMITTED_USECASE_SWEEP_CRON = '23 * * * *'

const UNSUBMITTED_USECASE_SWEEP_CRON_JOB = 'tcrUnsubmittedUsecaseSweep'

// Pre-Peerly claim TTL: a claim older than this is treated as stale (failed
// without rollback) and re-claimable. Bounds the Peerly call's normal duration
// plus a comfortable margin; tune if Peerly latency drifts.
const PEERLY_SUBMISSION_CLAIM_TTL_MINUTES = 5

// Agentic dispatch claim TTL: a claim older than this is treated as stale
// (worker crashed between claim and dispatchRun completion) and re-claimable.
// Bounds dispatchRun's normal duration (SQS sendMessage + tcr_compliance write)
// plus a comfortable margin.
const AGENTIC_DISPATCH_CLAIM_TTL_MINUTES = 5

// How long to hold off re-submitting to Peerly after a billing/account failure
// ("No payment method available"). The failure is unrecoverable until Peerly
// fixes billing, so agent-resume / kickoff re-dispatches within this window
// short-circuit instead of re-hitting Peerly — one alert, no retry storm. After
// it elapses the next attempt probes again (and re-alerts if still failing), so
// registrations resume automatically once billing clears.
export const PEERLY_BILLING_BLOCK_COOLDOWN_MINUTES = 6 * 60

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/

const manualFilingAddressColumns = (
  manualAddress: ManualFilingAddress | undefined,
) =>
  manualAddress
    ? {
        filingAddressLine1: manualAddress.addressLine1,
        filingAddressLine2: manualAddress.addressLine2 ?? null,
        filingCity: manualAddress.city,
        filingState: manualAddress.state,
        filingZip: manualAddress.zip,
      }
    : {}

const NON_PROD_BYPASS_CV_TOKEN = 'non-prod-bypass-cv-token'

// Filler for the NOT NULL business columns on an internal-testing approval
// row — the row never reaches Peerly (no identity is ever minted for it), so
// these values are display-only.
const INTERNAL_TESTING_PLACEHOLDER = 'internal-testing'

type PeerlySubmissionResult = {
  peerlyIdentityId: string
  peerlyIdentityProfileLink: string | null
  peerly10DLCBrandSubmissionKey: string | null
  cvVerificationId: string | null
}

@Injectable()
export class CampaignTcrComplianceService extends createPrismaBase(
  MODELS.TcrCompliance,
) {
  constructor(
    private readonly peerlyIdentityService: PeerlyIdentityService,
    private readonly websitesService: WebsitesService,
    private readonly campaignsService: CampaignsService,
    private readonly crmCampaignsService: CrmCampaignsService,
    private readonly complianceStateService: ComplianceStateService,
    private queueService: QueueProducerService,
    private readonly experimentRunsService: ExperimentRunsService,
    private readonly analytics: AnalyticsService,
    private readonly cronLock: CronLockService,
    private readonly cvPreSubmissionValidation: CvPreSubmissionValidationService,
    private readonly slack: SlackService,
  ) {
    super()
  }

  @Interval(AGENTIC_KICKOFF_SWEEP_INTERVAL * 1000)
  async sweepStrandedAgenticKickoffs() {
    const cutoff = subMinutes(new Date(), AGENTIC_KICKOFF_STALENESS_MINUTES)
    const stranded = await this.model.findMany({
      where: {
        status: TcrComplianceStatus.submitted,
        peerlyIdentityId: null,
        kickoffSentAt: null,
        createdAt: { lt: cutoff },
        // Pre-payment submissions intentionally sit with
        // kickoffSentAt null until payment; only sweep campaigns that are
        // already Pro so the agent never runs before the candidate pays.
        campaign: { isPro: true },
      },
      include: {
        campaign: {
          include: {
            user: true,
            campaignPositions: { include: { topIssue: true } },
          },
        },
      },
    })

    if (!stranded.length) {
      return
    }

    // Split deferred records (profile can't pass the publish gate — see
    // claimAndEnqueueKickoff) from genuinely stranded ones. Deferred records
    // are skipped every cycle at no cost; the moment the candidate completes
    // their profile the next sweep dispatches automatically, which is the
    // deferral loop's self-heal path.
    const dispatchable: {
      record: (typeof stranded)[number]
      clerkUserId: string
    }[] = []
    for (const record of stranded) {
      const user = record.campaign?.user
      if (!user?.clerkId) {
        this.logger.error(
          { tcrComplianceId: record.id, campaignId: record.campaignId },
          '[TCR Compliance] Stranded agentic record has no Clerk user; skipping',
        )
        continue
      }
      let content: PrismaJson.WebsiteContent | null
      try {
        content = await this.websitesService.getContentForCampaign(
          record.campaignId,
        )
      } catch (err) {
        // Isolate per record (matching the other sweeps): one record's fetch
        // failure must not abandon the rest of this tick's candidates.
        this.logger.error(
          { err, tcrComplianceId: record.id, campaignId: record.campaignId },
          '[TCR Compliance] Failed to fetch website content for stranded ' +
            'record; skipping',
        )
        continue
      }
      if (!wouldBePublishableAfterFallbacks(content, user, record.campaign)) {
        continue
      }
      dispatchable.push({ record, clerkUserId: user.clerkId })
    }

    if (!dispatchable.length) {
      return
    }

    this.logger.warn(
      { count: dispatchable.length, cutoff: cutoff.toISOString() },
      `[TCR Compliance] Sweeping ${dispatchable.length} stranded agentic kickoff(s)`,
    )

    for (const { record, clerkUserId } of dispatchable) {
      try {
        await this.queueService.sendMessage(
          {
            type: QueueType.AGENTIC_COMPLIANCE_KICKOFF,
            data: {
              campaignId: record.campaignId,
              tcrComplianceId: record.id,
              clerkUserId,
            },
          },
          `${MessageGroup.agenticComplianceKickoff}-${record.campaignId}`,
          {
            deduplicationId: `agentic-compliance-${record.id}-recover-${Date.now()}`,
            throwOnError: true,
          },
        )

        await this.model.update({
          where: { id: record.id },
          data: { kickoffSentAt: new Date() },
        })
      } catch (err) {
        this.logger.error(
          { err, tcrComplianceId: record.id },
          '[TCR Compliance] Failed to re-enqueue stranded agentic kickoff',
        )
      }
    }
  }

  // The POLITICAL usecase is what finalizes a TCR registration, and it is only
  // submitted by approve10DLCBrand — which today fires solely from the in-app
  // PIN flow (submit-cv-pin). When that flow's approve step throws after the
  // candidate has verified their PIN, the usecase is never submitted and the
  // identity strands "loading" in Peerly. This sweep heals those records by
  // submitting the usecase for any record whose Campaign Verify is VERIFIED.
  // It deliberately does NOT act on APPROVED: that status can precede the
  // candidate's PIN entry, so advancing it would skip them past the PIN screen
  // (submitUsecaseIfVerified). Only `submitted` records are candidates —
  // `pending` means the usecase was already submitted (status advances after
  // approve).
  // Filters on the persisted peerlyCvStatus (stamped by the CV status scan
  // and the PIN-entry path) instead of a per-record retrieve_cv read — the
  // sweep used to poll Peerly for every submitted record hourly, which is
  // what Peerly's rate-limit complaint was about (2026-08-17). VERIFIED is
  // the only status that warrants auto-submitting the usecase: the candidate
  // proved control via PIN, so this just finishes a flow whose approve step
  // threw. APPROVED is NOT a completion signal — CV can reach it before the
  // candidate enters their PIN, so acting on it would skip the PIN screen.
  // A fixed wall-clock @Cron behind the hourly cron lock, not an @Interval:
  // @Interval fires independently in every replica (prod runs two) and
  // submitUsecaseIfVerified has no per-record claim, so two concurrent passes
  // over the same record would both mint a CV token and both approve — which
  // double-finalizes the 10DLC brand and strands the identity in the MNO queue
  // for manual vendor cleanup.
  @Cron(UNSUBMITTED_USECASE_SWEEP_CRON, {
    name: UNSUBMITTED_USECASE_SWEEP_CRON_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepUnsubmittedUsecases() {
    // Pin one timestamp so the claim and the completion mark resolve to the
    // same slot even if the pass crosses the hour boundary.
    const now = new Date()
    const claimed = await this.cronLock.tryClaimHourlyRun(
      UNSUBMITTED_USECASE_SWEEP_CRON_JOB,
      now,
    )
    if (!claimed) return

    try {
      const candidates = await this.model.findMany({
        where: {
          status: TcrComplianceStatus.submitted,
          peerlyIdentityId: { not: null },
          peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
        },
      })

      for (const record of candidates) {
        try {
          await this.submitUsecaseIfVerified(record)
        } catch (err) {
          this.logger.error(
            { err, tcrComplianceId: record.id },
            '[TCR Compliance] Failed to submit usecase for verified record',
          )
        }
      }
    } finally {
      // Seal the claim even if the candidate query threw, otherwise the claim
      // dangles until it goes stale and blocks the rest of this hour's slot
      // for nothing — the next hour's slot is a fresh row either way.
      await this.cronLock.markHourlyCompleted(
        UNSUBMITTED_USECASE_SWEEP_CRON_JOB,
        now,
      )
    }
  }

  private async submitUsecaseIfVerified(tcrCompliance: TcrCompliance) {
    const { peerlyIdentityId } = tcrCompliance
    if (!peerlyIdentityId) {
      return
    }

    const campaign = await this.campaignsService.findUnique({
      where: { id: tcrCompliance.campaignId },
    })
    if (!campaign) {
      return
    }

    // Idempotency guard. approve10DLCBrand advances the Peerly profile from
    // `pending` to `waiting_to_finalize` (then `finalized`), so a non-`pending`
    // profile already has its usecase submitted. get_usecases can't serve as
    // this guard — it stays empty until `finalized`, so it would let an
    // in-flight (`waiting_to_finalize`) record be re-submitted.
    let profileResponse: PeerlyIdentityProfileResponseBody | null
    try {
      // This is a background sweep with no human waiting, so a transient Peerly
      // read failure must not page the 10DLC Slack channel (it logs + throws
      // below, and the next sweep retries).
      profileResponse = await this.peerlyIdentityService.getIdentityProfile(
        peerlyIdentityId,
        campaign,
        { suppressSlackAlert: true },
      )
    } catch (err) {
      // A deleted/orphaned Peerly identity 404s here; skip rather than letting
      // it propagate and have the sweep re-select it every tick.
      if (err instanceof NotFoundException) {
        return
      }
      throw err
    }
    if (profileResponse?.profile?.status !== PEERLY_PROFILE_STATUS_PENDING) {
      return
    }

    const campaignVerifyToken =
      await this.peerlyIdentityService.createCampaignVerifyToken(
        peerlyIdentityId,
        campaign,
      )
    if (!campaignVerifyToken) {
      return
    }

    // On approve failure, mark the record `error` so the sweep's `submitted`
    // filter stops re-selecting it every hour (each retry re-fires the
    // bot10DlcCompliance alert from handleApiError). `error` is retryable — a
    // re-submit through createAgentic resets it.
    let approveResult: BrandApprovalResult | undefined
    try {
      approveResult = await this.submitCampaignVerifyToken(
        tcrCompliance,
        campaignVerifyToken,
      )
    } catch (err) {
      await this.model.update({
        where: { id: tcrCompliance.id },
        data: { status: TcrComplianceStatus.error },
      })
      throw err
    }

    // submitCampaignVerifyToken returns undefined in non-prod (it short-circuits
    // the Peerly approve). Only advance status when the usecase was actually
    // submitted, so a non-prod record isn't promoted to `pending` (and then
    // swept by bootstrapTcrComplianceCheck) for a usecase that doesn't exist.
    if (approveResult === undefined) {
      return
    }

    await this.model.update({
      where: { id: tcrCompliance.id },
      data: { status: TcrComplianceStatus.pending },
    })
  }

  // Act on a CV observation the twice-daily status scan already fetched
  // (cvStatusPoll.service.ts) — this method makes no Peerly call of its own.
  // It detects that Peerly sent the candidate's CampaignVerify PIN, records
  // the channel + destination, and fires the "PIN Sent" Segment event once so
  // HubSpot can stamp the company and nudge the candidate; the same
  // observation detects a CV that flipped to REJECTED/WITHDRAWN after
  // submission. Replaced the hourly sweepPinDeliveryDetection, whose
  // per-record retrieve_cv reads were the bulk of the call volume Peerly
  // flagged (2026-08-17).
  async applyCvDetection(
    tcrCompliance: TcrCompliance,
    campaign: Campaign & { user: User | null },
    details: {
      status: PeerlyCvVerificationStatus | null
      pinDelivery: DerivedPinDelivery | null
    },
  ) {
    const { peerlyIdentityId } = tcrCompliance
    if (!peerlyIdentityId || !campaign.user) {
      return
    }
    const { user } = campaign

    const { status: cvStatus, pinDelivery } = details

    // A CV that flipped to REJECTED or WITHDRAWN after submission never gets
    // a PIN, so without this the record would sit in the sweep set forever
    // (TcrComplianceStatus has no withdrawn value; rejected is the terminal
    // mapping and keeps the record retryable via createAgentic). Persist via
    // an atomic transition claim so the rejection event fires once; the DB
    // write is the source of truth and the event is best-effort — a lost
    // event still surfaces via the nightly 10DLC report's rejected section.
    if (
      cvStatus === PeerlyCvVerificationStatus.REJECTED ||
      cvStatus === PeerlyCvVerificationStatus.WITHDRAWN
    ) {
      const rejectedClaim = await this.model.updateMany({
        where: {
          id: tcrCompliance.id,
          status: { not: TcrComplianceStatus.rejected },
        },
        data: { status: TcrComplianceStatus.rejected },
      })
      if (rejectedClaim.count > 0) {
        void this.analytics
          .track(user.id, EVENTS.Outreach.ComplianceRejected, {
            rejection_source: 'cv_status_check',
            peerly_identity_id: peerlyIdentityId,
            ...(campaign.data.hubspotId
              ? { company_hubspot_id: campaign.data.hubspotId }
              : {}),
          })
          .catch(() => undefined)
      }
      return
    }

    // A record whose channel was already recorded has nothing left to detect
    // — but only after the rejection branch above, so a late REJECTED flip on
    // a delivered-PIN record still stamps our terminal status (the scan's
    // poll set is broader than the old sweep's `pinDeliveryMethod IS NULL`
    // filter).
    if (tcrCompliance.pinDeliveryMethod) {
      return
    }

    // Peerly echoes back the verification_method/filing_email we ourselves
    // send in submit_cv from day one, so their presence does not mean a PIN
    // went out. Only APPROVED (PIN issued) and VERIFIED (PIN consumed) prove
    // delivery; REQUESTED/IN_REVIEW stay in the sweep set for a later pass
    // (ENG-10785 — false "PIN Sent" nudges for in-review CVs).
    if (
      cvStatus !== PeerlyCvVerificationStatus.APPROVED &&
      cvStatus !== PeerlyCvVerificationStatus.VERIFIED
    ) {
      return
    }

    // No method yet = PIN not sent (or an unrecognized channel we don't
    // surface) — leave the record for a later sweep.
    if (!pinDelivery) {
      return
    }

    // Once-only claim: only the caller that flips pinSentDetectedAt from null
    // persists and fires the event, so a re-run or a concurrent sweep can't
    // double-record or double-fire.
    const claimTimestamp = new Date()
    const claim = await this.model.updateMany({
      where: { id: tcrCompliance.id, pinSentDetectedAt: null },
      data: {
        pinDeliveryMethod: pinDelivery.method,
        pinDeliveryDestination: pinDelivery.destination,
        pinSentDetectedAt: claimTimestamp,
      },
    })
    if (claim.count === 0) {
      return
    }

    try {
      await this.firePinSentEvent(user.id, campaign, pinDelivery, {
        peerlyIdentityId,
        pinSentAt: claimTimestamp,
      })
    } catch (err) {
      // The event is the whole point of the detection — if it fails, roll back
      // our claim (scoped to the exact timestamp we wrote, so a concurrent
      // re-claimant's live claim isn't disturbed) so the next sweep retries
      // rather than silently dropping the nudge. Guard the rollback itself: if
      // it throws, its error must not mask the original (nor leave the record
      // claimed-but-never-fired and thus permanently excluded by the sweep's
      // `pinDeliveryMethod IS NULL` filter) — mirrors submitToPeerlyForAgent.
      try {
        await this.model.updateMany({
          where: { id: tcrCompliance.id, pinSentDetectedAt: claimTimestamp },
          data: {
            pinDeliveryMethod: null,
            pinDeliveryDestination: null,
            pinSentDetectedAt: null,
          },
        })
      } catch (rollbackErr) {
        this.logger.error(
          { rollbackErr, tcrComplianceId: tcrCompliance.id },
          '[TCR Compliance] Failed to roll back PIN-delivery claim; ' +
            'record may be stuck with no PIN Sent event fired',
        )
      }
      throw err
    }

    // Stamp the delivery details onto the HubSpot company directly (via the
    // company sync, which now carries the n10_dlc_pin_* fields). The
    // Segment -> HubSpot event-property path silently drops properties that
    // are missing from the destination's mapping, so the company sync is the
    // guaranteed carrier; the event remains the workflow trigger.
    try {
      await this.crmCampaignsService.trackCampaign(campaign.id)
    } catch (err) {
      this.logger.error(
        { err, campaignId: campaign.id },
        '[TCR Compliance] CRM company sync failed after PIN Sent event; ' +
          'next full sync will carry the PIN delivery fields',
      )
    }
  }

  private async firePinSentEvent(
    userId: number,
    campaign: Campaign,
    pinDelivery: DerivedPinDelivery,
    context: { peerlyIdentityId: string; pinSentAt: Date },
  ) {
    // The destination rides along so the HubSpot nudge can name the actual
    // inbox/number CV delivered to — often a treasurer's contact from the
    // state filing, not the candidate's own. Same sensitivity class as the
    // filing email/phone we already sync to HubSpot company properties. The
    // candidate-facing API still masks it (see complianceState.service).
    await this.analytics.track(userId, EVENTS.Outreach.CompliancePinSent, {
      peerly_identity_id: context.peerlyIdentityId,
      pin_delivery_method: pinDelivery.method,
      pin_delivery_destination: pinDelivery.destination,
      pin_sent_at: formatISO(context.pinSentAt),
      ...(campaign.data.hubspotId
        ? { company_hubspot_id: campaign.data.hubspotId }
        : {}),
    })
  }

  // Fixed wall-clock cron (an @Interval resets on every deploy) so both prod
  // replicas fire in the same instant and the slot-keyed FIFO deduplicationId
  // collapses their enqueues within SQS's 5-minute dedup window — the old
  // interval + random dedup id made every replica's enqueue a duplicate
  // Peerly-touching job (nightly10DlcReport pattern).
  @Cron('0 7,19 * * *', {
    name: 'tcrComplianceStatusCheck',
    timeZone: EASTERN_TIMEZONE,
  })
  async bootstrapTcrComplianceCheck() {
    const pendingTcrCompliances = await this.model.findMany({
      where: {
        status: TcrComplianceStatus.pending,
      },
    })
    if (pendingTcrCompliances.length) {
      this.logger.debug(
        { pendingTcrCompliances },
        `Queuing up pendingTcrCompliances =>`,
      )
      const slot = formatInTimeZone(
        new Date(),
        EASTERN_TIMEZONE,
        'yyyy-MM-dd-HH',
      )
      await Promise.allSettled(
        pendingTcrCompliances.map((tcrCompliance) =>
          this.queueService.sendMessage(
            {
              type: QueueType.TCR_COMPLIANCE_STATUS_CHECK,
              data: { tcrCompliance } as TcrComplianceStatusCheckMessage,
            },
            MessageGroup.tcrCompliance,
            {
              deduplicationId: `tcrStatusCheck-${tcrCompliance.id}-${slot}`,
            },
          ),
        ),
      )
    } else {
      this.logger.debug(
        'No pending TCR Compliances need checking at this time.',
      )
    }
  }

  async fetchByCampaignId(campaignId: number) {
    return this.model.findUnique({
      where: { campaignId },
    })
  }

  // Admin-granted "treat as 10DLC approved" for internal accounts: status is
  // approved so every UI gate passes, but no Peerly identity ever exists, so
  // the P2P send gate (requirePeerlyIdentityId) keeps real sends blocked.
  async grantInternalTestingApproval(user: User, campaign: Campaign) {
    if (!isInternalUser({ email: user.email })) {
      throw new BadRequestException(
        'Internal testing approval is limited to internal GoodParty accounts',
      )
    }

    const existing = await this.fetchByCampaignId(campaign.id)
    if (existing?.internalTestingApprovedAt) {
      return existing
    }
    if (existing) {
      throw new ConflictException(
        'Campaign already has a real TCR compliance record',
      )
    }

    try {
      return await this.model.create({
        data: {
          campaignId: campaign.id,
          status: TcrComplianceStatus.approved,
          internalTestingApprovedAt: new Date(),
          ein: INTERNAL_TESTING_PLACEHOLDER,
          postalAddress: INTERNAL_TESTING_PLACEHOLDER,
          committeeName: INTERNAL_TESTING_PLACEHOLDER,
          websiteDomain: INTERNAL_TESTING_PLACEHOLDER,
          filingUrl: INTERNAL_TESTING_PLACEHOLDER,
          phone: INTERNAL_TESTING_PLACEHOLDER,
          email: user.email,
          officeLevel: OfficeLevel.local,
        },
      })
    } catch (err) {
      // Concurrent grants can both pass the pre-check; the loser's create
      // hits the campaignId unique constraint. Resolve the race the same way
      // the pre-check would have: idempotent for a marker row, 409 for a
      // real compliance record that landed in between.
      if (isPrismaError(err, 'P2002')) {
        const raced = await this.fetchByCampaignId(campaign.id)
        if (raced?.internalTestingApprovedAt) {
          return raced
        }
        if (raced) {
          throw new ConflictException(
            'Campaign already has a real TCR compliance record',
          )
        }
        // Row vanished between the P2002 and this re-read (concurrent
        // revoke deleted the racing winner's row); surface a clean error.
        throw new ConflictException(
          'Internal testing approval was concurrently granted and ' +
            'revoked; please retry',
        )
      }
      throw err
    }
  }

  async revokeInternalTestingApproval(campaignId: number) {
    const existing = await this.fetchByCampaignId(campaignId)
    if (!existing) {
      return
    }
    if (!existing.internalTestingApprovedAt) {
      throw new ConflictException(
        'Campaign has a real TCR compliance record; refusing to delete it',
      )
    }
    // deleteMany so a concurrent revoke that already removed the row no-ops
    // instead of throwing P2025 — revoke is idempotent.
    await this.model.deleteMany({ where: { id: existing.id } })
  }

  // Admin override for a held pre-submission validation failure (ENG-10965):
  // lets a staff member let the submission proceed despite an unresolved
  // failed verdict (e.g. a filing page CampaignVerify itself can reach even
  // though the LLM couldn't confirm it). assertCvPreSubmissionValid checks
  // this before the held-failure short-circuit, so it fully bypasses the
  // gate on every subsequent submission attempt.
  async overrideCvValidation(campaignId: number) {
    const existing = await this.fetchByCampaignId(campaignId)
    if (!existing) {
      throw new NotFoundException(
        `TcrCompliance record not found for campaignId=${campaignId}`,
      )
    }
    await this.model.update({
      where: { id: existing.id },
      data: { cvValidationOverriddenAt: new Date() },
    })
  }

  // TODO: Refactor this flow to persist the Peerly Identity ID and other
  //  relevant data in the TCR Compliance record as we go, and then use that to
  //  determine flow progress instead of calling Peerly for everything.
  //  Once we do so, the UI and other consumers that are determining logic flows
  //  based on existence of TcrCompliance records will need to be updated to
  //  reflect this change.
  async create(
    user: User,
    campaign: Campaign,
    tcrComplianceCreatePayload: CreateTcrCompliancePayload,
  ) {
    const { domain } = await this.websitesService.findFirstOrThrow({
      where: {
        campaignId: campaign.id,
      },
      include: {
        domain: true,
      },
    })
    if (!domain) {
      throw new BadRequestException(
        'Campaign must have a domain to create TCR compliance',
      )
    }

    // Pre-submission validation gate (ENG-10965): no TcrCompliance row exists
    // yet on this path, so a failure just 400s synchronously — the candidate
    // corrects the filing details and resubmits, no hold/Slack alert needed.
    const submissionName =
      tcrComplianceCreatePayload.candidateName ?? getUserFullName(user)
    const validationResult = await this.cvPreSubmissionValidation.validate({
      filingUrl: tcrComplianceCreatePayload.filingUrl,
      submissionName,
    })
    if (validationResult.outcome === 'transient') {
      throw new BadGatewayException(
        'CV pre-submission validation is temporarily unavailable; retry shortly',
      )
    }
    if (validationResult.outcome === 'failed') {
      throw new CvPreSubmissionValidationException(validationResult.reasons)
    }

    const peerlyResult = await this.submitToPeerly(
      user,
      campaign,
      tcrComplianceCreatePayload,
      domain.name,
    )

    const { manualAddress, ...persistablePayload } = tcrComplianceCreatePayload
    const newTcrCompliance = {
      ...persistablePayload,
      postalAddress: manualAddress
        ? formatManualFilingAddress(manualAddress)
        : campaign.formattedAddress!,
      ...manualFilingAddressColumns(manualAddress),
      campaignId: campaign.id,
      peerlyIdentityId: peerlyResult.peerlyIdentityId,
      peerlyIdentityProfileLink: peerlyResult.peerlyIdentityProfileLink,
      peerly10DLCBrandSubmissionKey: peerlyResult.peerly10DLCBrandSubmissionKey,
      peerlyCvVerificationId: peerlyResult.cvVerificationId,
    }

    this.logger.debug(
      { newTcrCompliance },
      '[TCR Compliance] Step 5: Creating TCR Compliance record:',
    )

    const createdTcrCompliance = await this.model.create({
      data: newTcrCompliance,
    })

    this.logger.info(
      `[TCR Compliance] Flow completed for campaignId=${campaign.id}, ` +
        `tcrComplianceId=${createdTcrCompliance.id}, ` +
        `peerlyIdentityId=${createdTcrCompliance.peerlyIdentityId}`,
    )

    return createdTcrCompliance
  }

  private async submitToPeerly(
    user: User,
    campaign: Campaign,
    tcrComplianceCreatePayload: CreateTcrCompliancePayload,
    domainName: string,
  ): Promise<PeerlySubmissionResult> {
    const {
      ein,
      filingUrl,
      email,
      phone,
      officeLevel,
      fecCommitteeId,
      committeeType,
      candidateName,
      manualAddress,
    } = tcrComplianceCreatePayload

    // Peerly's identity/brand calls resolve the candidate's postal address
    // from a manually entered structured address or, failing that, from
    // campaign.placeId via Google Places (peerlyIdentity.service
    // getAddressByPlaceId). With neither, that lookup 502s, which the
    // compliance agent treats as transient and retries forever (campaign
    // 325553). A 10DLC brand can't be registered without an address, so fail
    // fast with a non-recoverable 4xx that names the real cause instead.
    if (!manualAddress && !campaign.placeId?.trim()) {
      throw new BadRequestException(
        'Cannot submit TCR registration to Peerly: the campaign has no ' +
          'address on file (no placeId and no manually entered address). ' +
          'The candidate must add their address before TCR registration ' +
          'can proceed.',
      )
    }

    const userFullName = getUserFullName(user)
    const { ballotLevel } = campaign.details as { ballotLevel?: string }

    this.logger.info(
      `[TCR Compliance] Starting registration flow for ` +
        `campaignId=${campaign.id}, userId=${user.id}, ` +
        `userName="${userFullName}", ein=${ein}, ` +
        `ballotLevel=${ballotLevel || 'NOT_SET'}`,
    )

    const tcrIdentityName = this.peerlyIdentityService.getTCRIdentityName(
      userFullName,
      ein,
    )
    this.logger.debug(
      `[TCR Compliance] Step 1: tcrIdentityName => ${tcrIdentityName}`,
    )

    const identities = await this.peerlyIdentityService.getIdentities(campaign)
    const existingIdentity = identities.find(
      (identity) => identity.identity_name === tcrIdentityName,
    )

    if (existingIdentity) {
      this.logger.debug(
        { existingIdentity },
        '[TCR Compliance] Step 1: Existing Identity found, skipping creation:',
      )
    } else {
      this.logger.debug(
        `[TCR Compliance] Step 1: No existing identity found, creating new one`,
      )
    }

    const tcrComplianceIdentity =
      existingIdentity ||
      (await this.peerlyIdentityService.createIdentity(
        tcrIdentityName,
        campaign,
      ))
    if (!tcrComplianceIdentity) {
      throw new BadGatewayException(
        'Peerly did not return an identity after creation',
      )
    }
    const peerlyIdentityId = tcrComplianceIdentity.identity_id

    // Push the Peerly identity id onto the campaign's HubSpot company (via
    // Segment) so Campaign Success can match Peerly's 10DLC Slack
    // notifications, which carry only this id, to the right company record.
    // Only when we just created the identity — an existing-identity pass
    // (idempotent retry or account-level reuse) already emitted this, so
    // re-firing would duplicate the event for the same id. companyHubspotId is
    // where Campaign Success wants peerly_identity_id to land; the contact id
    // already rides along in the event's context traits. Omitted when the
    // company record isn't known yet.
    if (!existingIdentity) {
      void this.analytics
        .track(user.id, EVENTS.Outreach.PeerlyIdentityIdCreated, {
          peerly_identity_id: peerlyIdentityId,
          ...(campaign.data.hubspotId
            ? { company_hubspot_id: campaign.data.hubspotId }
            : {}),
        })
        .catch(() => undefined)
    }

    let existingIdentityProfileResponse: PeerlyIdentityProfileResponseBody | null =
      null
    try {
      existingIdentityProfileResponse =
        await this.peerlyIdentityService.getIdentityProfile(
          peerlyIdentityId,
          campaign,
        )
    } catch (error) {
      if (error instanceof NotFoundException) {
        existingIdentityProfileResponse = null
      } else {
        throw error
      }
    }

    if (existingIdentityProfileResponse) {
      this.logger.debug(
        `[TCR Compliance] Step 2: Existing Identity Profile found, skipping creation`,
      )
    } else {
      this.logger.debug(`[TCR Compliance] Step 2: Submitting Identity Profile`)
    }

    const peerlyIdentityProfileResponse: PeerlyIdentityProfileResponseBody | null =
      existingIdentityProfileResponse ||
      (await this.peerlyIdentityService.submitIdentityProfile(
        peerlyIdentityId,
        campaign,
      )) ||
      null

    const peerlyIdentityProfileLink =
      peerlyIdentityProfileResponse?.link || null

    const identityProfile: PeerlyIdentityProfile | null =
      peerlyIdentityProfileResponse?.profile ?? null

    let peerly10DLCBrandSubmissionKey: string | null = null
    // Apparently, duck-typing whether `vertical` has been set or not, is the
    //  _only_ way to determine whether or not the given Identity has a 10DLC
    //  "brand" submitted for it or not. See Peerly Slack discussion here:
    //  https://goodpartyorg.slack.com/archives/C09H3K02LLV/p1759788426640679
    if (identityProfile?.vertical) {
      this.logger.debug(
        `[TCR Compliance] Step 3: Existing 10DLC Brand derived from ` +
          `IdentityProfile (vertical=${identityProfile.vertical}), ` +
          `skipping creation`,
      )
    } else {
      this.logger.debug(`[TCR Compliance] Step 3: Submitting 10DLC Brand`)
      peerly10DLCBrandSubmissionKey =
        (await this.peerlyIdentityService.submit10DlcBrand(
          peerlyIdentityId,
          tcrComplianceCreatePayload,
          campaign,
          domainName,
        )) || null
    }

    const existingCampaignVerifyRequest =
      await this.peerlyIdentityService.getCampaignVerifyRequest(
        peerlyIdentityId,
        campaign,
      )

    let cvVerificationId: string | null = null
    if (existingCampaignVerifyRequest?.verification_status) {
      this.logger.debug(
        `[TCR Compliance] Step 4: Existing Campaign Verify Request found ` +
          `w/ status ${existingCampaignVerifyRequest.verification_status}, ` +
          `skipping creation`,
      )
    } else {
      this.logger.debug(
        `[TCR Compliance] Step 4: Submitting Campaign Verify Request for ` +
          `campaignId=${campaign.id}`,
      )

      const cvResponse =
        await this.peerlyIdentityService.submitCampaignVerifyRequest(
          {
            ein,
            filingUrl,
            peerlyIdentityId,
            email,
            phone,
            officeLevel,
            fecCommitteeId: fecCommitteeId ?? null,
            committeeType: committeeType,
            candidateName: candidateName ?? null,
            ...manualFilingAddressColumns(manualAddress),
          },
          user,
          campaign,
          domainName,
        )
      cvVerificationId = cvResponse?.verification_id ?? null
      this.logger.info(
        `[TCR Compliance] Step 4 SUCCESS: Campaign Verify Request submitted ` +
          `for campaignId=${campaign.id}`,
      )
    }

    return {
      peerlyIdentityId,
      peerlyIdentityProfileLink,
      peerly10DLCBrandSubmissionKey,
      cvVerificationId,
    }
  }

  // Pre-submission validation gate (ENG-10965): must run before any Peerly
  // CV submission — catches a junk/unacceptable filing URL, a candidate name
  // CampaignVerify can't find on the filing page, or a filing that hasn't
  // commenced, before Peerly ever sees the submission. A held record
  // (cvValidationFailedAt set) short-circuits without re-running the
  // fetch/LLM check — cheap, and keeps the once-only Slack claim honest. An
  // admin override bypasses the gate entirely.
  private async assertCvPreSubmissionValid(
    existing: TcrCompliance,
    user: User,
    campaign: Campaign,
  ): Promise<void> {
    if (existing.cvValidationOverriddenAt) {
      return
    }
    if (existing.cvValidationFailedAt) {
      throw new CvPreSubmissionValidationException(
        existing.cvValidationFailureReasons,
      )
    }

    // Mirrors exactly the fallback submitCampaignVerifyRequest itself uses —
    // the candidate's own name, falling back to the account holder's name for
    // records created before candidateName existed.
    const submissionName = existing.candidateName ?? getUserFullName(user)
    const result = await this.cvPreSubmissionValidation.validate({
      filingUrl: existing.filingUrl,
      submissionName,
    })

    if (result.outcome === 'transient') {
      // A vendor blip is not evidence of a bad URL — never hold or alert on
      // this outcome. 502 so agent/wizard callers retry later, same as any
      // other transient Peerly failure.
      throw new BadGatewayException(
        'CV pre-submission validation is temporarily unavailable; retry shortly',
      )
    }
    if (result.outcome === 'failed') {
      await this.recordCvValidationFailure(
        existing,
        user,
        campaign,
        result.reasons,
      )
      throw new CvPreSubmissionValidationException(result.reasons)
    }
  }

  // Once-only claim on cvValidationFailedAt before posting the internal Slack
  // alert — mirrors the cvInReviewEscalatedAt / pinSentDetectedAt claim
  // pattern. A failed post rolls the claim back (scoped to the exact
  // timestamp written) so the next attempt retries the alert.
  //
  // The claim is scoped to peerlyIdentityId: null in addition to
  // cvValidationFailedAt: null — submitToPeerlyForAgent supports concurrent
  // callers, and the gate runs before the peerlySubmissionStartedAt claim, so
  // a slower caller can reach a failed verdict after a faster one already
  // submitted (peerlyIdentityId set). Without this, the slower caller would
  // hold an already-submitted record and fire a false alert.
  private async recordCvValidationFailure(
    existing: TcrCompliance,
    user: User,
    campaign: Campaign,
    reasons: string[],
  ): Promise<void> {
    const claimedAt = new Date()
    const claim = await this.model.updateMany({
      where: {
        id: existing.id,
        cvValidationFailedAt: null,
        peerlyIdentityId: null,
      },
      data: {
        cvValidationFailedAt: claimedAt,
        cvValidationFailureReasons: reasons,
      },
    })
    if (claim.count === 0) {
      return
    }

    const posted = await this.slack.message(
      {
        blocks: [
          {
            type: SlackMessageType.HEADER,
            text: {
              type: SlackMessageType.PLAIN_TEXT,
              text:
                '⛔ CV pre-submission validation failed — 10DLC ' +
                'registration held',
              emoji: true,
            },
          },
          {
            type: SlackMessageType.SECTION,
            text: {
              type: SlackMessageType.MRKDWN,
              text:
                `*Candidate:* ${getUserFullName(user)} (${user.email})\n` +
                `*Campaign:* campaignId=${campaign.id}\n` +
                `*Filing URL:* ${existing.filingUrl}\n` +
                '*Failed checks:*\n' +
                reasons.map((reason) => `• ${reason}`).join('\n'),
            },
          },
        ],
      },
      SlackChannel.bot10DlcCompliance,
    )
    if (posted !== undefined) {
      return
    }

    // If this rollback itself fails, the claim stays set forever with no
    // post ever sent — log loudly so it's visible rather than silently
    // stranding the record outside every future retry's claim attempt.
    try {
      await this.model.updateMany({
        where: { id: existing.id, cvValidationFailedAt: claimedAt },
        data: { cvValidationFailedAt: null, cvValidationFailureReasons: [] },
      })
      this.logger.error(
        { tcrComplianceId: existing.id },
        '[TCR Compliance] CV pre-submission validation alert failed to ' +
          'post; claim rolled back for retry',
      )
    } catch (err) {
      this.logger.error(
        { err, tcrComplianceId: existing.id },
        '[TCR Compliance] CV pre-submission validation alert failed and ' +
          'the claim rollback also failed; record is stuck unalerted until ' +
          'repaired',
      )
    }
  }

  async submitToPeerlyForAgent(
    user: User,
    campaign: Campaign,
  ): Promise<SubmitToPeerlyOutput> {
    const existing = await this.fetchByCampaignId(campaign.id)
    if (!existing) {
      throw new NotFoundException(
        `TcrCompliance record not found for campaignId=${campaign.id}; ` +
          `the agentic compliance flow must be initialized first`,
      )
    }

    if (existing.peerlyIdentityId) {
      return this.buildSubmitToPeerlyResponse(existing)
    }

    // Billing-outage hold: a prior submission hit Peerly's unrecoverable
    // "No payment method available" billing error. Retrying re-fails and spams
    // Peerly, so an agent resume / kickoff re-dispatch that lands here during
    // the cooldown is refused before touching Peerly — this is what breaks the
    // retry storm. The cooldown lets it probe again automatically once billing
    // clears.
    if (
      existing.peerlyBillingBlockedAt &&
      isAfter(
        existing.peerlyBillingBlockedAt,
        subMinutes(new Date(), PEERLY_BILLING_BLOCK_COOLDOWN_MINUTES),
      )
    ) {
      throw new ServiceUnavailableException(
        'Peerly Campaign Verify submission is on hold: Peerly reported a ' +
          `billing/account issue ("${PEERLY_NO_PAYMENT_METHOD_MESSAGE}"). ` +
          'Retrying is paused until the billing issue clears.',
      )
    }

    // Stage gate: only proceed when the candidate's website is live + the
    // domain is registered (derived stage = awaiting_pin with identity still
    // null). Reject all earlier stages so an agent can't kick a Peerly brand
    // submission for an unverified/unregistered domain.
    const stageBeforeSubmit =
      await this.complianceStateService.getStageForCampaign(campaign.id)
    if (stageBeforeSubmit !== ComplianceStage.awaiting_pin) {
      throw new UnprocessableEntityException(
        `Cannot submit TCR registration to Peerly until the candidate's ` +
          `website is published and live. Current compliance stage: ` +
          `${stageBeforeSubmit}. Wait for stage = awaiting_pin.`,
      )
    }

    // Content gate: never submit templated / too-short content to Peerly — it
    // is rejected as "not genuine". Read the persisted website (source of
    // truth), not the request input, so a retry can't smuggle content past it.
    const content = await this.websitesService.getContentForCampaign(
      campaign.id,
    )
    if (isGenericComplianceContent(content)) {
      throw new BadRequestException(
        'Website content is not genuine enough to submit for 10DLC ' +
          'compliance: the candidate must add a real bio (>= ' +
          `${MIN_BIO_LENGTH} characters) and at least one real issue before ` +
          'submission.',
      )
    }

    // Source the website host from the campaign's registered domain (the apex
    // name, matching the legacy create() path), not from the agent request.
    // The awaiting_pin stage gate above guarantees the domain is registered
    // and the site is live, so a domain always exists here.
    const { domain } = await this.websitesService.findFirstOrThrow({
      where: { campaignId: campaign.id },
      include: { domain: true },
    })
    if (!domain) {
      throw new BadRequestException(
        'Campaign must have a domain to submit TCR compliance',
      )
    }
    const hostname = domain.name.replace(/^www\./, '')

    // Every Peerly field is sourced from the persisted TcrCompliance record —
    // the agent request is not trusted (the compliance_setup instruction
    // already promises gp-api reads the candidate's saved details itself).
    // Re-apply PR #643's filing-URL guards to the persisted value: a record
    // saved before that guard shipped can still carry a goodparty.org page,
    // the candidate's own campaign site, or (non-federal) an FEC filing URL,
    // all of which CampaignVerify deterministically rejects.
    const filingCheck = submitToPeerlyFilingSchema.safeParse({
      filingUrl: existing.filingUrl,
      officeLevel: existing.officeLevel,
      websiteHost: hostname,
    })
    if (!filingCheck.success) {
      throw new BadRequestException(
        filingCheck.error.issues.map((issue) => issue.message).join('; '),
      )
    }

    // The agent resolves the FEC committee id by scraping FEC public records,
    // which is unreliable — so it may be absent. The federal requirement is
    // enforced here against the value persisted on the TcrCompliance row (e.g.
    // backfilled by staff), re-checking presence + format so a federal brand
    // never reaches Peerly without a valid committee id.
    const fecCommitteeId = existing.fecCommitteeId ?? undefined
    if (existing.officeLevel === OfficeLevel.federal) {
      if (!fecCommitteeId) {
        throw new BadRequestException(
          'FEC Committee ID is required for federal office level',
        )
      }
      if (!FEC_COMMITTEE_ID_PATTERN.test(fecCommitteeId)) {
        throw new BadRequestException(
          'FEC Committee ID must be "C" followed by 8 digits (e.g., C00123456)',
        )
      }
    }

    // Pre-submission validation gate (ENG-10965): catches a junk filing URL,
    // a candidate name CampaignVerify can't find on the filing page, or a
    // filing that hasn't commenced, before any Peerly call. Runs before the
    // claim below so a held/transient outcome never claims the record.
    await this.assertCvPreSubmissionValid(existing, user, campaign)

    // Pre-Peerly claim: only one concurrent caller may proceed past this
    // point. The TTL allows re-claim if a prior caller crashed mid-flight
    // without clearing its claim.
    //
    // Also scoped to cvValidationFailedAt: null — the mirror image of the
    // race the failure claim above guards against. This gate runs before
    // this claim and re-reads nothing from the DB in between, so a
    // concurrent caller's 'passed' verdict (read before a slower caller's
    // 'failed' verdict won the failure claim) must not be allowed to win
    // this claim and submit to Peerly on a now-held record. Whichever claim
    // lands first — this one or the failure claim above — blocks the other.
    const staleBefore = subMinutes(
      new Date(),
      PEERLY_SUBMISSION_CLAIM_TTL_MINUTES,
    )
    const claimTimestamp = new Date()
    const claim = await this.model.updateMany({
      where: {
        id: existing.id,
        peerlyIdentityId: null,
        cvValidationFailedAt: null,
        OR: [
          { peerlySubmissionStartedAt: null },
          { peerlySubmissionStartedAt: { lt: staleBefore } },
        ],
      },
      data: { peerlySubmissionStartedAt: claimTimestamp },
    })

    if (claim.count === 0) {
      const current = await this.fetchByCampaignId(campaign.id)
      if (current?.peerlyIdentityId) {
        return this.buildSubmitToPeerlyResponse(current)
      }
      if (current?.cvValidationFailedAt) {
        throw new CvPreSubmissionValidationException(
          current.cvValidationFailureReasons,
        )
      }
      throw new ConflictException(
        `A Peerly submission is already in progress for ` +
          `campaignId=${campaign.id}; retry in a few seconds.`,
      )
    }

    const helperPayload: CreateTcrCompliancePayload = {
      ein: existing.ein,
      committeeName: existing.committeeName,
      filingUrl: existing.filingUrl,
      email: existing.email,
      phone: existing.phone,
      officeLevel: existing.officeLevel,
      fecCommitteeId,
      committeeType: existing.committeeType,
      candidateName: existing.candidateName,
      websiteDomain: hostname,
      // A record created from a manual address entry carries its structured
      // components; passing them through makes the Peerly submits read them
      // instead of resolving campaign.placeId.
      manualAddress:
        existing.filingAddressLine1 &&
        existing.filingCity &&
        existing.filingState &&
        existing.filingZip
          ? {
              addressLine1: existing.filingAddressLine1,
              addressLine2: existing.filingAddressLine2 ?? undefined,
              city: existing.filingCity,
              state: existing.filingState,
              zip: existing.filingZip,
            }
          : undefined,
    }

    let peerlyResult: PeerlySubmissionResult
    try {
      peerlyResult = await this.submitToPeerly(
        user,
        campaign,
        helperPayload,
        hostname,
      )
    } catch (error) {
      // Roll back this caller's claim and, on a billing outage, stamp the hold
      // in ONE transaction. If these were separate writes, a crash between them
      // could release the claim while leaving peerlyBillingBlockedAt unset — the
      // next resume would then find no cooldown, bypass the guard, and re-storm
      // Peerly, which is exactly what the hold prevents.
      let rejectedStamped = false
      try {
        let ownedClaim = false
        await this.client.$transaction(async (tx) => {
          // Roll back only this caller's claim by matching the exact timestamp
          // we wrote. A TTL re-claimant (caller B, after our call exceeded TTL)
          // will have a different timestamp, so its in-flight claim isn't
          // disturbed.
          const released = await tx.tcrCompliance.updateMany({
            where: {
              id: existing.id,
              peerlyIdentityId: null,
              peerlySubmissionStartedAt: claimTimestamp,
            },
            data: { peerlySubmissionStartedAt: null },
          })
          // released.count === 0 means a TTL re-claimant owns the record now;
          // only the claim owner may stamp rejected (and fire the event),
          // otherwise both callers would emit for the same rejection.
          ownedClaim = released.count > 0
          if (error instanceof PeerlyBillingException) {
            await tx.tcrCompliance.update({
              where: { id: existing.id },
              data: { peerlyBillingBlockedAt: new Date() },
            })
          }
          if (error instanceof PeerlyCvRejectionException && ownedClaim) {
            // A CV data rejection re-fails deterministically until the
            // candidate corrects their filing details, and createAgentic
            // treats `rejected` as retryable (delete + recreate), so this is
            // the designed lifecycle state — not a dead end.
            await tx.tcrCompliance.update({
              where: { id: existing.id },
              data: { status: TcrComplianceStatus.rejected },
            })
          }
        })
        rejectedStamped = ownedClaim
      } catch (rollbackErr) {
        // If the rollback/stamp transaction itself fails, the claim TTL will
        // release the held claim later. Log and fall through so the original
        // error (e.g. PeerlyBillingException) is always the one rethrown.
        this.logger.error(
          { rollbackErr, campaignId: campaign.id },
          '[TCR Compliance] Failed to roll back Peerly submission claim; ' +
            'TTL will recover',
        )
      }
      // Only fire once the rejected stamp actually committed: if the rollback
      // transaction failed, the record stays non-rejected and the
      // deterministic retry would fire this event a second time.
      if (error instanceof PeerlyCvRejectionException && rejectedStamped) {
        void this.analytics
          .track(user.id, EVENTS.Outreach.ComplianceRejected, {
            rejection_source: 'cv_submit',
            rejection_reason: error.message,
            ...(campaign.data.hubspotId
              ? { company_hubspot_id: campaign.data.hubspotId }
              : {}),
          })
          .catch(() => undefined)
      }
      throw error
    }

    const updated = await this.model.update({
      where: { id: existing.id },
      data: {
        // Every Peerly field was already sourced from this record; only the
        // canonical website host, postal address, and the Peerly result need
        // persisting back. A manual-address record keeps its composed postal
        // address — campaign.formattedAddress may hold an unrelated address
        // from another flow.
        websiteDomain: hostname,
        postalAddress: existing.filingAddressLine1
          ? existing.postalAddress
          : (campaign.formattedAddress ?? existing.postalAddress),
        peerlyIdentityId: peerlyResult.peerlyIdentityId,
        peerlyIdentityProfileLink: peerlyResult.peerlyIdentityProfileLink,
        peerly10DLCBrandSubmissionKey:
          peerlyResult.peerly10DLCBrandSubmissionKey,
        // Peerly's GET-CV-request response doesn't carry verification_id, so
        // when the helper skipped CV submission (existing CV found), it
        // returns null. Fall back to the persisted value so a real ID isn't
        // overwritten on retry.
        peerlyCvVerificationId:
          peerlyResult.cvVerificationId ?? existing.peerlyCvVerificationId,
        // Submission succeeded — clear any prior billing hold.
        peerlyBillingBlockedAt: null,
      },
    })

    this.logger.info(
      `[TCR Compliance] submitToPeerlyForAgent complete for ` +
        `campaignId=${campaign.id}, tcrComplianceId=${updated.id}, ` +
        `peerlyIdentityId=${updated.peerlyIdentityId}`,
    )

    return this.buildSubmitToPeerlyResponse(updated)
  }

  private async buildSubmitToPeerlyResponse(
    record: TcrCompliance,
  ): Promise<SubmitToPeerlyOutput> {
    // Stage-only lookup: findStateForCampaign now fires a Peerly retrieve_cv
    // call at awaiting_pin, which must not sit on this write-completion path.
    const stage = await this.complianceStateService.getStageForCampaign(
      record.campaignId,
    )
    if (!record.peerlyIdentityId) {
      throw new BadGatewayException(
        `Cannot build submit-to-peerly response for tcrComplianceId=` +
          `${record.id}: peerlyIdentityId is unexpectedly null`,
      )
    }
    return {
      tcrComplianceId: record.id,
      peerlyIdentityId: record.peerlyIdentityId,
      peerlyIdentityProfileLink: record.peerlyIdentityProfileLink,
      peerly10DLCBrandSubmissionKey: record.peerly10DLCBrandSubmissionKey,
      peerlyVerificationId: record.peerlyCvVerificationId,
      stage,
      pinDeliveryChannels: { email: record.email, phone: record.phone },
    }
  }

  async createAgentic(
    user: User,
    campaign: Campaign,
    payload: CreateAgenticTcrCompliancePayload,
  ) {
    if (!user.clerkId) {
      throw new BadRequestException(
        'User must have a Clerk ID to start the agentic compliance flow',
      )
    }

    const existing = await this.fetchByCampaignId(campaign.id)
    const isRetryableFailure =
      existing?.status === TcrComplianceStatus.error ||
      existing?.status === TcrComplianceStatus.rejected

    if (existing && !isRetryableFailure) {
      // Recovery path for a held pre-submission validation failure or an
      // admin override (ENG-10965): no Peerly identity exists yet on such a
      // record (the gate runs before any Peerly call), so updating the
      // corrected filing data in place is safe. Clear both the hold and the
      // override so the next submission attempt re-validates instead of
      // reusing a stale verdict or a stale bypass — an override is scoped to
      // the data it was granted for; new data must be checked fresh.
      if (
        (existing.cvValidationFailedAt || existing.cvValidationOverriddenAt) &&
        !existing.peerlyIdentityId &&
        (payload.filingUrl !== existing.filingUrl ||
          payload.candidateName !== existing.candidateName)
      ) {
        const updated = await this.model.update({
          where: { id: existing.id },
          data: {
            filingUrl: payload.filingUrl,
            candidateName: payload.candidateName,
            cvValidationFailedAt: null,
            cvValidationFailureReasons: [],
            cvValidationOverriddenAt: null,
          },
        })
        return { record: updated, created: false }
      }
      return { record: existing, created: false }
    }

    const {
      ein,
      committeeName,
      websiteDomain,
      placeId,
      formattedAddress,
      manualAddress,
      ...rest
    } = payload

    let record: TcrCompliance
    try {
      record = await this.client.$transaction(
        async (tx) => {
          // Manual entry leaves campaign.placeId/formattedAddress untouched:
          // they may carry an address from another flow (e.g. onboarding)
          // that other features read, and the compliance address lives on
          // the TcrCompliance columns in that case.
          const updatedCampaign = await this.campaignsService.updateJsonFields(
            campaign.id,
            {
              details: {
                einNumber: ein,
                campaignCommittee: committeeName,
              },
              placeId,
              formattedAddress,
            },
            false,
            undefined,
            tx,
          )

          if (!updatedCampaign) {
            throw new NotFoundException(
              `Campaign ${campaign.id} not found while updating compliance details`,
            )
          }

          if (existing) {
            await tx.tcrCompliance.deleteMany({ where: { id: existing.id } })
          }

          return tx.tcrCompliance.create({
            data: {
              ...rest,
              ein,
              committeeName,
              websiteDomain: websiteDomain ?? '',
              postalAddress: manualAddress
                ? formatManualFilingAddress(manualAddress)
                : (updatedCampaign.formattedAddress ?? ''),
              ...manualFilingAddressColumns(manualAddress),
              campaignId: campaign.id,
            },
          })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (err) {
      if (isPrismaError(err, 'P2002')) {
        const raced = await this.fetchByCampaignId(campaign.id)
        if (raced) {
          this.logger.info(
            `[TCR Compliance] Agentic kickoff lost race for campaignId=${campaign.id}; returning record created by parallel request`,
          )
          return { record: raced, created: false }
        }
        this.logger.error(
          { err, campaignId: campaign.id, target: err.meta?.target },
          '[TCR Compliance] P2002 on create with no racing record found — likely a unique constraint other than campaignId',
        )
        throw new BadGatewayException(
          'Failed to create TCR compliance record due to a constraint violation',
        )
      }
      throw err
    }

    // Pre-payment submissions defer dispatch to the payment
    // webhook so the agent never provisions a domain/site for an unpaid
    // candidate. Already-Pro submissions (post-payment
    // resubmission) enqueue immediately, as before.
    if (campaign.isPro) {
      try {
        await this.claimAndEnqueueKickoff(record, user.clerkId)
      } catch (err) {
        try {
          await this.model.update({
            where: { id: record.id },
            data: { status: TcrComplianceStatus.error },
          })
        } catch (updateErr) {
          this.logger.error(
            { updateErr, tcrComplianceId: record.id },
            '[TCR Compliance] Failed to mark record as error after SQS send failure; sweep will recover',
          )
        }
        throw err
      }
    }

    try {
      await this.crmCampaignsService.trackCampaign(campaign.id)
    } catch (err) {
      this.logger.error(
        { err, campaignId: campaign.id },
        '[TCR Compliance] CRM tracking failed after agentic kickoff enqueued; agent run will continue',
      )
    }

    this.logger.info(
      `[TCR Compliance] Agentic flow kicked off for campaignId=${campaign.id}, tcrComplianceId=${record.id}`,
    )

    return { record, created: true }
  }

  // Webhook entry point: enqueue the compliance_setup kickoff for a campaign
  // that has already submitted its TCR record but deferred dispatch until
  // payment. No-ops when no record exists yet (candidate paid before filing)
  // — the eventual createAgentic submit will enqueue because the campaign is
  // now Pro.
  async enqueueAgenticKickoffIfNeeded(campaignId: number) {
    const record = await this.fetchByCampaignId(campaignId)
    if (!record) {
      return
    }

    const campaign = await this.campaignsService.findUnique({
      where: { id: campaignId },
      include: { user: true },
    })
    const clerkUserId = campaign?.user?.clerkId
    if (!clerkUserId) {
      this.logger.error(
        { campaignId, tcrComplianceId: record.id },
        '[TCR Compliance] Cannot enqueue agentic kickoff: ' +
          'campaign has no Clerk user',
      )
      return
    }

    await this.claimAndEnqueueKickoff(record, clerkUserId)
  }

  // Single source of the kickoff SQS message shape, shared by createAgentic
  // (already-Pro submit) and the payment webhook. The atomic claim on
  // kickoffSentAt is the idempotency guard: a webhook replay or a
  // submit->pay->submit race finds it already set and short-circuits, so the
  // agent is dispatched exactly once.
  private async claimAndEnqueueKickoff(
    record: TcrCompliance,
    clerkUserId: string,
  ) {
    // Dispatch gate: a run kicked off for a profile that can't pass the
    // publish gate fails terminally at publish_website (profile_incomplete),
    // burning a paid run and stranding the record (nothing retries once
    // kickoffSentAt is stamped). Returning here without claiming leaves
    // kickoffSentAt null — the deferral mechanism: the record stays in the
    // stranded-kickoff sweep's candidate set and dispatches automatically
    // once the candidate authors a genuine bio + policy issue.
    let publishable: boolean
    try {
      const campaign = await this.campaignsService.findUnique({
        where: { id: record.campaignId },
        include: {
          user: true,
          campaignPositions: { include: { topIssue: true } },
        },
      })
      if (!campaign?.user) {
        this.logger.error(
          { campaignId: record.campaignId, tcrComplianceId: record.id },
          '[TCR Compliance] Cannot enqueue agentic kickoff: campaign or ' +
            'its user is missing',
        )
        return
      }
      const content = await this.websitesService.getContentForCampaign(
        record.campaignId,
      )
      publishable = wouldBePublishableAfterFallbacks(
        content,
        campaign.user,
        campaign,
      )
    } catch (err) {
      // A transient fetch failure must not propagate: createAgentic's catch
      // would mark the record `error`, which removes it from the sweep's
      // `submitted` candidate set — stranding it with kickoffSentAt null.
      // Returning without claiming leaves it deferred; the sweep re-evaluates
      // the gate next cycle.
      this.logger.error(
        { err, campaignId: record.campaignId, tcrComplianceId: record.id },
        '[TCR Compliance] Failed to evaluate the kickoff dispatch gate; ' +
          'leaving kickoffSentAt null so the stranded-kickoff sweep retries',
      )
      return
    }
    if (!publishable) {
      this.logger.info(
        { campaignId: record.campaignId, tcrComplianceId: record.id },
        '[TCR Compliance] Deferring agentic kickoff: candidate profile ' +
          'incomplete (no genuine bio/policy issue); the stranded-kickoff ' +
          'sweep dispatches once the profile is completed',
      )
      return
    }

    // Claim before the send so concurrent callers can't both enqueue. Only the
    // caller that flips kickoffSentAt from null wins the claim.
    const claimTimestamp = new Date()
    const claim = await this.model.updateMany({
      where: { id: record.id, kickoffSentAt: null },
      data: { kickoffSentAt: claimTimestamp },
    })
    if (claim.count === 0) {
      return
    }

    try {
      await this.queueService.sendMessage(
        {
          type: QueueType.AGENTIC_COMPLIANCE_KICKOFF,
          data: {
            campaignId: record.campaignId,
            tcrComplianceId: record.id,
            clerkUserId,
          },
        },
        `${MessageGroup.agenticComplianceKickoff}-${record.campaignId}`,
        {
          deduplicationId: `agentic-compliance-${record.id}`,
          throwOnError: true,
        },
      )
    } catch (err) {
      // Roll back only this caller's claim by matching the exact timestamp we
      // wrote, leaving kickoffSentAt null so the stranded-kickoff sweep can
      // re-enqueue it.
      await this.model.updateMany({
        where: { id: record.id, kickoffSentAt: claimTimestamp },
        data: { kickoffSentAt: null },
      })
      throw err
    }
  }

  async handleAgenticKickoff(message: AgenticComplianceKickoffMessage) {
    const { campaignId, tcrComplianceId, clerkUserId } = message

    const record = await this.model.findUnique({
      where: { id: tcrComplianceId },
    })
    if (!record || record.campaignId !== campaignId) {
      this.logger.warn(
        { campaignId, tcrComplianceId },
        '[TCR Compliance] Kickoff for unknown or mismatched record; dropping',
      )
      return
    }

    const campaign = await this.campaignsService.findUnique({
      where: { id: campaignId },
      include: {
        user: true,
        campaignPositions: { include: { topIssue: true } },
      },
    })
    if (!campaign || !campaign.user) {
      this.logger.warn(
        { campaignId, tcrComplianceId },
        '[TCR Compliance] Kickoff for unknown campaign or user; dropping',
      )
      return
    }

    // campaign.details is a freeform JSON column; electionDate is typed as
    // `string?` in the shadow types but the Zod input schema doesn't enforce
    // YYYY-MM-DD. The agent uses this for {mm}/{month_abbreviation}/{yyyy}
    // placeholder expansion, so a wrong-format value (e.g. "11/02/2027" or
    // "November 2027") would feed malformed substrings into domain generation.
    // Reject at the boundary instead of letting it propagate.
    const electionDate = campaign.details.electionDate
    if (
      !electionDate ||
      !YYYY_MM_DD.test(electionDate) ||
      !isValid(parseISO(electionDate))
    ) {
      this.logger.error(
        { campaignId, tcrComplianceId, electionDate },
        '[TCR Compliance] Cannot dispatch compliance_setup: ' +
          'campaign.details.electionDate is missing or not a valid ' +
          'YYYY-MM-DD date',
      )
      // Guard on agenticRunId IS NULL: an SQS redelivery arriving after a
      // successful dispatch (e.g., user edited the campaign and broke
      // electionDate in between) must not overwrite status on a live record.
      await this.model.updateMany({
        where: { id: tcrComplianceId, agenticRunId: null },
        data: { status: TcrComplianceStatus.error },
      })
      return
    }

    // Peerly TCR submission resolves the postal address from the record's
    // manual filing-address columns or from campaign.placeId
    // (peerlyIdentity.service resolveFilingAddress). With neither, the run
    // publishes a site, reaches website_verified_live, then can't submit —
    // and the agent reports `partial`, so the resume sweep re-dispatches a
    // full paid run every few minutes until it gives up (~$10 burned per
    // stuck candidate). Reject at kickoff so the candidate is told to add
    // their address instead of looping.
    if (!campaign.placeId?.trim() && !record.filingAddressLine1) {
      this.logger.error(
        { campaignId, tcrComplianceId },
        '[TCR Compliance] Cannot dispatch compliance_setup: ' +
          'campaign.placeId is missing and the record has no manual ' +
          'filing address; Peerly requires a postal address',
      )
      await this.model.updateMany({
        where: { id: tcrComplianceId, agenticRunId: null },
        data: { status: TcrComplianceStatus.error },
      })
      return
    }

    // The agent buys a domain and publishes this campaign's website but can't
    // create one or author missing copy. Legacy-Pro candidates reach this flow
    // without the pre-payment candidate-profile step that builds the site, so
    // guarantee a publishable site before dispatch. Runs before the claim:
    // same-campaign kickoffs are serialized by the FIFO message group, and a
    // failure here redelivers cleanly with no claim to roll back.
    await this.websitesService.ensureCompliancePublishableWebsite(
      campaign.user,
      campaign,
    )

    // Defense-in-depth behind the producer-side gate in
    // claimAndEnqueueKickoff: messages enqueued before that gate shipped (or
    // by a path that skips it) can still arrive for a profile the fallbacks
    // above couldn't complete — they never invent a bio or an issue. Without
    // this re-check the run dispatches and fails terminally at
    // publish_website (profile_incomplete). Roll the kickoff claim back to
    // null instead so the record re-enters the deferral loop and the
    // stranded-kickoff sweep dispatches once the profile is completed. The
    // rollback is scoped to the claim timestamp this message was enqueued
    // under (and to no run having been dispatched) so a newer claim isn't
    // cleared. First-pass records only (`agenticRunId` null): a record with
    // a prior run must fall through to the FAILED/SUPERSEDED retake logic
    // below — deferring it here would no-op the rollback (its agenticRunId
    // is set) and strand it with kickoffSentAt stamped, invisible to the
    // sweep.
    if (!record.agenticRunId) {
      const persistedContent =
        await this.websitesService.getContentForCampaign(campaignId)
      if (isGenericComplianceContent(persistedContent)) {
        this.logger.info(
          { campaignId, tcrComplianceId },
          '[TCR Compliance] Deferring dispatch at kickoff: candidate ' +
            'profile incomplete after publish fallbacks; kickoff claim ' +
            'rolled back',
        )
        await this.model.updateMany({
          where: {
            id: tcrComplianceId,
            agenticRunId: null,
            kickoffSentAt: record.kickoffSentAt,
          },
          data: { kickoffSentAt: null },
        })
        return
      }
    }

    // Atomic claim before dispatchRun to prevent duplicate dispatches under
    // at-least-once SQS delivery (consumer crashes, redelivery, concurrent
    // workers). Pattern mirrors the Peerly submission claim above. The claim
    // is keyed by agenticRunId being null (no successful dispatch yet) and
    // either no in-flight claim or a stale one past TTL.
    const staleBefore = subMinutes(
      new Date(),
      AGENTIC_DISPATCH_CLAIM_TTL_MINUTES,
    )
    const claimTimestamp = new Date()
    let isRecovery = false
    const claim = await this.model.updateMany({
      where: {
        id: tcrComplianceId,
        agenticRunId: null,
        OR: [
          { agenticDispatchAttemptedAt: null },
          { agenticDispatchAttemptedAt: { lt: staleBefore } },
        ],
      },
      data: { agenticDispatchAttemptedAt: claimTimestamp },
    })

    if (claim.count === 0) {
      // Idempotency branches intentionally exclude FAILED from the skip path.
      // Per gp-api/CLAUDE.md "Idempotency check breadth", FAILED runs must
      // remain eligible for re-dispatch — dispatchRun writes RUNNING then
      // flips to FAILED on SQS-send failure, and a dead Fargate task is
      // reconciled to FAILED by the gp-ai-projects ECS task-reaper; including
      // FAILED here would permanently strand both.
      const current = await this.model.findUnique({
        where: { id: tcrComplianceId },
      })
      if (!current) {
        return
      }
      if (current.agenticRunId) {
        const existingRun = await this.experimentRunsService.findUnique({
          where: { runId: current.agenticRunId },
        })
        // QUEUED / RUNNING / AWAITING_RESUME / COMPLETED mean a live (or resume-
        // pending) run already owns this record, so skip. SUPERSEDED falls
        // through to the retake block below: agenticRunId is never repointed to
        // the resume successor, so a SUPERSEDED predecessor whose successor later
        // FAILED would otherwise strand the record forever — it stays
        // re-dispatchable, exactly as FAILED is.
        if (
          existingRun &&
          (existingRun.status === ExperimentRunStatus.QUEUED ||
            existingRun.status === ExperimentRunStatus.RUNNING ||
            existingRun.status === ExperimentRunStatus.AWAITING_RESUME ||
            existingRun.status === ExperimentRunStatus.COMPLETED)
        ) {
          this.logger.info(
            {
              tcrComplianceId,
              existingRunId: existingRun.runId,
              status: existingRun.status,
            },
            '[TCR Compliance] Agent run already dispatched for record; skipping',
          )
          return
        }
        if (
          existingRun?.status === ExperimentRunStatus.FAILED ||
          existingRun?.status === ExperimentRunStatus.SUPERSEDED
        ) {
          const retake = await this.model.updateMany({
            where: {
              id: tcrComplianceId,
              agenticRunId: current.agenticRunId,
            },
            data: {
              agenticRunId: null,
              agenticDispatchAttemptedAt: claimTimestamp,
            },
          })
          if (retake.count === 0) {
            this.logger.info(
              { tcrComplianceId },
              '[TCR Compliance] Lost race to re-dispatch prior run; skipping',
            )
            return
          }
          // Signal to the agent that this is a re-dispatch over a prior failure;
          // it will consult durable compliance state and skip completed steps
          // instead of restarting from step 1 (re-buying domain, etc.).
          isRecovery = true
        } else {
          // experiment_run row is missing — a concurrent worker is mid-dispatch
          // between its claim and ExperimentRunsService.dispatchRun creating
          // the experiment_run row. SQS will redeliver if that worker crashes
          // (claim TTL clears the slot in <=5min).
          this.logger.info(
            { tcrComplianceId, existingRunId: current.agenticRunId },
            '[TCR Compliance] Concurrent dispatch in progress; skipping',
          )
          return
        }
      } else {
        this.logger.info(
          { tcrComplianceId },
          '[TCR Compliance] Concurrent claim in progress; skipping',
        )
        return
      }
    }

    let run: ExperimentRun | undefined
    try {
      run = await this.experimentRunsService.dispatchRun({
        type: 'compliance_setup',
        organizationSlug: campaign.organizationSlug,
        clerkUserId,
        params: {
          campaign_id: campaignId,
          candidate_first_name: campaign.user.firstName ?? '',
          candidate_last_name: campaign.user.lastName ?? '',
          clerk_user_id: clerkUserId,
          election_date: electionDate,
          trigger: isRecovery ? 'recovery_resume' : 'initial',
        },
      })
    } catch (err) {
      // Roll back only this caller's claim by matching the exact timestamp we
      // wrote. A TTL re-claimant (caller B, after our call exceeded TTL) will
      // have a different timestamp, so its in-flight claim isn't disturbed.
      // agenticRunId: null guards against clearing a parallel success.
      await this.model.updateMany({
        where: {
          id: tcrComplianceId,
          agenticRunId: null,
          agenticDispatchAttemptedAt: claimTimestamp,
        },
        data: { agenticDispatchAttemptedAt: null },
      })
      throw err
    }

    if (!run) {
      // AGENT_DISPATCH_QUEUE_NAME is unset (preview envs by design — see
      // src/agentExperiments/CLAUDE.md). The misconfiguration is permanent
      // for the lifetime of this env, so retrying is futile. Roll back the
      // claim, log loudly, and ack so the message doesn't churn through
      // redrives until DLQ.
      await this.model.updateMany({
        where: {
          id: tcrComplianceId,
          agenticRunId: null,
          agenticDispatchAttemptedAt: claimTimestamp,
        },
        data: { agenticDispatchAttemptedAt: null },
      })
      this.logger.error(
        { campaignId, tcrComplianceId },
        '[TCR Compliance] Agent dispatch queue not configured; ' +
          'discarding kickoff message ' +
          '(set AGENT_DISPATCH_QUEUE_NAME to enable)',
      )
      return
    }

    // Stamp the runId scoped to our claim timestamp. If dispatchRun exceeded
    // the TTL and a re-claimant took over and stamped its own runId, this
    // updateMany matches zero rows — we don't clobber the live claim. The
    // orphaned experiment_run row this caller created is RUNNING; if its
    // Fargate task dies it is reconciled to FAILED by the gp-ai-projects ECS
    // task-reaper (there is no time-based stale sweeper in gp-api).
    const stamped = await this.model.updateMany({
      where: {
        id: tcrComplianceId,
        agenticDispatchAttemptedAt: claimTimestamp,
      },
      data: { agenticRunId: run.runId },
    })

    if (stamped.count === 0) {
      this.logger.error(
        { campaignId, tcrComplianceId, runId: run.runId },
        '[TCR Compliance] Claim expired before dispatch completed; ' +
          'experiment_run is orphaned; a dead task is reconciled to FAILED ' +
          'by the gp-ai-projects ECS task-reaper',
      )
      return
    }

    this.logger.info(
      { campaignId, tcrComplianceId, runId: run.runId },
      '[TCR Compliance] Dispatched compliance_setup agent run',
    )
  }

  async delete(id: string) {
    return this.model.delete({
      where: { id },
    })
  }

  async checkTcrRegistrationStatus(peerlyIdentityId: string) {
    const { campaign } = await this.model.findFirstOrThrow({
      where: { peerlyIdentityId },
      include: {
        campaign: true,
      },
    })
    let useCases: PeerlyIdentityUseCase[]
    try {
      useCases =
        (await this.peerlyIdentityService.getIdentityUseCases(
          peerlyIdentityId,
          campaign,
        )) || []
    } catch (error) {
      if (error instanceof NotFoundException) {
        return false
      }
      throw error
    }

    const useCase = useCases.find(({ usecase }) => usecase === PEERLY_USECASE)
    return Boolean(useCase?.activated)
  }

  async resendCampaignVerifyPin(campaign: Campaign): Promise<void> {
    const tcrCompliance = await this.fetchByCampaignId(campaign.id)
    if (!tcrCompliance) {
      throw new NotFoundException(
        'TCR compliance does not exist for this campaign',
      )
    }
    // Non-prod deploys short-circuit the Peerly submission (see
    // websites.service.ts verifyLive), so there is no real CV request to
    // resend a PIN for; succeed without calling Peerly so testers can walk
    // the admin flow (mirrors retrieveCampaignVerifyToken's bypass).
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') {
      this.logger.info(
        `Non-prod environment detected. Skipping Peerly CV PIN resend for ` +
          `campaign ${campaign.id}.`,
      )
      this.trackCompliancePinResent(campaign, tcrCompliance.peerlyIdentityId)
      return
    }

    if (!tcrCompliance.peerlyIdentityId) {
      throw new UnprocessableEntityException(
        'The Campaign Verify request has not been submitted yet, so there ' +
          'is no PIN to resend.',
      )
    }

    // CV only resends once the request is APPROVED (PIN issued) and rejects a
    // resend after VERIFIED (PIN already consumed); pre-checking the live
    // status turns those into actionable 4xxs instead of an opaque 502.
    const { status } =
      await this.peerlyIdentityService.retrieveCampaignVerifyDetails(
        tcrCompliance.peerlyIdentityId,
        campaign,
      )
    if (status === PeerlyCvVerificationStatus.VERIFIED) {
      throw new ConflictException(
        'The PIN has already been entered and verified for this campaign.',
      )
    }
    if (status !== PeerlyCvVerificationStatus.APPROVED) {
      throw new UnprocessableEntityException(
        `Campaign Verify has not issued a PIN yet (status: ` +
          `${status ?? 'none'}). A PIN can only be resent once the ` +
          'verification request is approved.',
      )
    }

    await this.peerlyIdentityService.resendCampaignVerifyPin(
      tcrCompliance.peerlyIdentityId,
      campaign,
    )
    this.trackCompliancePinResent(campaign, tcrCompliance.peerlyIdentityId)
  }

  // Telemetry only (HubSpot surfaces staff resend activity on the contact) —
  // fire-and-forget so a Segment hiccup can never fail the admin's request.
  private trackCompliancePinResent(
    campaign: Campaign,
    peerlyIdentityId: string | null,
  ) {
    void this.analytics
      .track(campaign.userId, EVENTS.Outreach.CompliancePinResent, {
        triggered_by: 'admin',
        ...(peerlyIdentityId ? { peerly_identity_id: peerlyIdentityId } : {}),
        ...(campaign.data.hubspotId
          ? { company_hubspot_id: campaign.data.hubspotId }
          : {}),
      })
      .catch(() => undefined)
  }

  async retrieveCampaignVerifyToken(
    pin: string,
    { peerlyIdentityId }: TcrCompliance,
  ) {
    // In non-prod deploys, TCR submission to Peerly is short-circuited
    // (see websites.service.ts verifyLive), so there is no real Peerly
    // identity / PIN to verify against. Accept any PIN so testers can
    // exercise the rest of the compliance flow.
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') {
      return NON_PROD_BYPASS_CV_TOKEN
    }
    if (!peerlyIdentityId) {
      throw new BadRequestException(
        'TCR compliance does not have a Peerly identity ID',
      )
    }
    const record = await this.model.findFirstOrThrow({
      where: { peerlyIdentityId },
      include: {
        campaign: { include: { user: true } },
      },
    })
    const { campaign } = record
    // A PIN can only be consumed once: verify_pin rejects an already-VERIFIED
    // CV as an invalid PIN. If an earlier attempt verified the PIN but a
    // downstream Peerly step threw (stranding the record at `submitted`),
    // re-verifying would dead-end the retry with "Invalid PIN". When the CV is
    // already VERIFIED the candidate has proven control, so skip the re-check
    // and mint the token so the retry can finish the flow. The enriched read
    // (same retrieve_cv call as the status-only variant) also carries the PIN
    // delivery channel for the detection below.
    const details =
      await this.peerlyIdentityService.retrieveCampaignVerifyDetails(
        peerlyIdentityId,
        campaign,
      )
    if (details.status !== PeerlyCvVerificationStatus.VERIFIED) {
      // APPROVED is the only state in which a PIN actually exists. REQUESTED,
      // IN_REVIEW, REJECTED and null all mean CampaignVerify never issued one,
      // so forwarding the candidate's guess to verify_pin can only come back
      // rejected — which we then reported as "that PIN didn't match", sending
      // them into an unwinnable retry loop (ENG-10866).
      if (details.status !== PeerlyCvVerificationStatus.APPROVED) {
        throw new CampaignVerifyPinNotIssuedException()
      }
      const pinIsValid =
        await this.peerlyIdentityService.verifyCampaignVerifyPin(
          peerlyIdentityId,
          pin,
          campaign,
        )
      if (!pinIsValid) {
        throw new UnprocessableEntityException('Invalid PIN')
      }
    }

    // The CV is VERIFIED here either way (observed live or via a successful
    // verify_pin). Stamp the persisted mirror so sweepUnsubmittedUsecases'
    // persisted-status filter picks the record up without waiting for the
    // next CV status scan. Any live cvInReviewEscalatedAt claim implies the
    // stored status was IN_REVIEW, so clearing it here is the same
    // leaving-the-state reset the scan performs.
    await this.model.updateMany({
      where: {
        peerlyIdentityId,
        NOT: { peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED },
      },
      data: {
        peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
        peerlyCvStatusChangedAt: new Date(),
        cvInReviewEscalatedAt: null,
      },
    })

    // The VERIFIED stamp above removes the record from the CV scan's poll
    // set, so a candidate who enters their PIN between scans would otherwise
    // never get pinDeliveryMethod recorded or the CompliancePinSent event
    // fired. Run detection off the read this path already made (no extra
    // Peerly call); the status passed is the post-verify truth. Detached +
    // best-effort — Segment/HubSpot must not fail or slow the PIN entry, and
    // the atomic pinSentDetectedAt claim makes a re-run safe.
    void this.applyCvDetection(record, campaign, {
      status: PeerlyCvVerificationStatus.VERIFIED,
      pinDelivery: details.pinDelivery,
    }).catch((err: Error) =>
      this.logger.error(
        { err, tcrComplianceId: record.id },
        '[TCR Compliance] PIN-delivery detection failed after PIN entry; ' +
          'the record has left the CV scan poll set so the PIN Sent event ' +
          'may never fire for it',
      ),
    )

    return await this.peerlyIdentityService.createCampaignVerifyToken(
      peerlyIdentityId,
      campaign,
    )
  }

  async submitCampaignVerifyToken(
    tcrCompliance: TcrCompliance,
    campaignVerifyToken: string,
  ) {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') {
      return undefined
    }
    return this.peerlyIdentityService.submitCampaignVerifyTokenToBrand(
      tcrCompliance,
      campaignVerifyToken,
    )
  }
}
