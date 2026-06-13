import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Campaign, User } from '../../generated/prisma'
import { CrmUsersService } from './crmUsers.service'

describe('CrmUsersService - trackContact active-campaign selection', () => {
  const update = vi.fn()
  const hubspot = {
    client: { crm: { contacts: { basicApi: { update } } } },
  }
  const users = { patchUserMetaData: vi.fn() }
  const campaigns = { findActiveByUserId: vi.fn() }
  const logger = createMockLogger()

  let service: CrmUsersService

  const user = {
    id: 7,
    email: 'candidate@example.com',
    metaData: { hubspotId: 'hs-1' },
  } as unknown as User

  const activeCampaign = {
    id: 222,
    isActive: true,
  } as unknown as Campaign

  beforeEach(() => {
    vi.clearAllMocks()
    update.mockResolvedValue({ id: 'hs-1' })
    users.patchUserMetaData.mockResolvedValue(undefined)
    service = new CrmUsersService(
      hubspot as never,
      users as never,
      campaigns as never,
      {} as never,
      {} as never,
      logger,
    )
  })

  it('resolves the active campaign and reflects it in CRM properties', async () => {
    campaigns.findActiveByUserId.mockResolvedValue(activeCampaign)

    await service.trackUserLogin(user)

    expect(campaigns.findActiveByUserId).toHaveBeenCalledWith(user.id)
    expect(update).toHaveBeenCalledWith(
      'hs-1',
      expect.objectContaining({
        properties: expect.objectContaining({
          active_candidate: 'Yes',
          live_candidate: 'true',
          product_user: 'yes',
        }),
      }),
    )
  })

  it('falls back gracefully when the user has no active campaign', async () => {
    campaigns.findActiveByUserId.mockResolvedValue(null)

    await service.trackUserLogin(user)

    expect(campaigns.findActiveByUserId).toHaveBeenCalledWith(user.id)
    expect(update).toHaveBeenCalledWith(
      'hs-1',
      expect.objectContaining({
        properties: expect.objectContaining({ active_candidate: 'No' }),
      }),
    )
  })
})
