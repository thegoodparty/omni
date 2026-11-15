import { describe, expect, it, vi } from 'vitest'
import { ClerkClient } from '@clerk/backend'
import { useTestService } from '@/test-service'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { CLERK_API_TIMEOUT_MS } from '@/vendors/clerk/clerk.consts'
import { CandidaciesService } from '@/electionDb/candidacies/candidacies.service'

const service = useTestService()

// A verify call that settles only after the Clerk timeout has passed, as when
// the event loop was frozen past CLERK_API_TIMEOUT_MS mid-request.
const SLOW_MS = CLERK_API_TIMEOUT_MS + 300

const slowVerify = () =>
  new Promise((resolve) =>
    setTimeout(
      () => resolve({ id: 'm2m_1', subject: 'mch_machine', expired: false }),
      SLOW_MS,
    ),
  )

const setup = () => {
  const clerkClient = service.app.get<ClerkClient>(CLERK_CLIENT_PROVIDER_TOKEN)
  const verify = vi
    .spyOn(clerkClient.m2m, 'verify')
    .mockImplementation(slowVerify as never)
  vi.spyOn(
    service.app.get(CandidaciesService),
    'getCandidacies',
  ).mockResolvedValue([])
  return verify
}

describe('SessionGuard — M2M verification timeout', () => {
  it('still times out an opaque mt_ token at CLERK_API_TIMEOUT_MS', async () => {
    const verify = setup()
    const started = Date.now()

    const res = await service.client.get('/v1/elections/candidacies', {
      headers: { Authorization: 'Bearer mt_opaque' },
    })

    expect(verify).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(403)
    expect(Date.now() - started).toBeGreaterThanOrEqual(
      CLERK_API_TIMEOUT_MS - 50,
    )
  })
})
