import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UserRole } from '../generated/prisma'
import { useTestService } from '@/test-service'
import { ContentService } from './services/content.service'

const service = useTestService()

// The harness attaches a valid session token to any request that carries no
// Authorization header, so an empty bearer is how a test reaches the
// no-token branch of SessionGuard.
const anonymous = { headers: { Authorization: 'Bearer ' } }

describe('content routes', () => {
  let syncContent: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    syncContent = vi
      .spyOn(service.app.get(ContentService), 'syncContent')
      .mockResolvedValue({
        entries: [],
        createEntries: [],
        updateEntries: [],
        deletedEntries: [],
      })
  })

  describe('GET /v1/content/type/:type', () => {
    it('serves an anonymous caller', async () => {
      const result = await service.client.get(
        '/v1/content/type/aiContentCategories',
        anonymous,
      )

      expect(result.status).toBe(HttpStatus.OK)
    })

    it('still rejects an unknown content type', async () => {
      const result = await service.client.get(
        '/v1/content/type/not-a-content-type',
        anonymous,
      )

      expect(result.status).toBe(HttpStatus.BAD_REQUEST)
    })
  })

  describe('GET /v1/content/sync', () => {
    it('rejects an anonymous caller without syncing', async () => {
      const result = await service.client.get('/v1/content/sync', anonymous)

      expect(result.status).toBe(HttpStatus.UNAUTHORIZED)
      expect(syncContent).not.toHaveBeenCalled()
    })

    it('rejects a signed-in non-admin without syncing', async () => {
      const result = await service.client.get('/v1/content/sync')

      expect(result.status).toBe(HttpStatus.FORBIDDEN)
      expect(syncContent).not.toHaveBeenCalled()
    })

    it('admits an admin', async () => {
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: { roles: [UserRole.admin] },
      })

      const result = await service.client.get('/v1/content/sync')

      expect(result.status).toBe(HttpStatus.OK)
      expect(syncContent).toHaveBeenCalledOnce()
    })
  })
})
