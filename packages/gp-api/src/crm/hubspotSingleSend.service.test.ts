import { BadGatewayException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { HubspotSingleSendService } from './hubspotSingleSend.service'

describe('HubspotSingleSendService', () => {
  const sendEmail = vi.fn()
  const hubspot = {
    isConfigured: true,
    client: {
      marketing: { transactional: { singleSendApi: { sendEmail } } },
    },
  }
  const logger = createMockLogger()

  let service: HubspotSingleSendService

  beforeEach(() => {
    vi.clearAllMocks()
    hubspot.isConfigured = true
    sendEmail.mockResolvedValue({ statusId: 'evt-1', status: 'PENDING' })
    service = new HubspotSingleSendService(hubspot as never, logger)
  })

  it('posts the documented payload shape', async () => {
    await service.sendSingleSend({
      emailId: 12345,
      to: 'candidate@example.com',
      customProperties: { pin_delivery_method: 'text' },
    })

    expect(sendEmail).toHaveBeenCalledWith({
      emailId: 12345,
      message: { to: 'candidate@example.com' },
      customProperties: { pin_delivery_method: 'text' },
      contactProperties: undefined,
    })
  })

  it('skips the send when HubSpot is not configured', async () => {
    hubspot.isConfigured = false

    await service.sendSingleSend({ emailId: 1, to: 'a@example.com' })

    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('skips a test-email recipient even when HubSpot is configured', async () => {
    await service.sendSingleSend({
      emailId: 1,
      to: 'dustin+test@example.com',
    })

    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('logs and throws BadGatewayException when the API call fails', async () => {
    sendEmail.mockRejectedValue(new Error('HubSpot 500'))

    await expect(
      service.sendSingleSend({ emailId: 1, to: 'a@example.com' }),
    ).rejects.toThrow(BadGatewayException)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ emailId: 1, to: 'a@example.com' }),
      expect.any(String),
    )
  })

  it('logs and throws BadGatewayException on a malformed response', async () => {
    sendEmail.mockResolvedValue({ unexpected: true })

    await expect(
      service.sendSingleSend({ emailId: 1, to: 'a@example.com' }),
    ).rejects.toThrow(BadGatewayException)
  })
})
