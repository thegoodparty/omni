import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ClerkUserEnricherService } from '@/vendors/clerk/services/clerk-user-enricher.service'
import { WebsiteStatus } from '../../generated/prisma'
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

    const rawCampaigns = await this.findMany({
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

    // Draft (unpublished) websites must not leak through this @PublicAccess()
    // path — the canonical public website endpoints reject any non-published
    // site. Only expose the website (incl. its draft contact/bio content) once
    // it is published; otherwise return it as absent.
    const campaigns = rawCampaigns.map((campaign) => ({
      ...campaign,
      website:
        campaign.website?.status === WebsiteStatus.published
          ? campaign.website
          : null,
    }))

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
      const [onlyMatch] = campaignsWithLastName
      return onlyMatch ? this.withCandidateAvatar(onlyMatch) : null
    }

    const campaignsWithBothNames = campaignsWithLastName.filter((campaign) =>
      this.matchesCandidateName(campaign.slug, firstName, lastName),
    )

    const chosen =
      campaignsWithBothNames.length > 0
        ? campaignsWithBothNames[0]
        : campaignsWithLastName[0]
    return chosen ? this.withCandidateAvatar(chosen) : null
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

    // `findSlug` de-duplicates colliding slugs by appending a counter (1-99) to
    // the name *before* slugify, so a second "Mike Vick" is stored as
    // `mike-vick1`, not `mike-vick-1`. Without stripping that counter the last
    // name never matches and the candidate's own page reports them unclaimed.
    const lastToken = campaignTokens.at(-1)
    const collisionBase = lastToken
      ? /^(.+?)\d{1,2}$/.exec(lastToken)?.[1]
      : undefined
    if (collisionBase) {
      set.add(collisionBase)
    }

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
