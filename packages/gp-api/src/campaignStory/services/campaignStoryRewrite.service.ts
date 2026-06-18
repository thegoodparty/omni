import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { GEMINI_MODEL } from '@/vendors/google/gemini.types'
import { GeminiService } from '@/vendors/google/services/gemini.service'
import { UserRequestBudget } from '@/speech/util/userRequestBudget'
import {
  CampaignStoryRewrite,
  CampaignStoryRewriteSchema,
} from '@goodparty_org/contracts'
import { RewriteCampaignStoryInput } from '../schemas/rewriteCampaignStory.schema'

// Pinned to stable Flash 3.5 (not the GeminiService default 3-flash-preview)
// so the rewrite voice doesn't drift with the preview channel.
const REWRITE_MODEL = GEMINI_MODEL.FLASH_3_5

// Per-user budget against the Gemini-billed rewrite endpoint, mirroring the
// speech endpoints' UserRequestBudget. Bounds cost/quota abuse from an
// authenticated user hammering the button. In-memory/per-pod — fine for v1
// (same rationale as the TTS limiter).
const REWRITE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000
const REWRITE_RATE_LIMIT_PER_USER = 20

const FIELD_GUIDANCE: Record<RewriteCampaignStoryInput['field'], string> = {
  why: 'why they are running — the moment, people, or breaking point that pushed them to put their name on the ballot. This is their stump-speech opener.',
  background:
    'their background — childhood, career, and community ties; the human story behind the candidate.',
  issues:
    'the two to four concrete issues they will fight for in their first term.',
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
  private readonly budget = new UserRequestBudget({
    windowMs: REWRITE_RATE_LIMIT_WINDOW_MS,
    limit: REWRITE_RATE_LIMIT_PER_USER,
  })

  constructor(private readonly gemini: GeminiService) {}

  rewrite(
    input: RewriteCampaignStoryInput,
    candidateName: string,
    userId: number,
  ): Promise<CampaignStoryRewrite> {
    if (!this.budget.tryAdmit(userId)) {
      throw new HttpException(
        'Rewrite rate limit exceeded; please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    return this.gemini.generateStructured(
      this.buildPrompt(input, candidateName),
      CampaignStoryRewriteSchema,
      { model: REWRITE_MODEL, systemInstruction: SYSTEM_INSTRUCTION },
    )
  }

  private buildPrompt(
    input: RewriteCampaignStoryInput,
    candidateName: string,
  ): string {
    return [
      `Candidate name: ${candidateName || 'The candidate'}.`,
      `This passage is about ${FIELD_GUIDANCE[input.field]}`,
      'Here is what the candidate wrote (it may be rough, short, or',
      'unpolished):',
      '"""',
      input.text,
      '"""',
      'Rewrite it following your instructions.',
    ].join('\n')
  }
}
