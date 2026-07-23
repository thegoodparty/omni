import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlacesService } from './places.service'
import { PlaceFilterDto } from './places.schema'

describe('PlacesService', () => {
  let service: PlacesService
  let findMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findMany = vi.fn()
    service = new PlacesService()
    Object.defineProperty(service, '_prisma', {
      value: {
        place: {
          findMany,
        },
      },
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
})
