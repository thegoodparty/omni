import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { HubspotSingleSendService } from '@/crm/hubspotSingleSend.service'
import { UsersService } from '@/users/services/users.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { OutreachRobocallSingleSendService } from '../services/outreachRobocallSingleSend.service'

describe('OutreachRobocallSingleSendService', () => {
  let sendSingleSend: ReturnType<typeof vi.fn>
  let findFirst: ReturnType<typeof vi.fn>
  let mockLogger: ReturnType<typeof createMockLogger>
  let service: OutreachRobocallSingleSendService

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    sendSingleSend = vi.fn().mockResolvedValue(undefined)
    findFirst = vi.fn().mockResolvedValue({ id: 55, email: 'jane@example.com' })
    mockLogger = createMockLogger()
    service = new OutreachRobocallSingleSendService(
      { sendSingleSend } as unknown as HubspotSingleSendService,
      { findFirst } as unknown as UsersService,
      mockLogger,
    )
  })

  it('skips when the event has no email id configured', async () => {
    await service.send(EVENTS.Robocall.Scheduled, 55, 1, {
      outreach_id: '1',
    })

    expect(findFirst).not.toHaveBeenCalled()
    expect(sendSingleSend).not.toHaveBeenCalled()
    expect(mockLogger.debug).toHaveBeenCalled()
  })

  it('resolves the recipient email fresh from userId and sends with the given properties', async () => {
    vi.stubEnv('HUBSPOT_ROBOCALL_SCHEDULED_EMAIL_ID', '777')

    await service.send(EVENTS.Robocall.Scheduled, 55, 1, {
      outreach_id: '1',
      scheduled_at: '2026-09-10T00:00:00+00:00',
    })

    expect(findFirst).toHaveBeenCalledWith({ where: { id: 55 } })
    expect(sendSingleSend).toHaveBeenCalledTimes(1)
    expect(sendSingleSend).toHaveBeenCalledWith({
      emailId: 777,
      to: 'jane@example.com',
      customProperties: {
        outreach_id: '1',
        scheduled_at: '2026-09-10T00:00:00+00:00',
      },
    })
  })

  it('is keyed per event: an env var for one event does not configure another', async () => {
    vi.stubEnv('HUBSPOT_ROBOCALL_SCHEDULED_EMAIL_ID', '777')

    await service.send(EVENTS.Robocall.HoldPlaced, 55, 1, {
      outreach_id: '1',
    })

    expect(sendSingleSend).not.toHaveBeenCalled()
  })

  it('treats a non-numeric env var as unconfigured', async () => {
    vi.stubEnv('HUBSPOT_ROBOCALL_SCHEDULED_EMAIL_ID', 'not-a-number')

    await service.send(EVENTS.Robocall.Scheduled, 55, 1, {})

    expect(sendSingleSend).not.toHaveBeenCalled()
  })

  it('logs and returns, without throwing, when the user cannot be found', async () => {
    vi.stubEnv('HUBSPOT_ROBOCALL_SCHEDULED_EMAIL_ID', '777')
    findFirst.mockResolvedValue(null)

    await expect(
      service.send(EVENTS.Robocall.Scheduled, 55, 1, {}),
    ).resolves.toBeUndefined()

    expect(sendSingleSend).not.toHaveBeenCalled()
    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('logs and swallows a HubSpot send failure rather than throwing', async () => {
    vi.stubEnv('HUBSPOT_ROBOCALL_SCHEDULED_EMAIL_ID', '777')
    sendSingleSend.mockRejectedValue(new Error('hubspot down'))

    await expect(
      service.send(EVENTS.Robocall.Scheduled, 55, 1, {}),
    ).resolves.toBeUndefined()

    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('logs and swallows a user-lookup failure rather than throwing', async () => {
    vi.stubEnv('HUBSPOT_ROBOCALL_SCHEDULED_EMAIL_ID', '777')
    findFirst.mockRejectedValue(new Error('db down'))

    await expect(
      service.send(EVENTS.Robocall.Scheduled, 55, 1, {}),
    ).resolves.toBeUndefined()

    expect(sendSingleSend).not.toHaveBeenCalled()
    expect(mockLogger.error).toHaveBeenCalled()
  })
})
