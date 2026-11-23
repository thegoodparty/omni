import { describe, expect, it, vi } from 'vitest'
import { ChatMessageRole } from '@/generated/prisma'
import {
  checkContactPatterns,
  checkCopiedText,
  checkDenylist,
  gateDraft,
  gateNeedsSetup,
  outboundStrings,
  runSecondRead,
  SecondReadCallError,
  type CaseCandidate,
} from './gate.util'
import type { Message, Session } from './sessions.util'
import { sessionSourceTexts } from './transcript.util'

const clean: CaseCandidate = {
  caseId: 'a-clean-case',
  question: 'What turnout should I expect this fall?',
  condition: 'Numbers come with a source.',
  handledWhen: 'The reply names a source.',
  source: 'production',
  split: 'tune',
}

describe('checkDenylist', () => {
  it('blocks a present term whatever its case', () => {
    expect(
      checkDenylist(["Mention Springfield's rule."], ['springfield']),
    ).toBeDefined()
    expect(
      checkDenylist(['ran in SPRINGFIELD.'], ['Springfield']),
    ).toBeDefined()
  })

  it('passes an absent term and skips terms under three characters', () => {
    expect(checkDenylist(['Nothing here.'], ['Springfield'])).toBeUndefined()
    expect(checkDenylist(['Mo went home.'], ['Mo'])).toBeUndefined()
  })

  it('matches whole words only', () => {
    expect(checkDenylist(['moved to Canada'], ['Ada'])).toBeUndefined()
  })

  it('treats regex characters in a term literally', () => {
    expect(
      checkDenylist(
        ['Call City Council (District 4) directly.'],
        ['City Council (District 4)'],
      ),
    ).toBeDefined()
  })

  it('catches a punctuated term in a de-slugged caseId', () => {
    expect(
      checkDenylist(['delacroix venn asks about turnout'], ['Delacroix-Venn']),
    ).toBeDefined()
    expect(
      checkDenylist(['o brien wants a yard sign'], ["O'Brien"]),
    ).toBeDefined()
  })

  it('catches a hyphenated term written with a space', () => {
    expect(
      checkDenylist(['Ask Delacroix Venn about turnout.'], ['Delacroix-Venn']),
    ).toBeDefined()
  })

  it('never names the matched term', () => {
    expect(checkDenylist(['Springfield'], ['Springfield'])).not.toContain(
      'Springfield',
    )
  })
})

describe('checkCopiedText', () => {
  const source = [
    'I think the polling place on Fenwick Road closed early on election day',
  ]

  it('blocks an identifying run of exactly eight words', () => {
    expect(
      checkCopiedText(
        ['He said the polling place on Fenwick Road closed early'],
        source,
      ),
    ).toBeDefined()
  })

  it('passes seven', () => {
    expect(
      checkCopiedText(
        ['He said the polling place on Fenwick Road closed'],
        source,
      ),
    ).toBeUndefined()
  })

  it('normalizes case and punctuation on both sides', () => {
    expect(
      checkCopiedText(
        ['He said: THE POLLING-PLACE on fenwick road, closed early!'],
        source,
      ),
    ).toBeDefined()
  })

  it('blocks a copied name whose lowercase gains a combining mark', () => {
    expect(
      checkCopiedText(
        ['the polling place on İnönü Road closed early today'],
        ['so the polling place on İnönü Road closed early today'],
      ),
    ).toBeDefined()
  })

  it('blocks a copied run whose source carries a number', () => {
    expect(
      checkCopiedText(
        ['So the polling place near my house closed at 6?'],
        ['the polling place near my house closed at 6 on election day'],
      ),
    ).toBeDefined()
  })

  it('passes a generic run copied word for word', () => {
    const generic = [
      "I'm sure the polling place near my house closed early on election day",
    ]
    expect(
      checkCopiedText(
        ['He said the polling place near my house closed early'],
        generic,
      ),
    ).toBeUndefined()
    expect(
      checkCopiedText(
        ['He said the Polling Place near my House closed early'],
        generic,
      ),
    ).toBeUndefined()
  })

  it('reads a capital after a sentence break as ordinary', () => {
    expect(
      checkCopiedText(
        ['Turnout at the polling place near my house was low.'],
        ['We lost. Turnout at the polling place near my house was low'],
      ),
    ).toBeUndefined()
  })

  it('never blocks without source texts', () => {
    expect(
      checkCopiedText(['anything at all, eight or more words long here'], []),
    ).toBeUndefined()
  })
})

