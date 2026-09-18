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
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { ASSET_DOMAIN } from '@/shared/util/appEnvironment.util'
import {
  Campaign,
  Outreach,
  OutreachRobocall,
  OutreachStatus,
  OutreachType,
  RobocallSettleState,
} from '../../generated/prisma'
import { OutreachSocialService } from './outreachSocial.service'
import { RobocallComplianceResultService } from './robocallComplianceResult.service'
import { requireBoundPassingCompliance } from '../util/robocallComplianceGate.util'

export type DraftRowWithRobocall = Outreach & {
  robocall: OutreachRobocall | null
}

const keyFromAssetUrl = (imageUrl: string): string =>
  imageUrl.replace(`https://${ASSET_DOMAIN}/`, '')

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

  async createP2pDraft(
    campaign: Campaign,
    input: CreateOutreachDraftRequest,
    imageUrl: string,
  ): Promise<OutreachDetail> {
    await this.assertNoActiveDraft(campaign.id, OutreachType.p2p)
    await this.requireOwnFilter(campaign, input.voterFileFilterId)
    const row = await this.model.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: campaign.organizationSlug,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.draft,
        name: input.name,
        // Both columns, the way the send path writes them, so a resume reads
        // back the candidate's own text from either.
        script: input.script,
        message: input.script,
        imageUrl,
        voterFileFilterId: input.voterFileFilterId,
        title: `P2P Outreach - Campaign ${campaign.id}`,
      },
    })
    return this.socialService.findDetail({ campaignId: campaign.id }, row.id)
  }

  async createRobocallDraft(
    campaign: Campaign,
    input: CreateOutreachDraftRequest,
    audioKey: string,
    callbackNumber: string,
  ): Promise<OutreachDetail> {
    await this.assertNoActiveDraft(campaign.id, OutreachType.robocall)
    await this.requireOwnFilter(campaign, input.voterFileFilterId)
    const compliance = await requireBoundPassingCompliance(audioKey, {
      s3: this.s3,
      complianceResults: this.complianceResults,
      audioBucket: this.audioBucket,
    })
    const id = await this.client.$transaction(async (tx) => {
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
    })
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
      await this.s3.deleteObject(ASSET_DOMAIN, keyFromAssetUrl(row.imageUrl))
    }
    if (row.robocall) {
      await this.s3.deleteObject(this.audioBucket, row.robocall.audioKey)
      await this.complianceResults.deleteByAudioKey(row.robocall.audioKey)
    }
    await this.model.delete({ where: { id: row.id } })
  }

  // One active draft per type: the wizard resumes the existing one rather than
  // accumulating half-built sends, so the id rides the 409 for the client to
  // switch to resume.
  private async assertNoActiveDraft(
    campaignId: number,
    outreachType: OutreachType,
  ): Promise<void> {
    const existing = await this.findActiveDraft(campaignId, outreachType)
    if (existing) {
      throw new ConflictException({
        message: 'A draft already exists',
        existingId: existing.id,
      })
    }
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
