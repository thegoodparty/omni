import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  OutreachReceipt,
  P2P_SCRIPT_MAX_LENGTH,
} from '@goodparty_org/contracts'
import {
  Campaign,
  Outreach,
  OutreachStatus,
  OutreachType,
  User,
} from '../../generated/prisma'
import { AreaCodeFromZipService } from 'src/ai/util/areaCodeFromZip.util'
import { CampaignTcrComplianceService } from 'src/campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { ASSET_DOMAIN } from 'src/shared/util/appEnvironment.util'
import { DateFormats, formatDate } from 'src/shared/util/date.util'
import { GooglePlacesService } from 'src/vendors/google/services/google-places.service'
import { S3Service } from 'src/vendors/aws/services/s3.service'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'
import { PeerlyP2pJobService } from 'src/vendors/peerly/services/peerlyP2pJob.service'
import { Readable } from 'stream'
import { VoterFileFilterService } from 'src/voters/services/voterFileFilter.service'
import { CreateOutreachSchema } from '../schemas/createOutreachSchema'
import {
  resolveP2pJobGeography as resolveP2pJobGeographyUtil,
  type P2pJobGeographyResult,
} from '../util/campaignGeography.util'
import { resolveScriptContent } from '../util/resolveScriptContent.util'
import { OutreachStepError } from '../types/outreachStepError'
import { OutreachMaterializationService } from './outreachMaterialization.service'
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
    private readonly notificationService: OutreachNotificationService,
    private readonly voterFileFilterService: VoterFileFilterService,
    private readonly materializationService: OutreachMaterializationService,
    private readonly s3: S3Service,
    private readonly stripeService: StripeService,
  ) {
    super()
  }

  private async requirePeerlyIdentityId(campaign: Campaign): Promise<string> {
    let peerlyIdentityId: string | null
    let internalTestingApprovedAt: Date | null
    try {
      ;({ peerlyIdentityId, internalTestingApprovedAt } =
        await this.tcrComplianceService.findFirstOrThrow({
          where: { campaignId: campaign.id },
        }))
    } catch (err) {
      throw new OutreachStepError('tcrLookup', err)
    }

    if (!peerlyIdentityId) {
      throw new BadRequestException(
        internalTestingApprovedAt
          ? 'Campaign is 10DLC-approved for internal testing only; ' +
              'real P2P sends are disabled'
          : 'TCR Compliance Peerly identity ID is required for P2P outreach',
      )
    }

    return peerlyIdentityId
  }

  private async resolveP2pCreateInputs(
    campaign: Campaign,
    createOutreachDto: CreateOutreachSchema,
    script: string,
  ) {
    const peerlyIdentityId = await this.requirePeerlyIdentityId(campaign)

    const name = `${campaign.slug}${
      createOutreachDto.date
        ? ` - ${formatDate(createOutreachDto.date, DateFormats.usIsoSlashes)}`
        : ''
    }`

    const { aiContent = {} } = campaign
    const resolvedScriptText = resolveScriptContent(script, aiContent)

    // The schema only sees the raw script field, which may be an aiContent
    // key; the resolved text is what Peerly enforces its limit on, and it
    // must be rejected here, before payment (ENG-10665).
    if (resolvedScriptText.length > P2P_SCRIPT_MAX_LENGTH) {
      throw new BadRequestException(
        `Script cannot exceed ${P2P_SCRIPT_MAX_LENGTH} characters for ` +
          `P2P outreach (got ${resolvedScriptText.length})`,
      )
    }

    let resolvedGeography: P2pJobGeographyResult
    try {
      resolvedGeography = await this.resolveP2pJobGeography(campaign)
    } catch (err) {
      throw new OutreachStepError('geographyResolution', err)
    }
    const didState = createOutreachDto.didState ?? resolvedGeography.didState
    const didNpaSubset =
      createOutreachDto.didNpaSubset ?? resolvedGeography.didNpaSubset

    return {
      peerlyIdentityId,
      name,
      resolvedScriptText,
      didState,
      didNpaSubset,
    }
  }

  // Persists everything the payment-webhook finalize will need: the browser
  // (and its request) may be gone by the time payment settles, so the row must
  // be self-contained — resolved script, identity, name, and geography.
  private async createP2pDraft(
    campaign: Campaign,
    createOutreachDto: CreateOutreachSchema,
    imageUrl: string,
    script: string,
  ) {
    const {
      peerlyIdentityId,
      name,
      resolvedScriptText,
      didState,
      didNpaSubset,
    } = await this.resolveP2pCreateInputs(campaign, createOutreachDto, script)

    return await this.createRecord(
      campaign,
      {
        ...createOutreachDto,
        script: resolvedScriptText,
        status: OutreachStatus.pending_payment,
        name,
        didState,
        didNpaSubset,
        // The payload's offset-annotated datetime starts with the user's
        // local calendar day; the DateTime column loses that offset, and
        // finalize needs the local day for Peerly's start/end dates.
        scheduledLocalDate: createOutreachDto.date?.slice(0, 10),
      },
      imageUrl,
      peerlyIdentityId,
    )
  }

  private async createP2pOutreach(
    campaign: Campaign,
    createOutreachDto: CreateOutreachSchema,
    p2pImage: P2pOutreachImageInput,
    imageUrl: string,
    script: string,
    phoneListId: number,
  ) {
    const {
      peerlyIdentityId,
      name,
      resolvedScriptText,
      didState,
      didNpaSubset,
    } = await this.resolveP2pCreateInputs(campaign, createOutreachDto, script)

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
      campaign,
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

      if (createOutreachDto.draft) {
        return await this.createP2pDraft(
          campaign,
          createOutreachDto,
          imageUrl,
          createOutreachDto.script,
        )
      }

      const outreach = await this.createP2pOutreach(
        campaign,
        createOutreachDto,
        p2pImage,
        imageUrl,
        createOutreachDto.script,
        createOutreachDto.phoneListId,
      )
      await this.tryNotifySuccess(user, campaign, outreach, createOutreachDto)
      await this.tryMaterializeOutreach(campaign, outreach)
      return outreach
    }

    const outreach = await this.createRecord(
      campaign,
      createOutreachDto,
      imageUrl,
    )
    await this.tryNotifySuccess(user, campaign, outreach, createOutreachDto)
    await this.tryMaterializeOutreach(campaign, outreach)
    return outreach
  }

  /**
   * Submits a paid draft to Peerly. Invoked by the TEXT post-purchase handler,
   * which runs from BOTH the client's complete-checkout-session call and the
   * Stripe webhook — the status claim below is the DB lock that makes the race
   * harmless. Throwing here is deliberate: completeCheckoutSession only stamps
   * its idempotency marker after handler success, so a throw makes Stripe
   * retry, and the revert re-arms the claim for that retry. campaignId scopes
   * the claim to the paying campaign — outreachId arrives via client-influenced
   * checkout metadata and must not finalize another campaign's draft.
   */
  async finalizeOutreachPurchase(
    outreachId: number,
    campaignId: number,
  ): Promise<void> {
    const claimed = await this.model.updateMany({
      where: {
        id: outreachId,
        campaignId,
        status: OutreachStatus.pending_payment,
      },
      data: { status: OutreachStatus.pending },
    })
    if (claimed.count === 0) {
      await this.confirmFinalized(outreachId, campaignId)
      return
    }

    const outreach = await this.model.findUniqueOrThrow({
      where: { id: outreachId },
      include: {
        voterFileFilter: true,
        campaign: { include: { user: true } },
      },
    })
    const { campaign } = outreach
    const user = campaign.user

    let jobId: string
    try {
      jobId = await this.submitDraftToPeerly(outreach)
    } catch (err) {
      await this.model.updateMany({
        where: {
          id: outreachId,
          status: OutreachStatus.pending,
          projectId: null,
        },
        data: { status: OutreachStatus.pending_payment },
      })
      this.logger.error(
        { err, outreachId, campaignId: campaign.id },
        'P2P outreach finalize failed after payment',
      )
      if (user) {
        try {
          await this.notificationService.notifyFailure({
            user,
            campaign,
            createOutreachDto: {
              outreachType: outreach.outreachType,
              script: outreach.script ?? undefined,
              date: outreach.date?.toISOString(),
            },
            step:
              err instanceof OutreachStepError ? err.step : 'peerlyJobCreation',
            error: err,
          })
        } catch (notifyErr) {
          this.logger.error(
            { err: notifyErr, outreachId },
            'Finalize failure notification failed',
          )
        }
      }
      throw err
    }

    await this.model.update({
      where: { id: outreachId },
      data: { projectId: jobId },
    })

    const finalized = { ...outreach, projectId: jobId }
    // Materialization needs no user — a missing user record must not skip
    // the filter lock and interaction rows for a paid launch.
    await this.tryMaterializeOutreach(campaign, finalized)

    if (!user) {
      this.logger.error(
        { outreachId, campaignId: campaign.id },
        'Campaign has no user — skipping finalize notifications',
      )
      return
    }

    await this.tryNotifySuccess(user, campaign, finalized, {
      audienceRequest: outreach.audienceRequest ?? undefined,
      campaignPlanDueDate: outreach.campaignPlanDueDate ?? undefined,
      textCount: outreach.textCount ?? undefined,
      billableTextCount: outreach.billableTextCount ?? undefined,
    })
  }

  /**
   * A lost claim does NOT mean the work happened: the winner may still be
   * mid-Peerly, may have failed and reverted the row, or the id may not match
   * any draft of this campaign at all. Only a stamped projectId proves
   * fulfillment — everything else throws, so the payment layer never marks
   * the purchase processed on the strength of a lost race and Stripe keeps
   * retrying.
   */
  private async confirmFinalized(
    outreachId: number,
    campaignId: number,
  ): Promise<void> {
    // Covers the winner's inline Peerly submission (~10s worst case observed).
    const POLL_ATTEMPTS = 30
    const POLL_INTERVAL_MS = 1000

    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      const row = await this.model.findFirst({
        where: { id: outreachId, campaignId },
        select: { status: true, projectId: true },
      })
      if (!row || row.status === OutreachStatus.pending_payment) {
        break
      }
      if (row.projectId) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }

    this.logger.error(
      { outreachId, campaignId },
      'P2P outreach finalize failed after payment',
    )
    throw new OutreachStepError(
      'peerlyJobCreation',
      new Error(
        `Outreach ${outreachId} was not finalized: missing, not owned by ` +
          `campaign ${campaignId}, or a concurrent finalize failed`,
      ),
    )
  }

  private async submitDraftToPeerly(
    outreach: Awaited<ReturnType<OutreachService['createRecord']>>,
  ): Promise<string> {
    if (
      !outreach.imageUrl ||
      !outreach.phoneListId ||
      !outreach.script ||
      !outreach.identityId
    ) {
      throw new OutreachStepError(
        'validation',
        new Error('Draft outreach is missing fields required for Peerly'),
      )
    }

    const imageKey = decodeURIComponent(
      new URL(outreach.imageUrl).pathname.slice(1),
    )
    const image = await this.s3.getFileBytesWithContentType(
      ASSET_DOMAIN,
      imageKey,
    )
    if (!image) {
      throw new OutreachStepError(
        'peerlyMediaUpload',
        new Error(`Draft image not found in S3: ${imageKey}`),
      )
    }

    try {
      return await this.peerlyP2pJobService.createPeerlyP2pJob({
        campaignId: outreach.campaignId,
        listId: outreach.phoneListId,
        imageInfo: {
          fileStream: image.bytes,
          fileName: imageKey.split('/').pop() ?? 'outreach-image',
          mimeType: image.contentType ?? 'image/jpeg',
          title: outreach.title ?? undefined,
        },
        scriptText: outreach.script,
        identityId: outreach.identityId,
        name: outreach.name ?? undefined,
        didState: outreach.didState ?? undefined,
        didNpaSubset: outreach.didNpaSubset,
        scheduledDate:
          outreach.scheduledLocalDate ?? outreach.date?.toISOString(),
      })
    } catch (err) {
      throw new OutreachStepError('peerlyJobCreation', err)
    }
  }

  // Materializes the outreach's resolved saved filter into per-recipient
  // ContactInteraction<channel> rows and locks the filter. Best-effort like
  // tryNotifySuccess: the rows are the audit trail, but a materialization
  // failure must not fail the outreach that was already persisted.
  private async tryMaterializeOutreach(
    campaign: Campaign,
    outreach: Awaited<ReturnType<OutreachService['createRecord']>>,
  ) {
    try {
      await this.materializationService.materializeOutreach(campaign, outreach)
    } catch (err) {
      this.logger.error(
        {
          err,
          outreachId: outreach.id,
          filterId: outreach.voterFileFilterId,
        },
        'Outreach list materialization failed',
      )
    }
  }

  private async tryNotifySuccess(
    user: User,
    campaign: Campaign,
    outreach: Awaited<ReturnType<OutreachService['createRecord']>>,
    notificationMeta: Pick<
      CreateOutreachSchema,
      | 'audienceRequest'
      | 'campaignPlanDueDate'
      | 'textCount'
      | 'billableTextCount'
    >,
  ) {
    try {
      await this.notificationService.notifySuccess({
        user,
        campaign,
        outreach,
        audienceRequest: notificationMeta.audienceRequest,
        campaignPlanDueDate: notificationMeta.campaignPlanDueDate,
        textCount: notificationMeta.textCount,
        billableTextCount: notificationMeta.billableTextCount,
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
    campaign: Campaign,
    // scheduledLocalDate is server-derived at draft creation, never client
    // input — hence the widening rather than a schema field.
    createOutreachDto: CreateOutreachSchema & { scheduledLocalDate?: string },
    imageUrl?: string,
    identityId?: string,
  ) {
    // draft is a flow selector, not an Outreach column.
    const outreachData = { ...createOutreachDto }
    delete outreachData.draft
    return await this.model.create({
      data: {
        ...outreachData,
        organizationSlug: campaign.organizationSlug,
        ...(imageUrl ? { imageUrl } : {}),
        ...(identityId ? { identityId } : {}),
      },
      include: {
        voterFileFilter: true,
      },
    })
  }

  // Scoped by organizationSlug, not campaignId: archiving is an
  // organization-level action on the history drawer, and the response reads
  // back the persisted row rather than trusting the request's `archived`
  // flag.
  async setArchived(
    id: number,
    organizationSlug: string,
    archived: boolean,
  ): Promise<{ id: number; archivedAt: Date | null }> {
    const claimed = await this.model.updateMany({
      where: { id, organizationSlug },
      data: { archivedAt: archived ? new Date() : null },
    })
    if (claimed.count === 0) {
      throw new NotFoundException('Outreach not found')
    }
    return this.model.findUniqueOrThrow({
      where: { id },
      select: { id: true, archivedAt: true },
    })
  }

  // Durable payment link for cancel-before-send. Idempotent by shape (same
  // session id on every webhook retry); scoped to the paying campaign like
  // finalize, since outreachId rides in client-influenced metadata.
  async recordCheckoutSession(
    outreachId: number,
    campaignId: number,
    checkoutSessionId: string,
  ): Promise<void> {
    await this.model.updateMany({
      where: { id: outreachId, campaignId },
      data: { stripeCheckoutSessionId: checkoutSessionId },
    })
  }

  /**
   * Cancel-before-send (product decision: permanent, vendor job deleted,
   * automatic refund). Cancelable = status `pending` only: that is the
   * scheduled-not-started state finalize leaves a paid campaign in;
   * `in_progress`/`completed` rows have sent messages and are not
   * refundable here.
   *
   * Ordering is the failure policy. The vendor delete runs first — if it
   * fails, nothing changed and the user keeps their campaign. The refund
   * runs second — if IT fails, the row deliberately stays `pending`: the
   * cancel CTA stays live, and a retry re-runs both steps safely (the
   * vendor status write is idempotent, and the refund's idempotency key is
   * stable per outreach, so it can neither be lost nor doubled). Only after
   * both succeed does the status flip.
   */
  async cancelOutreach(
    outreachId: number,
    campaignId: number,
  ): Promise<{ outreach: Outreach; refunded: boolean }> {
    const outreach = await this.model.findFirst({
      where: { id: outreachId, campaignId },
    })
    if (!outreach) {
      throw new NotFoundException('Outreach not found')
    }
    if (outreach.status === OutreachStatus.canceled) {
      return { outreach, refunded: false }
    }
    if (outreach.status !== OutreachStatus.pending) {
      throw new BadRequestException('Only scheduled campaigns can be canceled')
    }

    if (outreach.projectId) {
      await this.peerlyP2pJobService.deleteJob(outreach.projectId)
    }

    let refunded = false
    if (outreach.stripeCheckoutSessionId) {
      try {
        const session = await this.stripeService.retrieveCheckoutSession(
          outreach.stripeCheckoutSessionId,
        )
        const paymentIntentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id
        if (paymentIntentId) {
          await this.stripeService.refundPaymentIntent(
            paymentIntentId,
            `outreach-cancel-${outreachId}`,
          )
          refunded = true
        }
      } catch (error) {
        this.logger.error(
          { err: error },
          `Refund failed canceling outreach ${outreachId}; row left pending for retry`,
        )
        throw new BadGatewayException(
          'The refund could not be processed. Try canceling again.',
        )
      }
    }

    const updated = await this.model.update({
      where: { id: outreachId },
      data: { status: OutreachStatus.canceled },
    })
    return { outreach: updated, refunded }
  }

  // Deleting is reserved for canceled campaigns: cancel already tore down
  // the vendor job and refunded the charge, so the row is pure history.
  // Anything else still has money or a live send attached — those go
  // through cancel first.
  async deleteCanceledOutreach(
    outreachId: number,
    campaignId: number,
  ): Promise<void> {
    const outreach = await this.model.findFirst({
      where: { id: outreachId, campaignId },
    })
    if (!outreach) {
      throw new NotFoundException('Outreach not found')
    }
    if (outreach.status !== OutreachStatus.canceled) {
      throw new BadRequestException('Only canceled campaigns can be deleted')
    }
    await this.model.delete({ where: { id: outreachId } })
  }

  /**
   * Live receipt read for a paid campaign. No local payment snapshot
   * exists — the row only stores the checkout session id — so the card and
   * receipt URL come from Stripe on every read. Free-texts rows never
   * record a session, so they 404 here; a Stripe failure is a 502, never
   * an empty receipt.
   */
  async getOutreachReceipt(
    outreachId: number,
    campaignId: number,
  ): Promise<OutreachReceipt> {
    const outreach = await this.model.findFirst({
      where: { id: outreachId, campaignId },
    })
    if (!outreach?.stripeCheckoutSessionId) {
      throw new NotFoundException('No receipt for this outreach')
    }
    let session: Awaited<
      ReturnType<StripeService['retrieveCheckoutSessionWithCharge']>
    >
    try {
      session = await this.stripeService.retrieveCheckoutSessionWithCharge(
        outreach.stripeCheckoutSessionId,
      )
    } catch (error) {
      this.logger.error(
        { err: error },
        `Receipt read failed for outreach ${outreachId}`,
      )
      throw new BadGatewayException('Could not load the receipt from Stripe')
    }
    const paymentIntent =
      typeof session.payment_intent === 'object' ? session.payment_intent : null
    const charge =
      paymentIntent && typeof paymentIntent.latest_charge === 'object'
        ? paymentIntent.latest_charge
        : null
    const card = charge?.payment_method_details?.card
    return {
      // DOLLARS, matching the checkout-session endpoint convention.
      amount: (session.amount_total ?? 0) / 100,
      cardBrand: card?.brand ?? null,
      cardLast4: card?.last4 ?? null,
      receiptUrl: charge?.receipt_url ?? null,
      paidAt: charge?.created
        ? new Date(charge.created * 1000).toISOString()
        : null,
    }
  }

  async findByCampaignId(campaignId: number) {
    const outreachCampaigns = await this.findMany({
      where: {
        campaignId,
        // Unpaid drafts are an implementation detail of the purchase flow.
        // Prisma's `not` also excludes NULL, so nullable legacy rows need the
        // explicit OR branch.
        OR: [
          { status: { not: OutreachStatus.pending_payment } },
          { status: null },
        ],
      },
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
