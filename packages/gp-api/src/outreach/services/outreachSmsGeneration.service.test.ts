import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { SERVE_OUTREACH_PURPOSE_VALUES } from '@goodparty_org/contracts'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { LlmService } from '@/llm/services/llm.service'
import { SERVE_SMS_VOICE } from '../util/serveSmsVoice.util'
import {
  IMPROVE_DRAFT_TARGET_LENGTH,
  OutreachSmsGenerationService,
  type SmsImproveProtection,
  SMS_IMPROVE_IDENTIFICATION_RULE,
  SMS_NO_NAME_PLACEHOLDER_RULE,
} from './outreachSmsGeneration.service'

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

const WIN_PROTECTION: SmsImproveProtection = {
  candidateNames: ['Sarah Chen'],
  committeeName: 'Friends of Sarah Chen',
  channel: 'peerly',
  ignoredRules: [],
}

const SERVE_PROTECTION: SmsImproveProtection = {
  candidateNames: [],
  committeeName: null,
  channel: 'serve',
  ignoredRules: ['paid_for_by'],
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
      [],
      WIN_PROTECTION,
    )

    const { userPrompt } = promptsOf(jsonCompletion)
    expect(userPrompt).toContain('Candidate name: The candidate.')
    expect(userPrompt).toContain('Office sought: local office.')
    expect(userPrompt).toContain("The candidate's SMS to polish:")
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
      {
        candidateNames: [],
        committeeName: null,
        channel: 'serve',
        ignoredRules: ['paid_for_by'],
      },
    )

    const { systemPrompt, userPrompt } = promptsOf(jsonCompletion)
    expect(userPrompt).toContain('Elected official name: The elected official.')
    expect(userPrompt).toContain("The elected official's SMS to polish:")
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

