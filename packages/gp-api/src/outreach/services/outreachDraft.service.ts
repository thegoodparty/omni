import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  CreateOutreachDraftRequest,
  OutreachDetail,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { isSerializationError } from '@/prisma/util/prismaErrors.util'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { ASSET_DOMAIN } from '@/shared/util/appEnvironment.util'
import {
  Campaign,
  Outreach,
  OutreachRobocall,
  OutreachStatus,
  OutreachType,
  Prisma,
  RobocallSettleState,
} from '../../generated/prisma'
import { OutreachSocialService } from './outreachSocial.service'
import { RobocallComplianceResultService } from './robocallComplianceResult.service'
import { requireBoundPassingCompliance } from '../util/robocallComplianceGate.util'

export type DraftRowWithRobocall = Outreach & {
  robocall: OutreachRobocall | null
}

const DRAFT_OUTREACH_TYPES: Record<
  CreateOutreachDraftRequest['outreachType'],
  OutreachType
> = {
  p2p: OutreachType.p2p,
  robocall: OutreachType.robocall,
}

const draftConflict = (existingId: number): ConflictException =>
  new ConflictException({ message: 'A draft already exists', existingId })

// Null for a URL this route did not write: the expiry job calls the teardown
// on every draft row, including legacy ones whose image lives elsewhere, and
// a blind `replace` would hand S3 a whole URL as an object key.
const keyFromAssetUrl = (imageUrl: string): string | null => {
  const prefix = `https://${ASSET_DOMAIN}/`
  return imageUrl.startsWith(prefix) ? imageUrl.slice(prefix.length) : null
}

// A draft holds what the candidate built and nothing the send needs: no date,
// no phone list, no Peerly identity, no billing. Those are derived at resume,
// when the row is converted in place.
@Injectable()
export class OutreachDraftService extends createPrismaBase(MODELS.Outreach) {
  constructor(
    private readonly s3: S3Service,
    private readonly complianceResults: RobocallComplianceResultService,
    private readonly socialService: OutreachSocialService,
    private readonly voterFileFilters: VoterFileFilterService,
  ) {
    super()
    const bucket = process.env.ROBOCALL_AUDIO_BUCKET
    if (!bucket) throw new Error('ROBOCALL_AUDIO_BUCKET is not configured')
    this.audioBucket = bucket
  }

  private readonly audioBucket: string

  findActiveDraft(
    campaignId: number,
    outreachType: OutreachType,
  ): Promise<Outreach | null> {
    return this.findFirst({
      where: { campaignId, outreachType, status: OutreachStatus.draft },
    })
  }

  // The cheap rejections, run BEFORE the controller uploads the p2p image so a
  // capped or unauthorized create never leaves an orphaned S3 object. Not the
  // guarantee — createDraftRow's in-transaction re-check is.
  async preflight(
    campaign: Campaign,
    input: CreateOutreachDraftRequest,
  ): Promise<void> {
    await this.assertNoActiveDraft(
      campaign.id,
      DRAFT_OUTREACH_TYPES[input.outreachType],
    )
    await this.requireOwnFilter(campaign, input.voterFileFilterId)
  }

  async createP2pDraft(
    campaign: Campaign,
    input: CreateOutreachDraftRequest,
    imageUrl: string,
  ): Promise<OutreachDetail> {
    await this.requireOwnFilter(campaign, input.voterFileFilterId)
    const row = await this.createDraftRow(campaign.id, OutreachType.p2p, (tx) =>
      tx.outreach.create({
        data: {
          campaignId: campaign.id,
          organizationSlug: campaign.organizationSlug,
          outreachType: OutreachType.p2p,
          status: OutreachStatus.draft,
          name: input.name,
          // Both columns, the way the send path writes them, so a resume
          // reads back the candidate's own text from either.
          script: input.script,
          message: input.script,
          imageUrl,
          voterFileFilterId: input.voterFileFilterId,
          title: `P2P Outreach - Campaign ${campaign.id}`,
        },
      }),
    )
    return this.socialService.findDetail({ campaignId: campaign.id }, row.id)
  }

