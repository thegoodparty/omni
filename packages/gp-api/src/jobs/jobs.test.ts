import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'

const service = useTestService()

describe('JobsService', () => {
  it('boots against the pgboss schema the Prisma migration installed', async () => {
    const [row] = await service.prisma.$queryRaw<Array<{ version: number }>>`
      SELECT version FROM pgboss.version`
    expect(row?.version).toBe(46)
  })
})
