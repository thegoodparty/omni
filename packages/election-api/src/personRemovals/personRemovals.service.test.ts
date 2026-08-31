import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PERSON_SOURCED_CANDIDACY_FIELDS,
  PersonRemovalsService,
} from './personRemovals.service'

const REMOVED = '11111111-1111-1111-1111-111111111111'
const KEPT = '22222222-2222-2222-2222-222222222222'

describe('PersonRemovalsService', () => {
  let service: PersonRemovalsService
  let findMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue([{ personId: REMOVED }])
    service = new PersonRemovalsService()
    Object.defineProperty(service, '_prisma', {
      value: { personRemoval: { findMany } },
    })
  })

  describe('findRemovedPersonIds', () => {
    it('scopes the query to the ids asked about, deduped', async () => {
      await service.findRemovedPersonIds([REMOVED, KEPT, REMOVED])

      expect(findMany).toHaveBeenCalledWith({
        where: { personId: { in: [REMOVED, KEPT] } },
        select: { personId: true },
      })
    })

    it('does not query at all for an empty id list', async () => {
      const result = await service.findRemovedPersonIds([])

      expect(findMany).not.toHaveBeenCalled()
      expect(result.size).toBe(0)
    })
  })

  describe('blankRemovedPersonFields', () => {
    it('blanks the person-sourced fields only on the removed row', async () => {
      const rows = [
        {
          personId: REMOVED,
          image: 'https://cdn.example.org/removed.jpg',
          about: 'bio',
          lastName: 'Removed',
          party: 'Nonpartisan',
        },
        {
          personId: KEPT,
          image: 'https://cdn.example.org/kept.jpg',
          about: 'bio',
          lastName: 'Kept',
          party: 'Nonpartisan',
        },
      ]

      const result = await service.blankRemovedPersonFields(
        rows,
        PERSON_SOURCED_CANDIDACY_FIELDS,
        'personId',
      )

      expect(result[0]?.image).toBeNull()
      expect(result[0]?.about).toBeNull()
      // Race-sourced fields survive, so the roster still shows a real candidacy.
      expect(result[0]?.lastName).toBe('Removed')
      expect(result[0]?.party).toBe('Nonpartisan')
      expect(result[1]?.image).toBe('https://cdn.example.org/kept.jpg')
      expect(result[1]?.about).toBe('bio')
    })

    it('empties `urls` rather than nulling it, since the column is not nullable', async () => {
      const rows = [{ personId: REMOVED, urls: ['https://example.org'] }]

      const result = await service.blankRemovedPersonFields(
        rows,
        PERSON_SOURCED_CANDIDACY_FIELDS,
        'personId',
      )

      expect(result[0]?.urls).toEqual([])
    })

    it('does not invent properties the row never carried', async () => {
      const rows = [{ personId: REMOVED, image: 'x' }]

      const result = await service.blankRemovedPersonFields(
        rows,
        PERSON_SOURCED_CANDIDACY_FIELDS,
        'personId',
      )

      expect(result[0] && 'about' in result[0]).toBe(false)
      expect(result[0] && 'urls' in result[0]).toBe(false)
    })

    it('leaves rows alone when nothing is removed', async () => {
      findMany.mockResolvedValue([])
      const rows = [
        { personId: REMOVED, image: 'https://cdn.example.org/a.jpg' },
      ]

      const result = await service.blankRemovedPersonFields(
        rows,
        PERSON_SOURCED_CANDIDACY_FIELDS,
        'personId',
      )

      expect(result[0]?.image).toBe('https://cdn.example.org/a.jpg')
    })
  })
})
