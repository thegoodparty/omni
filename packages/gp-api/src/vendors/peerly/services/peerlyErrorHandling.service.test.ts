import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { PeerlyErrorHandlingService } from './peerlyErrorHandling.service'

const TINYURL_MESSAGE =
  'Message cannot contain tinyurl.com links. Please correct your message.'

const axiosError = (data: object, status = 400) => {
  const config = { url: '/1to1/jobs', method: 'post', headers: {} }
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    config,
    response: { status, data, headers: {}, config },
  })
}

describe('PeerlyErrorHandlingService', () => {
  const service = new PeerlyErrorHandlingService()

  it('surfaces a template content rejection as a 400 with Peerly’s message', async () => {
    const error = axiosError({
      Errors: { templates: [{ non_field_errors: [TINYURL_MESSAGE] }] },
    })

    const promise = service.handleApiError({ error })
    await expect(promise).rejects.toThrow(BadRequestException)
    await expect(promise).rejects.toThrow(TINYURL_MESSAGE)
  })

  it('joins multiple template error messages', async () => {
    const error = axiosError({
      Errors: {
        templates: [
          { non_field_errors: ['First problem.'], text: ['Second problem.'] },
        ],
      },
    })

    await expect(service.handleApiError({ error })).rejects.toThrow(
      'First problem. Second problem.',
    )
  })

  it('keeps the caller’s customMessage framing over template errors', async () => {
    const error = axiosError({
      Errors: { templates: [{ non_field_errors: [TINYURL_MESSAGE] }] },
    })

    const promise = service.handleApiError({
      error,
      context: { customMessage: 'Failed to assign list to P2P job' },
    })
    await expect(promise).rejects.toThrow(BadGatewayException)
    await expect(promise).rejects.toThrow('Failed to assign list to P2P job')
  })

  it('parses the singular error field into the 502 message', async () => {
    const error = axiosError({ error: 'account_id required' })

    const promise = service.handleApiError({ error })
    await expect(promise).rejects.toThrow(BadGatewayException)
    await expect(promise).rejects.toThrow(
      'Peerly API error: account_id required',
    )
  })

  it('falls back to Unknown API error for an unrecognized body', async () => {
    const promise = service.handleApiError({
      error: axiosError({ something: 'else' }),
    })
    await expect(promise).rejects.toThrow(BadGatewayException)
    await expect(promise).rejects.toThrow('Peerly API error: Unknown API error')
  })

  it('does not 400 a template-shaped body on a 5xx response', async () => {
    const error = axiosError(
      { Errors: { templates: [{ non_field_errors: [TINYURL_MESSAGE] }] } },
      502,
    )

    const promise = service.handleApiError({ error })
    await expect(promise).rejects.toThrow(BadGatewayException)
    await expect(promise).rejects.toThrow('Peerly API error: Unknown API error')
  })

  it('does not 400 an Errors body without template messages', async () => {
    const promise = service.handleApiError({
      error: axiosError({ Errors: { templates: [] } }),
    })
    await expect(promise).rejects.toThrow(BadGatewayException)
    await expect(promise).rejects.toThrow('Peerly API error: Unknown API error')
  })

  it('rethrows an HttpException unchanged when no customMessage is set', async () => {
    const original = new NotFoundException('job not found')

    await expect(service.handleApiError({ error: original })).rejects.toBe(
      original,
    )
  })
})
