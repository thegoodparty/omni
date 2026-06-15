import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommunityEventsPersister } from './communityEvents.persister'

describe('CommunityEventsPersister', () => {
  let persister: CommunityEventsPersister
  let updateMany: ReturnType<typeof vi.fn>
  let warn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    persister = new CommunityEventsPersister()
    updateMany = vi.fn().mockResolvedValue({ count: 1 })
    warn = vi.fn()
    Object.defineProperty(persister, '_prisma', {
      value: { campaignStrategy: { updateMany } },
    })
    Object.assign(persister, { logger: { warn } })
  })

  it('writes the result guarded on the row still holding the generating race', async () => {
    await persister.persist(42, 'hash-abc', { events: [] })

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 42, raceId: 'hash-abc' },
      data: { communityEvents: { events: [] } },
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('drops the result without throwing when the row moved to another race', async () => {
    updateMany.mockResolvedValue({ count: 0 })

    await persister.persist(42, 'hash-stale', { events: [] })

    expect(warn).toHaveBeenCalled()
  })
})
