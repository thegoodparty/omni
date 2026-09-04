import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { ApiException } from '@hubspot/api-client/lib/codegen/crm/contacts'
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

describe('CrmUsersService - merge-tolerant contact lookups (ENG-11029)', () => {
  const doSearch = vi.fn()
  const create = vi.fn()
  const update = vi.fn()
  const hubspot = {
    client: {
      crm: {
        contacts: {
          searchApi: { doSearch },
          basicApi: { create, update },
        },
      },
    },
  }
  const users = { patchUserMetaData: vi.fn() }
  const campaigns = { findActiveByUserId: vi.fn() }
  const logger = createMockLogger()

  let service: CrmUsersService

  // No cached hubspotId, so trackContact always falls through to a fresh
  // email lookup — the path the merge-survivor shape has to travel.
  const user = {
    id: 42,
    email: 'survivor-search@example.com',
    metaData: {},
  } as unknown as User

  beforeEach(() => {
    vi.clearAllMocks()
    campaigns.findActiveByUserId.mockResolvedValue(null)
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

  it('adopts a search result whose primary email differs (merged survivor) and updates it', async () => {
    doSearch.mockResolvedValue({
      total: 1,
      results: [
        { id: 'hs-survivor', properties: { email: 'primary@example.com' } },
      ],
    })
    update.mockResolvedValue({ id: 'hs-survivor' })

    await service.trackUserLogin(user)

    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(
      'hs-survivor',
      expect.objectContaining({
        properties: expect.objectContaining({
          email: 'survivor-search@example.com',
        }),
      }),
    )
    expect(users.patchUserMetaData).toHaveBeenCalledWith(user.id, {
      hubspotId: 'hs-survivor',
    })
  })

  it('adopts the existing id when create 409s, persists it, and updates that contact', async () => {
    doSearch.mockResolvedValue({ total: 0, results: [] })
    create.mockRejectedValue(
      new ApiException(
        409,
        'Conflict',
        { message: 'Contact already exists. Existing ID: 909090' },
        {},
      ),
    )
    update.mockResolvedValue({ id: '909090' })

    const result = await service.trackUserLogin(user)

    expect(update).toHaveBeenCalledWith(
      '909090',
      expect.objectContaining({
        properties: expect.objectContaining({
          email: 'survivor-search@example.com',
          lifecyclestage: 'opportunity',
        }),
      }),
    )
    expect(users.patchUserMetaData).toHaveBeenCalledWith(user.id, {
      hubspotId: '909090',
    })
    expect(result).toEqual({ id: '909090' })
  })

  it('persists the adopted id even when the follow-up update fails', async () => {
    doSearch.mockResolvedValue({ total: 0, results: [] })
    create.mockRejectedValue(
      new ApiException(
        409,
        'Conflict',
        { message: 'Contact already exists. Existing ID: 909090' },
        {},
      ),
    )
    update.mockRejectedValue(new Error('hubspot transient failure'))

    const result = await service.trackUserLogin(user)

    expect(users.patchUserMetaData).toHaveBeenCalledWith(user.id, {
      hubspotId: '909090',
    })
    expect(result).toEqual({ id: '909090' })
  })

  it('leaves a non-409 create failure unchanged: logged, no adoption, undefined', async () => {
    doSearch.mockResolvedValue({ total: 0, results: [] })
    create.mockRejectedValue(new Error('hubspot down'))

    const result = await service.trackUserLogin(user)

    expect(update).not.toHaveBeenCalled()
    expect(users.patchUserMetaData).not.toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({ hubspotId: expect.anything() }),
    )
    expect(logger.error).toHaveBeenCalled()
    expect(result).toBeUndefined()
  })

  it('regression: an exact-match search still resolves and updates the same id', async () => {
    doSearch.mockResolvedValue({
      total: 1,
      results: [
        {
          id: 'hs-exact',
          properties: { email: 'survivor-search@example.com' },
        },
      ],
    })
    update.mockResolvedValue({ id: 'hs-exact' })

    await service.trackUserLogin(user)

    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(
      'hs-exact',
      expect.objectContaining({
        properties: expect.objectContaining({
          email: 'survivor-search@example.com',
        }),
      }),
    )
  })

  it('regression: an empty search result still routes to create', async () => {
    doSearch.mockResolvedValue({ total: 0, results: [] })
    create.mockResolvedValue({ id: 'hs-new' })

    await service.trackUserLogin(user)

    expect(update).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          email: 'survivor-search@example.com',
        }),
      }),
    )
    expect(users.patchUserMetaData).toHaveBeenCalledWith(user.id, {
      hubspotId: 'hs-new',
    })
  })
})
