import {
  CampaignLaunchStatus,
  CampaignStatus,
  type Eligibility,
  OnboardingStep,
  type ListCampaignsPagination,
  type RaceMilestones,
} from '@goodparty_org/contracts'
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { Campaign, Prisma, User } from '../../generated/prisma'
import { differenceInMilliseconds, formatISO } from 'date-fns'
import { deepmerge as deepMerge } from 'deepmerge-ts'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { BallotReadyService } from 'src/elections/services/ballotReady.service'
import { ElectionsService } from 'src/elections/services/elections.service'
import {
  CampaignStrategyContextResponse,
  FilingFeeByBrHashResult,
  RaceTargetMetrics,
} from 'src/elections/types/elections.types'
import { formatL2DistrictName } from 'src/campaigns/ai/chat/util/formatDistrictName.util'
import { OrganizationsService } from 'src/organizations/services/organizations.service'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  DEFAULT_PAGINATION_LIMIT,
  DEFAULT_PAGINATION_OFFSET,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER,
} from 'src/shared/constants/paginationOptions.consts'
import { PaginatedResults, WrapperType } from 'src/shared/types/utility.types'
import { objectNotEmpty } from 'src/shared/util/objects.util'
import { toDateOnlyString } from 'src/shared/util/date.util'
import { buildSlug } from 'src/shared/util/slug.util'
import { getUserFullName } from 'src/users/util/users.util'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { AiContentInputValues } from '../ai/content/aiContent.types'
import {
  CampaignPlanVersionData,
  PlanVersion,
  UpdateCampaignFieldsInput,
} from '../campaigns.types'
import { CreateFollowOnCampaignBody } from '../schemas/updateCampaign.schema'
import { FOLLOW_ON_CAMPAIGN_ADVISORY_LOCK_KEY } from '../campaigns.consts'
import { isActiveCampaign } from '../util/eligibility.util'
import { toCampaignGroupTraits } from '../util/campaignGroupTraits.util'
import { CampaignPlanVersionsService } from './campaignPlanVersions.service'
import { CrmCampaignsService } from './crmCampaigns.service'
import { CampaignTasksService } from '../tasks/services/campaignTasks.service'

enum CandidateVerification {
  yes = 'YES',
  no = 'NO',
}

@Injectable()
export class CampaignsService extends createPrismaBase(MODELS.Campaign) {
  constructor(
    @Inject(forwardRef(() => CrmCampaignsService))
    private readonly crm: WrapperType<CrmCampaignsService>,
    private readonly analytics: AnalyticsService,
    private planVersionService: CampaignPlanVersionsService,
    private readonly elections: ElectionsService,
    private readonly ballotReady: BallotReadyService,
    private readonly organizations: OrganizationsService,
    @Inject(forwardRef(() => CampaignTasksService))
    private readonly campaignTasks: WrapperType<CampaignTasksService>,
  ) {
    super()
  }

  findByUserId<T extends Prisma.CampaignInclude>(
    userId: Prisma.CampaignWhereInput['userId'],
    include?: T,
  ) {
    // Prisma include query — TypeScript cannot narrow the included relations at compile time
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return this.findFirst({
      where: { userId },
      include,
    }) as Promise<Prisma.CampaignGetPayload<{ include: T }>>
  }

  // The active-aware counterpart to findByUserId for background call sites that
  // have no X-Organization-Slug context (Stripe webhooks, CRM sync). electionDate
  // lives in the details JSON, so the active campaign is filtered in app code via
  // the shared isActiveCampaign predicate rather than a where clause.
  async findActiveByUserId<T extends Prisma.CampaignInclude>(
    userId: Prisma.CampaignWhereInput['userId'],
    include?: T,
  ): Promise<Prisma.CampaignGetPayload<{ include: T }> | null> {
    const campaigns = await this.findMany({ where: { userId }, include })
    const now = new Date()
    const active = campaigns.find((campaign) => isActiveCampaign(campaign, now))
    // Prisma include query — TypeScript cannot narrow the included relations at compile time
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return (active ?? null) as Prisma.CampaignGetPayload<{ include: T }> | null
  }

  async listCampaigns({
    offset: skip = DEFAULT_PAGINATION_OFFSET,
    limit = DEFAULT_PAGINATION_LIMIT,
    sortBy = DEFAULT_SORT_BY,
    sortOrder = DEFAULT_SORT_ORDER,
    userId,
    slug,
  }: ListCampaignsPagination): Promise<
    PaginatedResults<
      Prisma.CampaignGetPayload<{
        include: {
          organization: {
            select: { customPositionName: true; positionId: true }
          }
        }
      }>
    >
  > {
    const where: Prisma.CampaignWhereInput = {
      ...(userId ? { userId } : {}),
      ...(slug
        ? { slug: { contains: slug, mode: Prisma.QueryMode.insensitive } }
        : {}),
    }

    return {
      data: await this.model.findMany({
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        where,
        include: {
          organization: {
            select: { customPositionName: true, positionId: true },
          },
        },
      }),
      meta: {
        total: await this.model.count({ where }),
        offset: skip,
        limit,
      },
    }
  }

