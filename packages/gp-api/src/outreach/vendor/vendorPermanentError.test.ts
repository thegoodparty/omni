import { BadGatewayException, HttpStatus } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { VendorPermanentError } from './vendorPermanentError'

describe('VendorPermanentError', () => {
  it('is a BadGatewayException so callers see an unchanged 502', () => {
    const err = new VendorPermanentError('vendor rejected the request')
    expect(err).toBeInstanceOf(BadGatewayException)
    expect(err.getStatus()).toBe(HttpStatus.BAD_GATEWAY)
  })

  // The retry sweeps branch on the distinct class, so a transient 502 must NOT
  // read as permanent — a misclassification would permanently fail a run.
  it('is distinguishable from a plain transient BadGatewayException', () => {
    const transient = new BadGatewayException('transient blip')
    expect(transient).not.toBeInstanceOf(VendorPermanentError)
  })
})
