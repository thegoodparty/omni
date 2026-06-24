import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  Campaign,
  OutreachStatus,
  OutreachType,
  User,
} from '../../generated/prisma'
import { AreaCodeFromZipService } from 'src/ai/util/areaCodeFromZip.util'
import { CampaignTcrComplianceService } from 'src/campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { DateFormats, formatDate } from 'src/shared/util/date.util'
import { GooglePlacesService } from 'src/vendors/google/services/google-places.service'
import { PeerlyP2pJobService } from 'src/vendors/peerly/services/peerlyP2pJob.service'
import { PeerlyPhoneListOwnershipService } from 'src/vendors/peerly/services/peerlyPhoneListOwnership.service'
import { Readable } from 'stream'
import { VoterFileFilterService } from 'src/voters/services/voterFileFilter.service'
import { CreateOutreachSchema } from '../schemas/createOutreachSchema'
import {
  resolveP2pJobGeography as resolveP2pJobGeographyUtil,
  type P2pJobGeographyResult,
} from '../util/campaignGeography.util'
import { resolveScriptContent } from '../util/resolveScriptContent.util'
import { OutreachStepError } from '../types/outreachStepError'
import { OutreachAttributionService } from './outreachAttribution.service'
import { OutreachNotificationService } from './outreachNotification.service'

export type { P2pJobGeographyResult } from '../util/campaignGeography.util'

/** Image payload for P2P outreach (decoupled from HTTP FileUpload). */
export interface P2pOutreachImageInput {
  stream: Buffer | Readable
  filename: string
  mimetype: string
}

@Injectable()
export class OutreachService extends createPrismaBase(MODELS.Outreach) {
  constructor(
    private readonly placesService: GooglePlacesService,
    private readonly areaCodeFromZipService: AreaCodeFromZipService,
    private readonly tcrComplianceService: CampaignTcrComplianceService,
    private readonly peerlyP2pJobService: PeerlyP2pJobService,
    private readonly phoneListOwnership: PeerlyPhoneListOwnershipService,
    private readonly notificationService: OutreachNotificationService,
    private readonly voterFileFilterService: VoterFileFilterService,
    private readonly attributionService: OutreachAttributionService,
  ) {
    super()
  }

  private async createP2pOutreach(
    campaign: Campaign,
    createOutreachDto: CreateOutreachSchema,
    p2pImage: P2pOutreachImageInput,
    imageUrl: string,
    script: string,
    phoneListId: number,
  ) {
    let peerlyIdentityId: string | null
    try {
      ;({ peerlyIdentityId } = await this.tcrComplianceService.findFirstOrThrow(
        {
          where: { campaignId: campaign.id },
        },
      ))
    } catch (err) {
      throw new OutreachStepError('tcrLookup', err)
    }

    if (!peerlyIdentityId) {
      throw new BadRequestException(
        'TCR Compliance Peerly identity ID is required for P2P outreach',
      )
    }

    const name = `${campaign.slug}${
      createOutreachDto.date
        ? ` - ${formatDate(createOutreachDto.date, DateFormats.usIsoSlashes)}`
        : ''
    }`

    const { aiContent = {} } = campaign
    const resolvedScriptText = resolveScriptContent(script, aiContent)

    let resolvedGeography: P2pJobGeographyResult
    try {
      resolvedGeography = await this.resolveP2pJobGeography(campaign)
    } catch (err) {
      throw new OutreachStepError('geographyResolution', err)
    }
    const didState = createOutreachDto.didState ?? resolvedGeography.didState
    const didNpaSubset =
      createOutreachDto.didNpaSubset ?? resolvedGeography.didNpaSubset

    let jobId: string
    try {
      jobId = await this.peerlyP2pJobService.createPeerlyP2pJob({
        campaignId: campaign.id,
        listId: phoneListId,
        imageInfo: {
          fileStream: p2pImage.stream,
          fileName: p2pImage.filename,
          mimeType: p2pImage.mimetype,
          title: createOutreachDto.title,
        },
        scriptText: resolvedScriptText,
        identityId: peerlyIdentityId,
        name,
        didState,
        didNpaSubset,
        scheduledDate: createOutreachDto.date,
      })
    } catch (err) {
      throw new OutreachStepError('peerlyJobCreation', err)
    }

    return await this.createRecord(
      {
        ...createOutreachDto,
        script: resolvedScriptText,
        projectId: jobId,
        status: OutreachStatus.pending,
        didState,
        didNpaSubset,
      },
      imageUrl,
    )
  }