  async create(args: Prisma.CampaignCreateArgs) {
    return await this.model.create(args)
  }

  // TODO: Find a way to make these JSON path lookups type-safe

  async findBySubscriptionId(subscriptionId: string) {
    return this.findFirst({
      where: {
        details: {
          path: ['subscriptionId'],
          equals: subscriptionId,
        },
      },
    })
  }
  // TODO: Find a way to make these JSON path lookups type-safe

  async findByHubspotId(hubspotId: string) {
    return this.findFirst({
      where: {
        data: {
          path: ['hubspotId'],
          equals: hubspotId,
        },
      },
    })
  }
  async createForUser(
    user: User,
    initialData: {
      details: PrismaJson.CampaignDetails
      data?: PrismaJson.CampaignData
    },
    orgPosition?: {
      ballotReadyPositionId?: string
      customPositionName?: string
      // Already-resolved org fields, used by the follow-on "same-office" path
      // to inherit the held office's position without re-resolving BallotReady.
      positionId?: string
      overrideDistrictId?: string
    },
    campaignOverrides?: {
      isPro?: boolean
    },
    // When provided, the org+campaign insert runs inside the caller's
    // transaction (the follow-on path holds a per-user advisory lock around an
    // eligibility re-check). CRM tracking is then the caller's responsibility,
    // after that transaction commits — the row isn't visible to it until then.
    outerTx?: Prisma.TransactionClient,
  ) {
    this.logger.debug(user, 'Creating campaign for user')
    const slug = await this.findSlug(user)

    const baseData: PrismaJson.CampaignData = {
      slug,
    }

    const position = orgPosition?.ballotReadyPositionId
      ? await this.elections.getPositionByBallotReadyId(
          orgPosition.ballotReadyPositionId,
        )
      : null

    const resolvedPositionId = position?.id ?? orgPosition?.positionId ?? null

    const resolvedCustomPositionName = !resolvedPositionId
      ? (orgPosition?.customPositionName ?? null)
      : null

    const insert = async (tx: Prisma.TransactionClient) => {
      const [{ nextval: id }] = await tx.$queryRaw<[{ nextval: bigint }]>`
        SELECT nextval('campaign_id_seq')`

      const campaignId = Number(id)
      const orgSlug = OrganizationsService.campaignOrgSlug(campaignId)

      this.logger.info(
        {
          ballotReadyPositionId: orgPosition?.ballotReadyPositionId,
          position,
          campaignId,
          orgSlug,
        },
        'Creating organization',
      )

      await tx.organization.create({
        data: {
          slug: orgSlug,
          ownerId: user.id,
          positionId: resolvedPositionId,
          overrideDistrictId: orgPosition?.overrideDistrictId ?? null,
          customPositionName: resolvedCustomPositionName,
        },
      })

      const mergedDetails = deepMerge(
        { zip: user.zip } as object,
        initialData.details as object,
      ) as PrismaJson.CampaignDetails

      return tx.campaign.create({
        data: {
          id: campaignId,
          slug,
          organizationSlug: orgSlug,
          isActive: false,
          isPro: campaignOverrides?.isPro ?? false,
          userId: user.id,
          details: mergedDetails,
          data: initialData.data
            ? deepMerge(baseData, initialData.data)
            : baseData,
        },
      })
    }

    const newCampaign = outerTx
      ? await insert(outerTx)
      : await this.client.$transaction(insert)

    this.logger.debug({ newCampaign }, 'Created campaign')

    if (!outerTx) {
      await this.crm.trackCampaign(newCampaign.id)
    }

    return newCampaign
  }

