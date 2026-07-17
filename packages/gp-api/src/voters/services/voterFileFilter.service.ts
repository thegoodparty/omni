import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { ActivityCondition } from '@/shared/schemas/activityCondition.schema'
import {
  OutreachStatus,
  OutreachType,
  Prisma,
  VoterFileFilter,
} from '../../generated/prisma'
import { CreateVoterFileFilterSchema } from '../schemas/CreateVoterFileFilterSchema'
import { UpdateVoterFileFilterSchema } from '../schemas/UpdateVoterFileFilterSchema'

const ACTIVITY_CONDITIONS_INCLUDE = {
  activityConditions: true,
} as const satisfies Prisma.VoterFileFilterInclude

type VoterFileFilterWithConditions = Prisma.VoterFileFilterGetPayload<{
  include: typeof ACTIVITY_CONDITIONS_INCLUDE
}>

const toActivityConditionCreateInput = (
  conditions: ActivityCondition[],
): Prisma.VoterFileFilterActivityConditionUncheckedCreateWithoutVoterFileFilterInput[] =>
  conditions.map(({ outreachType, outreachId, actions }) => ({
    outreachType,
    outreachId,
    actions,
  }))

@Injectable()
export class VoterFileFilterService extends createPrismaBase(
  MODELS.VoterFileFilter,
) {
  private async validateActivityConditions(
    organizationSlug: string,
    conditions: ActivityCondition[],
  ): Promise<void> {
    for (const condition of conditions) {
      if (condition.outreachId == null) continue

      if (condition.outreachType === OutreachType.doorKnocking) {
        throw new BadRequestException(
          'Door-knocking activity conditions cannot target a specific ' +
            'outreachId — door-knock interactions have no outreach ' +
            'linkage, so door-knock conditions only support "any campaign" ' +
            '(omit outreachId).',
        )
      }

      const outreach = await this._prisma.outreach.findFirst({
        where: {
          id: condition.outreachId,
          OR: [
            { organizationSlug },
            { organizationSlug: null, campaign: { organizationSlug } },
          ],
        },
      })

      if (!outreach) {
        throw new BadRequestException(
          `outreachId ${condition.outreachId} was not found for this organization`,
        )
      }
      if (outreach.outreachType !== condition.outreachType) {
        throw new BadRequestException(
          `outreachId ${condition.outreachId} is a ${outreach.outreachType} ` +
            `campaign, not ${condition.outreachType}`,
        )
      }
      if (outreach.status !== OutreachStatus.completed) {
        throw new BadRequestException(
          `outreachId ${condition.outreachId} has not completed (status: ` +
            `${outreach.status}); activity conditions can only target ` +
            'completed outreach',
        )
      }
    }
  }

  private async assertNotLocked(
    id: number,
    organizationSlug: string,
  ): Promise<void> {
    const existing = await this.model.findFirst({
      where: { id, organizationSlug },
    })
    if (existing?.firstUsedForOutreachAt) {
      throw new ConflictException(
        'This list has already been used for outreach and is locked from ' +
          'edits — duplicate it to make changes.',
      )
    }
  }

  async create(
    organizationSlug: string,
    data: CreateVoterFileFilterSchema,
  ): Promise<VoterFileFilterWithConditions> {
    const { activityConditions, ...rest } = data

    if (activityConditions?.length) {
      await this.validateActivityConditions(
        organizationSlug,
        activityConditions,
      )
    }

    return this.model.create({
      data: {
        organizationSlug,
        ...rest,
        ...(activityConditions
          ? {
              activityConditions: {
                create: toActivityConditionCreateInput(activityConditions),
              },
            }
          : {}),
      },
      include: ACTIVITY_CONDITIONS_INCLUDE,
    })
  }

  async update(
    id: number,
    data: Omit<Prisma.VoterFileFilterUpdateInput, 'campaign' | 'outreach'>,
  ) {
    return this.model.update({
      where: { id },
      data,
    })
  }

  async delete(id: number) {
    return this.model.delete({
      where: { id },
    })
  }

  findByOrganizationSlug(
    slug: string,
  ): Promise<VoterFileFilterWithConditions[]> {
    return this.model.findMany({
      where: { organizationSlug: slug },
      orderBy: { name: 'asc' },
      include: ACTIVITY_CONDITIONS_INCLUDE,
    })
  }

  findByIdAndOrganizationSlug(
    id: number,
    organizationSlug: string,
  ): Promise<VoterFileFilterWithConditions | null> {
    return this.findFirst({
      where: { id, organizationSlug },
      include: ACTIVITY_CONDITIONS_INCLUDE,
    })
  }

  async updateByIdAndOrganizationSlug(
    id: number,
    organizationSlug: string,
    data: UpdateVoterFileFilterSchema,
  ): Promise<VoterFileFilterWithConditions> {
    await this.assertNotLocked(id, organizationSlug)

    const { activityConditions, ...rest } = data

    if (activityConditions?.length) {
      await this.validateActivityConditions(
        organizationSlug,
        activityConditions,
      )
    }

    return this.client.$transaction(async (tx) => {
      if (activityConditions !== undefined) {
        await tx.voterFileFilterActivityCondition.deleteMany({
          where: { voterFileFilterId: id },
        })
        if (activityConditions.length > 0) {
          await tx.voterFileFilterActivityCondition.createMany({
            data: activityConditions.map(
              ({ outreachType, outreachId, actions }) => ({
                voterFileFilterId: id,
                outreachType,
                outreachId,
                actions,
              }),
            ),
          })
        }
      }

      return tx.voterFileFilter.update({
        where: { id, organizationSlug },
        data: rest,
        include: ACTIVITY_CONDITIONS_INCLUDE,
      })
    })
  }

  async deleteByIdAndOrganizationSlug(
    id: number,
    organizationSlug: string,
  ): Promise<VoterFileFilter> {
    await this.assertNotLocked(id, organizationSlug)

    return this.model.delete({
      where: { id, organizationSlug },
    })
  }

  // TODO: Fix the keys for the audience fields in the frontend so we don't have to do this mapping: https://goodparty.atlassian.net/browse/WEB-4277
  // NOTE: This function duplicates field mapping logic with transformRequestToFilters in P2P service.
  // Consider using the shared utility function mapAudienceFields from src/peerly/utils/audienceMapping.util.ts
  // in a future refactor to consolidate this logic and reduce code duplication.
  async voterFileFilterToAudience(idOrFilter: VoterFileFilter | number) {
    const {
      audienceSuperVoters,
      audienceLikelyVoters,
      audienceUnreliableVoters,
      audienceUnlikelyVoters,
      audienceFirstTimeVoters,
      partyIndependent,
      partyDemocrat,
      partyRepublican,
      age18_25,
      age25_35,
      age35_50,
      age50Plus,
      genderMale,
      genderFemale,
      genderUnknown,
      hasCellPhone,
      hasLandline,
      ethnicityEuropean,
      ethnicityAsian,
      ethnicityHispanic,
      ethnicityAfricanAmerican,
    }: Partial<VoterFileFilter> =
      typeof idOrFilter === 'number'
        ? await this.model.findUniqueOrThrow({ where: { id: idOrFilter } })
        : idOrFilter

    return {
      ...(audienceSuperVoters === true
        ? { audience_superVoters: audienceSuperVoters }
        : {}),
      ...(audienceLikelyVoters === true
        ? { audience_likelyVoters: audienceLikelyVoters }
        : {}),
      ...(audienceUnreliableVoters === true
        ? { audience_unreliableVoters: audienceUnreliableVoters }
        : {}),
      ...(audienceUnlikelyVoters === true
        ? { audience_unlikelyVoters: audienceUnlikelyVoters }
        : {}),
      ...(audienceFirstTimeVoters === true
        ? { audience_firstTimeVoters: audienceFirstTimeVoters }
        : {}),
      ...(partyIndependent === true
        ? { party_independent: partyIndependent }
        : {}),
      ...(partyDemocrat === true ? { party_democrat: partyDemocrat } : {}),
      ...(partyRepublican === true
        ? { party_republican: partyRepublican }
        : {}),
      ...(age18_25 === true ? { age_18_25: age18_25 } : {}),
      ...(age25_35 === true ? { age_25_35: age25_35 } : {}),
      ...(age35_50 === true ? { age_35_50: age35_50 } : {}),
      ...(age50Plus === true ? { age_50_plus: age50Plus } : {}),
      ...(genderMale === true ? { gender_male: genderMale } : {}),
      ...(genderFemale === true ? { gender_female: genderFemale } : {}),
      ...(genderUnknown === true ? { gender_unknown: genderUnknown } : {}),
      ...(hasCellPhone === true ? { has_cell_phone: hasCellPhone } : {}),
      ...(hasLandline === true ? { has_landline: hasLandline } : {}),
      ...(ethnicityEuropean === true
        ? { ethnicity_european: ethnicityEuropean }
        : {}),
      ...(ethnicityAsian === true ? { ethnicity_asian: ethnicityAsian } : {}),
      ...(ethnicityHispanic === true
        ? { ethnicity_hispanic: ethnicityHispanic }
        : {}),
      ...(ethnicityAfricanAmerican === true
        ? { ethnicity_african_american: ethnicityAfricanAmerican }
        : {}),
    }
  }

  async filterAccessCheck(organizationSlug: string): Promise<void> {
    if (organizationSlug.startsWith('campaign-')) {
      const campaign = await this._prisma.campaign.findFirst({
        where: { organizationSlug },
      })

      if (!campaign?.isPro) {
        throw new BadRequestException('Campaign is not pro')
      }
    }
  }

  // First-write-wins claim: the `IS NULL` guard makes concurrent callers race
  // safely (exactly one `updateMany` matches the row) with no read-then-write.
  // Deliberately no rollback path — once a filter has been used for outreach,
  // that fact is permanent even if the triggering send later fails, so the
  // lock (and the 409 `assertNotLocked` reads) must never clear. Returns the
  // number of rows this call actually claimed (0 or 1) so callers/tests can
  // observe who won a concurrent race.
  async stampFirstUsedForOutreach(
    id: number,
    organizationSlug: string,
  ): Promise<number> {
    const { count } = await this.model.updateMany({
      where: { id, organizationSlug, firstUsedForOutreachAt: null },
      data: { firstUsedForOutreachAt: new Date() },
    })
    return count
  }
}