// Improve rewrites the whole message, locked parts included, so the model
// sees markers in their place and a reply is used only if it restores them.
describe('OutreachSmsGenerationService — protected Improve', () => {
  const MESSAGE =
    "Hello {first_name}, it's Sarah Chen. Come vote Nov 3!\n\nPaid for by Friends of Sarah Chen. Reply STOP to opt out."
  const improve = (service: OutreachSmsGenerationService) =>
    service.generateDraft(
      { purpose: 'custom', tone: 'warm', currentDraft: MESSAGE },
      'Sarah Chen',
      'City Council',
      '7',
      [],
      WIN_PROTECTION,
    )
  const replyWith = (...drafts: string[]) => {
    const { service, jsonCompletion } = buildService()
    drafts.forEach((draft) =>
      jsonCompletion.mockResolvedValueOnce({ object: { draft } }),
    )
    return { service, jsonCompletion }
  }

  it('sends markers instead of the locked text', async () => {
    const { service, jsonCompletion } = replyWith(
      "Hi ⟦1⟧, it's ⟦2⟧! Please vote Nov 3.\n\n⟦3⟧ ⟦4⟧",
    )
    await improve(service)
    const { userPrompt, systemPrompt } = promptsOf(jsonCompletion)
    expect(userPrompt).toContain('⟦3⟧')
    expect(userPrompt).not.toContain('Paid for by')
    expect(userPrompt).not.toContain('Reply STOP')
    expect(systemPrompt).toContain('Keep every marker exactly once')
  })

  it('returns the polish with the locked text put back', async () => {
    const { service } = replyWith(
      "Hi ⟦1⟧, it's ⟦2⟧! Please vote Nov 3.\n\n⟦3⟧ ⟦4⟧",
    )
    await expect(improve(service)).resolves.toBe(
      "Hi {first_name}, it's Sarah Chen! Please vote Nov 3.\n\nPaid for by Friends of Sarah Chen. Reply STOP to opt out.",
    )
  })

  it('retries once when the reply drops a marker, then uses the good one', async () => {
    const { service, jsonCompletion } = replyWith(
      "Hi ⟦1⟧, it's ⟦2⟧! Vote Nov 3.",
      "Hi ⟦1⟧, it's ⟦2⟧! Vote Nov 3.\n\n⟦3⟧ ⟦4⟧",
    )
    await expect(improve(service)).resolves.toContain('Reply STOP to opt out.')
    expect(jsonCompletion).toHaveBeenCalledTimes(2)
  })

  it('gives up with a 502 rather than return changed locked text', async () => {
    const { service } = replyWith('No markers at all.', 'Still none.')
    await expect(improve(service)).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('refuses a polish that breaks a rule the original passed', async () => {
    const { service } = replyWith(
      "Hi ⟦1⟧, it's ⟦2⟧! Vote at bit.ly/vote.\n\n⟦3⟧ ⟦4⟧",
      "Hi ⟦1⟧, it's ⟦2⟧! Vote at bit.ly/vote.\n\n⟦3⟧ ⟦4⟧",
    )
    await expect(improve(service)).rejects.toBeInstanceOf(BadGatewayException)
  })

  // The markers are shorter than what they hold, so the length the model is
  // told about is the message's, not the masked text's.
  it('asks for a cut when the whole message is over target, not the masked one', async () => {
    const body = 'Come vote. '.repeat(70)
    const long = `${MESSAGE.replace('Come vote Nov 3!', body.trim())}`
    expect(long.length).toBeGreaterThan(IMPROVE_DRAFT_TARGET_LENGTH)
    const { service, jsonCompletion } = replyWith('Hi ⟦1⟧ ⟦2⟧ ⟦3⟧ ⟦4⟧')
    await service
      .generateDraft(
        { purpose: 'custom', tone: 'warm', currentDraft: long },
        'Sarah Chen',
        'City Council',
        '7',
        [],
        WIN_PROTECTION,
      )
      .catch(() => undefined)
    expect(promptsOf(jsonCompletion).userPrompt).toContain(
      `The original runs ${long.length} characters`,
    )
  })

  it('refuses to polish without the message protection', async () => {
    const { service } = buildService()
    await expect(
      service.generateDraft(
        { purpose: 'custom', tone: 'warm', currentDraft: MESSAGE },
        'Sarah Chen',
        'City Council',
        '7',
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})

// The webapp writes the identification sentence and restores it when a draft
// comes back without it, so every prompt has to leave it to the app on a
// fresh draft, keep it on a polish, and never bracket a name.
describe('OutreachSmsGenerationService — identification', () => {
  it('keeps a fresh Win draft from greeting, introducing, or bracketing a name', async () => {
    const { service, jsonCompletion } = buildService()

    await service.generateDraft(
      { purpose: 'introduce_myself', tone: 'warm' },
      'Jane Doe',
      'City Council',
      '7',
    )

    const { systemPrompt } = promptsOf(jsonCompletion)
    expect(systemPrompt).toContain('do not greet, and')
    expect(systemPrompt).toContain('do not sign off')
    expect(systemPrompt).toContain(SMS_NO_NAME_PLACEHOLDER_RULE)
  })

  it('keeps a fresh Serve draft from signing off or bracketing a name', async () => {
    const { service, jsonCompletion } = buildService()

    await service.generateDraftWithVoice(
      { purpose: 'introduce_myself', tone: 'warm' },
      'Bryan Levine',
      'City Council Member',
      '7',
      [],
      SERVE_SMS_VOICE,
    )

    const { systemPrompt } = promptsOf(jsonCompletion)
    expect(systemPrompt).toContain('Do not greet')
    expect(systemPrompt).toContain('Do not sign off')
    expect(systemPrompt).toContain(SMS_NO_NAME_PLACEHOLDER_RULE)
  })

  it('makes a polish keep the name on both surfaces', async () => {
    const win = buildService()
    await win.service.generateDraft(
      { purpose: 'custom', tone: 'warm', currentDraft: 'Vote Tuesday.' },
      'Jane Doe',
      'City Council',
      '7',
      [],
      WIN_PROTECTION,
    )
    const serve = buildService()
    await serve.service.generateDraftWithVoice(
      { purpose: 'custom', tone: 'warm', currentDraft: 'Town hall Tuesday.' },
      'Bryan Levine',
      'City Council Member',
      '7',
      [],
      SERVE_SMS_VOICE,
      SERVE_PROTECTION,
    )

    for (const { jsonCompletion } of [win, serve]) {
      const { systemPrompt } = promptsOf(jsonCompletion)
      expect(systemPrompt).toContain(SMS_IMPROVE_IDENTIFICATION_RULE)
    }
  })
})

const LOGISTICS_BRACKET = /\[(date|time|location|hours|phone number)\]/i

describe('OutreachSmsGenerationService — event invite details', () => {
  const EVENT = {
    date: '2026-10-17',
    time: '18:30',
    location: 'Georgetown  Public\nLibrary',
  }

  it('writes the given details into a Win invite', async () => {
    const { service, jsonCompletion } = buildService()

    await service.generateDraft(
      { purpose: 'event_invite', tone: 'warm', event: EVENT },
      'Jane Doe',
      'City Council',
      '7',
    )

    const { systemPrompt, userPrompt } = promptsOf(jsonCompletion)
    expect(userPrompt).toContain('Date: Saturday, October 17')
    expect(userPrompt).toContain('Time: 6:30 PM')
    expect(userPrompt).toContain('Location: Georgetown Public Library')
    expect(`${systemPrompt}\n${userPrompt}`).not.toMatch(LOGISTICS_BRACKET)
  })

  it('writes the given details into a Serve invite', async () => {
    const { service, jsonCompletion } = buildService()

    await service.generateDraftWithVoice(
      { purpose: 'event_invite', tone: 'warm', event: EVENT },
      'Alex Rivera',
      'City Council',
      '7',
      [],
      SERVE_SMS_VOICE,
    )

    const { systemPrompt, userPrompt } = promptsOf(jsonCompletion)
    expect(userPrompt).toContain('Date: Saturday, October 17')
    expect(userPrompt).toContain('Location: Georgetown Public Library')
    expect(`${systemPrompt}\n${userPrompt}`).not.toMatch(LOGISTICS_BRACKET)
  })

  it('asks for no logistics line when an invite has no details', async () => {
    const { service, jsonCompletion } = buildService()

    await service.generateDraft(
      { purpose: 'event_invite', tone: 'warm' },
      'Jane Doe',
      'City Council',
      '7',
    )

    const { userPrompt } = promptsOf(jsonCompletion)
    expect(userPrompt).toContain('No event date, time or place was given.')
    expect(userPrompt).not.toContain('Date:')
  })

  it('adds no event block to another purpose or to a polish', async () => {
    const { service, jsonCompletion } = buildService()

    await service.generateDraft(
      { purpose: 'introduce_myself', tone: 'warm', event: EVENT },
      'Jane Doe',
      'City Council',
      '7',
    )
    await service.generateDraft(
      {
        purpose: 'event_invite',
        tone: 'warm',
        currentDraft: 'Join us Saturday at the library.',
        event: EVENT,
      },
      'Jane Doe',
      'City Council',
      '7',
      [],
      WIN_PROTECTION,
    )

    expect(jsonCompletion).toHaveBeenCalledTimes(2)
    for (const [call] of jsonCompletion.mock.calls) {
      const { messages } = call as {
        messages: Array<{ role: string; content: string }>
      }
      const user = messages.find((m) => m.role === 'user')?.content
      expect(user).not.toContain('Event details.')
      expect(user).not.toContain('No event date')
    }
  })

  it.each([
    'introduce_myself',
    'persuade_voters',
    'event_invite',
    'early_voting',
    'election_day_turnout',
  ] as const)('never asks a Win %s draft for a bracket', async (purpose) => {
    const { service, jsonCompletion } = buildService()

    await service.generateDraft(
      { purpose, tone: 'warm' },
      'Jane Doe',
      'City Council',
      '7',
    )

    const { systemPrompt, userPrompt } = promptsOf(jsonCompletion)
    expect(`${systemPrompt}\n${userPrompt}`).not.toMatch(LOGISTICS_BRACKET)
  })

  it.each(freshServePurposes)(
    'never asks a Serve %s draft for a bracket',
    async (purpose) => {
      const { service, jsonCompletion } = buildService()

      await service.generateDraftWithVoice(
        { purpose, tone: 'warm' },
        'Alex Rivera',
        'City Council',
        '7',
        [],
        SERVE_SMS_VOICE,
      )

      const { systemPrompt, userPrompt } = promptsOf(jsonCompletion)
      expect(`${systemPrompt}\n${userPrompt}`).not.toMatch(LOGISTICS_BRACKET)
    },
  )
})
