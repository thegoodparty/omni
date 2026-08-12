import { BadGatewayException, Injectable } from '@nestjs/common'
import {
  SocialAsset,
  SocialAssetPlatformSchema,
  SocialGenerateRequest,
  SocialPurpose,
} from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { LlmService } from '@/llm/services/llm.service'
import { type LlmMessage } from '@/llm/types/llmMessages.types'
import { SocialAssetKind, SocialAssetPlatform } from '../../generated/prisma'
import { SOCIAL_PLATFORM_KIND } from '../util/socialAssets.util'

const PURPOSE_GOALS: Record<SocialPurpose, string> = {
  introduce_myself: 'introduce the candidate to voters',
  persuade_voters: 'persuade likely voters to support the candidate',
  event_invite: 'invite people to a local event',
  early_voting: 'encourage voters to vote early',
  election_day_turnout: 'encourage voters to turn out on election day',
  issue_update: 'share an update about a local issue',
  custom: "deliver the candidate's own message as written",
}

const PLATFORM_RULES: Record<SocialAssetPlatform, string> = {
  [SocialAssetPlatform.facebook]:
    'Post copy. Conversational and community-minded. End with a short ' +
    'link line inviting readers to learn more (the candidate appends ' +
    'their campaign link after it).',
  [SocialAssetPlatform.instagram]:
    'Post copy written as an Instagram caption. Close with 3-5 relevant, ' +
    'non-partisan hashtags.',
  [SocialAssetPlatform.nextdoor]:
    'Post copy in a neighbor-to-neighbor tone. Open by addressing ' +
    'neighbors directly (for example "Hi neighbors,"). Hyper-local, ' +
    'never salesy.',
  [SocialAssetPlatform.x]:
    'A single post of at most 230 characters, leaving room for a URL ' +
    'the candidate appends. At most one hashtag.',
  [SocialAssetPlatform.tiktok]:
    'A spoken-word video script of roughly 30-45 seconds, written to be ' +
    'read to camera in the first person, plus a short caption for the ' +
    'post in the caption field.',
  [SocialAssetPlatform.youtube_shorts]:
    'A spoken-word video script of roughly 30-45 seconds, written to be ' +
    'read to camera in the first person, plus a short caption for the ' +
    'post in the caption field.',
}

const SYSTEM_PROMPT = [
  'You are a social media expert helping an independent, non-partisan',
  'local candidate adapt one confirmed campaign message into',
  'platform-native posts.',
  'Rules:',
  '- Write in the first person, as the candidate.',
  '- Build ONLY on the provided draft message. Never invent facts,',
  '  endorsements, statistics, dates, or places it does not contain.',
  '- Stay strictly non-partisan. No party labels, no attacks.',
  '- Return exactly one asset per requested platform, following each',
  "  platform's rules.",
  '- For video platforms, put the spoken script in "text" and the post',
  '  caption in "caption". For copy platforms, omit "caption".',
].join('\n')

const GeneratedAssetsSchema = z.object({
  assets: z.array(
    z.object({
      platform: SocialAssetPlatformSchema,
      text: z.string(),
      caption: z.string().optional(),
    }),
  ),
})

type GeneratedAssets = z.infer<typeof GeneratedAssetsSchema>

@Injectable()
export class OutreachSocialGenerationService {
  constructor(
    private readonly llm: LlmService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachSocialGenerationService.name)
  }

  async generateAssets(
    input: SocialGenerateRequest,
    candidateName: string,
    userId: string,
  ): Promise<SocialAsset[]> {
    const platforms = [...new Set(input.platforms)]
    const messages: LlmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(input, platforms, candidateName) },
    ]

    let generated: GeneratedAssets
    try {
      ;({ object: generated } = await this.llm.jsonCompletion({
        messages,
        schema: GeneratedAssetsSchema,
        temperature: 0.7,
        maxTokens: 8192,
        userId,
      }))
    } catch (err) {
      this.logger.error({ err }, 'Social asset generation failed')
      throw new BadGatewayException('Social asset generation failed')
    }

    return platforms.map((platform) => {
      const asset = generated.assets.find((a) => a.platform === platform)
      const kind = SOCIAL_PLATFORM_KIND[platform]
      // A partial set must never reach the client as a success: the flow
      // saves exactly what generate returned, so missing platforms would
      // silently persist an incomplete campaign.
      if (!asset || (kind === SocialAssetKind.video_script && !asset.caption)) {
        this.logger.error(
          { platform, requested: platforms },
          'Social asset generation returned an incomplete set',
        )
        throw new BadGatewayException(
          'Social asset generation returned an incomplete set',
        )
      }
      return {
        platform,
        kind,
        text: asset.text,
        caption:
          kind === SocialAssetKind.video_script
            ? (asset.caption ?? null)
            : null,
      }
    })
  }
}

const buildPrompt = (
  input: SocialGenerateRequest,
  platforms: SocialAssetPlatform[],
  candidateName: string,
): string =>
  [
    `Candidate name: ${candidateName || 'The candidate'}.`,
    `Goal of this message: ${PURPOSE_GOALS[input.purpose]}.`,
    'Confirmed draft message:',
    '"""',
    input.draftMessage,
    '"""',
    'Requested platforms and their rules:',
    ...platforms.map(
      (platform) => `- ${platform}: ${PLATFORM_RULES[platform]}`,
    ),
    'Adapt the draft into one asset per requested platform.',
  ].join('\n')
