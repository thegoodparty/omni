import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createMockLogger } from '../../shared/test-utils'
import { parseVendorResponse } from './parseVendorResponse'
import { recordVendorSchemaMismatch } from './vendorSchema.metrics'

vi.mock('./vendorSchema.metrics', () => ({
  recordVendorSchemaMismatch: vi.fn(),
}))

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
  })

  it('returns the body for a valid response without counting', () => {
    const body = { status: 'ok', ein: '12-3456789' }
    expect(
      parseVendorResponse(schema, body, { ...options, mode: 'observe' }),
    ).toEqual(body)
    expect(recordVendorSchemaMismatch).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('observe: returns the raw body, counts once, and logs paths only', () => {
    const body = { status: 42, ein: '99-9999999' }
    const result = parseVendorResponse(schema, body, {
      ...options,
      mode: 'observe',
    })

    expect(result).toBe(body)
    expect(recordVendorSchemaMismatch).toHaveBeenCalledTimes(1)
    expect(recordVendorSchemaMismatch).toHaveBeenCalledWith(
      'peerly',
      '/v2/tdlc/:id/retrieve_cv',
    )
    expect(logger.warn).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls)
    expect(logged).toContain('status')
    expect(logged).not.toContain('99-9999999')
    expect(logged).not.toContain('42')
  })

  it('enforce: counts and logs paths only, then throws on the same malformed body', () => {
    expect(() =>
      parseVendorResponse(
        schema,
        { status: 42, ein: 'x' },
        { ...options, mode: 'enforce' },
      ),
    ).toThrow(z.ZodError)
    expect(recordVendorSchemaMismatch).toHaveBeenCalledTimes(1)
    expect(recordVendorSchemaMismatch).toHaveBeenCalledWith(
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
    expect(recordVendorSchemaMismatch).not.toHaveBeenCalled()
  })
})
