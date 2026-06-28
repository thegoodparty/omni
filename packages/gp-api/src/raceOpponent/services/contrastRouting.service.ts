import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  RouteContrastTarget,
  RouteContrastToStoryResponse,
  RouteContrastToTextingResponse,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  OutreachStatus,
  OutreachType,
  Prisma,
  RaceOpponentContrastStatus,
} from '@/generated/prisma'
import { EVENTS } from '@/vendors/segment/segment.types'
import { AnalyticsService } from '@/analytics/analytics.service'
import { contrastToDTO } from './contrastEngine.service'

// A contrast can be routed only while it is candidate-actionable: cleared (or
// the candidate-approved variant). pending_review / blocked / draft / discarded
// are not routable, and an already-`used` contrast can't be routed twice.
const ROUTABLE_STATUSES: RaceOpponentContrastStatus[] = [
  RaceOpponentContrastStatus.cleared,
  RaceOpponentContrastStatus.approved,
]

// Routes an approved contrast into Campaign Story or a texting Outreach as a
// DRAFT only. The route never sends: the story write is narrative text and the
// outreach is left in its pre-send `pending` state with no queue producer call.
// The candidate's own later action is what sends.
@Injectable()
export class ContrastRoutingService extends createPrismaBase(
  MODELS.RaceOpponentContrast,
) {
  constructor(private readonly analytics: AnalyticsService) {
    super()
  }

  async route(
    campaignId: number,
    userId: number,
    contrastId: number,
    target: RouteContrastTarget,
  ): Promise<RouteContrastToStoryResponse | RouteContrastToTextingResponse> {
    const result =
      target === 'story'
        ? await this.routeToStory(campaignId, contrastId)
        : await this.routeToTexting(campaignId, contrastId)

    void this.analytics
      .track(userId, EVENTS.RaceOpponent.ContrastUsed, {
        campaignId,
        contrastId,
        target,
      })
      .catch(() => undefined)

    return result
  }

  // The target write and the status claim run in one transaction so a partial
  // route can't leave a contrast `used` with no draft, nor a draft with the
  // contrast still routable. The updateMany scoped to the routable statuses is
  // the atomic claim: count 0 means a concurrent route already used it, which
  // rolls back the target write too.
  private async routeToStory(
    campaignId: number,
    contrastId: number,
  ): Promise<RouteContrastToStoryResponse> {
    return this.client.$transaction(async (tx) => {
      const contrast = await this.assertRoutable(tx, campaignId, contrastId)

      const existing = await tx.campaignStory.findUnique({
        where: { campaignId },
        select: { issues: true },
      })
      const issues = appendIssue(
        existing?.issues ?? null,
        contrast.contrastSentence,
      )
      const story = await tx.campaignStory.upsert({
        where: { campaignId },
        create: { campaignId, issues },
        update: { issues },
      })

      await this.claim(tx, contrastId, { routedStoryId: story.id })

      return {
        contrast: contrastToDTO({
          ...contrast,
          routedStoryId: story.id,
          status: RaceOpponentContrastStatus.used,
        }),
        routedStoryId: story.id,
      }
    })
  }

  private async routeToTexting(
    campaignId: number,
    contrastId: number,
  ): Promise<RouteContrastToTextingResponse> {
    return this.client.$transaction(async (tx) => {
      const contrast = await this.assertRoutable(tx, campaignId, contrastId)

      const outreach = await tx.outreach.create({
        data: {
          campaignId,
          outreachType: OutreachType.text,
          status: OutreachStatus.pending,
          name: `Contrast: ${contrast.issueTag}`,
          message: contrast.contrastSentence,
          script: contrast.contrastSentence,
        },
      })

      await this.claim(tx, contrastId, { routedOutreachId: outreach.id })

      return {
        contrast: contrastToDTO({
          ...contrast,
          routedOutreachId: outreach.id,
          status: RaceOpponentContrastStatus.used,
        }),
        routedOutreachId: outreach.id,
      }
    })
  }

  private async assertRoutable(
    tx: Prisma.TransactionClient,
    campaignId: number,
    contrastId: number,
  ) {
    const contrast = await tx.raceOpponentContrast.findFirst({
      where: { id: contrastId, campaignId },
    })
    if (!contrast) {
      throw new NotFoundException('Contrast not found')
    }
    if (!ROUTABLE_STATUSES.includes(contrast.status)) {
      throw new ConflictException('Contrast is not in a routable state')
    }
    return contrast
  }

  private async claim(
    tx: Prisma.TransactionClient,
    contrastId: number,
    routed: { routedStoryId?: number; routedOutreachId?: number },
  ): Promise<void> {
    const claimed = await tx.raceOpponentContrast.updateMany({
      where: { id: contrastId, status: { in: ROUTABLE_STATUSES } },
      data: { ...routed, status: RaceOpponentContrastStatus.used },
    })
    if (claimed.count === 0) {
      throw new ConflictException('Contrast is not in a routable state')
    }
  }
}

// Campaign Story `issues` is a single free-text field shared with the candidate.
// Routing appends the contrast on its own line so an existing narrative is never
// clobbered; a first route into an empty story seeds it.
const appendIssue = (existing: string | null, sentence: string): string =>
  existing && existing.trim().length > 0 ? `${existing}\n${sentence}` : sentence
