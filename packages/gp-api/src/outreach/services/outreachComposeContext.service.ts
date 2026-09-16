import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { cleanWebsiteIssues } from '@/websites/util/serializeWebsiteIssues.util'
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
  async buildCampaignContext(
    campaign: Campaign,
    // Opt-in, and door knocking is the only caller that opts in. See the
    // `issues` block below for what it turns on and why it is not simply the
    // behaviour for everyone.
    { includeWebsiteIssues = false }: { includeWebsiteIssues?: boolean } = {},
  ): Promise<string[]> {
    const [story, strategy, website] = await Promise.all([
      this.model.findUnique({ where: { campaignId: campaign.id } }),
      this.client.campaignStrategy.findUnique({
        where: { campaignId: campaign.id },
        include: {
          opportunities: { orderBy: { order: Prisma.SortOrder.asc } },
          challenges: { orderBy: { order: Prisma.SortOrder.asc } },
        },
      }),
      // The store current onboarding actually writes to — see `issues` below.
      // Not read at all for the callers that did not ask for it: a query
      // spent on a block that cannot be used is a query wasted on the four
      // channels this must not change.
      includeWebsiteIssues
        ? this.client.website.findUnique({
            where: { campaignId: campaign.id },
            select: { content: true },
          })
        : null,
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

    // Two stores, because the product has two and only ever read one.
    //
    // `details.customIssues` is written by the legacy `/dashboard/questions`
    // flow, which has no nav entry and is reachable only by detouring through
    // Content Builder. Current onboarding writes the candidate's issues to
    // `website.content.about.issues` instead (`saveAboutFields({ issues })` in
    // useOnboardingStoryDraft), and nothing bridged them in this direction —
    // so for a campaign onboarded through the flow candidates actually use,
    // the single most useful input to a compose prompt is absent and the
    // context degrades to place plus whatever story they did not skip.
    //
    // **Reading the second store is opt-in, and only door knocking opts in.**
    // The gap is real for SMS, social, phone banking and robocall too, and
    // closing it there is worth doing — but it would change what four shipped
    // features generate, for every campaign onboarded through the current
    // flow, on the day it merged. That is not this feature's call to make and
    // not this feature's blast radius to take. Door knocking is new, so there
    // is no output to change. Widening this to the other four is its own
    // change, with its own before/after review.
    //
    // Custom issues lead and the website store fills in behind them, so a
    // campaign that already produced content keeps the same leading material
    // and only gains.
    //
    // Deduped on the lowercased title the way `buildScriptIssues` dedupes the
    // same two stores at the door — a candidate who re-entered one issue in
    // both places should not have it stated to the model twice, which reads as
    // emphasis it never asked for.
    const customIssues = (campaign.details.customIssues ?? [])
      .filter((issue) => issue?.title && issue?.position)
      .map((issue) => ({ title: issue.title, position: issue.position }))
    const seenIssueTitles = new Set(
      customIssues.map((issue) => issue.title.toLowerCase()),
    )
    const websiteIssues = cleanWebsiteIssues(
      website?.content?.about?.issues ?? [],
    )
      .filter((issue) => issue.title && issue.description)
      .filter((issue) => {
        const key = issue.title.toLowerCase()
        if (seenIssueTitles.has(key)) return false
        seenIssueTitles.add(key)
        return true
      })
      .map((issue) => ({ title: issue.title, position: issue.description }))

    const issues = [...customIssues, ...websiteIssues].slice(0, ISSUES_MAX)
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
