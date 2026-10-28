import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
} from '@nestjs/common'
import { createHmac, randomInt } from 'node:crypto'
import { differenceInCalendarWeeks } from 'date-fns'
import type { ClerkClient } from '@clerk/backend'
import type Stripe from 'stripe'
import { z } from 'zod'
import {
  encodePrecinctPair,
  ROBOCALL_FREE_OFFER_VARIANT,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { TRACKER_STATIC_TASKS_ADVISORY_LOCK_KEY } from '@/campaigns/campaigns.consts'
import { getEnv, requireEnv } from 'src/shared/util/env.util'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { CampaignExperimentAssignmentService } from '@/features/services/campaignExperimentAssignment.service'
import { FeaturesService } from '@/features/services/features.service'
import { UNSENT_OUTREACH_STATUSES } from '@/outreach/util/unsentOutreachStatuses.util'
import type { PrecinctLandlines } from '@/peopleDb/databricks/databricksVoter.service'
import type { DbxDistrict } from '@/peopleDb/databricks/databricksVoterSql.util'
import { VoterRecommendedListsService } from '@/peopleDb/services/voterRecommendedLists.service'
import { findEquivalentFilter } from '@/recommendedLists/recommendedListsDedupe.util'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { clerkCall } from '@/vendors/clerk/util/clerkCall.util'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import {
  Campaign,
  CampaignTaskType,
  Organization,
  OutreachType,
  Prisma,
} from '../../generated/prisma'
import {
  MIN_KNOWN_PRECINCTS,
  PRECINCT_ARMS,
  ROBOCALL_FREE_OFFER_ADVISORY_LOCK_KEY,
  ROBOCALL_FREE_OFFER_ARMS,
  ROBOCALL_FREE_OFFER_CAP_CENTS,
  ROBOCALL_FREE_OFFER_CODE_EXPIRES_AT,
  ROBOCALL_FREE_OFFER_CODE_PREFIX,
  ROBOCALL_FREE_OFFER_ELECTION_DATE,
  ROBOCALL_FREE_OFFER_EXPERIMENT_KEY,
  ROBOCALL_FREE_OFFER_FLAG,
  ROBOCALL_FREE_OFFER_TASK_DESCRIPTION,
  ROBOCALL_FREE_OFFER_TASK_TITLE,
} from '../robocallFreeOffer.consts'
import {
  assignPrecincts,
  isAfterOfferElection,
} from '../robocallFreeOfferAssignment.util'

// Campaign.details is Prisma JSON; `.catch(null)` keeps one off-shape key
// elsewhere in details from hiding a good election date.
const CampaignElectionSchema = z.object({
  electionDate: z.string().nullable().optional().catch(null),
})

const SMS_OUTREACH_TYPES = [OutreachType.text, OutreachType.p2p]

const INTERNAL_EMAIL_DOMAIN = '@goodparty.org'

// Uppercase letters and digits without the ones that read alike (0/O, 1/I).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

type DistrictPrecincts = {
  district: DbxDistrict
  known: PrecinctLandlines[]
}

const precinctKey = (county: string, precinct: string): string =>
  encodePrecinctPair(county, precinct)

// Decides who gets the free election-eve robocall, assigns precincts to
// treatment and control, and hands out the campaign's promotion code. The
// offer resolves to the campaign's treatment precincts (as the `county|
// precinct` pairs a saved list stores) or to null, and every surface and the
// payment path read that one answer.
@Injectable()
export class RobocallFreeOfferService extends createPrismaBase(
  MODELS.RobocallExperimentPrecinct,
) {
  private readonly couponId = getEnv('ROBOCALL_FREE_OFFER_COUPON_ID') || null
  private readonly codeSecret = requireEnv('AUTH_SECRET')

  constructor(
    private readonly features: FeaturesService,
    private readonly experimentAssignments: CampaignExperimentAssignmentService,
    private readonly contacts: ContactsService,
    private readonly reads: VoterRecommendedListsService,
    private readonly elections: ElectionsService,
    private readonly stripe: StripeService,
    @Inject(CLERK_CLIENT_PROVIDER_TOKEN)
    private readonly clerk: ClerkClient,
  ) {
    super()
  }

  // Unset hides the offer everywhere: there would be no code to hand out.
  isConfigured(): boolean {
    return this.couponId !== null
  }

  // What the surfaces ask: the offer list's precincts, or null when the offer
  // does not apply. The first call for an eligible campaign assigns its
  // district's precincts and enrolls it. The flag only gates here, so turning
  // it off hides the offer and stops new assignment but never voids a code a
  // draft already holds.
  async resolveOffer(
    organization: Organization,
    campaign: Campaign,
  ): Promise<string[] | null> {
    const treatment = await this.resolve(organization, campaign, true)
    if (treatment) await this.ensureOfferTask(campaign)
    return treatment
  }

  // Home shows the offer as its plan task, so a campaign that has the offer
  // gets the task the moment gp-api first says so, not only from a launch
  // script that misses whoever enrolls later. Under the static tasks' lock
  // and only once the default rows exist: an early default row would stop
  // materializeStaticTasks from ever building the rest of the plan.
  private async ensureOfferTask(campaign: Campaign): Promise<void> {
    await this.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TRACKER_STATIC_TASKS_ADVISORY_LOCK_KEY}::integer, ${campaign.id}::integer)`
      const existing = await tx.campaignTrackerTask.findFirst({
        where: {
          campaignId: campaign.id,
          title: ROBOCALL_FREE_OFFER_TASK_TITLE,
        },
        select: { id: true },
      })
      if (existing) return
      const hasDefaultRows = await tx.campaignTrackerTask.count({
        where: { campaignId: campaign.id, isDefaultTask: true },
      })
      if (hasDefaultRows === 0) return
      const anchor = await tx.campaignTrackerTask.findFirst({
        where: {
          campaignId: campaign.id,
          isDefaultTask: true,
          phase: 'preLaunch',
        },
        orderBy: { date: Prisma.SortOrder.asc },
        select: { date: true },
      })
      const today = new Date()
      const row = await tx.campaignTrackerTask.create({
        data: {
          campaignId: campaign.id,
          title: ROBOCALL_FREE_OFFER_TASK_TITLE,
          description: ROBOCALL_FREE_OFFER_TASK_DESCRIPTION,
          cta: 'Send outreach',
          flowType: CampaignTaskType.robocall,
          week: anchor
            ? Math.max(0, differenceInCalendarWeeks(today, anchor.date))
            : 0,
          date: today,
          proRequired: true,
          isDefaultTask: true,
          phase: 'gotv',
        },
      })
      await tx.campaignTrackerTask.update({
        where: { id: row.id },
        data: { link: offerTaskLink(row.id) },
      })
    })
  }

  // The same answer without assigning or enrolling anything, for a dry run.
  // A campaign that would be enrolled counts as offered, though its random
  // half could still come out with no landline to call.
  async wouldOffer(
    organization: Organization,
    campaign: Campaign,
  ): Promise<boolean> {
    return (await this.resolve(organization, campaign, false)) !== null
  }

  private async resolve(
    organization: Organization,
    campaign: Campaign,
    assign: boolean,
  ): Promise<string[] | null> {
    if (!this.isConfigured()) return null
    const internal = await this.hasInternalOwner(campaign)
    if (!this.passesCampaignRules(organization, campaign, internal)) return null

    const arm = await this.experimentAssignments.findArm(
      campaign.id,
      ROBOCALL_FREE_OFFER_FLAG,
    )
    if (arm === ROBOCALL_FREE_OFFER_ARMS.withdrawn) return null

    if (!internal) {
      const flagOn = await this.features.isFeatureEnabled({
        user: campaign.userId,
        feature: ROBOCALL_FREE_OFFER_FLAG,
      })
      if (!flagOn) return null
    }
    if (!(await this.passesOutreachRules(organization, campaign, internal)))
      return null
    // Win ICP is a slow rule the stored arm caches, but it is checked ahead
    // of the warehouse read below so a non-ICP campaign never pays for one.
    if (arm === null && !internal && !(await this.isWinIcp(organization)))
      return null

    const precincts = await this.districtPrecincts(organization)
    if (!precincts) return null

    if (arm === ROBOCALL_FREE_OFFER_ARMS.offered) {
      return this.treatmentPairs(precincts)
    }
    if (!assign) {
      return precincts.known.length >= MIN_KNOWN_PRECINCTS ? [] : null
    }
    return this.enroll(campaign, precincts)
  }

  // What the payment path asks: the same answer for an already-enrolled
  // campaign, with the rules that can change since enrollment rechecked and
  // no flag. `excludeOutreachId` is the draft being paid for, so the
  // candidate's own offer run does not count as a robocall already booked.
  async enrolledTreatmentPrecincts(
    organization: Organization,
    campaign: Campaign,
    excludeOutreachId?: number,
  ): Promise<string[] | null> {
    const internal = await this.hasInternalOwner(campaign)
    if (!this.passesCampaignRules(organization, campaign, internal)) return null
    const arm = await this.experimentAssignments.findArm(
      campaign.id,
      ROBOCALL_FREE_OFFER_FLAG,
    )
    if (arm !== ROBOCALL_FREE_OFFER_ARMS.offered) return null
    if (
      !(await this.passesOutreachRules(
        organization,
        campaign,
        internal,
        excludeOutreachId,
      ))
    ) {
      return null
    }
    const precincts = await this.districtPrecincts(organization)
    return precincts ? this.treatmentPairs(precincts) : null
  }

  isOfferPromotionCode(promo: Stripe.PromotionCode): boolean {
    return promo.metadata?.experiment === ROBOCALL_FREE_OFFER_EXPERIMENT_KEY
  }

  // The code is shown on the pay step, so this is what stops it being typed
  // onto another campaign's robocall or onto a list other than the offer's.
  async assertOfferBinding(params: {
    promo: Stripe.PromotionCode
    organization: Organization
    campaign: Campaign
    outreachId: number
    voterFileFilterId: number | null
  }): Promise<void> {
    const { promo, organization, campaign, outreachId, voterFileFilterId } =
      params
    const refuse = () =>
      new BadRequestException(
        'This free offer code only works on your free offer robocall list',
      )
    if (promo.metadata?.campaignId !== String(campaign.id)) throw refuse()
    // A live coupon created with the wrong amount or currency would otherwise
    // be honored as whatever Stripe says it is worth.
    const coupon = promo.promotion.coupon
    if (
      typeof coupon !== 'object' ||
      coupon === null ||
      coupon.amount_off !== ROBOCALL_FREE_OFFER_CAP_CENTS ||
      coupon.currency !== 'usd' ||
      coupon.percent_off != null
    ) {
      this.logger.error(
        { promotionCodeId: promo.id, campaignId: campaign.id },
        'robocall free offer: the offer coupon is not $400 off in usd',
      )
      throw refuse()
    }
    if (voterFileFilterId === null) throw refuse()
    const precincts = await this.enrolledTreatmentPrecincts(
      organization,
      campaign,
      outreachId,
    )
    if (!precincts) throw refuse()
    if (!(await this.isOfferList(organization, voterFileFilterId, precincts))) {
      throw refuse()
    }
  }

  // The code to apply to a fresh robocall draft, or null when the draft is
  // not the campaign's offer run. A campaign has exactly one code, derived
  // from its id, so two drafts opened at once share it and the redeemed-code
  // unique index lets only one of them spend it.
  async codeForDraft(params: {
    organization: Organization
    campaign: Campaign
    outreachId: number
    voterFileFilterId: number
  }): Promise<string | null> {
    const { organization, campaign, outreachId, voterFileFilterId } = params
    if (!this.couponId) return null
    const precincts = await this.enrolledTreatmentPrecincts(
      organization,
      campaign,
      outreachId,
    )
    if (!precincts) return null
    if (!(await this.isOfferList(organization, voterFileFilterId, precincts))) {
      return null
    }

    const code = this.campaignCode(campaign)
    const live = await this.stripe.findActivePromotionCode(code)
    if (live) return live.code
    try {
      const created = await this.stripe.createPromotionCode({
        couponId: this.couponId,
        code,
        metadata: {
          experiment: ROBOCALL_FREE_OFFER_EXPERIMENT_KEY,
          campaignId: String(campaign.id),
        },
        expiresAt: ROBOCALL_FREE_OFFER_CODE_EXPIRES_AT,
      })
      return created.code
    } catch (err) {
      // A concurrent draft created the same code first; Stripe refuses the
      // duplicate, so read the one it kept.
      const raced = await this.stripe.findActivePromotionCode(code)
      if (raced) return raced.code
      throw err
    }
  }

  // An offer run on a staff, demo or test-mode campaign loads only the
  // owner's own phone: those campaigns sit in real districts and the run is
  // free, so it must never reach real voters. Leans toward staff on purpose
  // (either email counts, verified or not), because a wrong yes costs one
  // call to the owner and a wrong no calls a district.
  async dialsOwnerOnly(campaign: Campaign): Promise<boolean> {
    if (campaign.isDemo) return true
    const organization = await this.client.organization.findUnique({
      where: { slug: campaign.organizationSlug },
      select: { testModeCreatedAt: true },
    })
    if (organization?.testModeCreatedAt != null) return true
    const owner = await this.client.user.findUnique({
      where: { id: campaign.userId },
      select: { email: true, clerkId: true },
    })
    if (!owner) return true
    if (owner.email.toLowerCase().endsWith(INTERNAL_EMAIL_DOMAIN)) return true
    if (!owner.clerkId) return false
    const primary = await this.clerkPrimaryEmail(owner.clerkId)
    return (
      primary?.emailAddress.toLowerCase().endsWith(INTERNAL_EMAIL_DOMAIN) ??
      false
    )
  }

  // "THE list": saved from the offer card, untouched, and holding exactly
  // the campaign's treatment precincts. Robocall re-resolves the list at
  // authorize and at staging, and the list is locked on save, so this is
  // what the code is bound to.
  async isOfferList(
    organization: Organization,
    voterFileFilterId: number,
    treatmentPrecincts: string[],
  ): Promise<boolean> {
    const list = await this.client.voterFileFilter.findFirst({
      where: { id: voterFileFilterId, organizationSlug: organization.slug },
      include: { activityConditions: true },
    })
    if (!list) return false
    if (
      list.recommendedVariant !== ROBOCALL_FREE_OFFER_VARIANT ||
      list.recommendedModified !== false ||
      list.hasLandline !== true ||
      list.geoPoly !== null ||
      list.sampleSize !== null
    ) {
      return false
    }
    const expected = offerListFilter(treatmentPrecincts)
    return findEquivalentFilter(list, [{ ...expected, id: list.id }]) !== null
  }

  // A goodparty.org owner skips the eligibility rules (Pro, election date,
  // sent texts, other robocalls booked, demo / test mode, Win ICP and the
  // flag), so staff can run the offer end to end on any of their Win
  // campaigns, in a preview or in prod. What the offer itself needs still
  // applies: Win, before Election Day, the offer used once, and enough
  // precincts to split. The readout leaves these campaigns out.
  //
  // Staff is the owner's Clerk primary email, verified, on goodparty.org.
  // User.email does not count because PUT /v1/users/me sets it with no
  // verification; it only spares everyone else a Clerk round-trip.
  private async hasInternalOwner(campaign: Campaign): Promise<boolean> {
    const owner = await this.client.user.findUnique({
      where: { id: campaign.userId },
      select: { email: true, clerkId: true },
    })
    if (!owner?.clerkId) return false
    if (!owner.email.toLowerCase().endsWith(INTERNAL_EMAIL_DOMAIN)) return false
    // A Clerk outage must not fail every staff dashboard load; not-staff only
    // means the candidate rules apply.
    const primary = await this.clerkPrimaryEmail(owner.clerkId).catch(
      () => null,
    )
    return (
      primary?.verification?.status === 'verified' &&
      primary.emailAddress.toLowerCase().endsWith(INTERNAL_EMAIL_DOMAIN)
    )
  }

  private async clerkPrimaryEmail(clerkId: string) {
    try {
      const user = await clerkCall(
        'users.getUser',
        { 'clerk.user_id': clerkId },
        () => this.clerk.users.getUser(clerkId),
      )
      return user.primaryEmailAddress
    } catch (err) {
      this.logger.error(
        { err, clerkId },
        'robocall free offer: could not read the owner from Clerk',
      )
      throw new BadGatewayException('Failed to read the campaign owner')
    }
  }

  // Rules read straight off the campaign and organization rows.
  private passesCampaignRules(
    organization: Organization,
    campaign: Campaign,
    internal: boolean,
  ): boolean {
    // A used offer ends with the booked-robocall rule; an unused one ends
    // after Election Day, so its saved list goes back to being a plain list.
    if (isAfterOfferElection(new Date())) return false
    // Win only: there is no product column, and `eo-` is Serve.
    if (!organization.slug.startsWith('campaign-')) return false
    if (internal) return true
    if (!campaign.isPro) return false
    const parsed = CampaignElectionSchema.safeParse(campaign.details)
    const electionDate = parsed.success ? parsed.data.electionDate : null
    return electionDate === ROBOCALL_FREE_OFFER_ELECTION_DATE
  }

  // Rules that need other tables: has booked no robocall, has sent texts,
  // and is not a demo or test-mode campaign. For a goodparty.org owner only
  // a booked offer run counts as a robocall, and the other two are skipped.
  private async passesOutreachRules(
    organization: Organization,
    campaign: Campaign,
    internal: boolean,
    excludeOutreachId?: number,
  ): Promise<boolean> {
    const bookedRobocall = await this.client.outreach.count({
      where: {
        campaignId: campaign.id,
        outreachType: OutreachType.robocall,
        status: { notIn: UNSENT_OUTREACH_STATUSES },
        ...(excludeOutreachId === undefined
          ? {}
          : { id: { not: excludeOutreachId } }),
        ...(internal
          ? {
              robocall: {
                promoCode: { startsWith: ROBOCALL_FREE_OFFER_CODE_PREFIX },
              },
            }
          : {}),
      },
    })
    if (bookedRobocall > 0) return false
    if (internal) return true
    if (campaign.isDemo || organization.testModeCreatedAt !== null) return false
    const sentSms = await this.client.outreach.count({
      where: {
        campaignId: campaign.id,
        outreachType: { in: SMS_OUTREACH_TYPES },
        status: { notIn: UNSENT_OUTREACH_STATUSES },
      },
    })
    return sentSms > 0
  }

  // The district's known precincts (the Unknown bucket dropped) with their
  // landline counts. Null when the campaign has no voter district at all, or
  // one too large for a saved list to hold the treatment half.
  private async districtPrecincts(
    organization: Organization,
  ): Promise<DistrictPrecincts | null> {
    let eligible: Awaited<
      ReturnType<ContactsService['resolveEligibleDistrict']>
    >
    try {
      eligible = await this.contacts.resolveEligibleDistrict(organization)
    } catch (err) {
      // No district or no voter data is an ordinary "not offered", not an
      // outage; anything else is.
      if (!(err instanceof BadRequestException)) throw err
      this.logger.info(
        { err, organizationSlug: organization.slug },
        'robocall free offer: no voter district, not offered',
      )
      return null
    }
    const district = await this.reads.resolveDistrict(
      eligible.districtId,
      eligible.dataset,
    )
    const { precincts, truncated } =
      await this.reads.precinctLandlines(district)
    if (truncated) return null
    return {
      district,
      known: precincts.filter(({ precinct }) => precinct !== ''),
    }
  }

  private async assignmentsFor({
    district,
    known,
  }: DistrictPrecincts): Promise<Map<string, string>> {
    const counties = [...new Set(known.map(({ county }) => county))]
    const rows = await this.model.findMany({
      where: {
        experimentKey: ROBOCALL_FREE_OFFER_EXPERIMENT_KEY,
        state: district.state,
        county: { in: counties },
      },
      select: { county: true, precinct: true, arm: true },
    })
    return new Map(
      rows.map((row) => [precinctKey(row.county, row.precinct), row.arm]),
    )
  }

  // Null, not [], when none of the district's current precincts is
  // treatment (the warehouse's precinct names can drift after enrollment):
  // an empty precinct filter would be every landline in the district, the
  // control half included, so such a campaign simply stays control.
  private async treatmentPairs(
    precincts: DistrictPrecincts,
  ): Promise<string[] | null> {
    const arms = await this.assignmentsFor(precincts)
    const treatment = precincts.known
      .map(({ county, precinct }) => precinctKey(county, precinct))
      .filter((key) => arms.get(key) === PRECINCT_ARMS.treatment)
    return treatment.length > 0 ? treatment : null
  }

  // Runs once per campaign, after the slow rules passed; the stored arm
  // caches them. Precincts are assigned under one experiment-wide lock
  // because overlapping districts share them, and inserts that lose a race
  // are dropped and re-read rather than overwritten.
  private async enroll(
    campaign: Campaign,
    precincts: DistrictPrecincts,
  ): Promise<string[] | null> {
    if (precincts.known.length < MIN_KNOWN_PRECINCTS) return null

    const { district, known } = precincts
    await this.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROBOCALL_FREE_OFFER_ADVISORY_LOCK_KEY}::integer, 0)`
      const counties = [...new Set(known.map(({ county }) => county))]
      const existing = await tx.robocallExperimentPrecinct.findMany({
        where: {
          experimentKey: ROBOCALL_FREE_OFFER_EXPERIMENT_KEY,
          state: district.state,
          county: { in: counties },
        },
        select: { county: true, precinct: true, arm: true },
      })
      const arms = new Map(
        existing.map((row) => [precinctKey(row.county, row.precinct), row.arm]),
      )
      const unassigned = known.filter(
        ({ county, precinct }) => !arms.has(precinctKey(county, precinct)),
      )
      const existingTreatment = known.filter(
        ({ county, precinct }) =>
          arms.get(precinctKey(county, precinct)) === PRECINCT_ARMS.treatment,
      ).length
      const assigned = assignPrecincts({
        totalKnown: known.length,
        existingTreatment,
        unassigned,
        randomInt: (max) => randomInt(max),
      })
      if (assigned.length === 0) return
      await tx.robocallExperimentPrecinct.createMany({
        data: assigned.map(({ key, arm, pTreatment }) => ({
          experimentKey: ROBOCALL_FREE_OFFER_EXPERIMENT_KEY,
          state: district.state,
          county: key.county,
          precinct: key.precinct,
          arm,
          pTreatment,
          assignedForDistrictId: district.districtId,
          assignedForCampaignId: campaign.id,
          landlinesAtAssignment: key.landlines,
        })),
        skipDuplicates: true,
      })
    })

    const arms = await this.assignmentsFor(precincts)
    const treatment = known.filter(
      ({ county, precinct }) =>
        arms.get(precinctKey(county, precinct)) === PRECINCT_ARMS.treatment,
    )
    const offered =
      treatment.length > 0 && treatment.some(({ landlines }) => landlines > 0)
    const arm = await this.experimentAssignments.recordArm({
      campaign,
      flagKey: ROBOCALL_FREE_OFFER_FLAG,
      arm: offered
        ? ROBOCALL_FREE_OFFER_ARMS.offered
        : ROBOCALL_FREE_OFFER_ARMS.withdrawn,
    })
    if (arm !== ROBOCALL_FREE_OFFER_ARMS.offered) return null
    return treatment.map(({ county, precinct }) =>
      precinctKey(county, precinct),
    )
  }

  private async isWinIcp(organization: Organization): Promise<boolean> {
    if (!organization.positionId) return false
    const position = await this.elections.getPositionById(
      organization.positionId,
    )
    return position?.isWinIcp === true
  }

  // Keyed with a server secret so a code cannot be worked out from a
  // campaign id. 256 is a multiple of the alphabet's 32, so every letter is
  // equally likely.
  private campaignCode(campaign: Campaign): string {
    const digest = createHmac('sha256', this.codeSecret)
      .update(`${ROBOCALL_FREE_OFFER_EXPERIMENT_KEY}:${campaign.id}`)
      .digest()
    const suffix = [...digest.subarray(0, CODE_LENGTH)]
      .map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length])
      .join('')
    return `${ROBOCALL_FREE_OFFER_CODE_PREFIX}${suffix}`
  }
}

// The task's button opens the robocall flow on the offer list. trackerTaskId
// and phase let the run complete the task once it is scheduled.
export const offerTaskLink = (trackerTaskId: string): string => {
  const params = new URLSearchParams({
    compose: 'robocall',
    recommended: ROBOCALL_FREE_OFFER_VARIANT,
    source: 'campaign_tracker',
    trackerTaskId,
    phase: 'gotv',
  })
  return `/dashboard/outreach?${params.toString()}`
}

// The offer list's saved shape: every landline voter in the treatment
// precincts who has not already voted. The same "Voted in election: Unknown"
// screen as every other non-event recommendation, so a banked vote is not
// called.
export const offerListFilter = (treatmentPrecincts: string[]) => ({
  hasLandline: true,
  votedStatus: ['unknown'],
  precincts: treatmentPrecincts,
})
