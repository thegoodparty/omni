import { Injectable } from '@nestjs/common'
import { CampaignStoryService } from '@/campaignStory/services/campaignStory.service'
import { CampaignStoryRewriteService } from '@/campaignStory/services/campaignStoryRewrite.service'
import type { RewriteCampaignStoryInput } from '@/campaignStory/schemas/rewriteCampaignStory.schema'
import { CampaignStrategyService } from '@/campaignStrategy/services/campaignStrategy.service'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { WebsitesService } from '@/websites/services/websites.service'
import { isPrismaError } from '@/prisma/util/prismaErrors.util'

export interface StoryPosition {
  title: string
  description: string
}

export type StoryField = 'why' | 'background' | 'positions'

// The three Campaign Story answers, sourced exactly as the story page sources
// them: `why` is the website bio, `background` is the campaign_story field, and
// `positions` are the website issues. `missing` mirrors the story page's
// completeness gate (why + background + at least one position).
export interface StoryState {
  why: string | null
  background: string | null
  // Read from the website issues, a lenient PrismaJson shape (entries may be
  // partial). Saves use the strict StoryPosition.
  positions: { title?: string; description?: string }[]
  complete: boolean
  missing: StoryField[]
}

type WebsiteAbout = NonNullable<PrismaJson.WebsiteContent['about']>

// Encapsulates the cross-module Campaign Story flow so the chat handler stays
// thin. Reuses the exact services the story page + plan tab use: the story
// record (background), the website (why/positions, shared with Pro-upgrade),
// the shared "Help me rewrite" service, and the plan generator (which
// bootstraps the tracker once its sections persist).
@Injectable()
export class CampaignStoryIntakeService {
  constructor(
    private readonly stories: CampaignStoryService,
    private readonly rewrites: CampaignStoryRewriteService,
    private readonly websites: WebsitesService,
    private readonly strategy: CampaignStrategyService,
    private readonly campaigns: CampaignsService,
  ) {}

  async read(campaignId: number): Promise<StoryState> {
    const [story, why, positions] = await Promise.all([
      this.stories.getForCampaign(campaignId),
      this.websites.getBioForCampaign(campaignId),
      this.websites.getIssuesForCampaign(campaignId),
    ])
    const missing: StoryField[] = []
    if (!why?.trim()) missing.push('why')
    if (!story.background?.trim()) missing.push('background')
    if (positions.length === 0) missing.push('positions')
    return {
      why,
      background: story.background,
      positions,
      complete: missing.length === 0,
      missing,
    }
  }

  saveBackground(campaignId: number, text: string): Promise<unknown> {
    return this.stories.upsertForCampaign(campaignId, { background: text })
  }

  saveWhy(campaignId: number, bio: string): Promise<void> {
    return this.patchAbout(campaignId, (about) => ({ ...about, bio }))
  }

  savePositions(campaignId: number, positions: StoryPosition[]): Promise<void> {
    return this.patchAbout(campaignId, (about) => ({
      ...about,
      issues: positions,
    }))
  }

  // The "why" (bio) and positions (issues) live on the website content, shared
  // with the story page / Pro-upgrade flow — so mirror saveAboutFields: create
  // the site on first write, then merge the single field being saved.
  private async patchAbout(
    campaignId: number,
    apply: (about: WebsiteAbout) => WebsiteAbout,
  ): Promise<void> {
    let content = await this.websites.getContentForCampaign(campaignId)
    if (!content) {
      const campaign = await this.campaigns.client.campaign.findUniqueOrThrow({
        where: { id: campaignId },
        include: { user: true, campaignPositions: true },
      })
      if (!campaign.user) {
        throw new Error('Campaign has no user; cannot create a website.')
      }
      try {
        const created = await this.websites.createByCampaign(
          campaign.user,
          campaign,
        )
        content = created.content ?? {}
      } catch (error) {
        // Two saves in one turn (e.g. why + positions) can both find no
        // website and both create; the loser trips website.campaignId's unique
        // constraint. The row exists now, so re-read instead of failing.
        if (!isPrismaError(error, 'P2002')) throw error
        content = (await this.websites.getContentForCampaign(campaignId)) ?? {}
      }
    }
    const nextContent: PrismaJson.WebsiteContent = {
      ...content,
      about: apply(content.about ?? {}),
    }
    await this.websites.update({
      where: { campaignId },
      data: { content: nextContent },
    })
  }

  // The existing story page's "Help me rewrite": expand a rough answer via
  // Gemini. Throws ForbiddenException at the per-campaign lifetime cap.
  elaborate(
    campaignId: number,
    input: RewriteCampaignStoryInput,
    candidateName: string,
  ): Promise<{ rewrite: string }> {
    return this.rewrites.rewrite(input, candidateName, campaignId)
  }

  // Same completion path as the story page → plan tab: kick off plan generation,
  // which materializes the tracker's static rows now and bootstraps its dynamic
  // generation once the plan's sections persist.
  async generate(campaignId: number): Promise<{ status: string }> {
    const campaign = await this.campaigns.client.campaign.findUnique({
      where: { id: campaignId },
      include: { user: true },
    })
    // Should never happen: campaignId is bound from the same request's context.
    // Throw rather than return an opaque status outside the plan vocabulary
    // ('ready' | 'generating' | 'failed'), so it's observable, not swallowed.
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found during generate`)
    }
    const { status } =
      await this.strategy.getOrGenerateStrategicLandscape(campaign)
    return { status }
  }
}
