import { HttpService } from '@nestjs/axios'
import { AxiosError, AxiosHeaders } from 'axios'
import { of, throwError } from 'rxjs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { WEBAPP_ROOT } from '@/shared/util/appEnvironment.util'
import {
  MarketingRevalidationService,
  PersonListing,
} from './marketing-revalidation.service'

/**
 * This is the sending half of a cross-repo contract. The receiver is
 * src/app/api/revalidate-person/route.ts in gp-marketing, whose tests assert the
 * same path, `x-revalidate-secret` header, and `{ personId, listings }` body
 * from the other direction. Changing any of the three here without changing it
 * there breaks revalidation silently: the request is best-effort, so a
 * rejected call only shows up as public profiles serving stale content until
 * their hourly window elapses.
 */
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

    await service.revalidatePerson(personId, [])

    expect(post).toHaveBeenCalledWith(
      override,
      { personId, listings: [] },
      { headers: { 'x-revalidate-secret': secret } },
    )
  })

  it('falls back to WEBAPP_ROOT when the override is unset', async () => {
    await service.revalidatePerson(personId, [])

    expect(post).toHaveBeenCalledWith(
      fallbackUrl,
      { personId, listings: [] },
      { headers: { 'x-revalidate-secret': secret } },
    )
  })

  it('falls back to WEBAPP_ROOT when the override is empty', async () => {
    process.env.MARKETING_REVALIDATE_URL = ''

    await service.revalidatePerson(personId, [])

    expect(post).toHaveBeenCalledWith(
      fallbackUrl,
      { personId, listings: [] },
      { headers: { 'x-revalidate-secret': secret } },
    )
  })

  // gp-marketing re-renders every page that read a list it is told changed,
  // so the caller's answer has to reach it unchanged.
  it('sends the lists the write changed', async () => {
    await service.revalidatePerson(personId, [
      PersonListing.published,
      PersonListing.unlisted,
    ])

    expect(post).toHaveBeenCalledWith(
      fallbackUrl,
      { personId, listings: ['published', 'unlisted'] },
      { headers: { 'x-revalidate-secret': secret } },
    )
  })

  it('skips the request when MARKETING_REVALIDATE_SECRET is unset', async () => {
    delete process.env.MARKETING_REVALIDATE_SECRET
    process.env.MARKETING_REVALIDATE_URL =
      'https://marketing.example.com/api/revalidate-person'

    await service.revalidatePerson(personId, [])

    expect(post).not.toHaveBeenCalled()
  })

  it('logs the status and Vercel mitigation header of an edge 429 without throwing', async () => {
    const logger = createMockLogger()
    const response = {
      status: 429,
      statusText: 'Too Many Requests',
      data: '',
      config: { headers: new AxiosHeaders() },
      headers: { 'x-vercel-mitigated': 'challenge' },
    }
    post.mockReturnValue(
      throwError(
        () =>
          new AxiosError(
            'Request failed with status code 429',
            'ERR_BAD_REQUEST',
            undefined,
            undefined,
            response,
          ),
      ),
    )
    service = new MarketingRevalidationService(
      { post } as unknown as HttpService,
      logger,
    )

    await expect(
      service.revalidatePerson(personId, []),
    ).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        personId,
        status: 429,
        vercelMitigated: 'challenge',
      }),
      'Marketing revalidation request failed (non-fatal)',
    )
  })
})
