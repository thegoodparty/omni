import { describe, expect, it, vi } from 'vitest'
import { PinoLogger } from 'nestjs-pino'
import { LlmService } from '@/llm/services/llm.service'
import { ConstituentFeedbackExtractionService } from './services/constituentFeedbackExtraction.service'

const logger = () =>
  ({ setContext: vi.fn(), error: vi.fn() }) as unknown as PinoLogger

const llmReturning = (object: {
  issues: Array<{
    issueLabel: string
    stance: string | null
    desiredOutcome: string | null
  }>
  confidence: number | null
}) =>
  ({
    jsonCompletion: vi.fn().mockResolvedValue({
      object,
      model: 'claude-test',
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
    }),
  }) as unknown as LlmService

const TRANSCRIPT = 'Talked to Bob, he is against the cameras.'

const promptFrom = (llm: LlmService): { user: string; userId?: string } => {
  const call = vi.mocked(llm.jsonCompletion).mock.calls[0]
  if (call === undefined) {
    throw new Error('expected jsonCompletion to have been called')
  }
  const message = call[0].messages[1]
  if (message === undefined || typeof message.content !== 'string') {
    throw new Error('expected jsonCompletion to get a string user prompt')
  }
  return { user: message.content, userId: call[0].userId }
}

describe('ConstituentFeedbackExtractionService', () => {
  it('returns every issue the note named, in order, and the model', async () => {
    const issues = [
      {
        issueLabel: 'Flock cameras',
        stance: 'opposes',
        desiredOutcome: null,
      },
      {
        issueLabel: 'Street flooding',
        stance: 'supports',
        desiredOutcome: 'Clear the storm drain',
      },
    ]
    const service = new ConstituentFeedbackExtractionService(
      llmReturning({ issues, confidence: 0.9 }),
      logger(),
    )

    const result = await service.extract({
      transcript: TRANSCRIPT,
      effortQuestion: null,
      userId: 1,
    })

    expect(result).toEqual({
      extraction: { issues, confidence: 0.9 },
      model: 'claude-test',
    })
  })

  // Some canvasses exist only to gather issues, so one note often names
  // several; the prompt has to ask for each rather than the first.
  it('asks for one entry per issue, up to five', async () => {
    const llm = llmReturning({ issues: [], confidence: 0.2 })
    const service = new ConstituentFeedbackExtractionService(llm, logger())

    await service.extract({
      transcript: TRANSCRIPT,
      effortQuestion: null,
      userId: 1,
    })

    const system = vi.mocked(llm.jsonCompletion).mock.calls[0]?.[0].messages[0]
      ?.content
    expect(system).toContain('one entry per distinct issue')
    expect(system).toContain('up to five')
  })

  // The memo is the record worth keeping. A provider outage must leave the
  // canvasser an empty issue to fill in, not lose what they just recorded.
  it('returns null instead of throwing when the model call fails', async () => {
    const llm = {
      jsonCompletion: vi.fn().mockRejectedValue(new Error('upstream 529')),
    } as unknown as LlmService
    const service = new ConstituentFeedbackExtractionService(llm, logger())

    const result = await service.extract({
      transcript: TRANSCRIPT,
      effortQuestion: null,
      userId: 1,
    })

    expect(result).toBeNull()
  })

  // The question is what tells the extractor whether "no" means opposing the
  // compost pilot or declining a yard sign, so it has to reach the prompt.
  it('puts the effort question in the prompt when the effort has one', async () => {
    const llm = llmReturning({
      issues: [
        {
          issueLabel: 'composting pilot',
          stance: 'supports',
          desiredOutcome: 'a smaller bin',
        },
      ],
      confidence: 0.8,
    })
    const service = new ConstituentFeedbackExtractionService(llm, logger())

    await service.extract({
      transcript: TRANSCRIPT,
      effortQuestion: 'Would you take part in a compost pilot?',
      userId: 7,
    })

    const prompt = promptFrom(llm)
    expect(prompt.user).toContain('Would you take part in a compost pilot?')
    expect(prompt.user).toContain(TRANSCRIPT)
    expect(prompt.userId).toBe('7')
  })

  it('omits the question clause entirely when the effort has none', async () => {
    const llm = llmReturning({ issues: [], confidence: 0.2 })
    const service = new ConstituentFeedbackExtractionService(llm, logger())

    await service.extract({
      transcript: TRANSCRIPT,
      effortQuestion: null,
      userId: 1,
    })

    expect(promptFrom(llm).user).toBe(`The canvasser's note:\n${TRANSCRIPT}`)
  })

  // The issues are shown on both products, and the copy around them is
  // mode-keyed by the UI. A product noun in the prompt steers the model into
  // writing one product's word into the other's record.
  it.each([null, 'Would you take part in a compost pilot?'])(
    'names no product’s people in the prompt (question: %s)',
    async (effortQuestion) => {
      const llm = llmReturning({ issues: [], confidence: 0.2 })
      const service = new ConstituentFeedbackExtractionService(llm, logger())

      await service.extract({
        transcript: TRANSCRIPT,
        effortQuestion,
        userId: 1,
      })

      const messages = vi.mocked(llm.jsonCompletion).mock.calls[0]?.[0].messages
      const assembled = (messages ?? [])
        .map((message) =>
          typeof message.content === 'string' ? message.content : '',
        )
        .join('\n')
      expect(assembled).not.toBe('')
      expect(assembled).not.toMatch(/constituent/i)
      expect(assembled).not.toMatch(/voter/i)
      // The rule that keeps the canvasser's words off the other person.
      expect(assembled).toContain('The voice in the note is the CANVASSER')
    },
  )
})
