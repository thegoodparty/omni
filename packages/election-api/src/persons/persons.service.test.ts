import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import { PersonsService } from './persons.service'
import { PersonFilterDto } from './persons.schema'

describe('PersonsService', () => {
  let service: PersonsService
  let findMany: ReturnType<typeof vi.fn>
  let findUnique: ReturnType<typeof vi.fn>
  let densityFindMany: ReturnType<typeof vi.fn>
  let metaFindUnique: ReturnType<typeof vi.fn>
  let mergeFindMany: ReturnType<typeof vi.fn>
  let mergeFindUnique: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findMany = vi.fn().mockResolvedValue([])
    findUnique = vi.fn().mockResolvedValue(null)
    densityFindMany = vi.fn().mockResolvedValue([])
    metaFindUnique = vi.fn().mockResolvedValue(null)
    // No merges by default, so every pre-existing by-slug case exercises the
    // live path exactly as before.
    mergeFindMany = vi.fn().mockResolvedValue([])
    mergeFindUnique = vi.fn().mockResolvedValue(null)
    service = new PersonsService()
    Object.defineProperty(service, '_prisma', {
      value: {
        person: { findMany, findUnique },
        districtVoterDensity: { findMany: densityFindMany },
        districtVoterDensityMeta: { findUnique: metaFindUnique },
        personMerge: { findMany: mergeFindMany, findUnique: mergeFindUnique },
      },
    })
  })

  it('omits PII on the default (no-columns) response', async () => {
    await service.getPersons({
      includeOfficeHolders: false,
      includeCandidacies: false,
    } as PersonFilterDto)

    expect(findMany).toHaveBeenCalledWith({
      where: {},
      omit: { email: true, phone: true, gpApiUserId: true },
      include: {},
    })
  })

  it('nests candidacies with email omitted and office holders when requested', async () => {
    await service.getPersons({
      includeOfficeHolders: true,
      includeCandidacies: true,
    } as PersonFilterDto)

    const args = findMany.mock.calls[0]?.[0]
    expect(args.omit).toEqual({ email: true, phone: true, gpApiUserId: true })
    expect(args.include.OfficeHolders).toBe(true)
    expect(args.include.Candidacies).toEqual({
      omit: { email: true },
      include: {
        Race: {
          select: { electionDate: true, slug: true, positionLevel: true },
        },
      },
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

  it('filters by gpApiUserId (gp-api user linkage lookup)', async () => {
    await service.getPersons({
      gpApiUserId: '12345',
      includeOfficeHolders: false,
      includeCandidacies: false,
    } as PersonFilterDto)

    const args = findMany.mock.calls[0]?.[0]
    expect(args.where).toEqual({ gpApiUserId: '12345' })
    // The internal linkage is never returned, even when filtered on.
    expect(args.omit).toEqual({ email: true, phone: true, gpApiUserId: true })
  })

  it('throws NotFound when a person id does not resolve', async () => {
    await expect(service.getPersonById('missing-id')).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('returns the person with relations and PII omitted', async () => {
    findUnique.mockResolvedValueOnce({ id: 'p1', OfficeHolders: [] })
    const result = await service.getPersonById('p1')

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'p1' },
      omit: { email: true, phone: true, gpApiUserId: true },
      include: {
        OfficeHolders: {
          include: {
            Position: {
              select: {
                level: true,
                Races: {
                  select: { slug: true, positionLevel: true },
                  orderBy: { electionDate: 'desc' },
                  take: 1,
                },
              },
            },
          },
        },
        Candidacies: {
          omit: { email: true },
          include: {
            Race: {
              select: { electionDate: true, slug: true, positionLevel: true },
            },
          },
        },
      },
    })
    expect(result).toEqual({ id: 'p1', OfficeHolders: [] })
  })

  // gp-marketing splits this slug into the breadcrumb's place crumbs + office
  // segment. A pure officeholder has no candidacy race slug, so without this the
  // trail degrades to `Elections > State > Name`.
  describe('office position slug', () => {
    const officeHolder = (Position: unknown) => ({
      id: 'oh1',
      officeTitle: 'County Sheriff',
      Position,
    })

    it('surfaces the office race slug and level, dropping the helper relation', async () => {
      findUnique.mockResolvedValueOnce({
        id: 'p1',
        OfficeHolders: [
          officeHolder({
            level: 'COUNTY',
            Races: [
              {
                slug: 'tx/hidalgo/mission/county-sheriff',
                positionLevel: 'CITY',
              },
            ],
          }),
        ],
      })

      const result = await service.getPersonById('p1')

      expect(result.OfficeHolders).toEqual([
        {
          id: 'oh1',
          officeTitle: 'County Sheriff',
          positionSlug: 'tx/hidalgo/mission/county-sheriff',
          // The race's level wins over the position's — it is non-null upstream,
          // and it is the level that pairs with the slug we took.
          positionLevel: 'CITY',
        },
      ])
      // Only pulled to reach the race; never part of the response shape.
      expect(result.OfficeHolders[0]).not.toHaveProperty('Position')
    })

    it('degrades to null when the term has no position (nullable, lossy FK)', async () => {
      findUnique.mockResolvedValueOnce({
        id: 'p1',
        OfficeHolders: [officeHolder(null)],
      })

      const result = await service.getPersonById('p1')

      expect(result.OfficeHolders[0]).toMatchObject({
        positionSlug: null,
        positionLevel: null,
      })
    })

    it('falls back to the position level when the office has no race', async () => {
      findUnique.mockResolvedValueOnce({
        id: 'p1',
        OfficeHolders: [officeHolder({ level: 'STATE', Races: [] })],
      })

      const result = await service.getPersonById('p1')

      expect(result.OfficeHolders[0]).toMatchObject({
        positionSlug: null,
        positionLevel: 'STATE',
      })
    })

    it('leaves both null when neither the race nor the position carries a level', async () => {
      findUnique.mockResolvedValueOnce({
        id: 'p1',
        OfficeHolders: [officeHolder({ level: null, Races: [] })],
      })

      const result = await service.getPersonById('p1')

      expect(result.OfficeHolders[0]).toMatchObject({
        positionSlug: null,
        positionLevel: null,
      })
    })

    it('resolves the slug on the by-slug path too (same spine shape)', async () => {
      findMany.mockResolvedValueOnce([
        {
          id: 'a1b2c3d4-0000-0000-0000-000000000000',
          slug: 'jane-doe-a1b2c3d4',
          OfficeHolders: [
            officeHolder({
              level: 'CITY',
              Races: [{ slug: 'ca/los-angeles/mayor', positionLevel: 'CITY' }],
            }),
          ],
        },
      ])

      const result = await service.getPersonBySlug('jane-doe-a1b2c3d4')

      expect(result.OfficeHolders[0]).toMatchObject({
        positionSlug: 'ca/los-angeles/mayor',
        positionLevel: 'CITY',
      })
    })
  })

  // The one read here that serves a PII column, and the reason it can: it
  // returns the address alone, so there is no wider payload for it to ride into
  // a public page inside.
  describe('getContactEmail', () => {
    it('selects the email and nothing else', async () => {
      findUnique.mockResolvedValue({ email: 'mayor@example.gov' })

      const result = await service.getContactEmail(
        '11111111-1111-1111-1111-111111111111',
      )

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: '11111111-1111-1111-1111-111111111111' },
        select: { email: true },
      })
      expect(result).toEqual({
        personId: '11111111-1111-1111-1111-111111111111',
        email: 'mayor@example.gov',
      })
    })

    it('reports a person with no address on file as null, not as an error', async () => {
      // Ordinary: the person feed only carries an address where a source had
      // one. The caller sends no CRM event rather than treating it as a fault.
      findUnique.mockResolvedValue({ email: null })

      await expect(
        service.getContactEmail('11111111-1111-1111-1111-111111111111'),
      ).resolves.toEqual({
        personId: '11111111-1111-1111-1111-111111111111',
        email: null,
      })
    })

    it('throws NotFound when the person is unknown', async () => {
      findUnique.mockResolvedValue(null)

      await expect(
        service.getContactEmail('11111111-1111-1111-1111-111111111111'),
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('getPersonBySlug', () => {
    it('resolves by the 8-hex id suffix via an indexed range scan (not the slug column)', async () => {
      findMany.mockResolvedValueOnce([
        { id: 'a1b2c3d4-...', slug: 'jane-doe-a1b2c3d4', OfficeHolders: [] },
      ])

      const result = await service.getPersonBySlug('jane-doe-a1b2c3d4')

      const args = findMany.mock.calls[0]?.[0]
      // Range on the id PK, never a where: { slug }.
      expect(args.where).toEqual({
        id: {
          gte: 'a1b2c3d4-0000-0000-0000-000000000000',
          lt: 'a1b2c3d5-0000-0000-0000-000000000000',
        },
      })
      expect(args.omit).toEqual({ email: true, phone: true, gpApiUserId: true })
      expect(result).toEqual({
        id: 'a1b2c3d4-...',
        slug: 'jane-doe-a1b2c3d4',
        OfficeHolders: [],
      })
    })

    it('uses an inclusive max-UUID bound for the all-Fs prefix (no successor)', async () => {
      findMany.mockResolvedValueOnce([
        { id: 'ffffffff-...', slug: 'zoe-zed-ffffffff', OfficeHolders: [] },
      ])

      await service.getPersonBySlug('zoe-zed-ffffffff')

      expect(findMany.mock.calls[0]?.[0].where).toEqual({
        id: {
          gte: 'ffffffff-0000-0000-0000-000000000000',
          lte: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        },
      })
    })

    it('breaks a shared-prefix tie against the whole stored slug', async () => {
      // The mart mints `slug` with the id suffix already on it, so the tie
      // breaks on the full URL slug, not on a base with the suffix stripped.
      findMany.mockResolvedValueOnce([
        { id: 'a1b2c3d4-1', slug: 'john-smith-a1b2c3d4', OfficeHolders: [] },
        { id: 'a1b2c3d4-2', slug: 'jane-doe-a1b2c3d4', OfficeHolders: [] },
      ])

      const result = await service.getPersonBySlug('jane-doe-a1b2c3d4')
      expect(result).toEqual({
        id: 'a1b2c3d4-2',
        slug: 'jane-doe-a1b2c3d4',
        OfficeHolders: [],
      })
    })

    it('404s a shared-prefix tie the base slug cannot break', async () => {
      // Both rows share the prefix and neither slug is the one asked for, so
      // there is no way to tell which was meant — serving either is worse.
      findMany.mockResolvedValueOnce([
        { id: 'a1b2c3d4-1', slug: 'john-smith-a1b2c3d4', OfficeHolders: [] },
        { id: 'a1b2c3d4-2', slug: 'jane-doe-a1b2c3d4', OfficeHolders: [] },
      ])

      await expect(
        service.getPersonBySlug('some-old-name-a1b2c3d4'),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('resolves a slug that is only the id suffix (name slugifies to empty)', async () => {
      // Non-Latin names strip to nothing, so the mart emits a bare 8-hex slug
      // and the public URL has no base part at all.
      findMany.mockResolvedValueOnce([
        { id: 'b2c3d4e5-...', slug: 'b2c3d4e5', OfficeHolders: [] },
      ])

      const result = await service.getPersonBySlug('b2c3d4e5')

      expect(findMany.mock.calls[0]?.[0].where).toEqual({
        id: {
          gte: 'b2c3d4e5-0000-0000-0000-000000000000',
          lt: 'b2c3d4e6-0000-0000-0000-000000000000',
        },
      })
      expect(result).toEqual({
        id: 'b2c3d4e5-...',
        slug: 'b2c3d4e5',
        OfficeHolders: [],
      })
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

    it('does not look for merges when a live person matches exactly', async () => {
      findMany.mockResolvedValueOnce([
        { id: 'a1b2c3d4-...', slug: 'jane-doe-a1b2c3d4', OfficeHolders: [] },
      ])

      await service.getPersonBySlug('jane-doe-a1b2c3d4')

      // The hot path must stay one query.
      expect(mergeFindMany).not.toHaveBeenCalled()
    })
  })

  // A URL whose person the data team has purged as a duplicate. The id8 that
  // made the slug unique was the deleted row's PK, so nothing in Person can
  // match it — PersonMerge holds the forwarding address and by-slug returns the
  // survivor, which is what lets gp-marketing 308 instead of 404.
  describe('getPersonBySlug — purged duplicates', () => {
    const SURVIVOR = {
      id: '99999999-9999-9999-9999-999999999999',
      slug: 'jane-doe-99999999',
      OfficeHolders: [],
    }

    it('resolves a purged slug to the surviving person', async () => {
      findMany.mockResolvedValueOnce([])
      mergeFindMany.mockResolvedValueOnce([
        { survivingId: SURVIVOR.id, retiredSlug: 'jane-doe-a1b2c3d4' },
      ])
      // Not itself retired, then loaded.
      mergeFindUnique.mockResolvedValueOnce(null)
      findUnique.mockResolvedValueOnce(SURVIVOR)

      const result = await service.getPersonBySlug('jane-doe-a1b2c3d4')

      // Looked up on the same indexed id-prefix range, against retiredId.
      expect(mergeFindMany.mock.calls[0]?.[0].where).toEqual({
        retiredId: {
          gte: 'a1b2c3d4-0000-0000-0000-000000000000',
          lt: 'a1b2c3d5-0000-0000-0000-000000000000',
        },
      })
      // The survivor, whose own slug differs — that difference is what the
      // marketing page turns into a permanent redirect.
      expect(result).toEqual(SURVIVOR)
    })

    it('carries several duplicates of one person to the same survivor', async () => {
      // The normal shape of a purge: many retired ids, one keeper.
      for (const retired of ['a1b2c3d4', 'b2c3d4e5']) {
        findMany.mockResolvedValueOnce([])
        mergeFindMany.mockResolvedValueOnce([
          { survivingId: SURVIVOR.id, retiredSlug: `jane-doe-${retired}` },
        ])
        mergeFindUnique.mockResolvedValueOnce(null)
        findUnique.mockResolvedValueOnce(SURVIVOR)

        await expect(
          service.getPersonBySlug(`jane-doe-${retired}`),
        ).resolves.toEqual(SURVIVOR)
      }
    })

    it('prefers an exact retired-slug match over a live person sharing the prefix', async () => {
      // The dangerous case: this URL demonstrably belonged to the purged
      // person, and the live row only happens to share 8 hex. Serving the live
      // person would conflate two different people under one URL.
      findMany.mockResolvedValueOnce([
        {
          id: 'a1b2c3d4-live',
          slug: 'someone-else-a1b2c3d4',
          OfficeHolders: [],
        },
      ])
      mergeFindMany.mockResolvedValueOnce([
        { survivingId: SURVIVOR.id, retiredSlug: 'jane-doe-a1b2c3d4' },
      ])
      mergeFindUnique.mockResolvedValueOnce(null)
      findUnique.mockResolvedValueOnce(SURVIVOR)

      const result = await service.getPersonBySlug('jane-doe-a1b2c3d4')

      expect(result).toEqual(SURVIVOR)
    })

    it('still prefers a lone live person when no retired slug matches (rename)', async () => {
      // A renamed person keeps resolving through their stale URL: that is why
      // lookup is on the id prefix rather than the slug in the first place.
      findMany.mockResolvedValueOnce([
        {
          id: 'a1b2c3d4-live',
          slug: 'jane-married-a1b2c3d4',
          OfficeHolders: [],
        },
      ])
      mergeFindMany.mockResolvedValueOnce([])

      const result = await service.getPersonBySlug('jane-maiden-a1b2c3d4')

      expect(result).toMatchObject({ id: 'a1b2c3d4-live' })
      expect(findUnique).not.toHaveBeenCalled()
    })

    it('resolves a lone prefix-unique merge row that carries no retired slug', async () => {
      // Backfilled rows may have no retiredSlug; uniqueness on the prefix is
      // enough to forward them.
      findMany.mockResolvedValueOnce([])
      mergeFindMany.mockResolvedValueOnce([
        { survivingId: SURVIVOR.id, retiredSlug: null },
      ])
      mergeFindUnique.mockResolvedValueOnce(null)
      findUnique.mockResolvedValueOnce(SURVIVOR)

      await expect(
        service.getPersonBySlug('whoever-a1b2c3d4'),
      ).resolves.toEqual(SURVIVOR)
    })

    it('404s an ambiguous prefix rather than guessing between two purged people', async () => {
      findMany.mockResolvedValueOnce([])
      mergeFindMany.mockResolvedValueOnce([
        { survivingId: 'survivor-1', retiredSlug: 'john-smith-a1b2c3d4' },
        { survivingId: 'survivor-2', retiredSlug: 'jane-doe-a1b2c3d4' },
      ])

      await expect(
        service.getPersonBySlug('some-old-name-a1b2c3d4'),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('follows a residual merge chain to the terminal survivor', async () => {
      // The ETL is contracted to path-compress, so this should never happen;
      // when it does, an extra hop beats a 404.
      findMany.mockResolvedValueOnce([])
      mergeFindMany.mockResolvedValueOnce([
        { survivingId: 'middle-id', retiredSlug: 'jane-doe-a1b2c3d4' },
      ])
      mergeFindUnique
        .mockResolvedValueOnce({ survivingId: SURVIVOR.id })
        .mockResolvedValueOnce(null)
      findUnique.mockResolvedValueOnce(SURVIVOR)

      const result = await service.getPersonBySlug('jane-doe-a1b2c3d4')

      expect(findUnique.mock.calls[0]?.[0].where).toEqual({ id: SURVIVOR.id })
      expect(result).toEqual(SURVIVOR)
    })

    it('does not spin on a merge cycle', async () => {
      findMany.mockResolvedValueOnce([])
      mergeFindMany.mockResolvedValueOnce([
        { survivingId: 'a-id', retiredSlug: 'jane-doe-a1b2c3d4' },
      ])
      // a -> b -> a, forever if unguarded.
      mergeFindUnique.mockImplementation(({ where }) =>
        Promise.resolve({
          survivingId: where.retiredId === 'a-id' ? 'b-id' : 'a-id',
        }),
      )
      findUnique.mockResolvedValueOnce(SURVIVOR)

      await expect(
        service.getPersonBySlug('jane-doe-a1b2c3d4'),
      ).resolves.toEqual(SURVIVOR)
      // Bounded by MAX_MERGE_HOPS, not by the cycle.
      expect(mergeFindUnique.mock.calls.length).toBeLessThanOrEqual(4)
    })

    it('404s when the forwarding address points at a person that is gone too', async () => {
      findMany.mockResolvedValueOnce([])
      mergeFindMany.mockResolvedValueOnce([
        { survivingId: SURVIVOR.id, retiredSlug: 'jane-doe-a1b2c3d4' },
      ])
      mergeFindUnique.mockResolvedValueOnce(null)
      findUnique.mockResolvedValueOnce(null)

      await expect(
        service.getPersonBySlug('jane-doe-a1b2c3d4'),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('404s a broken forwarding address instead of falling through to a live prefix collision', async () => {
      // An exact retired-slug match is definitive about whose URL this is, so a
      // broken forward makes it unresolvable — not ambiguous. Continuing down
      // the ladder would hand the purged person's URL to the one live row that
      // happens to share the 8 hex, which is the conflation rung 2 exists to
      // prevent.
      findMany.mockResolvedValueOnce([
        {
          id: 'a1b2c3d4-live',
          slug: 'jim-poe-a1b2c3d4',
          OfficeHolders: [],
        },
      ])
      mergeFindMany.mockResolvedValueOnce([
        { survivingId: 'ghost-id', retiredSlug: 'jane-doe-a1b2c3d4' },
      ])
      mergeFindUnique.mockResolvedValueOnce(null)
      findUnique.mockResolvedValueOnce(null)

      await expect(
        service.getPersonBySlug('jane-doe-a1b2c3d4'),
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

  describe('getVoterDensity', () => {
    /** A person whose current office term resolves to `districtId`. */
    const personInDistrict = (districtId: string | null) => ({
      state: 'CA',
      OfficeHolders: [
        {
          isCurrent: true,
          startAt: new Date('2020-01-01'),
          Position: { districtId },
        },
      ],
      Candidacies: [],
    })

    it('throws NotFound when the person is unknown', async () => {
      findUnique.mockResolvedValueOnce(null)
      await expect(service.getVoterDensity('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      )
    })

    it('returns an empty map without querying density when no district resolves', async () => {
      findUnique.mockResolvedValueOnce(personInDistrict(null))

      const result = await service.getVoterDensity('p1')

      expect(result).toEqual({
        personId: 'p1',
        districtId: null,
        coverage: null,
        cells: [],
      })
      // A person with no district has no key to look up; hitting the density
      // tables anyway would be a guaranteed-empty scan on every such profile.
      expect(densityFindMany).not.toHaveBeenCalled()
      expect(metaFindUnique).not.toHaveBeenCalled()
    })

    it('returns the cells and coverage for the resolved district', async () => {
      findUnique.mockResolvedValueOnce(personInDistrict('d1'))
      densityFindMany.mockResolvedValueOnce([
        { lat: 34.1, lng: -118.2, voterCount: 12 },
        { lat: 34.2, lng: -118.1, voterCount: 7 },
      ])
      metaFindUnique.mockResolvedValueOnce({ coverage: 0.82 })

      const result = await service.getVoterDensity('p1')

      expect(result).toEqual({
        personId: 'p1',
        districtId: 'd1',
        coverage: 0.82,
        cells: [
          { lat: 34.1, lng: -118.2, count: 12 },
          { lat: 34.2, lng: -118.1, count: 7 },
        ],
      })
    })

    it('keys both reads on the resolved district at the default resolution', async () => {
      findUnique.mockResolvedValueOnce(personInDistrict('d1'))

      await service.getVoterDensity('p1')

      expect(densityFindMany).toHaveBeenCalledWith({
        where: { districtId: 'd1', resolution: 8 },
        select: { lat: true, lng: true, voterCount: true },
        orderBy: [{ lat: 'asc' }, { lng: 'asc' }],
      })
      expect(metaFindUnique).toHaveBeenCalledWith({
        where: { districtId_resolution: { districtId: 'd1', resolution: 8 } },
        select: { coverage: true },
      })
    })

    it('passes a caller-supplied resolution through to both reads', async () => {
      findUnique.mockResolvedValueOnce(personInDistrict('d1'))

      await service.getVoterDensity('p1', 7)

      expect(densityFindMany.mock.calls[0]?.[0].where.resolution).toBe(7)
      expect(
        metaFindUnique.mock.calls[0]?.[0].where.districtId_resolution
          .resolution,
      ).toBe(7)
    })

    it('reports null coverage when cells exist but no meta row does', async () => {
      // The page hides the map on null/low coverage, so an unbuilt meta row has
      // to read as "do not render" rather than as full coverage.
      findUnique.mockResolvedValueOnce(personInDistrict('d1'))
      densityFindMany.mockResolvedValueOnce([
        { lat: 34.1, lng: -118.2, voterCount: 12 },
      ])
      metaFindUnique.mockResolvedValueOnce(null)

      const result = await service.getVoterDensity('p1')
      expect(result.coverage).toBeNull()
      expect(result.cells).toHaveLength(1)
    })

    it('reports zero coverage as zero, not as absent', async () => {
      // 0 is a real, published coverage value; `?? null` must not collapse it
      // the way `||` would, or a fully suppressed district becomes
      // indistinguishable from one the pipeline never built.
      findUnique.mockResolvedValueOnce(personInDistrict('d1'))
      metaFindUnique.mockResolvedValueOnce({ coverage: 0 })

      const result = await service.getVoterDensity('p1')
      expect(result.coverage).toBe(0)
    })

    it('returns empty cells for a district the pipeline has published nothing for', async () => {
      findUnique.mockResolvedValueOnce(personInDistrict('d1'))

      const result = await service.getVoterDensity('p1')
      expect(result).toEqual({
        personId: 'p1',
        districtId: 'd1',
        coverage: null,
        cells: [],
      })
    })
  })
})
