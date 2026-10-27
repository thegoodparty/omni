import { execFileSync } from 'child_process'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/election-prisma'
import { PlacesService } from '@/electionDb/places/places.service'
import { PlaceFilterDto } from '@/electionDb/places/places.schema'
import { testPostgresUri, withDatabase } from '@/test-postgres'
import { RaceFilterDto } from './races.schema'
import { RacesService } from './races.service'
import { getDedupedRacesBySlug } from './races.util'

// Runs the real queries against a scratch Postgres built from the election
// schema, because the point of merging in the database is what Postgres does
// with the SQL. The election database has no place in useTestService (it is
// never provisioned there), so this suite brings its own.
//
// The oracle is the implementation this replaced: load every row, merge in JS
// with getDedupedRacesBySlug. The service has to return the same thing.
const DB_NAME = `gp_api_merged_races_${process.pid}`
const LA = '00000000-0000-4000-8000-0000000000a1'
const MN = '00000000-0000-4000-8000-0000000000a2'
const LA_CITY = '00000000-0000-4000-8000-0000000000a3'

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

type Row = {
  n: number
  slug: string
  placeId: string | null
  names: string[]
  year: number
  level?: 'COUNTY' | 'STATE'
  isPrimary?: boolean | null
}

const ROWS: Row[] = [
  // Same slug across four election years; names overlap and repeat.
  {
    n: 1,
    slug: 'ca/la/judge',
    placeId: LA,
    names: ['Judge 1', 'Judge 2'],
    year: 2022,
  },
  {
    n: 2,
    slug: 'ca/la/judge',
    placeId: LA,
    names: ['Judge 2', 'Judge 3'],
    year: 2024,
  },
  {
    n: 3,
    slug: 'ca/la/judge',
    placeId: LA,
    names: ['Judge 4', 'Judge 1'],
    year: 2026,
  },
  { n: 4, slug: 'ca/la/judge', placeId: LA, names: [], year: 2028 },
  // One row whose own array repeats a value: the JS merge left it alone.
  {
    n: 5,
    slug: 'ca/la/sheriff',
    placeId: LA,
    names: ['Sheriff', 'Sheriff'],
    year: 2026,
  },
  {
    n: 6,
    slug: 'ca/la/assessor',
    placeId: LA,
    names: ['Assessor'],
    year: 2026,
    isPrimary: true,
  },
  {
    n: 7,
    slug: 'ca/la/assessor',
    placeId: LA,
    names: ['County Assessor'],
    year: 2028,
    isPrimary: false,
  },
  {
    n: 8,
    slug: 'ca/la/city/mayor',
    placeId: LA_CITY,
    names: ['Mayor'],
    year: 2026,
  },
  {
    n: 9,
    slug: 'ca/la/city/mayor',
    placeId: LA_CITY,
    names: ['Mayor (Interim)'],
    year: 2028,
  },
  {
    n: 10,
    slug: 'mn/clerk',
    placeId: MN,
    names: ['Clerk'],
    year: 2026,
    level: 'STATE',
  },
]