  // Creates a follow-on campaign (a re-election or a run for a new office) for
  // a user who already holds office. Reuses createForUser's org+campaign
  // transaction; the new org becomes the active one by derivation (it carries
  // the only active campaign). Eligibility is re-checked here under a per-user
  // advisory lock so two concurrent requests can't both create a campaign.
  async createFollowOn(
    user: User,
    body: CreateFollowOnCampaignBody,
    eligibility: Eligibility,
  ) {
    // Resolve the inherited position + Pro source before taking the lock, so
    // the serialized section is just the eligibility re-check + insert.
    const { orgPosition, isPro, electionDate } =
      await this.resolveFollowOnInputs(user, body, eligibility)

    // For same-office the electionDate is server-authoritative (resolved from
    // election-api, falling back to the term end). Strip any client-supplied
    // electionDate so a direct API caller can't inject one and slip past the
    // guard below when the server resolves none. New-office legitimately
    // carries the picked office's date in body.details, so leave it intact.
    const clientDetails: PrismaJson.CampaignDetails = {
      ...(body.details ?? {}),
    }
    if (body.intent === 'same-office') {
      delete clientDetails.electionDate
    }

    const initialData = {
      details: {
        ...clientDetails,
        ...(electionDate ? { electionDate } : {}),
      } as PrismaJson.CampaignDetails,
      data: body.data as PrismaJson.CampaignData | undefined,
    }

    // A same-office re-election carries no client-supplied office details, so
    // its electionDate must come from resolveFollowOnInputs. Without one,
    // derive-on-read marks the new campaign "past" — mislabeling the switcher
    // and leaving canStartCampaign true (unlimited duplicate re-elections). Fail
    // loudly rather than create that broken campaign.
    if (body.intent === 'same-office' && !initialData.details.electionDate) {
      void this.analytics
        .track(user.id, EVENTS.Campaigns.FollowOnBlocked, {
          intent: body.intent,
          reason: 'unresolved_election_date',
        })
        .catch(() => undefined)
      throw new BadRequestException({
        message: 'Could not determine the next election date for this office',
        errorCode: 'UNRESOLVED_ELECTION_DATE',
      })
    }

    const newCampaign = await this.client.$transaction(async (tx) => {
      // The second concurrent request blocks here until the first commits,
      // then its re-check below sees the freshly-created active campaign.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FOLLOW_ON_CAMPAIGN_ADVISORY_LOCK_KEY}::integer, ${user.id}::integer)`

      const now = new Date()
      const existing = await tx.campaign.findMany({
        where: { userId: user.id },
      })
      if (existing.some((campaign) => isActiveCampaign(campaign, now))) {
        void this.analytics
          .track(user.id, EVENTS.Campaigns.FollowOnBlocked, {
            intent: body.intent,
            reason: 'concurrent_active_campaign',
          })
          .catch(() => undefined)
        throw new ConflictException(
          'User is not eligible to start a new campaign',
        )
      }

      return this.createForUser(user, initialData, orgPosition, { isPro }, tx)
    })

    await this.crm.trackCampaign(newCampaign.id)

    // The new campaign gets its own org-scoped group so its facts don't
    // overwrite the prior campaign's on the user identity.
    void this.analytics
      .group(
        user.id,
        newCampaign.organizationSlug,
        toCampaignGroupTraits(newCampaign.details ?? {}),
      )
      .catch(() => undefined)

    void this.analytics
      .track(user.id, EVENTS.Campaigns.FollowOnCreated, {
        campaignId: newCampaign.id,
        intent: body.intent,
        isPro,
        inheritedFromOrganizationSlug: body.fromOrganizationSlug,
        electionDate,
      })
      .catch(() => undefined)

    return newCampaign
  }

  private async resolveFollowOnInputs(
    user: User,
    body: CreateFollowOnCampaignBody,
    eligibility: Eligibility,
  ): Promise<{
    orgPosition: {
      ballotReadyPositionId?: string
      customPositionName?: string
      positionId?: string
      overrideDistrictId?: string
    }
    isPro: boolean
    electionDate: string | null
  }> {
    if (body.intent === 'same-office') {
      if (!body.fromOrganizationSlug) {
        throw new BadRequestException(
          'fromOrganizationSlug is required for a same-office follow-on',
        )
      }

      const sourceOrg = await this.organizations.findFirst({
        where: { slug: body.fromOrganizationSlug, ownerId: user.id },
        include: { electedOffice: { include: { campaign: true } } },
      })

      if (!sourceOrg) {
        throw new NotFoundException('Source organization not found')
      }

      // A same-office run inherits the held office; the source must be an
      // elected-office org. Any other owned org (e.g. a campaign-* org) would
      // pass the ownership guard but inherit the wrong position and silently
      // strip isPro (no electedOffice.campaign to read it from).
      if (!sourceOrg.electedOffice) {
        void this.analytics
          .track(user.id, EVENTS.Campaigns.FollowOnBlocked, {
            intent: body.intent,
            reason: 'invalid_source_org',
          })
          .catch(() => undefined)
        throw new BadRequestException(
          'fromOrganizationSlug must reference an elected-office organization',
        )
      }

      // The re-election runs in the position's next upcoming election. Resolve
      // that real date from election-api. The term-end proxy is only a fallback
      // for when election-api can't answer (null = unreachable / no position):
      // a definitive { electionDate: null } means the position has no upcoming
      // general, so honor that null rather than overriding it with the cadence
      // guess — the guard below then refuses to create a campaign with no
      // electionDate (derive-on-read would mark it "past", mislabeling the
      // switcher and leaving canStartCampaign true for unlimited duplicates).
      // Elected-office orgs historically stored a BallotReady position id in
      // positionId; next-election keys on election-api's internal Position id.
      // Resolve to the internal id (newer orgs already store it and pass
      // through) before dating the run and before carrying it onto the new
      // campaign org.
      const internalPositionId = sourceOrg.positionId
        ? await this.elections.resolveInternalPositionId(sourceOrg.positionId)
        : null
      const nextElection = internalPositionId
        ? await this.elections.getNextElectionForPosition(internalPositionId)
        : null

      return {
        orgPosition: {
          positionId: internalPositionId ?? undefined,
          overrideDistrictId: sourceOrg.overrideDistrictId ?? undefined,
          customPositionName: sourceOrg.customPositionName ?? undefined,
        },
        isPro: sourceOrg.electedOffice.campaign?.isPro ?? false,
        electionDate:
          nextElection !== null
            ? nextElection.electionDate
            : (toDateOnlyString(sourceOrg.electedOffice.termEndDate) ?? null),
      }
    }

    return {
      orgPosition: {
        ballotReadyPositionId: body.ballotReadyPositionId ?? undefined,
        customPositionName: body.customPositionName ?? undefined,
      },
      isPro: await this.proFromOfficeOrg(
        eligibility.reelectionOfficeSlug,
        user.id,
      ),
      electionDate: null,
    }
  }

