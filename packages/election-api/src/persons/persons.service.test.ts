import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import { PersonsService } from './persons.service'
import { PersonFilterDto } from './persons.schema'

describe('PersonsService', () => {
  let service: PersonsService
  let findMany: ReturnType<typeof vi.fn>
  let findUnique: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue([])
    findUnique = vi.fn().mockResolvedValue(null)
    service = new PersonsService()
    Object.defineProperty(service, '_prisma', {
      value: { person: { findMany, findUnique } },
    })
  })

  it('omits PII on the default (no-columns) response', async () => {
    await service.getPersons({
      includeOfficeHolders: false,
      includeCandidacies: false,
    } as PersonFilterDto)

    expect(findMany).toHaveBeenCalledWith({
      where: {},
      omit: { email: true, phone: true },
      include: {},
    })
  })

  it('nests candidacies with email omitted and office holders when requested', async () => {
    await service.getPersons({
      includeOfficeHolders: true,
      includeCandidacies: true,
    } as PersonFilterDto)

    const args = findMany.mock.calls[0]?.[0]
    expect(args.omit).toEqual({ email: true, phone: true })
    expect(args.include.OfficeHolders).toBe(true)
    expect(args.include.Candidacies).toEqual({
      omit: { email: true },
      include: { Race: { select: { electionDate: true } } },
    })
    expect(args.select).toBeUndefined()
  })

  it('selects only the requested non-PII columns when columns are provided', async () => {
    await service.getPersons({
      columns: 'id,slug',
      includeOfficeHolders: false,
      includeCandidacies: false,
    } as PersonFilterDto)

    expect(findMany).toHaveBeenCalledWith({
      where: {},
      select: { id: true, slug: true },
    })
  })

  it('filters by a batch of ids (sitemap lookup)', async () => {
    const a = '11111111-1111-1111-1111-111111111111'
    const b = '22222222-2222-2222-2222-222222222222'
    await service.getPersons({
      ids: [a, b],
      includeOfficeHolders: false,
      includeCandidacies: false,
    } as PersonFilterDto)

    const args = findMany.mock.calls[0]?.[0]
    expect(args.where).toEqual({ id: { in: [a, b] } })
  })

  it('throws NotFound when a person id does not resolve', async () => {
    await expect(service.getPersonById('missing-id')).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('returns the person with relations and PII omitted', async () => {
    findUnique.mockResolvedValueOnce({ id: 'p1' })
    const result = await service.getPersonById('p1')

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'p1' },
      omit: { email: true, phone: true },
      include: {
        OfficeHolders: true,
        Candidacies: {
          omit: { email: true },
          include: { Race: { select: { electionDate: true } } },
        },
      },
    })
    expect(result).toEqual({ id: 'p1' })
  })

  describe('getPersonBySlug', () => {
    it('resolves by the 8-hex id suffix via an indexed range scan (not the slug column)', async () => {
      findMany.mockResolvedValueOnce([{ id: 'a1b2c3d4-...', slug: 'jane-doe' }])

      const result = await service.getPersonBySlug('jane-doe-a1b2c3d4')

      const args = findMany.mock.calls[0]?.[0]
      // Range on the id PK, never a where: { slug }.
      expect(args.where).toEqual({
        id: {
          gte: 'a1b2c3d4-0000-0000-0000-000000000000',
          lt: 'a1b2c3d5-0000-0000-0000-000000000000',
        },
      })
      expect(args.omit).toEqual({ email: true, phone: true })
      expect(result).toEqual({ id: 'a1b2c3d4-...', slug: 'jane-doe' })
    })

    it('uses an inclusive max-UUID bound for the all-Fs prefix (no successor)', async () => {
      findMany.mockResolvedValueOnce([{ id: 'ffffffff-...', slug: 'zoe-zed' }])

      await service.getPersonBySlug('zoe-zed-ffffffff')

      expect(findMany.mock.calls[0]?.[0].where).toEqual({
        id: {
          gte: 'ffffffff-0000-0000-0000-000000000000',
          lte: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        },
      })
    })

    it('breaks a shared-prefix tie by matching the base slug', async () => {
      findMany.mockResolvedValueOnce([
        { id: 'a1b2c3d4-1', slug: 'john-smith' },
        { id: 'a1b2c3d4-2', slug: 'jane-doe' },
      ])

      const result = await service.getPersonBySlug('jane-doe-a1b2c3d4')
      expect(result).toEqual({ id: 'a1b2c3d4-2', slug: 'jane-doe' })
    })

    it('throws NotFound when the slug has no 8-hex id suffix', async () => {
      await expect(service.getPersonBySlug('jane-doe')).rejects.toBeInstanceOf(
        NotFoundException,
      )
      // Never touches the DB for an unparseable slug.
      expect(findMany).not.toHaveBeenCalled()
    })

    it('throws NotFound when the id prefix matches no person', async () => {
      findMany.mockResolvedValueOnce([])
      await expect(
        service.getPersonBySlug('nobody-deadbeef'),
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('getVoterDistrict', () => {
    it('throws NotFound when the person is unknown', async () => {
      findUnique.mockResolvedValueOnce(null)
      await expect(service.getVoterDistrict('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      )
    })

    it('prefers the current office term district over other terms', async () => {
      findUnique.mockResolvedValueOnce({
        state: 'WY',
        OfficeHolders: [
          {
            isCurrent: false,
            startAt: new Date('2010-01-01'),
            Position: { districtId: 'old-district' },
          },
          {
            isCurrent: true,
            startAt: new Date('2020-01-01'),
            Position: { districtId: 'current-district' },
          },
        ],
        Candidacies: [],
      })

      const result = await service.getVoterDistrict('p1')
      expect(result).toEqual({
        personId: 'p1',
        districtId: 'current-district',
        state: 'WY',
      })
    })

    it('ignores office terms whose position has no district', async () => {
      findUnique.mockResolvedValueOnce({
        state: 'CA',
        OfficeHolders: [
          { isCurrent: true, startAt: null, Position: { districtId: null } },
          {
            isCurrent: false,
            startAt: new Date('2019-01-01'),
            Position: { districtId: 'real-district' },
          },
        ],
        Candidacies: [],
      })

      const result = await service.getVoterDistrict('p1')
      expect(result.districtId).toBe('real-district')
    })

    it('falls back to the most recent candidacy race district', async () => {
      findUnique.mockResolvedValueOnce({
        state: 'TX',
        OfficeHolders: [],
        Candidacies: [
          {
            Race: {
              electionDate: new Date('2018-11-06'),
              Position: { districtId: 'old-race-district' },
            },
          },
          {
            Race: {
              electionDate: new Date('2024-11-05'),
              Position: { districtId: 'recent-race-district' },
            },
          },
        ],
      })

      const result = await service.getVoterDistrict('p1')
      expect(result.districtId).toBe('recent-race-district')
    })

    it('returns null districtId when nothing resolves', async () => {
      findUnique.mockResolvedValueOnce({
        state: 'WY',
        OfficeHolders: [],
        Candidacies: [{ Race: null }],
      })

      const result = await service.getVoterDistrict('p1')
      expect(result).toEqual({ personId: 'p1', districtId: null, state: 'WY' })
    })
  })
})
