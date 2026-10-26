import { BadRequestException, Injectable } from '@nestjs/common'
import { randomInt } from 'node:crypto'
import type Stripe from 'stripe'
import { z } from 'zod'
import {
  encodePrecinctPair,
  ROBOCALL_FREE_OFFER_VARIANT,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { getEnv } from 'src/shared/util/env.util'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ElectionsService } from '@/elections/services/elections.service'
import { CampaignExperimentAssignmentService } from '@/features/services/campaignExperimentAssignment.service'
import { FeaturesService } from '@/features/services/features.service'
import { UNSENT_OUTREACH_STATUSES } from '@/outreach/util/unsentOutreachStatuses.util'
import type { PrecinctLandlines } from '@/peopleDb/databricks/databricksVoter.service'
import type { DbxDistrict } from '@/peopleDb/databricks/databricksVoterSql.util'
import { VoterRecommendedListsService } from '@/peopleDb/services/voterRecommendedLists.service'
import { findEquivalentFilter } from '@/recommendedLists/recommendedListsDedupe.util'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { Campaign, Organization, OutreachType } from '../../generated/prisma'
import {
  MIN_KNOWN_PRECINCTS,
  PRECINCT_ARMS,
  ROBOCALL_FREE_OFFER_ADVISORY_LOCK_KEY,
  ROBOCALL_FREE_OFFER_ARMS,
  ROBOCALL_FREE_OFFER_CODE_PREFIX,
  ROBOCALL_FREE_OFFER_ELECTION_DATE,
  ROBOCALL_FREE_OFFER_EXPERIMENT_KEY,
  ROBOCALL_FREE_OFFER_FLAG,
} from '../robocallFreeOffer.consts'
import { assignPrecincts } from '../robocallFreeOfferAssignment.util'

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

  constructor(
    private readonly features: FeaturesService,
    private readonly experimentAssignments: CampaignExperimentAssignmentService,
    private readonly contacts: ContactsService,
    private readonly reads: VoterRecommendedListsService,
    private readonly elections: ElectionsService,
    private readonly stripe: StripeService,
  ) {
    super()
  }

  // Unset (as in prod until the live coupon exists) hides the offer
  // everywhere: there would be no code to hand out.
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
    return this.resolve(organization, campaign, true)
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
    if (!this.passesCampaignRules(organization, campaign)) return null

    const arm = await this.experimentAssignments.findArm(
      campaign.id,
      ROBOCALL_FREE_OFFER_FLAG,
    )
    if (arm === ROBOCALL_FREE_OFFER_ARMS.withdrawn) return null

    const flagOn = await this.features.isFeatureEnabled({
      user: campaign.userId,
      feature: ROBOCALL_FREE_OFFER_FLAG,
    })
    if (!flagOn) return null
    if (!(await this.passesOutreachAndOwnerRules(organization, campaign)))
      return null
    // Win ICP is a slow rule the stored arm caches, but it is checked ahead
    // of the warehouse read below so a non-ICP campaign never pays for one.
    if (arm === null && !(await this.isWinIcp(organization))) return null

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
    if (!this.passesCampaignRules(organization, campaign)) return null
    const arm = await this.experimentAssignments.findArm(
      campaign.id,
      ROBOCALL_FREE_OFFER_FLAG,
    )
    if (arm !== ROBOCALL_FREE_OFFER_ARMS.offered) return null
    if (
      !(await this.passesOutreachAndOwnerRules(
        organization,
        campaign,
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
  // not the campaign's offer run. Reuses the code from an earlier offer draft
  // while it is still live in Stripe, else mints one.
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

    const earlier = await this.client.outreachRobocall.findFirst({
      where: {
        promoCode: { startsWith: ROBOCALL_FREE_OFFER_CODE_PREFIX },
        outreach: { campaignId: campaign.id },
      },
      orderBy: { outreachId: 'desc' },
      select: { promoCode: true },
    })
    if (earlier?.promoCode) {
      const live = await this.stripe.findActivePromotionCode(earlier.promoCode)
      if (live) return live.code
    }

    const created = await this.stripe.createPromotionCode({
      couponId: this.couponId,
      code: this.newCode(),
      metadata: {
        experiment: ROBOCALL_FREE_OFFER_EXPERIMENT_KEY,
        campaignId: String(campaign.id),
      },
    })
    return created.code
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

  // Rules read straight off the campaign and organization rows.
  private passesCampaignRules(
    organization: Organization,
    campaign: Campaign,
  ): boolean {
    if (!campaign.isPro) return false
    // Win only: there is no product column, and `eo-` is Serve.
    if (!organization.slug.startsWith('campaign-')) return false
    const parsed = CampaignElectionSchema.safeParse(campaign.details)
    const electionDate = parsed.success ? parsed.data.electionDate : null
    return electionDate === ROBOCALL_FREE_OFFER_ELECTION_DATE
  }

  // Rules that need other tables: has sent texts, has booked no robocall,
  // and is not a demo or test-mode campaign. A goodparty.org owner skips
  // that last rule, so staff can check the offer end to end in prod; the
  // readout leaves those campaigns out.
  private async passesOutreachAndOwnerRules(
    organization: Organization,
    campaign: Campaign,
    excludeOutreachId?: number,
  ): Promise<boolean> {
    const [sentSms, bookedRobocall, owner] = await Promise.all([
      this.client.outreach.count({
        where: {
          campaignId: campaign.id,
          outreachType: { in: SMS_OUTREACH_TYPES },
          status: { notIn: UNSENT_OUTREACH_STATUSES },
        },
      }),
      this.client.outreach.count({
        where: {
          campaignId: campaign.id,
          outreachType: OutreachType.robocall,
          status: { notIn: UNSENT_OUTREACH_STATUSES },
          ...(excludeOutreachId === undefined
            ? {}
            : { id: { not: excludeOutreachId } }),
        },
      }),
      this.client.user.findUnique({
        where: { id: campaign.userId },
        select: { email: true },
      }),
    ])
    if (sentSms === 0 || bookedRobocall > 0) return false
    if (owner?.email.toLowerCase().endsWith(INTERNAL_EMAIL_DOMAIN)) return true
    return !campaign.isDemo && organization.testModeCreatedAt === null
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

  private newCode(): string {
    let suffix = ''
    for (let i = 0; i < CODE_LENGTH; i++) {
      suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    }
    return `${ROBOCALL_FREE_OFFER_CODE_PREFIX}${suffix}`
  }
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
