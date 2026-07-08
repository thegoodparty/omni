import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { zCoerceDate, zDate } from './Date.schema'

describe('zCoerceDate / zDate', () => {
  it('zCoerceDate keeps z.coerce.date() runtime behavior', () => {
    expect(zCoerceDate().parse('2020-01-02')).toBeInstanceOf(Date)
    expect(zCoerceDate().parse(new Date())).toBeInstanceOf(Date)
  })

  it('zDate keeps z.date() runtime behavior', () => {
    expect(zDate().parse(new Date())).toBeInstanceOf(Date)
    expect(() => zDate().parse('2020-01-02')).toThrow()
  })

  it('renders dates as { type: string, format: date-time } in JSON Schema', () => {
    expect(z.toJSONSchema(z.object({ d: zCoerceDate() }))).toMatchObject({
      properties: { d: { type: 'string', format: 'date-time' } },
    })
  })

  it('stays representable through nullable/optional wrappers', () => {
    expect(() =>
      z.toJSONSchema(z.object({ d: zDate().nullable().optional() })),
    ).not.toThrow()
  })

  // Guards the regression these helpers exist to fix: zod v4 + nestjs-zod v5
  // throw on a bare ZodDate during SwaggerModule.createDocument.
  it('documents that a bare ZodDate is not representable', () => {
    expect(() => z.toJSONSchema(z.object({ d: z.date() }))).toThrow(
      /Date cannot be represented/,
    )
  })
})
