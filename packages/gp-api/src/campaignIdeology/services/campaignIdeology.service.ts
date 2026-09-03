import { Injectable } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { createHash } from 'node:crypto'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { LlmService } from '@/llm/services/llm.service'
import { RaceOpponentService } from '@/raceOpponent/services/raceOpponent.service'
import { serializeWebsiteIssues } from '@/websites/util/serializeWebsiteIssues.util'
import { IdeologyBucket, IdeologyBucketSchema } from '@goodparty_org/contracts'
import {
  buildCandidateIdeologyMessages,
  CAMPAIGN_IDEOLOGY_MODELS,
  CandidateIdeologyInput,
  IdeologyClassificationResponseSchema,
} from '../campaignIdeology.prompt'

@Injectable()
export class CampaignIdeologyService extends createPrismaBase(
  MODELS.CampaignIdeology,
) {
  constructor(
    private readonly llmService: LlmService,
    private readonly moduleRef: ModuleRef,
  ) {
    super()
  }

  // Lazy + cached: computed on the first recommendation request that needs
  // it, recomputed only when the underlying story text changes. Never
  // throws — a classification failure hides ideology recommendations rather
  // than breaking the caller.
  async bucketForCampaign(campaignId: number): Promise<IdeologyBucket | null> {
    const input = await this.buildInput(campaignId)
    const inputText = [input.issues, input.bio, input.background]
      .filter((text): text is string => Boolean(text))
      .join('\n\n')

    // Nothing to classify. Most campaigns never fill in onboarding story
    // text at all, so decline without paying for a model call or a write.
    if (!inputText) return null

    const inputHash = createHash('sha256').update(inputText).digest('hex')

    const existing = await this.model.findUnique({ where: { campaignId } })
    if (existing && existing.inputHash === inputHash) {
      return this.parseBucket(existing.bucket)
    }

    const classification = await this.classify(input, campaignId)
    if (!classification) return null

    await this.model.upsert({
      where: { campaignId },
      create: {
        campaignId,
        bucket: classification.bucket,
        evidence: classification.evidence,
        inputHash,
        model: classification.model,
        computedAt: new Date(),
      },
      update: {
        bucket: classification.bucket,
        evidence: classification.evidence,
        inputHash,
        model: classification.model,
        computedAt: new Date(),
      },
    })

    return classification.bucket
  }

  // Returns null (and logs) rather than throwing on any failure — a
  // transient LLM/infra failure should never persist, so the next request
  // gets a fresh attempt instead of a cached failure.
  private async classify(
    input: CandidateIdeologyInput,
    campaignId: number,
  ): Promise<{
    bucket: IdeologyBucket | null
    evidence: string
    model: string
  } | null> {
    try {
      const result = await this.llmService.jsonCompletion({
        messages: buildCandidateIdeologyMessages(input),
        schema: IdeologyClassificationResponseSchema,
        temperature: 0,
        models: CAMPAIGN_IDEOLOGY_MODELS,
      })
      return { ...result.object, model: result.model }
    } catch (error) {
      this.logger.error(
        { err: error, campaignId },
        'Candidate ideology classification failed',
      )
      return null
    }
  }

  private parseBucket(bucket: string | null): IdeologyBucket | null {
    const parsed = IdeologyBucketSchema.safeParse(bucket)
    return parsed.success ? parsed.data : null
  }

  // RaceOpponentService is resolved lazily via ModuleRef rather than
  // imported: RaceOpponentModule pulls in CampaignStrategyModule ->
  // WebsitesModule, and closing that back into this module risks the same
  // module-cycle failure PaymentEventsService avoids the same way.
  private async buildInput(
    campaignId: number,
  ): Promise<CandidateIdeologyInput> {
    const raceOpponent = this.moduleRef.get(RaceOpponentService, {
      strict: false,
    })
    const platform = await raceOpponent.buildCandidatePlatform(campaignId)
    const story = await this.client.campaignStory.findUnique({
      where: { campaignId },
      select: { background: true },
    })

    return {
      issues: platform?.issues ? serializeWebsiteIssues(platform.issues) : null,
      bio: platform?.bio?.trim() ? platform.bio : null,
      background: story?.background?.trim() ? story.background : null,
    }
  }
}
