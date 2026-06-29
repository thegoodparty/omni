import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import sanitizeHtml from 'sanitize-html'
import { Campaign } from '../../generated/prisma'
import { z } from 'zod'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { getUserFullName } from '@/users/util/users.util'
import { RacesService } from '@/elections/services/races.service'
import { CampaignStoryService } from '@/campaignStory/services/campaignStory.service'
import { WebsitesService } from '@/websites/services/websites.service'
import { AgentJobContracts } from '@/generated/agent-job-contracts'
import { ElectionApiService } from './electionApi.service'

// Both CAP experiments share one input contract.
type StrategicLandscapeInput = AgentJobContracts['opposition_research']['Input']
type PrimaryContext =
  StrategicLandscapeInput['campaign_primary_strategy_context']
type CampaignStoryParam = StrategicLandscapeInput['campaign_story']

const PartySchema = z
  .object({ party: z.string().optional(), otherParty: z.string().optional() })
  .partial()

// Send the raw party label + otherParty separately; the experiment treats
// 'Other' as a pointer to other_party. Don't collapse them here.
const resolveParty = (
  details: Campaign['details'],
): { party: string | null; otherParty: string | null } => {
  const parsed = PartySchema.safeParse(details)
  if (!parsed.success) return { party: null, otherParty: null }
  return {
    party: parsed.data.party ?? null,
    otherParty: parsed.data.otherParty ?? null,
  }
}

// Website issues are { title, description } objects with HTML descriptions
// (Quill). The agent's campaign_story.issues field is a single plain-text
// string, so strip the markup and flatten to title + description blocks.
const serializeIssues = (
  issues: { title?: string; description?: string }[],
): string | null => {
  const blocks = issues
    .map(({ title, description }) => {
      const cleanTitle = title?.trim() ?? ''
      const cleanDescription = description
        ? sanitizeHtml(description, {
            allowedTags: [],
            allowedAttributes: {},
          }).trim()
        : ''
      if (cleanTitle && cleanDescription) {
        return `${cleanTitle}\n${cleanDescription}`
      }
      return cleanTitle || cleanDescription
    })
    .filter((block) => block.length > 0)
  return blocks.length > 0 ? blocks.join('\n\n') : null
}

@Injectable()
export class StrategicLandscapeParamsService {
  constructor(
    private readonly electionApi: ElectionApiService,
    private readonly races: RacesService,
    private readonly campaignStory: CampaignStoryService,
    private readonly websites: WebsitesService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StrategicLandscapeParamsService.name)
  }

  async build(
    campaign: CampaignWith<'user'>,
    brHashId: string,
  ): Promise<StrategicLandscapeInput> {
    const [context, primary, campaignStory] = await Promise.all([
      this.electionApi.getStrategyContext(brHashId),
      this.buildPrimaryContext(brHashId),
      this.loadStoryParam(campaign.id),
    ])
    const { user } = campaign
    const { party, otherParty } = resolveParty(campaign.details)
    return {
      race_id: brHashId,
      user_email: user?.email ?? '',
      user_first_name: user?.firstName ?? null,
      user_last_name: user?.lastName ?? null,
      user_full_name: user ? getUserFullName(user) : '',
      user_party_affiliation: party,
      other_party: otherParty,
      campaign_strategy_context: context,
      campaign_primary_strategy_context: primary,
      campaign_story: campaignStory,
    }
  }

  // The story is optional enrichment, so a transient read failure must not
  // abort the (expensive) strategy build — log it and degrade to undefined.
  // `issues` no longer lives on the story: it's sourced from the campaign's
  // website issues (shared with Pro-upgrade) and flattened to the plain-text
  // string the agent expects.
  private async loadStoryParam(
    campaignId: number,
  ): Promise<CampaignStoryParam> {
    try {
      const [story, issues] = await Promise.all([
        this.campaignStory.getForCampaign(campaignId),
        this.websites.getIssuesForCampaign(campaignId),
      ])
      return {
        why: story.why,
        background: story.background,
        issues: serializeIssues(issues),
      }
    } catch (error) {
      this.logger.warn(
        { error, campaignId },
        'Failed to load campaign story for strategy params; proceeding without it',
      )
      return undefined
    }
  }

  private async buildPrimaryContext(brHashId: string): Promise<PrimaryContext> {
    const primaryRaceId = await this.races.getPrimaryRaceId(brHashId)
    if (!primaryRaceId) return null
    const ctx = await this.electionApi.getStrategyContext(primaryRaceId)
    return { candidate_count: ctx.candidate_count, candidates: ctx.candidates }
  }
}
