import { ForbiddenException, Injectable } from '@nestjs/common'
import { GEMINI_MODEL } from '@/vendors/google/gemini.types'
import { GeminiService } from '@/vendors/google/services/gemini.service'
import {
  CampaignStoryRewrite,
  CampaignStoryRewriteSchema,
} from '@goodparty_org/contracts'
import { RewriteCampaignStoryInput } from '../schemas/rewriteCampaignStory.schema'
import { CampaignStoryService } from './campaignStory.service'

// Pinned to stable Flash 3.5 (not the GeminiService default 3-flash-preview)
// so the rewrite voice doesn't drift with the preview channel.
const REWRITE_MODEL = GEMINI_MODEL.FLASH_3_5

const FIELD_GUIDANCE: Record<RewriteCampaignStoryInput['field'], string> = {
  why: 'why they are running — the moment, people, or breaking point that pushed them to put their name on the ballot. This is their stump-speech opener.',
  background:
    'their background — childhood, career, and community ties; the human story behind the candidate.',
  issue:
    'their focus on one of the concrete issues they will fight for if elected — what they will do about it and why it matters to their community.',
}

const SYSTEM_INSTRUCTION = [
  'You are a campaign manager helping an independent, non-partisan local',
  'candidate sharpen their campaign story in their own authentic voice.',
  'Rewrite the candidate-provided text into a confident, first-person',
  'passage of roughly 100-150 words, suitable for a stump speech.',
  'Rules:',
  '- Write in the first person ("I", "my"), as the candidate.',
  '- Build ONLY on what the candidate actually wrote. Never invent',
  '  biographical facts, policy positions, endorsements, statistics, or',
  '  specifics they did not provide.',
  '- Stay strictly non-partisan. No party labels, no attacks on opponents,',
  '  no divisive rhetoric.',
  '- Keep it warm, plain-spoken, and grounded in their community.',
  '- Put the rewritten passage in the "rewrite" field, with no preamble,',
  '  headings, or surrounding quotation marks.',
].join('\n')

@Injectable()
export class CampaignStoryRewriteService {
  constructor(
    private readonly gemini: GeminiService,
    private readonly campaignStory: CampaignStoryService,
  ) {}

  async rewrite(
    input: RewriteCampaignStoryInput,
    candidateName: string,
    campaignId: number,
  ): Promise<CampaignStoryRewrite> {
    if (!(await this.campaignStory.admitRewriteAttempt(campaignId))) {
      throw new ForbiddenException(
        'You have reached your AI rewrite limit for this campaign.',
      )
    }
    // Refund the admitted attempt if the Gemini call fails so an infra error
    // doesn't permanently consume a lifetime slot.
    try {
      return await this.gemini.generateStructured(
        this.buildPrompt(input, candidateName),
        CampaignStoryRewriteSchema,
        { model: REWRITE_MODEL, systemInstruction: SYSTEM_INSTRUCTION },
      )
    } catch (error) {
      await this.campaignStory.rollbackRewriteAttempt(campaignId)
      throw error
    }
  }

  private buildPrompt(
    input: RewriteCampaignStoryInput,
    candidateName: string,
  ): string {
    return [
      `Candidate name: ${candidateName || 'The candidate'}.`,
      `This passage is about ${FIELD_GUIDANCE[input.field]}`,
      ...(input.title ? [`This policy is titled: "${input.title}".`] : []),
      'Here is what the candidate wrote (it may be rough, short, or',
      'unpolished):',
      '"""',
      input.text,
      '"""',
      'Rewrite it following your instructions.',
    ].join('\n')
  }
}
