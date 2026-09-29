import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlacesService } from './places.service'
import {
  DEFAULT_PLACE_PAGE_SIZE,
  MAX_MOST_ELECTIONS_COUNT,
  MostElectionsDto,
  PlaceFilterDto,
} from './places.schema'

describe('PlacesService', () => {
  let service: PlacesService
  let findMany: ReturnType<typeof vi.fn>
  let queryRaw: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findMany = vi.fn()
    queryRaw = vi.fn()
    service = new PlacesService()
    Object.defineProperty(service, '_electionDb', {
      value: {
        instance: {
          place: {
            findMany,
          },
          $queryRaw: queryRaw,
        },
      },
    })
  })

  describe('getPlacesWithMostElections', () => {
    it('pushes the LIMIT into SQL with the count as a bound parameter', async () => {
      const rows = [
        { slug: 'st/city', name: 'City', race_count: 5 },
        { slug: 'st/county', name: 'County', race_count: 3 },
      ]
      queryRaw.mockResolvedValue(rows)

      const minRaces = 2
      const count = 10
      const result = await service.getPlacesWithMostElections(minRaces, count)

      expect(queryRaw).toHaveBeenCalledTimes(1)

      // Prisma tagged-template call: (strings, ...values)
      const [strings, ...values] = queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ]
      const sql = strings.join('?')

      // LIMIT is applied in SQL, not sliced in JS afterwards.
      expect(sql).toMatch(/LIMIT/i)
      // count is parameterized (bound value), never string-interpolated.
      expect(values).toContain(count)
      expect(values).toContain(minRaces)

      // Service returns exactly what the DB returned — no JS-side slicing.
      expect(result).toBe(rows)
    })
  })

  describe('getPlaces dedupes races across categorized children', () => {
    type RaceLite = { id: string; slug: string; positionNames: string[] }
    type CategoryPlace = { slug: string; Races?: RaceLite[] }
    type CategorizedPlace = {
      counties?: CategoryPlace[]
      districts?: CategoryPlace[]
      others?: CategoryPlace[]
    }

    const duplicateRaces = (slug: string, positionName: string) => [
      { id: `${slug}-1`, slug, positionNames: [positionName] },
      { id: `${slug}-2`, slug, positionNames: [`${positionName} (Interim)`] },
    ]

    const buildTree = () => [
      {
        id: 'state-1',
        name: 'State',
        slug: 'st',
        mtfcc: 'G4000',
        children: [
          {
            id: 'county-1',
            name: 'County',
            slug: 'st/county',
            mtfcc: 'G4020',
            Races: duplicateRaces('sheriff', 'Sheriff'),
          },
          {
            id: 'district-1',
            name: 'District',
            slug: 'st/district',
            mtfcc: 'G5420',
            Races: duplicateRaces('judge', 'Judge'),
          },
          {
            id: 'other-1',
            name: 'City',
            slug: 'st/city',
            mtfcc: 'G4110',
            Races: duplicateRaces('mayor', 'Mayor'),
          },
        ],
      },
    ]

    const filter = {
      includeChildren: true,
      includeChildRaces: true,
      includeRaces: true,
      includeParent: false,
      categorizeChildren: true,
    } as PlaceFilterDto

    it('dedupes races under counties, districts, and others exactly once', async () => {
      findMany.mockResolvedValue(buildTree())

      const [place] = (await service.getPlaces(
        filter,
      )) as unknown as CategorizedPlace[]

      expect(place?.counties?.[0]?.Races).toHaveLength(1)
      expect(place?.districts?.[0]?.Races).toHaveLength(1)
      expect(place?.others?.[0]?.Races).toHaveLength(1)

      expect(place?.others?.[0]?.Races?.[0]?.positionNames).toEqual([
        'Mayor',
        'Mayor (Interim)',
      ])
    })

    it('processes each category once (counties are not merged with others)', async () => {
      findMany.mockResolvedValue(buildTree())

      const [place] = (await service.getPlaces(
        filter,
      )) as unknown as CategorizedPlace[]

      expect(place?.counties?.[0]?.Races?.[0]?.positionNames).toEqual([
        'Sheriff',
        'Sheriff (Interim)',
      ])
      expect(place?.others).toHaveLength(1)
      expect(place?.others?.[0]?.slug).toBe('st/city')
    })
  })

  // The last collection endpoint to get a bound; `?state=TX` used to pull
  // every place in the state with children, parents and races included.
  it('bounds an unfiltered place query', async () => {
    findMany.mockResolvedValue([{ id: 'p1' }])
    await service.getPlaces({} as PlaceFilterDto)

    const args = findMany.mock.calls[0]?.[0]
    expect(args.take).toBe(DEFAULT_PLACE_PAGE_SIZE)
    expect(args.skip).toBe(0)
    expect(args.orderBy).toEqual({ id: 'asc' })
  })

  it('offsets by whole pages', async () => {
    findMany.mockResolvedValue([{ id: 'p1' }])
    await service.getPlaces({ page: 3, pageSize: 40 } as PlaceFilterDto)

    const args = findMany.mock.calls[0]?.[0]
    expect(args.skip).toBe(80)
    expect(args.take).toBe(40)
  })

  // `count` reaches a raw SQL LIMIT, so the schema is the only thing standing
  // between a caller and an unbounded scan.
  describe('most-elections count bound', () => {
    const parse = (count: string) =>
      MostElectionsDto.schema.safeParse({ count })

    it('accepts what the marketing site actually asks for', () => {
      expect(parse('3').success).toBe(true)
    })

    it('accepts the cap', () => {
      expect(parse(String(MAX_MOST_ELECTIONS_COUNT)).success).toBe(true)
    })

    it('rejects a count past the cap', () => {
      expect(parse(String(MAX_MOST_ELECTIONS_COUNT + 1)).success).toBe(false)
    })

    it('still rejects zero and negatives', () => {
      expect(parse('0').success).toBe(false)
      expect(parse('-5').success).toBe(false)
    })
  })
})
