import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { WEBAPP_ROOT } from '@/shared/util/appEnvironment.util'
import { MarketingRevalidationService } from './marketing-revalidation.service'

describe('MarketingRevalidationService', () => {
  const secret = 'test-revalidate-secret'
  const personId = 'person-123'
  const fallbackUrl = `${WEBAPP_ROOT}/api/revalidate-person`
  const originalSecret = process.env.MARKETING_REVALIDATE_SECRET
  const originalOverride = process.env.MARKETING_REVALIDATE_URL

  let post: ReturnType<typeof vi.fn>
  let service: MarketingRevalidationService

  const restoreEnv = (key: string, value: string | undefined): void => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  beforeEach(() => {
    process.env.MARKETING_REVALIDATE_SECRET = secret
    delete process.env.MARKETING_REVALIDATE_URL
    post = vi.fn().mockReturnValue(of({ data: {} }))
    service = new MarketingRevalidationService(
      { post } as unknown as HttpService,
      createMockLogger(),
    )
  })

  afterEach(() => {
    restoreEnv('MARKETING_REVALIDATE_SECRET', originalSecret)
    restoreEnv('MARKETING_REVALIDATE_URL', originalOverride)
  })

  it('POSTs to MARKETING_REVALIDATE_URL when the override is set', async () => {
    const override = 'https://marketing.example.com/api/revalidate-person'
    process.env.MARKETING_REVALIDATE_URL = override

    await service.revalidatePerson(personId)

    expect(post).toHaveBeenCalledWith(
      override,
      { personId },
      { headers: { 'x-revalidate-secret': secret } },
    )
  })

  it('falls back to WEBAPP_ROOT when the override is unset', async () => {
    await service.revalidatePerson(personId)

    expect(post).toHaveBeenCalledWith(
      fallbackUrl,
      { personId },
      { headers: { 'x-revalidate-secret': secret } },
    )
  })

  it('falls back to WEBAPP_ROOT when the override is empty', async () => {
    process.env.MARKETING_REVALIDATE_URL = ''

    await service.revalidatePerson(personId)

    expect(post).toHaveBeenCalledWith(
      fallbackUrl,
      { personId },
      { headers: { 'x-revalidate-secret': secret } },
    )
  })

  it('skips the request when MARKETING_REVALIDATE_SECRET is unset', async () => {
    delete process.env.MARKETING_REVALIDATE_SECRET
    process.env.MARKETING_REVALIDATE_URL =
      'https://marketing.example.com/api/revalidate-person'

    await service.revalidatePerson(personId)

    expect(post).not.toHaveBeenCalled()
  })
})
