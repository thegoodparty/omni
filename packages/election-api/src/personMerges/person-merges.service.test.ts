import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import { PersonMergesService } from './person-merges.service'
import { PersonMergeFilterDto } from './person-merges.schema'

const RETIRED = '11111111-1111-1111-1111-111111111111'
const SURVIVOR = '22222222-2222-2222-2222-222222222222'

describe('PersonMergesService', () => {
  let service: PersonMergesService
  let findMany: ReturnType<typeof vi.fn>
  let findUnique: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue([])
    findUnique = vi.fn().mockResolvedValue(null)
    service = new PersonMergesService()
    Object.defineProperty(service, '_prisma', {
      value: { personMerge: { findMany, findUnique } },
    })
  })

  describe('getPersonMerges', () => {
    it('orders by the full keyset so paging is stable', async () => {
      await service.getPersonMerges({ limit: 500 } as PersonMergeFilterDto)

      expect(findMany.mock.calls[0]?.[0]).toMatchObject({
        where: {},
        orderBy: [{ retiredAt: 'asc' }, { retiredId: 'asc' }],
        take: 500,
      })
    })

    it('takes the whole boundary timestamp on a first poll', async () => {
      // Inclusive, because the consumer has processed nothing at this instant
      // yet — an exclusive bound here would skip the first row of a batch.
      await service.getPersonMerges({
        since: '2026-09-10T00:00:00.000Z',
        limit: 500,
      } as PersonMergeFilterDto)

      expect(findMany.mock.calls[0]?.[0].where).toEqual({
        retiredAt: { gte: new Date('2026-09-10T00:00:00.000Z') },
      })
    })

    it('resumes strictly after (since, sinceId) within a shared timestamp', async () => {
      // The case a plain timestamp cursor gets wrong: one ETL run stamps a
      // whole batch with an identical retired_at, so a consumer that stopped
      // mid-batch must resume by id, not by time.
      await service.getPersonMerges({
        since: '2026-09-10T00:00:00.000Z',
        sinceId: RETIRED,
        limit: 500,
      } as PersonMergeFilterDto)

      expect(findMany.mock.calls[0]?.[0].where).toEqual({
        OR: [
          { retiredAt: { gt: new Date('2026-09-10T00:00:00.000Z') } },
          {
            retiredAt: new Date('2026-09-10T00:00:00.000Z'),
            retiredId: { gt: RETIRED },
          },
        ],
      })
    })

    it('pages through a batch that shares one timestamp without repeating or skipping', async () => {
      const at = '2026-09-10T00:00:00.000Z'
      const ids = ['aaaa', 'bbbb', 'cccc'].map(
        (p) => `${p}1111-1111-1111-1111-111111111111`,
      )
      findMany.mockResolvedValueOnce(
        ids.slice(0, 2).map((retiredId) => ({ retiredId, retiredAt: at })),
      )

      const first = await service.getPersonMerges({
        since: at,
        limit: 2,
      } as PersonMergeFilterDto)
      expect(first.map((m) => m.retiredId)).toEqual(ids.slice(0, 2))

      // The consumer advances the cursor to the last row it saw.
      findMany.mockResolvedValueOnce([{ retiredId: ids[2], retiredAt: at }])
      const second = await service.getPersonMerges({
        since: at,
        sinceId: ids[1],
        limit: 2,
      } as PersonMergeFilterDto)

      expect(second.map((m) => m.retiredId)).toEqual([ids[2]])
      expect(findMany.mock.calls[1]?.[0].where.OR[1]).toEqual({
        retiredAt: new Date(at),
        retiredId: { gt: ids[1] },
      })
    })
  })

  describe('getPersonMerge', () => {
    it('404s an id that was never retired', async () => {
      findUnique.mockResolvedValueOnce(null)

      await expect(service.getPersonMerge(RETIRED)).rejects.toBeInstanceOf(
        NotFoundException,
      )
    })

    it('returns the survivor for a retired id', async () => {
      findUnique
        .mockResolvedValueOnce({ retiredId: RETIRED, survivingId: SURVIVOR })
        .mockResolvedValueOnce(null)

      await expect(service.getPersonMerge(RETIRED)).resolves.toMatchObject({
        retiredId: RETIRED,
        survivingId: SURVIVOR,
      })
    })

    it('resolves through a residual chain so a consumer never repoints at a purged id', async () => {
      findUnique
        .mockResolvedValueOnce({ retiredId: RETIRED, survivingId: 'middle' })
        .mockResolvedValueOnce({ survivingId: SURVIVOR })
        .mockResolvedValueOnce(null)

      await expect(service.getPersonMerge(RETIRED)).resolves.toMatchObject({
        survivingId: SURVIVOR,
      })
    })

    it('does not spin on a cycle', async () => {
      findUnique.mockImplementation(({ where }) =>
        Promise.resolve(
          where.retiredId === RETIRED
            ? { retiredId: RETIRED, survivingId: 'a' }
            : { survivingId: where.retiredId === 'a' ? 'b' : 'a' },
        ),
      )

      await expect(service.getPersonMerge(RETIRED)).resolves.toBeDefined()
      expect(findUnique.mock.calls.length).toBeLessThanOrEqual(5)
    })
  })
})
