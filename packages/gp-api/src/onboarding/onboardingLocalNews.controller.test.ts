import { describe, expect, it, vi } from 'vitest'
import { OnboardingLocalNewsController } from './onboardingLocalNews.controller'
import { OnboardingLocalNewsService } from './services/localNews.service'
import { Organization, User } from '../generated/prisma'
import { GetLocalNewsQueryDTO } from './schemas/getLocalNews.schema'

const query = {
  state: 'WY',
  office: 'Cheyenne City Council - Ward 1',
} as GetLocalNewsQueryDTO
const organization = { ownerId: 7 } as Organization

const setup = (email: string) => {
  const service = {
    getLocalNews: vi.fn().mockResolvedValue({ status: 'pending' }),
  }
  const controller = new OnboardingLocalNewsController(
    service as unknown as OnboardingLocalNewsService,
  )
  return { service, controller, user: { email } as User }
}

describe('OnboardingLocalNewsController', () => {
  it('returns ready-empty for a test user without calling the service', async () => {
    const { service, controller, user } = setup('jane@test.goodparty.org')

    const res = await controller.getLocalNews(query, organization, user)

    expect(res).toEqual({ status: 'ready', outlets: [] })
    expect(service.getLocalNews).not.toHaveBeenCalled()
  })

  it('delegates to the service for a normal user', async () => {
    const { service, controller, user } = setup('jane@example.com')

    await controller.getLocalNews(query, organization, user)

    expect(service.getLocalNews).toHaveBeenCalledWith({
      city: undefined,
      state: 'WY',
      office: 'Cheyenne City Council - Ward 1',
      userId: 7,
    })
  })
})
