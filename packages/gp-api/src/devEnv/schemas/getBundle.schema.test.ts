import { ZodValidationPipe } from 'nestjs-zod'
import { describe, expect, it } from 'vitest'
import { GetDevEnvBundleSchema } from './getBundle.schema'

// Through the pipe the controller actually uses, because the schema is a
// transform rather than a plain object and the empty-body path is the one a
// setup script hits first.
const pipe = new ZodValidationPipe(GetDevEnvBundleSchema)
const parse = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: Object })

describe('GetDevEnvBundleSchema', () => {
  it.each([
    ['a body-less POST', null],
    ['an absent body', undefined],
    ['an empty object', {}],
  ])('reads %s as "every vendable package"', (_label, body) => {
    expect(parse(body)).toEqual({})
  })

  it('keeps a package filter', () => {
    expect(parse({ packages: ['gp-api'] })).toEqual({ packages: ['gp-api'] })
  })

  it.each([
    ['an unknown package', { packages: ['election-api'] }],
    ['an empty filter', { packages: [] }],
    ['an unknown key', { pakages: ['gp-api'] }],
  ])('rejects %s', (_label, body) => {
    expect(() => parse(body)).toThrow()
  })
})
