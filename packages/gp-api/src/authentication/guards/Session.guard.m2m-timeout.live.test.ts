import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import jwt from 'jsonwebtoken'
import { ClerkClient } from '@clerk/backend'
import { useTestService } from '@/test-service'
import {
  AUTH_PROVIDER_TOKEN,
  AuthProvider,
} from '@/authentication/interfaces/auth-provider.interface'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { CLERK_API_TIMEOUT_MS } from '@/vendors/clerk/clerk.consts'
import { CandidaciesService } from '@/electionDb/candidacies/candidacies.service'

const service = useTestService()

// A verify call that settles only after the Clerk timeout has passed, as when
// the event loop was frozen past CLERK_API_TIMEOUT_MS mid-request.
const SLOW_MS = CLERK_API_TIMEOUT_MS + 300

const M2M_JWT = jwt.sign({ sub: 'mch_machine' }, 'any-key')
const slowVerify = () =>
  new Promise((resolve) =>
    setTimeout(
      () => resolve({ id: 'm2m_1', subject: 'mch_machine', expired: false }),
      SLOW_MS,
    ),
  )

const setup = () => {
  const authProvider = service.app.get<AuthProvider>(AUTH_PROVIDER_TOKEN)
  // The harness stubs verifyM2MJwt with an AUTH_SECRET check; put the real
  // implementation back so the Clerk timeout behavior is what runs.
  // Restoring twice fails (the first restore already unwrapped the spy), so
  // only restore while it is still a mock.
  if (vi.isMockFunction(authProvider.verifyM2MJwt)) {
    ;(authProvider.verifyM2MJwt as unknown as MockInstance).mockRestore()
  }
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
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not time out a JWT verified locally with CLERK_JWT_KEY set', async () => {
    vi.stubEnv('CLERK_JWT_KEY', 'pem-public-key')
    const verify = setup()

    const res = await service.client.get('/v1/elections/candidacies', {
      headers: { Authorization: `Bearer ${M2M_JWT}` },
    })

    expect(verify).toHaveBeenCalledWith({ token: M2M_JWT })
    expect(res.status).toBe(200)
  })

  it('still times out an M2M JWT when CLERK_JWT_KEY is unset', async () => {
    vi.stubEnv('CLERK_JWT_KEY', '')
    setup()

    const res = await service.client.get('/v1/elections/candidacies', {
      headers: { Authorization: `Bearer ${M2M_JWT}` },
    })

    expect(res.status).toBe(403)
  })

  it('still times out an opaque mt_ token at CLERK_API_TIMEOUT_MS', async () => {
    vi.stubEnv('CLERK_JWT_KEY', 'pem-public-key')
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
