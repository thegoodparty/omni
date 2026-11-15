import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { SessionsService } from './sessions.service'

vi.stubEnv('SESSIONS_FLUSH_INTERVAL_MS', '50')

const service = useTestService({ scheduler: true })

const metaData = async () =>
  (
    await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
  ).metaData

describe('the sessions flush timer', () => {
  it("writes a signed-in request's visit to the user", async () => {
    const before = Date.now()

    expect((await service.client.get('/v1/users/me')).status).toBe(200)

    await vi.waitFor(async () => {
      expect(await metaData()).toEqual({
        lastVisited: expect.any(Number),
        sessionCount: 1,
      })
    })
    expect(
      ((await metaData()) as { lastVisited: number }).lastVisited,
    ).toBeGreaterThanOrEqual(before)
  })

  it('stops when the app shuts down', async () => {
    service.app.get(SessionsService).onModuleDestroy()

    expect((await service.client.get('/v1/users/me')).status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(await metaData()).toBeNull()
  })
})
