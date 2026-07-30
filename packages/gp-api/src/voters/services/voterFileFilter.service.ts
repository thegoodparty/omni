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

// Exported so the assistant's saved-filter tool can recognize this exact
// business-rule rejection (and suggest the Pro upgrade) without duplicating
// the string.
export const FILTER_PRO_REQUIRED_MESSAGE = 'Campaign is not pro'

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

      if (
        condition.outreachType === OutreachType.doorKnocking ||
        condition.outreachType === OutreachType.nativeDoorKnocking
      ) {
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

  // Most-recently-saved lists first, capped at `limit` — the overlap-count
  // union (ENG-10840) uses this to find the org's freshest lists once it
  // exceeds MAX_OVERLAP_SAVED_FILTER_SETS, rather than every saved list ever
  // created.
  findRecentByOrganizationSlug(
    organizationSlug: string,
    limit: number,
  ): Promise<VoterFileFilterWithConditions[]> {
    return this.model.findMany({
      where: { organizationSlug },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      take: limit,
      include: ACTIVITY_CONDITIONS_INCLUDE,
    })
  }

  // The org's real total, for the overlap-count truncation log (ENG-10840) —
  // findRecentByOrganizationSlug's `take` caps what it returns, so its result
  // length alone can't tell a genuinely-truncated org apart from one sitting
  // exactly at the fetch limit.
  countByOrganizationSlug(organizationSlug: string): Promise<number> {
    return this.model.count({ where: { organizationSlug } })
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

  // Outreach history for a list-detail page (ENG-10706). Reads the Outreach
  // table directly via `_prisma` (same pattern as validateActivityConditions
  // above) rather than pulling in OutreachModule, which already imports
  // ContactsModule (forwardRef) — a back-edge here would create a genuine
  // module cycle.
  //
  // ENG-10776: legacy `doorKnocking` rows are excluded — the door-knock tool
  // never materializes into this CRM surface (see src/contacts/CLAUDE.md),
  // so a leftover legacy row here is always a stray hand-logged draft, never
  // a real send. `nativeDoorKnocking` stays: those rows are deliberately
  // surfaced in the unified outreach list. Postgres `ORDER BY date DESC`
  // defaults to NULLS FIRST, which would put a null-date legacy row above
  // every real send — `NullsOrder.last` plus a `createdAt` tiebreaker makes
  // the order deterministic for the remaining legacy rows.
  findOutreachesByVoterFileFilterId(voterFileFilterId: number) {
    return this._prisma.outreach.findMany({
      where: {
        voterFileFilterId,
        outreachType: { not: OutreachType.doorKnocking },
      },
      orderBy: [
        {
          date: {
            sort: Prisma.SortOrder.desc,
            nulls: Prisma.NullsOrder.last,
          },
        },
        { createdAt: Prisma.SortOrder.desc },
      ],
      select: {
        id: true,
        name: true,
        outreachType: true,
        status: true,
        date: true,
        createdAt: true,
      },
    })
  }

  async filterAccessCheck(organizationSlug: string): Promise<void> {
    if (organizationSlug.startsWith('campaign-')) {
      const campaign = await this._prisma.campaign.findFirst({
        where: { organizationSlug },
      })

      if (!campaign?.isPro) {
        throw new BadRequestException(FILTER_PRO_REQUIRED_MESSAGE)
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