  // Reads the Pro state carried by the campaign that won the user a given
  // office org. Used as the isPro source for new-office follow-ons, where the
  // request body has no source org to inherit from.
  private async proFromOfficeOrg(
    slug: string | null,
    ownerId: number,
  ): Promise<boolean> {
    if (!slug) return false

    const org = await this.organizations.findFirst({
      where: { slug, ownerId },
      include: { electedOffice: { include: { campaign: true } } },
    })

    return org?.electedOffice?.campaign?.isPro ?? false
  }

  async update(args: Prisma.CampaignUpdateArgs & { where: { id: number } }) {
    const campaign = await this.client.$transaction(async (tx) => {
      return tx.campaign.update(args)
    })
    const isPro = args?.data?.isPro
    if (isPro) {
      await this.analytics.identify(campaign?.userId, {
        isPro,
        campaignId: campaign?.id,
      })
    }
    await this.crm.trackCampaign(campaign.id)
    return campaign
  }

  async updateJsonFields(
    id: number,
    body: UpdateCampaignFieldsInput,
    trackCampaign: boolean = true,
    scalarFields?: Prisma.CampaignUpdateInput,
    outerTx?: Prisma.TransactionClient,
  ) {
    const {
      data,
      details,
      aiContent,
      formattedAddress,
      placeId,
      canDownloadFederal,
      overrideDistrictId,
      primaryResult,
    } = body

    const runUpdate = async (tx: Prisma.TransactionClient) => {
      this.logger.debug({ id, body }, 'Updating campaign json fields')
      const campaign = await tx.campaign.findFirst({
        where: { id },
      })

      if (!campaign) return false

      const campaignUpdateData: Prisma.CampaignUpdateInput = {
        ...scalarFields,
      }
      if (data) {
        campaignUpdateData.data = deepMerge(campaign.data as object, data)
      }
      if (formattedAddress !== undefined) {
        campaignUpdateData.formattedAddress = formattedAddress
      }
      if (placeId !== undefined) {
        campaignUpdateData.placeId = placeId
      }
      if (canDownloadFederal !== undefined) {
        campaignUpdateData.canDownloadFederal = canDownloadFederal
      }
      if (primaryResult !== undefined) {
        campaignUpdateData.primaryResult = primaryResult
      }
      if (details) {
        const mergedDetails = deepMerge(
          campaign.details as object,
          details,
        ) as PrismaJson.CampaignDetails
        if (details?.customIssues) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          mergedDetails.customIssues = details.customIssues as Array<{
            position: string
            title: string
          }>
        }
        if (details.runningAgainst) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          mergedDetails.runningAgainst = details.runningAgainst as Array<{
            name: string
            party: string
            description: string
          }>
        }
        campaignUpdateData.details = mergedDetails
      }
      if (objectNotEmpty(aiContent)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        campaignUpdateData.aiContent = deepMerge(
          (campaign.aiContent as object) || {},
          aiContent,
        ) as PrismaJson.CampaignAiContent
      }

      if (overrideDistrictId !== undefined) {
        const orgSlug = OrganizationsService.campaignOrgSlug(campaign.id)
        const districtId = overrideDistrictId ?? null
        await tx.organization.update({
          where: { slug: orgSlug },
          data: { overrideDistrictId: districtId },
        })
      }