describe('checkContactPatterns', () => {
  it.each([
    'reach me at jane.doe+test@example.com',
    'call (555) 123-4567 for details',
    'call 555-123-4567 for details',
    'call +1 555 123 4567 for details',
    'see https://example.com/profile for more',
    'see www.example.com for more',
  ])('catches %s', (text) => {
    expect(checkContactPatterns([text])).toBeDefined()
  })

  it('passes ordinary text', () => {
    expect(
      checkContactPatterns(['a perfectly ordinary sentence, order 1234567']),
    ).toBeUndefined()
  })

  it.each([
    'her direct line is 555-0123',
    'her direct line is 555 0123',
    'her direct line is 555.0123.',
    'leave a message at 555-0193, then hang up',
    'his cell is 867-5309',
    'call 555 1999 after six',
    'reach her at 555.2024',
    'the office line is 210-5550',
    'Room 214 2026 schedule',
  ])('catches a seven-digit number with no area code: %s', (text) => {
    expect(checkContactPatterns([text])).toBeDefined()
  })

  it.each([
    'the levy passed in 2024 after failing in 2022',
    'the 2024-2025 budget',
    'Ordinance 245-2025 sets the fee',
    'we raised $1,250 and spent $4,000',
    'she won 2,450 to 1,980',
    'mail it to 80202-1234',
    'expect 500-1000 voters this fall',
    'expect 250-1000 voters this fall',
    'the precinct had 312 voters and 1204 households',
    'a $250 1,000-piece mailer',
    'a mill rate of 12.3456',
    'turnout was 3,212 of 9,876',
  ])('passes an ordinary number: %s', (text) => {
    expect(checkContactPatterns([text])).toBeUndefined()
  })
})