describe('races merged in the database', () => {
  let admin: Client
  let client: PrismaClient
  let races: RacesService
  let places: PlacesService

  beforeAll(async () => {
    const baseUri = await testPostgresUri()
    admin = new Client({ connectionString: baseUri })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${DB_NAME}`)
    const url = withDatabase(baseUri, DB_NAME)

    const ddl = execFileSync(
      'npx',
      [
        'prisma',
        'migrate',
        'diff',
        '--from-empty',
        '--to-schema-datamodel',
        'prisma-election/schema',
        '--script',
      ],
      { cwd: `${__dirname}/../../..`, encoding: 'utf8' },
    )
    const scratch = new Client({ connectionString: url })
    await scratch.connect()
    await scratch.query(ddl)
    await scratch.end()

    client = new PrismaClient({ datasourceUrl: url })
    const base = {
      mtfcc: 'G4020',
      brDatabaseId: 1,
      state: 'CA',
    }
    await client.place.createMany({
      data: [
        { id: LA, name: 'LA', slug: 'ca/la', geoId: '06037', ...base },
        { id: MN, name: 'MN', slug: 'mn', geoId: '27', ...base, state: 'MN' },
        {
          id: LA_CITY,
          name: 'LA City',
          slug: 'ca/la/city',
          geoId: '0644000',
          ...base,
          parentId: LA,
        },
      ],
    })
    await client.race.createMany({
      data: ROWS.map((r) => ({
        id: uuid(r.n),
        slug: r.slug,
        state: r.slug.startsWith('mn') ? 'MN' : 'CA',
        placeId: r.placeId,
        positionNames: r.names,
        positionLevel: r.level ?? 'COUNTY',
        electionDate: new Date(`${r.year}-11-03T00:00:00Z`),
        isPrimary: r.isPrimary ?? null,
        frequency: [4],
        normalizedPositionName: r.slug,
      })),
    })

    const electionDb = { instance: client }
    races = new RacesService()
    Object.defineProperty(races, '_electionDb', { value: electionDb })
    places = new PlacesService()
    Object.defineProperty(places, '_electionDb', { value: electionDb })
  })

  afterAll(async () => {
    await client?.$disconnect()
    await admin?.query(`DROP DATABASE IF EXISTS ${DB_NAME}`)
    await admin?.end()
  })

  const raceFilter = (over: Partial<RaceFilterDto>) =>
    ({
      includePlace: false,
      includeCandidacies: false,
      page: 1,
      pageSize: 1000,
      ...over,
    }) as RaceFilterDto

  // The old implementation: every matching row, merged in JS.
  const oldRaces = async (where: object) =>
    getDedupedRacesBySlug(
      await client.race.findMany({
        where,
        orderBy: [{ slug: 'asc' }, { id: 'asc' }],
      }),
    )

  it('returns the same races as the JS merge, for a slug with several rows', async () => {
    const result = await races.findRaces(raceFilter({ state: 'CA' }))

    expect(result).toEqual(await oldRaces({ state: 'CA' }))
    const judge = result.find((r) => r.slug === 'ca/la/judge')
    expect(judge?.positionNames).toEqual([
      'Judge 1',
      'Judge 2',
      'Judge 3',
      'Judge 4',
    ])
    // A lone row keeps its array as stored.
    expect(
      result.find((r) => r.slug === 'ca/la/sheriff')?.positionNames,
    ).toEqual(['Sheriff', 'Sheriff'])
  })

  it('keeps the filters: a filtered-out row is not merged in', async () => {
    const result = await races.findRaces(
      raceFilter({ raceSlug: 'ca/la/assessor', isPrimary: true }),
    )

    expect(result).toEqual(
      await oldRaces({ slug: 'ca/la/assessor', isPrimary: true }),
    )
    expect(result[0]?.positionNames).toEqual(['Assessor'])
  })

  it('keeps level, date and place filters', async () => {
    const result = await races.findRaces(
      raceFilter({
        placeSlug: 'ca/la',
        positionLevel: 'COUNTY',
        electionDateStart: '2026-01-01',
        electionDateEnd: '2026-12-31',
      }),
    )

    const where = {
      placeId: LA,
      positionLevel: 'COUNTY' as const,
      electionDate: {
        gte: new Date('2026-01-01'),
        lte: new Date('2026-12-31'),
      },
    }
    expect(result).toEqual(await oldRaces(where))
  })

  it('pages by distinct slug and still merges every row of each slug', async () => {
    const first = await races.findRaces(
      raceFilter({ state: 'CA', page: 1, pageSize: 2 }),
    )
    const second = await races.findRaces(
      raceFilter({ state: 'CA', page: 2, pageSize: 2 }),
    )

    const all = await oldRaces({ state: 'CA' })
    expect([...first, ...second]).toEqual(all.slice(0, 4))
  })

  it('honours raceColumns and keeps relations of the first row', async () => {
    const result = await races.findRaces(
      raceFilter({
        state: 'CA',
        raceColumns: 'slug,positionNames',
        includePlace: true,
      }),
    )

    const old = getDedupedRacesBySlug(
      await client.race.findMany({
        where: { state: 'CA' },
        select: { slug: true, positionNames: true, Place: true },
        orderBy: [{ slug: 'asc' }, { id: 'asc' }],
      }),
    )
    expect(result).toEqual(old)
  })

  const sortRaces = <T extends { slug: string }>(list: T[] | undefined) =>
    [...(list ?? [])].sort((a, b) => a.slug.localeCompare(b.slug))

  it('returns the same place-with-races tree as the JS merge', async () => {
    const [place] = await places.getPlaces({
      slug: 'ca/la',
      includeRaces: true,
      includeChildren: true,
      includeChildRaces: true,
    } as PlaceFilterDto)

    const old = await client.place.findFirstOrThrow({
      where: { slug: 'ca/la' },
      include: { Races: true, children: { include: { Races: true } } },
    })
    expect(
      sortRaces((place as { Races?: { slug: string }[] })?.Races as never),
    ).toEqual(sortRaces(getDedupedRacesBySlug(old.Races)))
    const child = place?.children?.[0] as { Races?: { slug: string }[] }
    expect(sortRaces(child?.Races)).toEqual(
      sortRaces(getDedupedRacesBySlug(old.children[0]?.Races ?? [])),
    )
  })

  // gp-marketing's location pages and featured-cities carousel ask for these
  // exact raceColumns, none of which is `id` (ENG-11491: every office dropped
  // when the merged rows were joined back by an id the caller never selected).
  const PLACE_RACE_COLUMNS =
    'slug,normalizedPositionName,positionNames,electionDate,positionDescription,positionLevel,isPrimary'
  const FEATURED_CITY_RACE_COLUMNS = 'slug,electionDate'
  const slugsOf = (list: unknown) =>
    [...new Set(((list ?? []) as { slug: string }[]).map((r) => r.slug))].sort()
  // positionNames always comes back: the merge needs it, as it did before.
  const expectOnlyColumns = (list: unknown, columns: string) => {
    const allowed = new Set([...columns.split(','), 'positionNames'])
    for (const race of (list ?? []) as Record<string, unknown>[]) {
      expect(Object.keys(race).filter((k) => !allowed.has(k))).toEqual([])
    }
  }

  it.each([PLACE_RACE_COLUMNS, FEATURED_CITY_RACE_COLUMNS])(
    'keeps place, child and parent races when raceColumns is %s',
    async (raceColumns) => {
      const [county] = await places.getPlaces({
        slug: 'ca/la',
        includeRaces: true,
        includeChildren: true,
        includeChildRaces: true,
        raceColumns,
      } as PlaceFilterDto)
      const [city] = await places.getPlaces({
        slug: 'ca/la/city',
        includeRaces: true,
        includeParent: true,
        raceColumns,
      } as PlaceFilterDto)

      const countySlugs = slugsOf(
        await client.race.findMany({ where: { placeId: LA } }),
      )
      const citySlugs = slugsOf(
        await client.race.findMany({ where: { placeId: LA_CITY } }),
      )
      expect(countySlugs.length).toBeGreaterThan(0)
      expect(citySlugs.length).toBeGreaterThan(0)

      const countyRaces = (county as { Races?: unknown }).Races
      const childRaces = (county?.children?.[0] as { Races?: unknown })?.Races
      const cityRaces = (city as { Races?: unknown }).Races
      const parentRaces = (city as { parent?: { Races?: unknown } }).parent
        ?.Races
      expect(slugsOf(countyRaces)).toEqual(countySlugs)
      expect(slugsOf(childRaces)).toEqual(citySlugs)
      expect(slugsOf(cityRaces)).toEqual(citySlugs)
      expect(slugsOf(parentRaces)).toEqual(countySlugs)
      for (const list of [countyRaces, childRaces, cityRaces, parentRaces]) {
        expectOnlyColumns(list, raceColumns)
      }
    },
  )

  it('attaches parent races and drops an id it only loaded to join on', async () => {
    const [place] = await places.getPlaces({
      slug: 'ca/la/city',
      includeRaces: true,
      includeParent: true,
      placeColumns: 'slug',
    } as PlaceFilterDto)

    expect(place).not.toHaveProperty('id')
    const parent = (place as { parent?: Record<string, unknown> }).parent
    expect(parent).not.toHaveProperty('id')
    const oldParent = await client.race.findMany({ where: { placeId: LA } })
    expect(sortRaces(parent?.Races as never)).toEqual(
      sortRaces(getDedupedRacesBySlug(oldParent)),
    )
    expect((place as { Races?: unknown[] })?.Races).toHaveLength(1)
  })
})
