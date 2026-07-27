import { ForbiddenException, Inject, Injectable } from '@nestjs/common'
import { isBefore, subMinutes } from 'date-fns'
import {
  RecommendedListsResponse,
  RecommendedListsSchema,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { Prisma } from '@/generated/prisma'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { FeaturesService } from '@/features/services/features.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { QueueType } from '@/queue/queue.types'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { isPrismaError } from '@/prisma/util/prismaErrors.util'
import { RECOMMENDED_LISTS_DATABRICKS } from '../recommendedLists.constants'

const FEATURE_FLAG = 'recommended-lists'
const TTL_MINUTES = 15
const MAX_ATTEMPTS = 3

@Injectable()
export class RecommendedListsService extends createPrismaBase(
  MODELS.RecommendedListsSnapshot,
) {
  constructor(
    private readonly features: FeaturesService,
    private readonly queueProducer: QueueProducerService,
    @Inject(RECOMMENDED_LISTS_DATABRICKS)
    private readonly databricks: DatabricksProvider | null,
  ) {
    super()
  }

  // The GET read model. Pro + feature gated. When the Win warehouse isn't
  // configured the endpoint reports 'unavailable' rather than spinning up a
  // recompute that can't run. Otherwise it returns the current snapshot,
  // (re)queuing a recompute whenever one is needed. The read path is the
  // scheduler: a lost enqueue self-heals off the TTL on the next poll, so
  // enqueue failures are swallowed rather than surfaced.
  async getForCampaign(
    campaign: CampaignWith<'user'>,
  ): Promise<RecommendedListsResponse> {
    await this.assertAccess(campaign)
    if (!this.databricks) return { status: 'unavailable' }

    const campaignId = campaign.id
    const raceId = campaign.details.raceId ?? null
    const snapshot = await this.model.findUnique({ where: { campaignId } })

    if (!snapshot) return this.createPending(campaignId, raceId)
    if (snapshot.raceId !== raceId) return this.resetPending(campaignId, raceId)

    if (snapshot.status === 'ready') {
      const parsed = RecommendedListsSchema.safeParse(snapshot.payload)
      if (parsed.success && snapshot.computedAt) {
        return {
          status: 'ready',
          computedAt: snapshot.computedAt.toISOString(),
          lists: parsed.data,
        }
      }
      return this.resetPending(campaignId, raceId)
    }

    if (snapshot.status === 'failed') return { status: 'failed' }

    return this.handlePending(
      campaignId,
      raceId,
      snapshot.startedAt,
      snapshot.attempts,
    )
  }

  private async assertAccess(campaign: CampaignWith<'user'>): Promise<void> {
    if (!campaign.isPro) {
      throw new ForbiddenException('Recommended lists requires Pro.')
    }
    const enabled = await this.features.isFeatureEnabled({
      user: campaign.userId,
      feature: FEATURE_FLAG,
    })
    if (!enabled) {
      throw new ForbiddenException('Recommended lists is not enabled.')
    }
  }

  private async createPending(
    campaignId: number,
    raceId: string | null,
  ): Promise<RecommendedListsResponse> {
    try {
      await this.model.create({
        data: {
          campaignId,
          status: 'pending',
          raceId,
          attempts: 1,
          startedAt: new Date(),
        },
      })
    } catch (error) {
      // A concurrent first GET created the row; it owns the enqueue, so this
      // request just reports pending without a duplicate dispatch.
      if (isPrismaError(error, 'P2002')) return { status: 'pending' }
      throw error
    }
    await this.enqueue(campaignId, raceId, 1)
    return { status: 'pending' }
  }

  private async resetPending(
    campaignId: number,
    raceId: string | null,
  ): Promise<RecommendedListsResponse> {
    await this.model.update({
      where: { campaignId },
      data: {
        status: 'pending',
        raceId,
        attempts: 1,
        startedAt: new Date(),
        payload: Prisma.DbNull,
        computedAt: null,
        error: null,
      },
    })
    await this.enqueue(campaignId, raceId, 1)
    return { status: 'pending' }
  }

  private async handlePending(
    campaignId: number,
    raceId: string | null,
    startedAt: Date | null,
    attempts: number,
  ): Promise<RecommendedListsResponse> {
    const stale =
      !startedAt || isBefore(startedAt, subMinutes(new Date(), TTL_MINUTES))
    if (!stale) return { status: 'pending' }
    if (attempts >= MAX_ATTEMPTS) return { status: 'failed' }

    const nextAttempt = attempts + 1
    await this.model.update({
      where: { campaignId },
      data: { attempts: nextAttempt, startedAt: new Date() },
    })
    await this.enqueue(campaignId, raceId, nextAttempt)
    return { status: 'pending' }
  }

  private async enqueue(
    campaignId: number,
    raceId: string | null,
    attempt: number,
  ): Promise<void> {
    await this.queueProducer.sendMessage(
      {
        type: QueueType.RECOMMENDED_LISTS_RECOMPUTE,
        data: { campaignId, raceId, attempt },
      },
      `recommended-lists-${campaignId}`,
      { deduplicationId: `${campaignId}:${raceId}:${attempt}` },
    )
  }
}
