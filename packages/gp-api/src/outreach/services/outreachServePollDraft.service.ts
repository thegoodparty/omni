import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common'
import {
  POLL_TOPICS,
  ServePollDraftRequest,
  ServePollDraftResponse,
  ServePollDraftResponseSchema,
} from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { LlmService } from '@/llm/services/llm.service'
import { type LlmMessage } from '@/llm/types/llmMessages.types'

const TONE_STYLES = {
  Neutral: 'Neutral: even-handed and plain, with no emotional color.',
  Warm: 'Warm: caring and personal, in the way a neighbor would ask.',
  Direct: 'Direct: short and to the point, with no filler or hedging.',
  Friendly: 'Friendly: upbeat and approachable, like a note to a friend.',
} as const

// Vocabulary is enforced here (docs/product-vocabulary.md): an elected
// official has constituents and an office, never voters or a campaign.
const SYSTEM_PROMPT = [
  'You are a writing assistant helping an elected official ask the',
  'constituents they serve one question by text message.',
  'Rules:',
  '- Write exactly one open-ended question about the topic. Never a yes/no',
  '  question and never a list of answer choices.',
  '- Stay neutral. Do not lead the reader toward an answer, imply the',
  '  official already has a position, or use loaded words.',
  '- Do not mention parties, elections, candidates or campaigns.',
  '- Under 300 characters. One sentence is best.',
  '- Do not greet, introduce the official, sign off, or add an opt-out line:',
  '  the app adds all of those around your question.',
  '- Never write a square-bracket placeholder or invent facts, numbers,',
  '  dates or places.',
  '- Match the requested tone through word choice only.',
  '- When the official already wrote a draft, improve that draft: keep what',
  '  it is asking and fix grammar, bias and clarity. Do not change the topic.',
].join('\n')

@Injectable()
export class OutreachServePollDraftService {
  constructor(
    private readonly llm: LlmService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachServePollDraftService.name)
  }

  async generateQuestion(
    input: ServePollDraftRequest,
    office: string,
    userId: string,
    composeContext: string[],
  ): Promise<ServePollDraftResponse> {
    const topic = POLL_TOPICS.find((candidate) => candidate.id === input.topic)
    if (input.topic === 'custom' && !input.currentDraft) {
      throw new BadRequestException(
        'A custom poll question is written by the official',
      )
    }
    const messages: LlmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `Office held: ${office || 'local office'}.`,
          `Topic: ${topic?.label}.`,
          `Tone: ${TONE_STYLES[input.tone]}`,
          ...composeContext,
          ...(input.currentDraft
            ? [
                'The official wrote this draft:',
                '"""',
                input.currentDraft,
                '"""',
                'Improve the draft.',
              ]
            : ['Write the question.']),
        ].join('\n'),
      },
    ]
    try {
      const { object } = await this.llm.jsonCompletion({
        messages,
        schema: ServePollDraftResponseSchema,
        // High enough that Regenerate re-rolls produce a different question.
        temperature: 0.8,
        maxTokens: 256,
        userId,
      })
      return object
    } catch (err) {
      this.logger.error({ err }, 'Poll question generation failed')
      throw new BadGatewayException('Poll question generation failed')
    }
  }
}
