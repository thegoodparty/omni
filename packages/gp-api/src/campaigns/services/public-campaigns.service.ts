import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ClerkUserEnricherService } from '@/vendors/clerk/services/clerk-user-enricher.service'
import slugify from 'slugify'
import { FindByRaceIdDto } from '../schemas/public/FindByRaceId.schema'
import { FindByRaceIdResponse } from '../schemas/public/FindByRaceIdResponse.schema'

@Injectable()
export class PublicCampaignsService extends createPrismaBase(MODELS.Campaign) {
  constructor(private readonly clerkEnricher: ClerkUserEnricherService) {
    super()
  }

  async findCampaignByRaceId(
    params: FindByRaceIdDto,
  ): Promise<FindByRaceIdResponse> {
    const { raceId, firstName, lastName } = params

    const campaigns = await this.findMany({
      where: {
        details: {
          path: ['raceId'],
          equals: raceId,
        },
        isActive: true,
      },
      select: {
        id: true,
        slug: true,
        details: true,
        updatedAt: true,
        user: {
          select: { id: true, clerkId: true, email: true, avatar: true },
        },
        website: {
          select: {
            id: true,
            createdAt: true,
            updatedAt: true,
            campaignId: true,
            status: true,
            vanityPath: true,
            content: true,
            domain: {
              select: {
                name: true,
                status: true,
              },
            },
          },
        },
        campaignPositions: {
          select: {
            description: true,
            position: {
              select: {
                name: true,
              },
            },
            topIssue: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    })

    if (campaigns.length === 0) {
      return null
    }

    const campaignsWithLastName = campaigns.filter((campaign) =>
      this.matchesCandidateName(campaign.slug, '', lastName),
    )

    if (campaignsWithLastName.length === 0) {
      return null
    }

    if (campaignsWithLastName.length === 1) {
      return this.withCandidateAvatar(campaignsWithLastName[0])
    }

    const campaignsWithBothNames = campaignsWithLastName.filter((campaign) =>
      this.matchesCandidateName(campaign.slug, firstName, lastName),
    )

    return this.withCandidateAvatar(
      campaignsWithBothNames.length > 0
        ? campaignsWithBothNames[0]
        : campaignsWithLastName[0],
    )
  }

  // Resolve the claimed candidate's uploaded photo from Clerk (not the stale
  // User.avatar column): the enricher returns null when Clerk has no uploaded
  // image, so candidates without a photo fall back to the BallotReady image.
  private async withCandidateAvatar<
    T extends {
      user: { id: number; clerkId: string | null; avatar: string | null } | null
    },
  >(campaign: T): Promise<Omit<T, 'user'> & { avatar: string | null }> {
    const { user, ...rest } = campaign
    const avatar = user
      ? (await this.clerkEnricher.enrichUser(user)).avatar
      : null

    return { ...rest, avatar }
  }

  private normalizeToTokens(value: string): string[] {
    return slugify(value, { lower: true, strict: true })
      .split('-')
      .filter(Boolean)
  }

  private slugHasAllTokens(
    campaignSlug: string,
    requiredTokens: string[],
  ): boolean {
    const campaignTokens = campaignSlug.split('-').filter(Boolean)
    const set = new Set(campaignTokens)
    return requiredTokens.every((token) => set.has(token))
  }

  private matchesCandidateName(
    campaignSlug: string,
    firstName: string,
    lastName: string,
  ): boolean {
    const lastTokens = this.normalizeToTokens(lastName)
    if (lastTokens.length && !this.slugHasAllTokens(campaignSlug, lastTokens)) {
      return false
    }

    if (firstName) {
      const firstTokens = this.normalizeToTokens(firstName)
      if (
        firstTokens.length &&
        !this.slugHasAllTokens(campaignSlug, firstTokens)
      ) {
        return false
      }
    }

    return true
  }
}
