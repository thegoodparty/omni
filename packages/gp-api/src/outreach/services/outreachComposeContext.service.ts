import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { Campaign, Prisma } from '../../generated/prisma'

// Prompt-size discipline: the story field allows 10k chars and plan
// sections are unbounded lists; compose prompts target short outputs, so
// each block is trimmed rather than passed whole.
const STORY_MAX_CHARS = 2000
const SECTION_ITEM_MAX = 5
const SECTION_ITEM_MAX_CHARS = 300
const ISSUES_MAX = 10

const trim = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

// Assembles the candidate's own materials (campaign story, stated issue
// positions, campaign plan opportunities/challenges) into prompt context
// blocks for the compose AI — the product decision (2026-08-17) that
// generation must use these to create scripts and messages. Every block is
// optional: a campaign with none of them gets an empty array and the
// prompts fall back to the name/office/purpose/tone baseline.
@Injectable()
export class OutreachComposeContextService extends createPrismaBase(
  MODELS.CampaignStory,
) {
  async buildCampaignContext(campaign: Campaign): Promise<string[]> {
    const [story, strategy] = await Promise.all([
      this.model.findUnique({ where: { campaignId: campaign.id } }),
      this.client.campaignStrategy.findUnique({
        where: { campaignId: campaign.id },
        include: {
          opportunities: { orderBy: { order: Prisma.SortOrder.asc } },
          challenges: { orderBy: { order: Prisma.SortOrder.asc } },
        },
      }),
    ])

    const blocks: string[] = []

    // The no-materials fallback is name, place, and office (product
    // decision 2026-08-17) — name and office already ride in the caller's
    // baseline lines, so place is contributed here.
    const place = [campaign.details.city, campaign.details.state]
      .filter(Boolean)
      .join(', ')
    if (place) {
      blocks.push(`Where the candidate is running: ${place}.`)
    }

    const background = story?.background?.trim()
    if (background) {
      blocks.push(
        [
          "The candidate's campaign story, in their own words:",
          '"""',
          trim(background, STORY_MAX_CHARS),
          '"""',
        ].join('\n'),
      )
    }

    const issues = (campaign.details.customIssues ?? [])
      .filter((issue) => issue?.title && issue?.position)
      .slice(0, ISSUES_MAX)
    if (issues.length > 0) {
      blocks.push(
        [
          "The candidate's stated issue positions:",
          ...issues.map(
            (issue) =>
              `- ${issue.title}: ${trim(issue.position, SECTION_ITEM_MAX_CHARS)}`,
          ),
        ].join('\n'),
      )
    }

    const opportunities = (strategy?.opportunities ?? []).slice(
      0,
      SECTION_ITEM_MAX,
    )
    if (opportunities.length > 0) {
      blocks.push(
        [
          "From the candidate's campaign plan — opportunities:",
          ...opportunities.map(
            (item) => `- ${trim(item.content, SECTION_ITEM_MAX_CHARS)}`,
          ),
        ].join('\n'),
      )
    }

    const challenges = (strategy?.challenges ?? []).slice(0, SECTION_ITEM_MAX)
    if (challenges.length > 0) {
      blocks.push(
        [
          "From the candidate's campaign plan — challenges:",
          ...challenges.map(
            (item) => `- ${trim(item.content, SECTION_ITEM_MAX_CHARS)}`,
          ),
        ].join('\n'),
      )
    }

    return blocks
  }
}