      return tx.campaign.update({
        where: { id: campaign.id },
        data: campaignUpdateData,
      })
    }

    const updatedCampaign = outerTx
      ? await runUpdate(outerTx)
      : await this.client.$transaction(runUpdate, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        })

    // TODO: this should throw an exception if the update failed
    //  https://goodparty.atlassian.net/browse/WEB-4384
    if (updatedCampaign && trackCampaign) {
      if (scalarFields?.isPro) {
        await this.analytics.identify(updatedCampaign.userId, {
          isPro: scalarFields.isPro,
          campaignId: updatedCampaign.id,
        })
      }
      await this.crm.trackCampaign(updatedCampaign.id)
    }

    return updatedCampaign ? updatedCampaign : null
  }

  async patchCampaignDetails(
    campaignId: number,
    details: Partial<PrismaJson.CampaignDetails>,
  ) {
    const currentCampaign = await this.model.findFirst({
      where: { id: campaignId },
    })
    if (!currentCampaign?.details) {
      throw new InternalServerErrorException(
        `Campaign ${campaignId} has no details JSON`,
      )
    }
    const { details: currentDetails } = currentCampaign

    const updatedDetails = {
      ...currentDetails,
      ...details,
    }
    const updatedCampaign = await this.client.$transaction(
      async (tx) =>
        tx.campaign.update({
          where: { id: campaignId },
          data: { details: updatedDetails },
        }),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    )

    return updatedCampaign
  }

  async persistCampaignProCancellation(campaign: Campaign) {
    await this.updateJsonFields(
      campaign.id,
      {
        details: {
          subscriptionId: null,
        },
      },
      false,
    )
    await this.setIsPro(campaign.id, false, false)
    await this.crm.trackCampaign(campaign.id)
  }

  // Returns whether this call flipped the campaign from non-Pro to Pro, so a
  // caller can fire a one-time side effect (e.g. auto-dispatching opponent
  // collection) only on the genuine false->true transition and not on a no-op
  // re-write of an already-Pro campaign.
  async setIsPro(
    campaignId: number,
    isPro: boolean = true,
    trackCampaign: boolean = true,
  ): Promise<{ becamePro: boolean }> {
    // The transition detection (read prior isPro) and the write must serialize:
    // Stripe delivers webhooks at-least-once, so two concurrent deliveries for
    // the same subscription could otherwise both read isPro=false, both compute
    // becamePro=true, and both fire the one-time Pro-upgrade side effects.
    // Serializable makes the second writer block on the first and observe
    // isPro=true, so it computes becamePro=false.
    const { campaign, isBecomingProFirstTime } = await this.client.$transaction(
      async (tx) => {
        const existingCampaign = await tx.campaign.findUnique({
          where: { id: campaignId },
          select: {
            isPro: true,
            hasFreeTextsOffer: true,
            freeTextsOfferRedeemedAt: true,
          },
        })

        const isBecomingProFirstTime = !existingCampaign?.isPro && isPro
        const shouldGrantOffer =
          isBecomingProFirstTime && !existingCampaign?.freeTextsOfferRedeemedAt

        const campaign = await tx.campaign.update({
          where: { id: campaignId },
          data: {
            isPro,
            ...(shouldGrantOffer && { hasFreeTextsOffer: true }),
          },
        })

        return { campaign, isBecomingProFirstTime }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )

    // Must be in serial so as to not overwrite campaign details w/ concurrent queries
    await this.patchCampaignDetails(campaignId, {
      isProUpdatedAt: formatISO(new Date()),
    })

    if (isBecomingProFirstTime) {
      void this.campaignTasks.notifySlackOnProUpgrade(campaignId)
    }

    if (trackCampaign) {
      const updatedIsPro = campaign?.isPro
      if (updatedIsPro) {
        await this.analytics.identify(campaign?.userId, {
          isPro: updatedIsPro,
          campaignId: campaign?.id,
        })
      }
      await this.crm.trackCampaign(campaignId)
    }

    return { becamePro: isBecomingProFirstTime }
  }

  async checkFreeTextsEligibility(campaignId: number): Promise<boolean> {
    const campaign = await this.model.findUnique({
      where: { id: campaignId },
      select: { hasFreeTextsOffer: true },
    })
    return campaign?.hasFreeTextsOffer ?? false
  }

  async redeemFreeTexts(campaignId: number): Promise<void> {
    const result = await this.client.$transaction(
      async (tx) => {
        const updatedCampaign = await tx.campaign.updateMany({
          where: {
            id: campaignId,
            hasFreeTextsOffer: true,
          },
          data: {
            hasFreeTextsOffer: false,
            freeTextsOfferRedeemedAt: new Date(),
          },
        })

        if (updatedCampaign.count === 0) {
          throw new BadRequestException(
            'No free texts offer available for this campaign',
          )
        }

        const campaign = await tx.campaign.findUnique({
          where: { id: campaignId },
          select: { userId: true },
        })

        return campaign?.userId
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    )
    if (result) {
      this.analytics.track(result, EVENTS.Outreach.FreeTextsOfferRedeemed, {
        campaignId,
        redeemedAt: new Date().toISOString(),
      })
    }
  }

  async getStatus(campaign?: Campaign) {
    const timestamp = new Date().getTime()

    if (!campaign) {
      return {
        status: false,
      }
    }

    const {
      data,
      details,
      slug,
      id,
      isActive,
      organizationSlug,
      isVerified: campaignIsVerified,
    } = campaign

    await this.model.update({
      where: { id },
      data: {
        data: { ...data, lastVisited: timestamp },
      },
    })

    const isVerified =
      campaignIsVerified ||
      data?.hubSpotUpdates?.verified_candidates?.toUpperCase() ===
        CandidateVerification.yes

    if (isActive) {
      return {
        status: CampaignStatus.candidate,
        slug,
        isVerified,
      }
    }
    let step = 1
    const org = organizationSlug
      ? await this.organizations.findUnique({
          where: { slug: organizationSlug },
        })
      : null
    if (org?.positionId || org?.customPositionName) {
      step = 2
    }
    if (details?.party || details?.otherParty) {
      step = 3
    }
    if (details?.pledged) {
      step = 4
    }

    return {
      status: CampaignStatus.onboarding,
      slug,
      step,
    }
  }

  delete(args: Prisma.CampaignDeleteArgs) {
    return this.model.delete(args)
  }

  deleteAll(args: Prisma.CampaignDeleteManyArgs) {
    return this.model.deleteMany(args)
  }

  async launch(campaign: Campaign) {
    const { id, organizationSlug, data: campaignData, isActive } = campaign

    if (
      isActive ||
      campaignData.launchStatus === CampaignLaunchStatus.launched
    ) {
      this.logger.info('Campaign already launched, skipping launch')
      return true
    }

    const org = organizationSlug
      ? await this.organizations.findUnique({
          where: { slug: organizationSlug },
        })
      : null
    if (!org?.positionId && !org?.customPositionName) {
      throw new BadRequestException('Cannot launch campaign, Office not set')
    }

    await this.model.update({
      where: { id },
      data: {
        isActive: true,
        data: {
          ...campaignData,
          launchStatus: CampaignLaunchStatus.launched,
          currentStep: OnboardingStep.complete,
        },
      },
    })

    await this.crm.trackCampaign(id)

    return true
  }

  async findSlug(user: User, suffix?: string) {
    const name = getUserFullName(user)
    const MAX_TRIES = 100
    const slug = buildSlug(name, suffix)
    const exists = await this.findUnique({ where: { slug } })
    if (!exists) {
      return slug
    }

    for (let i = 1; i < MAX_TRIES; i++) {
      const slug = buildSlug(`${name}${i}`, suffix)
      const exists = await this.findUnique({ where: { slug } })
      if (!exists) {
        return slug
      }
    }

    throw new InternalServerErrorException(
      `Could not find unique slug for user ${user.id} after ${MAX_TRIES} attempts`,
    )
  }

  async saveCampaignPlanVersion(inputs: {
    aiContent: PrismaJson.CampaignAiContent
    key: string
    campaignId: number
    inputValues?: AiContentInputValues | AiContentInputValues[]
    regenerate: boolean
    oldVersion?: { date: Date; text: string }
  }) {
    const { aiContent, key, campaignId, inputValues, oldVersion, regenerate } =
      inputs

    // we determine language by examining inputValues and tag it on the version.
    let language = 'English'
    if (Array.isArray(inputValues) && inputValues.length > 0) {
      inputValues.forEach((inputValue) => {
        if (typeof inputValue?.language === 'string') {
          language = inputValue.language
        }
      })
    }

    const newVersion = {
      date: new Date().toString(),
      text: aiContent[key]?.content,
      // if new inputValues are specified we use those
      // otherwise we use the inputValues from the prior generation.
      inputValues:
        Array.isArray(inputValues) && inputValues.length > 0
          ? inputValues
          : aiContent[key]?.inputValues,
      language: language,
    }

    const existingVersions =
      await this.planVersionService.findByCampaignId(campaignId)

    this.logger.info({ existingVersions }, 'existingVersions')

    let versions: CampaignPlanVersionData = {}
    if (existingVersions) {
      versions = existingVersions?.data as CampaignPlanVersionData
    }

    let foundKey = false
    if (!versions[key]) {
      versions[key] = []
    } else {
      foundKey = true
    }

    // determine if we should update the current version or add a new one.
    // if regenerate is true, we should always add a new version.
    // if regenerate is false and its been less than 5 minutes since the last generation
    // we should update the existing version.

    let updateExistingVersion = false
    if (regenerate === false && foundKey === true && versions[key].length > 0) {
      const lastVersion = versions[key][0] as PlanVersion
      const lastVersionDate = new Date(lastVersion?.date || 0)
      const diff = differenceInMilliseconds(new Date(), lastVersionDate)
      if (diff < 300000) {
        updateExistingVersion = true
      }
    }

    if (updateExistingVersion === true) {
      for (let i = 0; i < versions[key].length; i++) {
        const version = versions[key][i]
        if (
          JSON.stringify(version.inputValues) === JSON.stringify(inputValues)
        ) {
          // this version already exists. lets update it.
          versions[key][i].text = newVersion.text
          versions[key][i].date = new Date().toString()
          break
        }
      }
    }

    if (!foundKey && oldVersion) {
      this.logger.info(`no key found for ${key} yet we have oldVersion`)
      // here, we determine if we need to save an older version of the content.
      // because in the past we didn't create a Content version for every new generation.
      // otherwise if they translate they won't have the old version to go back to.
      versions[key].push({
        ...oldVersion,
        date: oldVersion.date.toString(),
      })
    }

    if (updateExistingVersion === false) {
      this.logger.info('adding new version')
      // add new version to the top of the list.
      const length = versions[key].unshift(newVersion)
      if (length > 10) {
        versions[key].length = 10
      }
    }

    if (existingVersions) {
      await this.planVersionService.update(existingVersions.id, {
        data: versions,
      })
    } else {
      await this.planVersionService.create({
        campaignId: campaignId,
        data: versions,
      })
    }

    return true
  }

  async updateCampaignAddress(
    campaignId: number,
    formattedAddress: string,
    placeId: string,
  ) {
    return this.model.update({
      where: { id: campaignId },
      data: {
        formattedAddress,
        placeId,
      } as Prisma.CampaignUpdateInput & {
        formattedAddress: string
        placeId: string
      },
    })
  }

  async fetchLiveRaceTargetMetrics(
    campaign: Campaign,
  ): Promise<RaceTargetMetrics | null> {
    const { details, organizationSlug, id: campaignId } = campaign
    const { electionDate } = details ?? {}
    if (!electionDate) return null

    // details is `Prisma.JsonValue` so raceId isn't on its TS shape; the
    // office picker (gp-webapp) writes the BallotReady race hash here.
    let raceId: string | undefined
    if (details && typeof details === 'object' && !Array.isArray(details)) {
      const candidate = (details as Record<string, unknown>).raceId
      if (typeof candidate === 'string' && candidate.length > 0) {
        raceId = candidate
      }
    }

    const org = organizationSlug
      ? await this.organizations.findUnique({
          where: { slug: organizationSlug },
        })
      : null

    if (!org?.overrideDistrictId && !org?.positionId && !raceId) return null

    // Three race-hash-keyed lookups in parallel: civics context (the new
    // unified source for win number, projected turnout, voter counts,
    // candidates, dates), filing fee, and BR campaign-timeline milestones.
    // Milestones come straight from BR GraphQL — election-api doesn't
    // store or expose them. All three return null on failure, letting us
    // degrade gracefully to the position-based path below.
    const [contextResult, filingFeeFromRaceHash, milestones] =
      await Promise.all([
        raceId
          ? this.elections.fetchCampaignStrategyContext(raceId)
          : Promise.resolve(null),
        raceId
          ? this.elections.fetchFilingFeeByRaceHash(raceId)
          : Promise.resolve(null),
        raceId
          ? this.ballotReady.fetchMilestones(raceId)
          : Promise.resolve(null),
      ])

    if (contextResult) {
      return this.mapContextToRaceTargetMetrics(
        contextResult,
        filingFeeFromRaceHash,
        milestones,
      )
    }

    // Fallback path: no raceId, or the context endpoint failed. Use the
    // legacy position / district-based metrics. New fields default to null
    // because the legacy path doesn't surface them.
    if (org?.overrideDistrictId) {
      const result = await this.elections
        .buildRaceTargetDetails({
          districtId: org.overrideDistrictId,
          electionDate,
        })
        .catch(() => null)

      const { projectedTurnout, winNumber, voterContactGoal } = result ?? {}
      if (!projectedTurnout || projectedTurnout <= 0) return null

      return {
        ...emptyContextFields(),
        projectedTurnout,
        winNumber: winNumber ?? 0,
        voterContactGoal: voterContactGoal ?? 0,
        filingFee: filingFeeFromRaceHash?.filingFee ?? null,
        filingRequirementsText:
          filingFeeFromRaceHash?.filingRequirementsText ?? null,
        filingOfficeAddress: filingFeeFromRaceHash?.filingOfficeAddress ?? null,
        filingPhoneNumber: filingFeeFromRaceHash?.filingPhoneNumber ?? null,
        paperworkInstructions:
          filingFeeFromRaceHash?.paperworkInstructions ?? null,
        milestones,
      }
    }

    if (!org?.positionId) return null

    const result = await this.elections
      .getPositionMatchedRaceTargetDetails({
        positionId: org.positionId,
        electionDate,
        includeTurnout: true,
        campaignId,
        officeName: undefined,
      })
      .catch(() => null)

    if (!result || result.projectedTurnout <= 0) return null

    const {
      projectedTurnout,
      winNumber,
      voterContactGoal,
      filingFee,
      filingRequirementsText,
    } = result
    return {
      ...emptyContextFields(),
      projectedTurnout,
      winNumber,
      voterContactGoal,
      filingFee:
        filingFeeFromRaceHash !== null
          ? filingFeeFromRaceHash.filingFee
          : (filingFee ?? null),
      filingRequirementsText:
        filingFeeFromRaceHash !== null
          ? filingFeeFromRaceHash.filingRequirementsText
          : (filingRequirementsText ?? null),
      filingOfficeAddress: filingFeeFromRaceHash?.filingOfficeAddress ?? null,
      filingPhoneNumber: filingFeeFromRaceHash?.filingPhoneNumber ?? null,
      paperworkInstructions:
        filingFeeFromRaceHash?.paperworkInstructions ?? null,
      milestones,
    }
  }

  private mapContextToRaceTargetMetrics(
    context: CampaignStrategyContextResponse,
    filingFeeFromRaceHash: FilingFeeByBrHashResult | null,
    milestones: RaceMilestones | null,
  ): RaceTargetMetrics {
    // win_number_effective prefers BR's calibrated civics number when
    // available, falls back to floor(turnout / 2) + 1 — both computed on
    // election-api. We just trust whatever it returns; null collapses to 0
    // so the downstream type stays `number` for win number / contact goal.
    const winNumber = context.win_number_effective ?? 0
    const projectedTurnout = context.projected_turnout ?? 0
    const voterContactGoal = context.contacts_needed_estimate ?? 0
    return {
      winNumber,
      projectedTurnout,
      voterContactGoal,
      filingFee: filingFeeFromRaceHash?.filingFee ?? null,
      filingRequirementsText:
        filingFeeFromRaceHash?.filingRequirementsText ?? null,
      filingOfficeAddress: filingFeeFromRaceHash?.filingOfficeAddress ?? null,
      filingPhoneNumber: filingFeeFromRaceHash?.filingPhoneNumber ?? null,
      paperworkInstructions:
        filingFeeFromRaceHash?.paperworkInstructions ?? null,
      registeredVoters: context.registered_voters,
      uniqueCellphones: context.unique_cellphones,
      uniqueLandlines: context.unique_landlines,
      projectedVoterTurnout: context.projected_voter_turnout,
      candidates: context.candidates.map((c) => ({
        gpCandidateId: c.gp_candidate_id,
        firstName: c.first_name,
        lastName: c.last_name,
        fullName: c.full_name,
        email: c.email,
        websiteUrl: c.website_url,
        party: c.party,
        isIncumbent: c.is_incumbent,
      })),
      generalElectionDate: context.general_election_date,
      primaryElectionDate: context.primary_election_date,
      relevantElectionDate: context.relevant_election_date,
      officialOfficeName: context.official_office_name,
      officeLevel: context.office_level,
      officeType: context.office_type,
      numberOfSeats: context.number_of_seats,
      milestones,
    }
  }

  /**
   * Resolves the candidate's real voter-file (L2) district name for prompt
   * personalization (e.g. "STATE HOUSE 005", "Clarkdale Town"). Prefers the
   * org's overridden district, falling back to the matched position's district.
   * Returns null when no district is resolvable so callers can fall back to the
   * self-reported `details.district`.
   */
  async resolveL2DistrictName(campaign: Campaign): Promise<string | null> {
    try {
      const { organizationSlug } = campaign
      const org = organizationSlug
        ? await this.organizations.findUnique({
            where: { slug: organizationSlug },
          })
        : null

      if (org?.overrideDistrictId) {
        const district = await this.elections.getDistrict(
          org.overrideDistrictId,
        )
        return formatL2DistrictName(
          district?.L2DistrictName,
          district?.L2DistrictType,
        )
      }

      if (org?.positionId) {
        const position = await this.elections.getPositionById(org.positionId, {
          includeDistrict: true,
        })
        return formatL2DistrictName(
          position?.district?.L2DistrictName,
          position?.district?.L2DistrictType,
        )
      }

      return null
    } catch (e) {
      this.logger.error({ e }, 'failed to resolve L2 district name')
      return null
    }
  }
}

// Null-filled values for every non-legacy field on RaceTargetMetrics — used
// on the position-based and overrideDistrict fallback paths that don't have
// access to the context endpoint's richer data.
const emptyContextFields = (): Omit<
  RaceTargetMetrics,
  | 'winNumber'
  | 'projectedTurnout'
  | 'voterContactGoal'
  | 'filingFee'
  | 'filingRequirementsText'
  | 'filingOfficeAddress'
  | 'filingPhoneNumber'
  | 'paperworkInstructions'
> => ({
  registeredVoters: null,
  uniqueCellphones: null,
  uniqueLandlines: null,
  projectedVoterTurnout: null,
  candidates: [],
  generalElectionDate: null,
  primaryElectionDate: null,
  relevantElectionDate: null,
  officialOfficeName: null,
  officeLevel: null,
  officeType: null,
  numberOfSeats: null,
  milestones: null,
})
