import { BadGatewayException, NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { BigqueryPermanentError } from '../errors/bigqueryPermanentError'
import {
  BigqueryErrorHandlingService,
  isPermanentBigqueryError,
} from './bigqueryErrorHandling.service'

const service = new BigqueryErrorHandlingService()

describe('isPermanentBigqueryError', () => {
  it.each([400, 401, 403, 404])('treats %i as permanent', (code) => {
    expect(isPermanentBigqueryError({ code })).toBe(true)
  })

  it.each([429, 500, 502, 503, 504])('treats %i as transient', (code) => {
    expect(isPermanentBigqueryError({ code })).toBe(false)
  })

  it('treats a string network errno as transient', () => {
    expect(isPermanentBigqueryError({ code: 'ECONNRESET' })).toBe(false)
  })

  it('treats an error with no code as transient', () => {
    expect(isPermanentBigqueryError(new Error('boom'))).toBe(false)
  })
})

describe('BigqueryErrorHandlingService.handleQueryError', () => {
  it('maps a permanent status to BigqueryPermanentError (still a 502)', () => {
    let thrown: unknown
    try {
      service.handleQueryError({ error: { code: 403 } })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(BigqueryPermanentError)
    expect(thrown).toBeInstanceOf(BadGatewayException)
  })

  it('maps a transient status to a plain BadGatewayException', () => {
    let thrown: unknown
    try {
      service.handleQueryError({ error: { code: 429 } })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(BadGatewayException)
    expect(thrown).not.toBeInstanceOf(BigqueryPermanentError)
  })

  it('rethrows an already-mapped HttpException unchanged', () => {
    const original = new NotFoundException('gone')
    expect(() => service.handleQueryError({ error: original })).toThrow(
      original,
    )
  })
})
