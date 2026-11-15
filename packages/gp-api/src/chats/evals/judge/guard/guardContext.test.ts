import { describe, expect, it } from 'vitest'
import { GuardContextError, parseGuardContext } from './guardContext'

describe('parseGuardContext', () => {
  it('parses a valid context', () => {
    const context = parseGuardContext(
      JSON.stringify({
        floor: ['chief_of_staff'],
        added: ['campaign_assistant'],
        picker: 'ok',
      }),
    )
    expect(context).toEqual({
      floor: ['chief_of_staff'],
      added: ['campaign_assistant'],
      picker: 'ok',
    })
  })

  it('accepts an empty floor and added set', () => {
    const context = parseGuardContext(
      JSON.stringify({ floor: [], added: [], picker: 'capped' }),
    )
    expect(context).toEqual({ floor: [], added: [], picker: 'capped' })
  })

  it('refuses malformed JSON rather than guessing a shape', () => {
    expect(() => parseGuardContext('{not json')).toThrow(GuardContextError)
  })

  it('refuses a picker value outside the enum', () => {
    expect(() =>
      parseGuardContext(
        JSON.stringify({ floor: [], added: [], picker: 'unknown' }),
      ),
    ).toThrow(GuardContextError)
  })

  it('refuses a context missing a required field', () => {
    expect(() =>
      parseGuardContext(JSON.stringify({ floor: [], picker: 'ok' })),
    ).toThrow(GuardContextError)
  })
})
