import { HttpStatus } from '@nestjs/common'
import {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios'
import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_VERIFY_TAX_EXEMPT_BRAND,
  isPeerlyCvTaxExemptBrandRejection,
  PeerlyCvTaxExemptBrandException,
} from './peerlyCvTaxExemptBrand.util'

const createAxiosError = (
  responseData: Record<string, unknown> | undefined,
  status = 400,
): AxiosError => {
  const config: AxiosRequestConfig = {
    url: '/v2/tdlc/123/approve',
    method: 'POST',
    headers: new AxiosHeaders(),
  }
  const response: AxiosResponse = {
    data: responseData,
    status,
    statusText: 'Bad Request',
    headers: {},
    config: config as AxiosResponse['config'],
  }
  return new AxiosError(
    'Request failed',
    'ERR_BAD_REQUEST',
    config as AxiosError['config'],
    {},
    response,
  )
}

// The exact body prod Peerly returned on /approve (ENG-11389, 2026-10-20).
const taxExemptBody = {
  Error:
    'Unable to submit CV token.\nCampaign verify vet cannot be imported for ' +
    'a non-profit brand having 501c tax-exempt status',
}

describe('isPeerlyCvTaxExemptBrandRejection', () => {
  it('detects the tax-exempt non-profit CV import refusal', () => {
    expect(
      isPeerlyCvTaxExemptBrandRejection(createAxiosError(taxExemptBody)),
    ).toBe(true)
  })

  it('does not match a different CV token refusal', () => {
    const error = createAxiosError({ Error: 'Unable to submit CV token.' })
    expect(isPeerlyCvTaxExemptBrandRejection(error)).toBe(false)
  })

  it('does not match the same wording on a Peerly 5xx', () => {
    expect(
      isPeerlyCvTaxExemptBrandRejection(createAxiosError(taxExemptBody, 500)),
    ).toBe(false)
  })

  it('handles a missing body, a non-string Error and non-Axios errors', () => {
    expect(isPeerlyCvTaxExemptBrandRejection(createAxiosError(undefined))).toBe(
      false,
    )
    expect(
      isPeerlyCvTaxExemptBrandRejection(createAxiosError({ Error: 42 })),
    ).toBe(false)
    expect(isPeerlyCvTaxExemptBrandRejection(new Error('boom'))).toBe(false)
    expect(isPeerlyCvTaxExemptBrandRejection(null)).toBe(false)
  })
})

describe('PeerlyCvTaxExemptBrandException', () => {
  it('answers 422 with the message and errorCode in the body', () => {
    const exception = new PeerlyCvTaxExemptBrandException('brand is exempt')
    expect(exception.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
    expect(exception.getResponse()).toEqual({
      message: 'brand is exempt',
      errorCode: CAMPAIGN_VERIFY_TAX_EXEMPT_BRAND,
    })
  })
})
