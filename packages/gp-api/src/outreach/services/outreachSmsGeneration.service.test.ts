import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { SERVE_OUTREACH_PURPOSE_VALUES } from '@goodparty_org/contracts'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { LlmService } from '@/llm/services/llm.service'
import { SERVE_SMS_VOICE } from '../util/serveSmsVoice.util'
import { OutreachSmsGenerationService } from './outreachSmsGeneration.service'

const buildService = () => {
  const jsonCompletion = vi
    .fn()
    .mockResolvedValue({ object: { draft: 'a body' } })
  const service = new OutreachSmsGenerationService(
    { jsonCompletion } as unknown as LlmService,
    createMockLogger(),
  )
  return { service, jsonCompletion }
}

const promptsOf = (jsonCompletion: ReturnType<typeof vi.fn>) => {
  const call = jsonCompletion.mock.calls[0]?.[0] as {
    messages: Array<{ role: string; content: string }>
  }
  return {
    systemPrompt: call.messages.find((m) => m.role === 'system')?.content ?? '',
    userPrompt: call.messages.find((m) => m.role === 'user')?.content ?? '',
  }
}

// The Win surface calls generateDraft, the five-argument entry point that
// binds WIN_SMS_VOICE. These pin the exact strings it must keep producing,
// so a voice edit that changes Win output fails here, not in production.
describe('OutreachSmsGenerationService — Win entry point', () => {
  it('builds the candidate context lines unchanged', async () => {
    const { service, jsonCompletion } = buildService()

    await service.generateDraft(
      { purpose: 'introduce_myself', tone: 'warm' },
      'Jane Doe',
      'City Council',
      '7',
      ["The campaign's website: https://janedoe.com"],
    )

    const { systemPrompt, userPrompt } = promptsOf(jsonCompletion)
    expect(userPrompt).toContain('Candidate name: Jane Doe.')
    expect(userPrompt).toContain('Office sought: City Council.')
    expect(userPrompt).toContain(
      'Goal of this message: introduce the candidate to voters.',
    )
    expect(userPrompt).toContain("The campaign's website: https://janedoe.com")
    expect(userPrompt).toContain('My priorities:')
    expect(systemPrompt).toContain('Do NOT introduce the candidate')
  })

  it('falls back to the candidate subject and polishes with the Win label', async () => {
    const { service, jsonCompletion } = buildService()

    await service.generateDraft(
      {
        purpose: 'custom',
        tone: 'direct',
        currentDraft: 'Town hall Saturday.',
      },
      '',
      '',
      '7',
    )

    const { userPrompt } = promptsOf(jsonCompletion)
    expect(userPrompt).toContain('Candidate name: The candidate.')
    expect(userPrompt).toContain('Office sought: local office.')
    expect(userPrompt).toContain("The candidate's SMS body to polish:")
  })

  it('refuses a fresh custom draft with the candidate wording', async () => {
    const { service } = buildService()

    await expect(
      service.generateDraft(
        { purpose: 'custom', tone: 'warm' },
        'Jane',
        '',
        '7',
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'Custom-purpose messages are written by the candidate',
      ),
    )
  })
})

const freshServePurposes = SERVE_OUTREACH_PURPOSE_VALUES.filter(
  (purpose) => purpose !== 'custom',
)

// The Win/Serve boundary is the point of the parametrization: an elected
// official has constituents, an office and a term (docs/product-vocabulary.md).
const BANNED_IN_SERVE =
  /\b(voters?|elections?|electoral|candidates?|ballots?)\b/i

describe('OutreachSmsGenerationService — SERVE_SMS_VOICE', () => {
  it.each(freshServePurposes)(
    'drafts the %s purpose with elected-official framing',
    async (purpose) => {
      const { service, jsonCompletion } = buildService()

      await service.generateDraftWithVoice(
        { purpose, tone: 'warm' },
        'Alex Rivera',
        'City Council',
        '7',
        ["The official's bio, in their own words:"],
        SERVE_SMS_VOICE,
      )

      const { systemPrompt, userPrompt } = promptsOf(jsonCompletion)
      expect(userPrompt).toContain('Elected official name: Alex Rivera.')
      expect(userPrompt).toContain('Office held: City Council.')
      expect(userPrompt).toContain(
        `Goal of this message: ${SERVE_SMS_VOICE.purposeGoals[purpose]}.`,
      )
      expect(userPrompt).toContain(SERVE_SMS_VOICE.purposeStructures[purpose])
      expect(userPrompt).not.toContain('Office sought')
      expect(systemPrompt).toContain('elected official')
      expect(systemPrompt).not.toMatch(BANNED_IN_SERVE)
      expect(userPrompt).not.toMatch(BANNED_IN_SERVE)
    },
  )

  it('polishes with the official subject and never injects a structure', async () => {
    const { service, jsonCompletion } = buildService()

    await service.generateDraftWithVoice(
      {
        purpose: 'introduce_myself',
        tone: 'warm',
        currentDraft: 'I wrote this myself, in my own shape.',
      },
      '',
      '',
      '7',
      [],
      SERVE_SMS_VOICE,
    )

    const { systemPrompt, userPrompt } = promptsOf(jsonCompletion)
    expect(userPrompt).toContain('Elected official name: The elected official.')
    expect(userPrompt).toContain("The elected official's SMS body to polish:")
    expect(userPrompt).not.toContain('My priorities:')
    expect(systemPrompt).toContain('light edit')
    expect(systemPrompt).not.toMatch(BANNED_IN_SERVE)
  })

  it('refuses a fresh custom draft with the official wording', async () => {
    const { service } = buildService()

    await expect(
      service.generateDraftWithVoice(
        { purpose: 'custom', tone: 'warm' },
        'Alex',
        '',
        '7',
        [],
        SERVE_SMS_VOICE,
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'Custom-purpose messages are written by the elected official',
      ),
    )
  })
})