  /**
   * Single entry point for creating outreach (text or P2P).
   * On success, fires the CAS Slack notification inline (awaited, with
   * internal try/catch so a Slack failure can't break the response).
   */
  async create(
    user: User,
    campaign: Campaign,
    createOutreachDto: CreateOutreachSchema,
    imageUrl?: string,
    p2pImage?: P2pOutreachImageInput,
  ) {
    if (createOutreachDto.voterFileFilterId) {
      await this.voterFileFilterService.filterAccessCheck(
        campaign.organizationSlug,
      )
      const filter =
        await this.voterFileFilterService.findByIdAndOrganizationSlug(
          createOutreachDto.voterFileFilterId,
          campaign.organizationSlug,
        )
      if (!filter) {
        throw new NotFoundException('Voter file filter not found')
      }
    }

    const isP2p = createOutreachDto.outreachType === OutreachType.p2p

    if (isP2p) {
      if (!imageUrl) {
        throw new BadRequestException('imageUrl is required for P2P outreach')
      }
      if (!p2pImage) {
        throw new BadRequestException(
          'P2P outreach requires an image with filename and MIME type; cannot create P2P outreach without Peerly job setup',
        )
      }
      if (!createOutreachDto.script) {
        throw new BadRequestException('Script is required for P2P outreach')
      }
      if (!createOutreachDto.phoneListId) {
        throw new BadRequestException(
          'Phone list ID is required for P2P outreach',
        )
      }

      // Verify the caller's campaign owns the phone list before assigning it to
      // a Peerly job — phoneListId is a client-supplied, guessable, account-
      // global id, so without this a campaign could text another campaign's
      // curated/DNC-scrubbed audience (CWE-639). Mirrors the org-scoping already
      // applied to voterFileFilterId above.
      await this.phoneListOwnership.assertCampaignOwnsList(
        campaign.id,
        createOutreachDto.phoneListId,
      )

      const outreach = await this.createP2pOutreach(
        campaign,
        createOutreachDto,
        p2pImage,
        imageUrl,
        createOutreachDto.script,
        createOutreachDto.phoneListId,
      )
      await this.tryNotifySuccess(user, campaign, outreach, createOutreachDto)
      await this.tryRecordSegmentAttribution(user, campaign, outreach)
      return outreach
    }

    const outreach = await this.createRecord(createOutreachDto, imageUrl)
    await this.tryNotifySuccess(user, campaign, outreach, createOutreachDto)
    await this.tryRecordSegmentAttribution(user, campaign, outreach)
    return outreach
  }

  // Per-voter attribution for the channels that resolve a segment (p2p, text,
  // phoneBanking, robocall, socialMedia; see OutreachAttributionService).
  // Best-effort like tryNotifySuccess: a people-api hiccup or attribution
  // failure is logged but must not fail the outreach that was already
  // persisted. Idempotent, so a later retry is safe.
  private async tryRecordSegmentAttribution(
    user: User,
    campaign: Campaign,
    outreach: Awaited<ReturnType<OutreachService['createRecord']>>,
  ) {
    try {
      await this.attributionService.recordSegmentAttribution(
        user,
        campaign,
        outreach,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId: outreach.id, campaignId: campaign.id },
        'Segment-derived outreach attribution failed',
      )
    }
  }

  private async tryNotifySuccess(
    user: User,
    campaign: Campaign,
    outreach: Awaited<ReturnType<OutreachService['createRecord']>>,
    createOutreachDto: CreateOutreachSchema,
  ) {
    try {
      await this.notificationService.notifySuccess({
        user,
        campaign,
        outreach,
        audienceRequest: createOutreachDto.audienceRequest,
        campaignPlanDueDate: createOutreachDto.campaignPlanDueDate,
        textCount: createOutreachDto.textCount,
        billableTextCount: createOutreachDto.billableTextCount,
      })
    } catch (err) {
      this.logger.error(
        { err, outreachId: outreach.id, campaignId: campaign.id },
        'CAS success notification failed',
      )
    }
  }

  /** Persists a single outreach record. Used by both non-P2P and P2P flows. */
  private async createRecord(
    createOutreachDto: CreateOutreachSchema,
    imageUrl?: string,
  ) {
    // campaignPlanDueDate and the text counts are notification-only metadata;
    // they have no Outreach column, so they must not reach Prisma's create.
    const outreachData = { ...createOutreachDto }
    delete outreachData.campaignPlanDueDate
    delete outreachData.textCount
    delete outreachData.billableTextCount
    return await this.model.create({
      data: {
        ...outreachData,
        ...(imageUrl ? { imageUrl } : {}),
      },
      include: {
        voterFileFilter: true,
      },
    })
  }

  async findByCampaignId(campaignId: number) {
    const outreachCampaigns = await this.findMany({
      where: { campaignId },
      include: {
        voterFileFilter: true,
      },
    })

    if (!outreachCampaigns.length) {
      throw new NotFoundException(
        `No outreach campaigns found for campaign ID ${campaignId}`,
      )
    }

    return outreachCampaigns
  }

  async resolveP2pJobGeography(
    campaign: Campaign,
  ): Promise<P2pJobGeographyResult> {
    return resolveP2pJobGeographyUtil(campaign, {
      placesService: this.placesService,
      areaCodeFromZipService: this.areaCodeFromZipService,
      logger: this.logger,
    })
  }
}
