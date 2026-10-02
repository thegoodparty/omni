import { describe, it, expect } from 'vitest'
import { ReadUserOutputSchema } from './ReadUserOutput.schema'
import { CreateUserInputSchema } from './CreateUserInput.schema'

const validUser = {
  id: 1,
  firstName: 'Dante',
  lastName: 'Hensley',
  email: 'dante@example.com',
  roles: [],
  hasPassword: true,
  metaData: {},
  createdAt: new Date('2026-01-01T00:00:00Z'),
  // `makeOptional` unions in `z.undefined()` rather than calling `.optional()`,
  // which in Zod 4 leaves the key required, so it has to be present.
  phone: null,
}

describe('ReadUserOutputSchema zip', () => {
  // The read schema describes what the `zip String?` column can hold, not what
  // the signup form accepts. Enforcing the input rule here 500ed GET /v1/users
  // through ZodResponseInterceptor whenever a page contained one of these.
  it.each([
    ['a non-US postal code', 'SW1A 1AA'],
    ['a truncated zip', '123'],
    ['free text', 'n/a'],
    ['a zip with trailing whitespace', '90210 '],
  ])('accepts %s', (_label, zip) => {
    const result = ReadUserOutputSchema.safeParse({ ...validUser, zip })

    expect(result.success).toBe(true)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
  ])('still accepts %s', (_label, zip) => {
    const result = ReadUserOutputSchema.safeParse({ ...validUser, zip })

    expect(result.success).toBe(true)
  })

  it('keeps a valid zip intact', () => {
    const result = ReadUserOutputSchema.safeParse({
      ...validUser,
      zip: '90210',
    })

    expect(result.success).toBe(true)
    expect(result.success && result.data.zip).toBe('90210')
  })

  // Relaxing the read side must not relax the write side: new bad zips should
  // still be rejected at the boundary that can actually refuse them.
  it('does not relax zip validation on the input schema', () => {
    const result = CreateUserInputSchema.safeParse({
      firstName: 'Dante',
      lastName: 'Hensley',
      email: 'dante@example.com',
      roles: [],
      zip: 'n/a',
    })

    expect(result.success).toBe(false)
  })
})
