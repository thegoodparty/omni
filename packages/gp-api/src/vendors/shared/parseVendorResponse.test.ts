import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createMockLogger } from '../../shared/test-utils'
import { parseVendorResponse } from './parseVendorResponse'
import * as vendorSchemaMetrics from './vendorSchema.metrics'

const schema = z.object({ status: z.string(), ein: z.string() })

describe('parseVendorResponse', () => {
  const logger = createMockLogger()
  const options = {
    vendor: 'peerly',
    endpoint: '/v2/tdlc/:id/retrieve_cv',
    logger,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(
      vendorSchemaMetrics,
      'recordVendorSchemaMismatch',
    ).mockImplementation(() => undefined)
  })

  it('returns the body for a valid response without counting', () => {
    const body = { status: 'ok', ein: '12-3456789' }
    expect(
      parseVendorResponse(schema, body, { ...options, mode: 'observe' }),
    ).toEqual(body)
    expect(
      vendorSchemaMetrics.recordVendorSchemaMismatch,
    ).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('observe: returns the raw body, counts once, and logs paths only', () => {
    const body = { status: 42, ein: '99-9999999' }
    const result = parseVendorResponse(schema, body, {
      ...options,
      mode: 'observe',
    })

    expect(result).toBe(body)
    expect(
      vendorSchemaMetrics.recordVendorSchemaMismatch,
    ).toHaveBeenCalledTimes(1)
    expect(vendorSchemaMetrics.recordVendorSchemaMismatch).toHaveBeenCalledWith(
      'peerly',
      '/v2/tdlc/:id/retrieve_cv',
    )
    expect(logger.warn).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls)
    expect(logged).toContain('status')
    expect(logged).not.toContain('99-9999999')
    expect(logged).not.toContain('42')
  })

  it('logs each issue as path, code, and expected/received types only', () => {
    const nested = z.object({
      status: z.string(),
      ein: z.string(),
      campaigns: z.record(z.string(), z.number()),
    })
    parseVendorResponse(
      nested,
      { status: null, campaigns: ['99-9999999'] },
      { ...options, mode: 'observe' },
    )

    const fields = vi.mocked(logger.warn).mock.calls[0]?.[0]
    expect(fields).toMatchObject({
      issues: [
        {
          path: 'status',
          code: 'invalid_type',
          expected: 'string',
          received: 'null',
        },
        {
          path: 'ein',
          code: 'invalid_type',
          expected: 'string',
          received: 'missing',
        },
        {
          path: 'campaigns',
          code: 'invalid_type',
          expected: 'record',
          received: 'array',
        },
      ],
    })
    expect(JSON.stringify(fields)).not.toContain('99-9999999')
  })

  it('enforce: throws an error that carries no body values', () => {
    let issues: z.core.$ZodIssue[] = []
    try {
      parseVendorResponse(
        schema,
        { status: 'ok', ein: 42 },
        { ...options, mode: 'enforce' },
      )
    } catch (error) {
      if (error instanceof z.ZodError) issues = error.issues
    }

    expect(issues.map((issue) => issue.path)).toEqual([['ein']])
    expect(issues[0]).not.toHaveProperty('input')
  })

  it('enforce: counts and logs paths only, then throws on the same malformed body', () => {
    expect(() =>
      parseVendorResponse(
        schema,
        { status: 42, ein: 'x' },
        { ...options, mode: 'enforce' },
      ),
    ).toThrow(z.ZodError)
    expect(
      vendorSchemaMetrics.recordVendorSchemaMismatch,
    ).toHaveBeenCalledTimes(1)
    expect(vendorSchemaMetrics.recordVendorSchemaMismatch).toHaveBeenCalledWith(
      'peerly',
      '/v2/tdlc/:id/retrieve_cv',
    )
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('enforce: returns the parsed body for a valid response without counting', () => {
    const body = { status: 'ok', ein: '12-3456789' }
    expect(
      parseVendorResponse(schema, body, { ...options, mode: 'enforce' }),
    ).toEqual(body)
    expect(
      vendorSchemaMetrics.recordVendorSchemaMismatch,
    ).not.toHaveBeenCalled()
  })
})
