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
  isSerializationError,
  isUniqueConstraintError,
} from '@/prisma/util/prismaErrors.util'
import { retryIf } from '@/shared/util/retry-if'
import { CampaignWith } from '@/campaigns/campaigns.types'
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

// Routes an approved contrast into the candidate website's issues or a texting
// Outreach as a DRAFT only. The route never sends: the story write seeds a
// website issue and the outreach is left in its pre-send `pending` state with
// no queue producer call. The candidate's own later action is what sends.
@Injectable()
export class ContrastRoutingService extends createPrismaBase(
  MODELS.RaceOpponentContrast,
) {
  constructor(private readonly analytics: AnalyticsService) {
    super()
  }

  async route(
    campaign: CampaignWith<'user'>,
    contrastId: number,
    target: RouteContrastTarget,
  ): Promise<RouteContrastToStoryResponse | RouteContrastToTextingResponse> {
    const result =
      target === 'story'
        ? await this.routeToStory(campaign, contrastId)
        : await this.routeToTexting(campaign.id, contrastId)

    void this.analytics
      .track(campaign.userId, EVENTS.RaceOpponent.ContrastUsed, {
        campaignId: campaign.id,
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
  // rolls back the target write too. Serializable because this is a read-then-
  // write on the campaign's single shared website `about.issues` array: two
  // routes for the same campaign with different contrasts both read the same
  // issues, append, and the per-contrast claim does not serialize them — at
  // Read Committed the second commit would clobber the first's appended issue.
  // The candidate's website issues moved off campaign_story (ENG-10524/10607);
  // a routed contrast becomes a website issue so it's actually shown. Concurrent
  // routes for the same campaign conflict two ways, both retried: with no
  // website yet, both take the create branch and the loser trips website's
  // @@unique(campaignId) (P2002); with a website present, both append under
  // Serializable and the loser aborts with a serialization failure (P2034).
  // Either retry re-reads the now-current row and re-appends cleanly (Website
  // has no upsert-append in a single statement).
  private async routeToStory(
    campaign: CampaignWith<'user'>,
    contrastId: number,
  ): Promise<RouteContrastToStoryResponse> {
    const campaignId = campaign.id
    return retryIf(
      () =>
        this.client.$transaction(
          async (tx) => {
            const contrast = await this.assertRoutable(
              tx,
              campaignId,
              contrastId,
            )

            const newIssue = {
              title: contrast.issueTag,
              description: contrast.contrastSentence,
            }
            const existing = await tx.website.findUnique({
              where: { campaignId },
              select: { id: true, content: true },
            })
            // Mirror the webapp's saveAboutFields create-if-missing: a candidate
            // may route a contrast before building a website, so seed a minimal
            // row (vanityPath defaults to the campaign slug, as createByCampaign
            // does) rather than 404. Existing content is preserved — only the
            // about.issues slice is extended.
            const website = existing
              ? await tx.website.update({
                  where: { campaignId },
                  data: {
                    content: appendWebsiteIssue(existing.content, newIssue),
                  },
                  select: { id: true },
                })
              : await tx.website.create({
                  data: {
                    campaignId,
                    vanityPath: campaign.slug,
                    content: { about: { issues: [newIssue] } },
                  },
                  select: { id: true },
                })

            await this.claim(tx, contrastId, { routedWebsiteId: website.id })

            return {
              contrast: contrastToDTO({
                ...contrast,
                routedWebsiteId: website.id,
                status: RaceOpponentContrastStatus.used,
              }),
              routedWebsiteId: website.id,
            }
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      {
        shouldRetry: (err) =>
          isUniqueConstraintError(err) || isSerializationError(err),
        retries: 3,
        factor: 1.5,
        minTimeout: 50,
      },
    )
  }

  private async routeToTexting(
    campaignId: number,
    contrastId: number,
  ): Promise<RouteContrastToTextingResponse> {
    return this.client.$transaction(
      async (tx) => {
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
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
    routed: { routedWebsiteId?: number; routedOutreachId?: number },
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

// The website's `about.issues` array is shared with the candidate and the
// Pro-upgrade flow. Routing appends the contrast as a new structured issue so
// existing candidate-authored issues are never clobbered, and the rest of the
// website content is carried through untouched.
const appendWebsiteIssue = (
  content: PrismaJson.WebsiteContent | null,
  issue: { title: string; description: string },
): PrismaJson.WebsiteContent => {
  const about = content?.about ?? {}
  return {
    ...content,
    about: { ...about, issues: [...(about.issues ?? []), issue] },
  }
}
