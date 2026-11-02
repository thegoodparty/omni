import { randomUUID } from 'node:crypto'
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
  type MockInstance,
} from 'vitest'
import {
  CIVIC_PANEL_JOIN_LINE,
  type CivicPanelSummary,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import {
  CivicPanelStatus,
  ContactStatusField,
  ContactStatusSource,
} from '@/generated/prisma'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { StatsService } from '@/peopleDb/services/stats.service'
import {
  CENSUS_COMPOSITION_SOURCE,
  type CensusCompositionSource,
} from '@/priorities/services/censusComposition'
import {
  ACS_COUNT_KEYS,
  type AcsCountKey,
  type AcsCounts,
  type TractPlace,
} from '@/peopleDb/databricks/districtCensusSql.util'
import { CensusTractNameService } from '../services/censusTractName.service'
import { tractNumber } from '../utils/civicPanelSteering.util'

const service = useTestService()

const headers = (slug: string) => ({ 'X-Organization-Slug': slug })

const seedOffice = async () => {
  const slug = `eo-tract-names-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id, overrideDistrictId: randomUUID() },
  })
  await service.prisma.electedOffice.create({
    data: { organizationSlug: slug, userId: service.user.id },
  })
  return slug
}

const joinPanel = async (slug: string, count: number) => {
  for (let i = 0; i < count; i++) {
    await service.app.get(ContactStatusService).changeStatus({
      organizationSlug: slug,
      personId: randomUUID(),
      field: ContactStatusField.civic_panel,
      toValue: CivicPanelStatus.member,
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
      fallbackFromValue: CivicPanelStatus.left,
    })
  }
}

const acs = (overrides: Partial<Record<AcsCountKey, number>>): AcsCounts =>
  Object.fromEntries(
    ACS_COUNT_KEYS.map((key) => [key, overrides[key] ?? 0]),
  ) as AcsCounts

// Census tract names are kept across every district, so each test names
// tracts no other test has seen.
const newTract = () =>
  `37021${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`

// A district split evenly across the given tracts, with every member in
// the first.
const stubDistrict = (tracts: string[]) => {
  vi.spyOn(
    service.app.get<CensusCompositionSource>(CENSUS_COMPOSITION_SOURCE),
    'districtAnswersNeeded',
  ).mockResolvedValue(96)
  vi.spyOn(service.app.get(StatsService), 'findWeightingInputs')
    .mockClear()
    .mockResolvedValue({
      district: acs({
        populationMale35To44: 500,
        populationFemale35To44: 500,
      }),
      cells: [
        {
          ageBand: '35to44',
          gender: null,
          tenure: null,
          tract: tracts[0] ?? null,
          race: null,
          count: 20,
        },
      ],
      tractAdults: new Map(tracts.map((tract) => [tract, 100])),
    })
}

// What the voter file says about each tract: its residents' mean point and
// top street.
const stubPlaces = (places: TractPlace[]) =>
  vi
    .spyOn(service.app.get(StatsService), 'findTractPlaces')
    .mockClear()
    .mockResolvedValue(places)

type GeocodeAnswer = Partial<Record<string, string>>

// Geoapify's reverse geocoding, answered per latitude. Everything else
// rides real fetch.
const realFetch = globalThis.fetch.bind(globalThis)
const stubGeocoder = (answers: Map<number, GeocodeAnswer>) => {
  const spy = vi.spyOn(globalThis, 'fetch')
  onTestFinished(() => spy.mockRestore())
  return spy.mockImplementation(async (url, init) => {
    if (!String(url).includes('/v1/geocode/reverse')) {
      return realFetch(url as Parameters<typeof fetch>[0], init)
    }
    const lat = Number(new URL(String(url)).searchParams.get('lat'))
    return new Response(JSON.stringify({ results: [answers.get(lat) ?? {}] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

const geocodeCalls = (fetchSpy: ReturnType<typeof stubGeocoder>) =>
  fetchSpy.mock.calls.filter(([url]) =>
    String(url).includes('/v1/geocode/reverse'),
  ).length

const place = (
  tract: string,
  lat: number | null,
  street: string | null,
  designator: string | null = null,
): TractPlace => ({
  tract,
  point: lat === null ? null : { lat, lng: -82.55 },
  street,
  designator,
})

const readPanel = (slug: string) =>
  service.client.get<CivicPanelSummary>('/v1/contacts/civic-panel', {
    headers: headers(slug),
    validateStatus: () => true,
  })

const labels = (res: { data: CivicPanelSummary }) =>
  Object.fromEntries(
    (res.data.composition?.places ?? []).map((p) => [p.key, p.label ?? null]),
  )

let fill: MockInstance<CensusTractNameService['fillMissing']>

// The naming a read starts after its response, awaited.
const naming = async (calls = 1) => {
  await vi.waitFor(() => expect(fill).toHaveBeenCalledTimes(calls))
  await fill.mock.results[calls - 1]?.value
}

// Reads the panel of a district of the given tracts, waits for them to be
// named, and reads it again.
const namedDistrict = async (tracts: string[]) => {
  const slug = await seedOffice()
  stubDistrict(tracts)
  await joinPanel(slug, 20)
  const res = await readPanel(slug)
  expect(res.status).toBe(200)
  await naming()
  return { slug, res: await readPanel(slug) }
}

beforeAll(() => {
  vi.stubEnv('GEOAPIFY_API_KEY', 'test-key')
})

beforeEach(() => {
  fill = vi.spyOn(service.app.get(CensusTractNameService), 'fillMissing')
})

describe('census tract names on the civic panel', () => {
  it('names a tract by its neighborhood', async () => {
    const tract = newTract()
    stubPlaces([place(tract, 35.59, 'HAYWOOD', 'RD')])
    stubGeocoder(
      new Map([
        [
          35.59,
          {
            neighbourhood: 'Hawthorne',
            suburb: 'West Asheville',
            street: 'Haywood Road',
            city: 'Asheville',
          },
        ],
      ]),
    )

    const { res } = await namedDistrict([tract])

    expect(labels(res)).toEqual({ [tract]: 'Hawthorne' })
    expect(res.data.composition?.places[0]?.name).toBe(tractNumber(tract))
  })

  it('names a tract around its top street when Geoapify finds only a road or the city', async () => {
    const road = newTract()
    const city = newTract()
    stubPlaces([
      place(road, 35.61, 'HAYWOOD', 'RD'),
      place(city, 35.62, 'MERRIMON', 'AVE'),
    ])
    stubGeocoder(
      new Map([
        [35.61, { street: 'Haywood Road', city: 'Asheville' }],
        [35.62, { suburb: 'Asheville', city: 'Asheville' }],
      ]),
    )

    const { res } = await namedDistrict([road, city])

    expect(labels(res)).toEqual({
      [road]: 'around Haywood Rd',
      [city]: 'around Merrimon Ave',
    })
  })

  it('leaves the tract number when there is no neighborhood and no street', async () => {
    const roadOnly = newTract()
    const empty = newTract()
    stubPlaces([place(roadOnly, 35.63, null)])
    const fetchSpy = stubGeocoder(
      new Map([[35.63, { street: 'Haywood Road', city: 'Asheville' }]]),
    )

    const { res } = await namedDistrict([roadOnly, empty])

    expect(labels(res)).toEqual({ [roadOnly]: null, [empty]: null })
    // The tract nobody lives in has no point to geocode.
    expect(geocodeCalls(fetchSpy)).toBe(1)
    const rows = await service.prisma.censusTractName.findMany({
      where: { tractGeoid: { in: [roadOnly, empty] } },
    })
    expect(rows.map((row) => row.source)).toEqual(['none', 'none'])
  })

  it('tells apart tracts in one neighborhood by street, then by number', async () => {
    const a = newTract()
    const b = newTract()
    const c = newTract()
    stubPlaces([
      place(a, 35.57, 'HAYWOOD', 'RD'),
      place(b, 35.58, 'STATE', 'ST'),
      place(c, 35.56, 'HAYWOOD', 'RD'),
    ])
    const westAsheville = { suburb: 'West Asheville', city: 'Asheville' }
    stubGeocoder(
      new Map([
        [35.57, westAsheville],
        [35.58, westAsheville],
        [35.56, westAsheville],
      ]),
    )

    const { res } = await namedDistrict([a, b, c])

    expect(labels(res)).toEqual({
      [a]: `West Asheville, around Haywood Rd (Tract ${tractNumber(a)})`,
      [b]: 'West Asheville, around State St',
      [c]: `West Asheville, around Haywood Rd (Tract ${tractNumber(c)})`,
    })
  })

  it('names the district on approval, so the first read has names', async () => {
    const tract = newTract()
    stubPlaces([place(tract, 35.64, 'HAYWOOD', 'RD')])
    stubGeocoder(
      new Map([[35.64, { suburb: 'West Asheville', city: 'Asheville' }]]),
    )
    const slug = await seedOffice()
    stubDistrict([tract])

    const approved = await service.client.post(
      '/v1/contacts/civic-panel/managed',
      {
        inviteMessage: `Hi, it's Mayor Lee.\n\n${CIVIC_PANEL_JOIN_LINE}\n\nReply STOP to opt out.`,
        consentVersion: '2026-10-22',
      },
      { headers: headers(slug), validateStatus: () => true },
    )
    expect(approved.status).toBe(200)
    await naming(1)
    await joinPanel(slug, 20)
    const res = await readPanel(slug)

    expect(labels(res)).toEqual({ [tract]: 'West Asheville' })
    expect(fill).toHaveBeenCalledTimes(1)
  })

  it('geocodes a tract once, ever, after the first read', async () => {
    const tract = newTract()
    stubPlaces([place(tract, 35.6, 'HAYWOOD', 'RD')])
    const fetchSpy = stubGeocoder(
      new Map([[35.6, { quarter: 'Biltmore Village', city: 'Asheville' }]]),
    )
    const slug = await seedOffice()
    stubDistrict([tract])
    await joinPanel(slug, 20)

    const before = await readPanel(slug)
    expect(labels(before)).toEqual({ [tract]: null })
    await naming(1)
    const after = await readPanel(slug)
    await readPanel(slug)

    expect(labels(after)).toEqual({ [tract]: 'Biltmore Village' })
    expect(fill).toHaveBeenCalledTimes(1)
    expect(geocodeCalls(fetchSpy)).toBe(1)
  })
})