  async createRobocallDraft(
    campaign: Campaign,
    input: CreateOutreachDraftRequest,
    audioKey: string,
    callbackNumber: string,
  ): Promise<OutreachDetail> {
    await this.requireOwnFilter(campaign, input.voterFileFilterId)
    const compliance = await requireBoundPassingCompliance(audioKey, {
      s3: this.s3,
      complianceResults: this.complianceResults,
      audioBucket: this.audioBucket,
    })
    const id = await this.createDraftRow(
      campaign.id,
      OutreachType.robocall,
      async (tx) => {
        const spine = await tx.outreach.create({
          data: {
            campaignId: campaign.id,
            organizationSlug: campaign.organizationSlug,
            outreachType: OutreachType.robocall,
            status: OutreachStatus.draft,
            name: input.name,
            script: input.script,
            voterFileFilterId: input.voterFileFilterId,
          },
        })
        await tx.outreachRobocall.create({
          data: {
            outreachId: spine.id,
            audioKey,
            callbackNumber,
            compliancePassedAt: compliance.checkedAt,
            complianceAudioEtag: compliance.audioEtag,
            settleState: RobocallSettleState.draft,
          },
        })
        return spine.id
      },
    )
    return this.socialService.findDetail({ campaignId: campaign.id }, id)
  }

  async deleteDraft(campaign: Campaign, id: number): Promise<void> {
    const row = await this.model.findFirst({
      where: { id, campaignId: campaign.id },
      include: { robocall: true },
    })
    if (!row) throw new NotFoundException('Outreach not found')
    if (row.status !== OutreachStatus.draft) {
      throw new ConflictException('Only drafts can be deleted')
    }
    await this.deleteDraftRow(row)
  }

  // Shared with the expiry job. S3 first, then the row: a failed object delete
  // leaves the row for the next attempt instead of orphaning bytes.
  async deleteDraftRow(row: DraftRowWithRobocall): Promise<void> {
    if (row.imageUrl) {
      const imageKey = keyFromAssetUrl(row.imageUrl)
      if (imageKey) {
        await this.s3.deleteObject(ASSET_DOMAIN, imageKey)
      } else {
        this.logger.warn(
          { outreachId: row.id, imageUrl: row.imageUrl },
          'draft image is not on the asset domain; leaving the object',
        )
      }
    }
    if (row.robocall) {
      await this.s3.deleteObject(this.audioBucket, row.robocall.audioKey)
      await this.complianceResults.deleteByAudioKey(row.robocall.audioKey)
    }
    await this.model.delete({ where: { id: row.id } })
  }

  // The cap's actual enforcement. A plain read-then-write lets two concurrent
  // POSTs both find no draft and both insert, and there is no unique index to
  // fall back on (`status` is not part of any constraint, and one per
  // campaign+type only holds for `draft` rows). Serializable + the
  // in-transaction re-check makes the loser fail rather than insert: it either
  // sees the winner's row, or Postgres aborts it with 40001 (Prisma P2034) —
  // both are the same 409 to the client, which then resumes the winner. The
  // robocall path additionally has unique(audio_key) behind this.
  private async createDraftRow<T>(
    campaignId: number,
    outreachType: OutreachType,
    create: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.client.$transaction(
        async (tx) => {
          const existing = await tx.outreach.findFirst({
            where: { campaignId, outreachType, status: OutreachStatus.draft },
            select: { id: true },
          })
          if (existing) throw draftConflict(existing.id)
          return create(tx)
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (err) {
      if (isSerializationError(err)) {
        const winner = await this.findActiveDraft(campaignId, outreachType)
        if (winner) throw draftConflict(winner.id)
      }
      throw err
    }
  }

  // One active draft per type: the wizard resumes the existing one rather than
  // accumulating half-built sends, so the id rides the 409 for the client to
  // switch to resume.
  private async assertNoActiveDraft(
    campaignId: number,
    outreachType: OutreachType,
  ): Promise<void> {
    const existing = await this.findActiveDraft(campaignId, outreachType)
    if (existing) throw draftConflict(existing.id)
  }

  // Ownership only: a free candidate owns their saved lists, so this is
  // deliberately not the Pro-gated filterAccessCheck.
  private async requireOwnFilter(
    campaign: Campaign,
    voterFileFilterId: number,
  ): Promise<void> {
    if (!campaign.organizationSlug) {
      throw new NotFoundException('Voter list not found')
    }
    const filter = await this.voterFileFilters.findByIdAndOrganizationSlug(
      voterFileFilterId,
      campaign.organizationSlug,
    )
    if (!filter) throw new NotFoundException('Voter list not found')
  }
}