describe('runSecondRead', () => {
  it('passes an empty list and blocks a flagged string', async () => {
    expect(await runSecondRead(['draft'], async () => '[]')).toBeUndefined()
    expect(
      await runSecondRead(['draft'], async () => '["Lakemoor"]'),
    ).toBeDefined()
  })

  it('blocks a call error at once, with no retry', async () => {
    const call = vi.fn(async () => {
      throw new SecondReadCallError('down')
    })
    expect(await runSecondRead(['draft'], call)).toBe(
      'the second read call failed',
    )
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('retries an unreadable answer once, then blocks', async () => {
    const call = vi.fn(async () => 'None found.')
    expect(await runSecondRead(['draft'], call)).toBe(
      'the second read returned an unparseable answer after a retry',
    )
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('recovers when the retry reads', async () => {
    const call = vi
      .fn<(text: string) => Promise<string>>()
      .mockResolvedValueOnce('None found.')
      .mockResolvedValueOnce('```json\n[]\n```')
    expect(await runSecondRead(['draft'], call)).toBeUndefined()
  })

  it('sends the draft alone', async () => {
    const call = vi.fn(async () => '[]')
    await runSecondRead(['condition', 'handled', 'question'], call)
    expect(call).toHaveBeenCalledWith('condition\nhandled\nquestion')
  })
})

describe('gateDraft', () => {
  const pass = async () => '[]'

  it('passes a clean draft', async () => {
    expect(await gateDraft(clean, [], [], pass)).toEqual({ passed: true })
  })

  it('stops at the first failing layer, before the paid second read', async () => {
    const secondRead = vi.fn(pass)
    const result = await gateDraft(
      { ...clean, question: 'Is Lakemoor turnout up?' },
      ['Lakemoor'],
      [],
      secondRead,
    )
    expect(result).toMatchObject({ passed: false, rule: 'denylist' })
    expect(secondRead).not.toHaveBeenCalled()
  })

  it('gates a schema violation last', async () => {
    expect(
      await gateDraft({ ...clean, caseId: 'bad id!' }, [], [], pass),
    ).toMatchObject({ passed: false, rule: 'schema' })
    expect(
      await gateDraft({ ...clean, turns: ['one'] }, [], [], pass),
    ).toMatchObject({
      passed: false,
      rule: 'schema',
      reason: 'exactly one of question or turns is required',
    })
    expect(
      await gateDraft({ ...clean, handledWhen: 'x'.repeat(601) }, [], [], pass),
    ).toMatchObject({ passed: false, rule: 'schema' })
  })
})

describe('copied text from every role', () => {
  const pass = async () => '[]'
  const message = (fields: Partial<Message>): Message => ({
    conversationId: 'conv-1',
    scope: 'campaign_assistant',
    messageId: 'msg-1',
    role: ChatMessageRole.user,
    content: 'how do I plan my week',
    createdAt: new Date('2026-11-12T15:00:00.000Z'),
    toolCalls: [],
    isInternal: false,
    denylist: [],
    ...fields,
  })
  const session = (messages: Message[]): Session => ({
    sessionId: 'conv-1:msg-1',
    conversationId: 'conv-1',
    scope: 'campaign_assistant',
    startedAt: new Date('2026-11-12T15:00:00.000Z'),
    messages,
  })
  const sourcesFrom = {
    'a user turn': (text: string) =>
      sessionSourceTexts(session([message({ content: text })])),
    'an assistant turn': (text: string) =>
      sessionSourceTexts(
        session([
          message({}),
          message({
            messageId: 'msg-2',
            role: ChatMessageRole.assistant,
            content: text,
          }),
        ]),
      ),
    'a tool input': (text: string) =>
      sessionSourceTexts(
        session([
          message({}),
          message({
            messageId: 'msg-2',
            role: ChatMessageRole.assistant,
            content: 'Saving that now.',
            toolCalls: [
              { tool: 'save_note', input: JSON.stringify({ note: text }) },
            ],
          }),
        ]),
      ),
  }
  const roles = Object.keys(sourcesFrom) as Array<keyof typeof sourcesFrom>

  it.each(roles)('passes a generic run copied from %s', async (role) => {
    expect(
      await gateDraft(
        {
          ...clean,
          question:
            'My treasurer wants the mailer proof back by the end of the week.',
        },
        [],
        sourcesFrom[role](
          'my treasurer wants the mailer proof back by the end of the week',
        ),
        pass,
      ),
    ).toEqual({ passed: true })
  })

  it.each(roles)('blocks a run with a number from %s', async (role) => {
    expect(
      await gateDraft(
        {
          ...clean,
          question: 'My treasurer wants the mailer proof back by the 14th. Ok?',
        },
        [],
        sourcesFrom[role](
          'my treasurer wants the mailer proof back by the 14th at noon',
        ),
        pass,
      ),
    ).toMatchObject({ passed: false, rule: 'copiedText' })
  })

  it.each(roles)('blocks a run with a name from %s', async (role) => {
    expect(
      await gateDraft(
        {
          ...clean,
          question:
            'My treasurer wants the mailer proof from Brightwell Press.',
        },
        [],
        sourcesFrom[role](
          'my treasurer wants the mailer proof from Brightwell Press by noon',
        ),
        pass,
      ),
    ).toMatchObject({ passed: false, rule: 'copiedText' })
  })
})

describe('outboundStrings', () => {
  it('lists every drafter-written field, the caseId de-slugged', () => {
    expect(
      outboundStrings({
        case: {
          ...clean,
          caseId: 'maple-falls_ward-2',
          question: undefined,
          turns: ['a', 'b'],
        },
      }),
    ).toEqual([
      clean.condition,
      clean.handledWhen,
      'a',
      'b',
      'maple falls ward 2',
    ])
    expect(outboundStrings({ needsSetup: 'a line' })).toEqual(['a line'])
  })
})

describe('the caseId', () => {
  const pass = async () => '[]'

  it('blocks a multi-word denylist term in its slug form', async () => {
    expect(
      await gateDraft(
        { ...clean, caseId: 'maple-falls-ward-2-turnout' },
        ['Maple Falls'],
        [],
        pass,
      ),
    ).toMatchObject({ passed: false, rule: 'denylist' })
    expect(
      await gateDraft(
        { ...clean, caseId: 'maple_falls_turnout' },
        ['Maple Falls'],
        [],
        pass,
      ),
    ).toMatchObject({ passed: false, rule: 'denylist' })
  })

  it('blocks a hyphenated denylist term in its slug form', async () => {
    expect(
      await gateDraft(
        { ...clean, caseId: 'delacroix-venn-asks-about-turnout' },
        ['Delacroix-Venn'],
        [],
        pass,
      ),
    ).toMatchObject({ passed: false, rule: 'denylist' })
  })

  it('blocks a phone number carried in the slug', async () => {
    expect(
      await gateDraft({ ...clean, caseId: 'call-555-018-4423' }, [], [], pass),
    ).toMatchObject({ passed: false, rule: 'contactPattern' })
  })

  it('is part of what the second read sees', async () => {
    const call = vi.fn(pass)
    await gateDraft({ ...clean, caseId: 'a-clean-case' }, [], [], call)
    expect(call).toHaveBeenCalledWith(expect.stringContaining('a clean case'))
  })
})

describe('gateNeedsSetup', () => {
  const pass = async () => '[]'

  it('passes a clean line', async () => {
    expect(
      await gateNeedsSetup(
        'An account with a primary next week.',
        [],
        [],
        pass,
      ),
    ).toEqual({ passed: true })
  })

  it('runs the text layers on the line', async () => {
    expect(
      await gateNeedsSetup(
        'The council seat in Lakemoor.',
        ['Lakemoor'],
        [],
        pass,
      ),
    ).toMatchObject({ passed: false, rule: 'denylist' })
    expect(
      await gateNeedsSetup(
        'A volunteer reachable at 555-123-4567.',
        [],
        [],
        pass,
      ),
    ).toMatchObject({ passed: false, rule: 'contactPattern' })
    expect(
      await gateNeedsSetup(
        'An account whose treasurer filed the report 2 days after the deadline',
        [],
        ['our treasurer filed the report 2 days after the deadline again'],
        pass,
      ),
    ).toMatchObject({ passed: false, rule: 'copiedText' })
    expect(
      await gateNeedsSetup(
        'Data for one town.',
        [],
        [],
        async () => '["one town"]',
      ),
    ).toMatchObject({ passed: false, rule: 'secondRead' })
  })

  it('has no schema layer', async () => {
    expect(await gateNeedsSetup('x', [], [], pass)).toEqual({ passed: true })
  })
})
