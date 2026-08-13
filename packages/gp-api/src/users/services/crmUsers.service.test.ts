import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { of } from 'rxjs'
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

  // A realistic findActiveByUserId return: it guarantees the isActiveCampaign
  // predicate (didWin null, future electionDate, not demo) but NOT the isActive
  // column, which only flips true at launch. So an active *run* can still be an
  // unlaunched campaign — active_candidate 'Yes' while live_candidate 'false'.
  const activeCampaign = {
    id: 222,
    isActive: false,
    isDemo: false,
    didWin: null,
    details: { electionDate: '2999-11-04' },
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
          live_candidate: 'false',
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

describe('CrmUsersService - submitCrmForm hutk forwarding', () => {
  const post = vi.fn()
  const hubspot = { client: { config: { accessToken: 'test-token' } } }
  const logger = createMockLogger()

  let service: CrmUsersService

  beforeEach(() => {
    vi.clearAllMocks()
    post.mockReturnValue(of({ data: {} }))
    service = new CrmUsersService(
      hubspot as never,
      {} as never,
      {} as never,
      { post } as never,
      {} as never,
      logger,
    )
  })

  it('includes context.hutk when the visitor cookie is provided', async () => {
    await service.submitCrmForm(
      'form-1',
      [{ name: 'email', value: 'a@b.co', objectTypeId: '0-1' }],
      'registerPage',
      'https://app.goodparty.org/sign-up',
      'visitor-hutk-value',
    )

    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('form-1'),
      expect.objectContaining({
        context: {
          pageName: 'registerPage',
          pageUri: 'https://app.goodparty.org/sign-up',
          hutk: 'visitor-hutk-value',
        },
      }),
      expect.anything(),
    )
  })

  it('omits hutk from context when no cookie value is passed', async () => {
    await service.submitCrmForm(
      'form-1',
      [{ name: 'email', value: 'a@b.co', objectTypeId: '0-1' }],
      'registerPage',
      'https://app.goodparty.org/sign-up',
    )

    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('form-1'),
      expect.objectContaining({
        context: {
          pageName: 'registerPage',
          pageUri: 'https://app.goodparty.org/sign-up',
        },
      }),
      expect.anything(),
    )
  })
})
