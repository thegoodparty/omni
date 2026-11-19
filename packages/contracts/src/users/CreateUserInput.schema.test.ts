import { describe, expect, it } from 'vitest'
import { CreateUserInputSchema } from './CreateUserInput.schema'

const valid = {
  firstName: 'Dee',
  lastName: 'Jetton',
  email: 'dee@goodparty.org',
  roles: [],
}

// ENG-5508: the API must not store a padded name, and a check that runs before
// the trim lets a single letter through on the strength of its whitespace.
describe('CreateUserInputSchema names', () => {
  it('trims surrounding whitespace from both name fields', () => {
    const result = CreateUserInputSchema.parse({
      ...valid,
      firstName: '  Dee ',
      lastName: '\tJetton  ',
    })

    expect(result.firstName).toBe('Dee')
    expect(result.lastName).toBe('Jetton')
  })

  it('trims the optional full name', () => {
    const result = CreateUserInputSchema.parse({
      ...valid,
      name: '  Dee Jetton ',
    })

    expect(result.name).toBe('Dee Jetton')
  })

  it('rejects a padded single letter, measured after the trim', () => {
    expect(
      CreateUserInputSchema.safeParse({ ...valid, firstName: ' A ' }).success,
    ).toBe(false)
  })

  it('keeps a name that is only inner whitespace intact', () => {
    const result = CreateUserInputSchema.parse({
      ...valid,
      firstName: 'Mary Jane',
    })

    expect(result.firstName).toBe('Mary Jane')
  })
})
