import { describe, expect, it, vi } from 'vitest'
import {
  checkContactPatterns,
  checkCopiedText,
  checkDenylist,
  gateDraft,
  runSecondRead,
  SecondReadCallError,
  type CaseCandidate,
} from './gate.util'

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

  it('never names the matched term', () => {
    expect(checkDenylist(['Springfield'], ['Springfield'])).not.toContain(
      'Springfield',
    )
  })
})

describe('checkCopiedText', () => {
  const source = [
    'I think the polling place near my house closed early on election day',
  ]

  it('blocks a run of exactly eight words', () => {
    expect(
      checkCopiedText(
        ['He said the polling place near my house closed early'],
        source,
      ),
    ).toBeDefined()
  })

  it('passes seven', () => {
    expect(
      checkCopiedText(['He said the polling place near my house'], source),
    ).toBeUndefined()
  })

  it('normalizes case and punctuation on both sides', () => {
    expect(
      checkCopiedText(
        ['He said: THE POLLING-PLACE near my house, closed early!'],
        source,
      ),
    ).toBeDefined()
  })

  it('never blocks without user messages', () => {
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
