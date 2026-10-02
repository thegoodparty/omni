import { describe, expect, it } from 'vitest'
import {
  checkSmsStandards,
  deriveSmsProtectedParts,
} from './SmsAdminConsole.schema'

const SCRIPT =
  "Hello {first_name}, it's Sarah Chen, running for city council. Can I count on your vote?\n\nPaid for by Friends of Sarah Chen. Reply STOP to opt out."
const CONTEXT = {
  candidateNames: ['Sarah Chen'],
  committeeName: 'Friends of Sarah Chen',
}

const textsFor = (
  script: string,
  context: Parameters<typeof deriveSmsProtectedParts>[1] = CONTEXT,
) =>
  Object.fromEntries(
    deriveSmsProtectedParts(script, context).map((part) => [
      part.rule,
      part.text,
    ]),
  )

describe('deriveSmsProtectedParts', () => {
  it('locks exactly what each rule tests for, the disclaimer as one unit', () => {
    expect(deriveSmsProtectedParts(SCRIPT, CONTEXT)).toEqual([
      {
        rule: 'first_name_token',
        kind: 'token',
        tagId: 'first_name',
        text: '{first_name}',
      },
      { rule: 'candidate_name', kind: 'phrase', text: 'Sarah Chen' },
      {
        rule: 'paid_for_by',
        kind: 'phrase',
        text: 'Paid for by Friends of Sarah Chen.',
      },
      { rule: 'opt_out_line', kind: 'phrase', text: 'Reply STOP to opt out.' },
    ])
  })

  it('locks only parts of a script that passes the verdict', () => {
    expect(checkSmsStandards(SCRIPT, CONTEXT).passed).toBe(true)
    for (const part of deriveSmsProtectedParts(SCRIPT, CONTEXT)) {
      expect(SCRIPT).toContain(part.text)
    }
  })

  it('keeps the text as written, not as the context spells it', () => {
    const script =
      'hi {first_name}, SARAH CHEN here. paid for by friends of sarah chen. reply stop'
    expect(textsFor(script)).toEqual({
      first_name_token: '{first_name}',
      candidate_name: 'SARAH CHEN',
      paid_for_by: 'paid for by friends of sarah chen.',
      opt_out_line: 'reply stop',
    })
  })

  it('falls back to the first word of the name the script uses', () => {
    const script =
      "Hi {first_name}, it's Sarah! Paid for by Friends of Sarah Chen. Reply STOP"
    expect(textsFor(script).candidate_name).toBe('Sarah')
  })

  it('leaves a name that only appears in the disclaimer to the disclaimer', () => {
    const script =
      'Hi {first_name}, vote Nov 3! Paid for by Friends of Sarah Chen. Reply STOP'
    const texts = textsFor(script)
    expect(texts.candidate_name).toBeUndefined()
    expect(texts.paid_for_by).toBe('Paid for by Friends of Sarah Chen.')
  })

  it('skips a committee copy that is not right after the phrase', () => {
    const script =
      "Hi {first_name}, it's Sarah! Paid for by the committee, Friends of Sarah Chen. Reply STOP"
    expect(textsFor(script).candidate_name).toBe('Sarah')
  })

  it('does not lock a name inside a disclaimer the surface ignores', () => {
    const script =
      'Hello {{first_name}}, vote Nov 3! Paid for by Friends of Sarah Chen. Reply STOP'
    const texts = textsFor(script, {
      ...CONTEXT,
      channel: 'serve',
      ignoredRules: ['paid_for_by'],
    })
    expect(texts.candidate_name).toBeUndefined()
    expect(texts.paid_for_by).toBeUndefined()
  })

  it('still locks the name when the committee is the candidate’s own name', () => {
    const script =
      "Hi {first_name}, it's Sarah Chen! Paid for by Sarah Chen. Reply STOP"
    const texts = textsFor(script, {
      candidateNames: ['Sarah Chen'],
      committeeName: 'Sarah Chen',
    })
    expect(texts.candidate_name).toBe('Sarah Chen')
    expect(texts.paid_for_by).toBe('Paid for by Sarah Chen.')
  })

  it('matches names as whole words, never inside another word', () => {
    const script = 'Hi {first_name}, the kitchen is open. Reply STOP'
    const context = { candidateNames: ['Lee Chen'] }
    // The verdict agrees: no whole-word name is no identification.
    expect(checkSmsStandards(script, context).failures).toContain(
      'candidate_name',
    )
    expect(textsFor(script, context).candidate_name).toBeUndefined()
  })

  it('matches names with letters outside ASCII', () => {
    const script = "Bonjour {first_name}, c'est Élodie. Reply STOP"
    expect(
      textsFor(script, { candidateNames: ['Élodie Durand'] }).candidate_name,
    ).toBe('Élodie')
  })

  it('matches a name whose letters change length when lowercased', () => {
    const context = { candidateNames: ['İlker Doğan'] }
    const script = 'Merhaba {first_name}, ben İlker. Reply STOP'
    expect(checkSmsStandards(script, context).failures).not.toContain(
      'candidate_name',
    )
    expect(textsFor(script, context).candidate_name).toBe('İlker')
  })

  it('locks a short name only when it is written in full, and the verdict agrees', () => {
    const context = { candidateNames: ['Al Bo'] }
    expect(
      checkSmsStandards("Hi {first_name}, it's Al Bo. Reply STOP", context)
        .failures,
    ).not.toContain('candidate_name')
    expect(
      checkSmsStandards('Hi {first_name}, vote! Reply STOP', context).failures,
    ).toContain('candidate_name')

    const script = "Hi {first_name}, it's Al Bo. Reply STOP"
    expect(textsFor(script, { candidateNames: ['Al Bo'] }).candidate_name).toBe(
      'Al Bo',
    )
    expect(
      textsFor('Hi {first_name}, vote! Reply STOP', {
        candidateNames: ['Al Bo'],
      }).candidate_name,
    ).toBeUndefined()
  })

  it('locks the committee with the phrase across punctuation', () => {
    for (const separator of [': ', ', ', ' - ', ' — ', ':']) {
      const script = `Hi {first_name}. Paid for by${separator}Friends of Sarah Chen. Reply STOP`
      expect(textsFor(script).paid_for_by).toBe(
        `Paid for by${separator}Friends of Sarah Chen.`,
      )
    }
  })

  it('locks the phrase alone when the committee is not right after it', () => {
    const script =
      'Hi {first_name}. Paid for by the committee to elect Sarah. Reply STOP'
    expect(textsFor(script, CONTEXT).paid_for_by).toBe('Paid for by')
  })

  // Before a committee is recorded the composer names a provisional one,
  // and Improve must not be able to rewrite what that line says.
  it('locks the whole sentence when no committee is known', () => {
    const script =
      'Hi {first_name}. Paid for by Sarah Chen for City Council.\nReply STOP'
    expect(textsFor(script, { committeeName: null }).paid_for_by).toBe(
      'Paid for by Sarah Chen for City Council.',
    )
  })

  // The composed footer closes the message; the body saying the same words
  // earlier must not take the lock from it.
  it('locks the footer, not an earlier mention in the body', () => {
    const script =
      'Hi {first_name}, this run is paid for by neighbors. Reply STOP if ' +
      'you want.\n\nPaid for by Friends of Sarah Chen.\nReply STOP to opt out.'
    const parts = deriveSmsProtectedParts(script, CONTEXT)
    const disclaimer = parts.find((part) => part.rule === 'paid_for_by')
    const optOut = parts.find((part) => part.rule === 'opt_out_line')
    expect(disclaimer?.text).toBe('Paid for by Friends of Sarah Chen.')
    expect(optOut?.text).toBe('Reply STOP to opt out.')
    expect(
      deriveSmsProtectedParts(script, { ...CONTEXT, committeeName: null }).find(
        (part) => part.rule === 'paid_for_by',
      )?.text,
    ).toBe('Paid for by Friends of Sarah Chen.')
  })

  it('leaves out any rule the script already fails', () => {
    expect(textsFor('Vote for me on Tuesday!')).toEqual({})
  })

  it('uses the channel form of the merge tag', () => {
    const script =
      'Hello {{first_name}}, Sarah Chen here. Reply STOP to opt out.'
    const parts = deriveSmsProtectedParts(script, {
      ...CONTEXT,
      channel: 'serve',
      ignoredRules: ['paid_for_by'],
    })
    expect(parts.find((part) => part.rule === 'first_name_token')?.text).toBe(
      '{{first_name}}',
    )
  })

  it('skips the surface ignored rules', () => {
    const rules = deriveSmsProtectedParts(SCRIPT, {
      ...CONTEXT,
      ignoredRules: ['paid_for_by'],
    }).map((part) => part.rule)
    expect(rules).not.toContain('paid_for_by')
    expect(rules).toContain('opt_out_line')
  })
})
