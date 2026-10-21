import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { format, subDays, addDays } from 'date-fns'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type {
  CivicPanelBuildPlanResponse,
  PrepareCivicPanelBuildStepResponse,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { AnalyticsService } from '@/analytics/analytics.service'
import {
  CivicPanelStatus,
  ContactStatusField,
  ContactStatusSource,
  OutreachStatus,
  OutreachType,
} from '@/generated/prisma'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { FeaturesService } from '@/features/services/features.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { VoterDoorKnockingService } from '@/peopleDb/services/voterDoorKnocking.service'
import { StatsService } from '@/peopleDb/services/stats.service'
import {
  CENSUS_COMPOSITION_SOURCE,
  type CensusCompositionSource,
} from '@/priorities/services/censusComposition'
import type { PersonOutput } from '@/contacts/schemas/person.schema'
import {
  ACS_COUNT_KEYS,
  type AcsCountKey,
  type AcsCounts,
  type RespondentCell,
} from '@/peopleDb/databricks/districtCensusSql.util'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

type FilterArg = {
  filters?: {
    filters?: string[]
    filterOperators?: { id?: { operator: string; values: string[] } }
  }
}

const filterKeys = (dto: FilterArg) => dto.filters?.filters ?? []
const notInIds = (dto: FilterArg) =>
  dto.filters?.filterOperators?.id?.operator === 'notIn'
    ? dto.filters.filterOperators.id.values
    : []

const page = (totalResults: number) => ({
  people: [],
  pagination: {
    totalResults,
    currentPage: 1,
    pageSize: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
})

// The pools people-db would count, per channel, keyed by the reach filter
// the step's criteria carry.
const stubPools = (pools: { cell: number; phone: number; door: number }) =>
  vi
    .spyOn(service.app.get(VoterQueryService), 'findPeople')
    .mockClear()
    .mockImplementation(async (dto) => {
      const keys = filterKeys(dto as FilterArg)
      if (keys.includes('hasCellPhone')) return page(pools.cell) as never
      if (keys.includes('hasAnyPhone') || keys.includes('hasLandline')) {
        return page(pools.phone) as never
      }
      return page(pools.door) as never
    })

// Every draw returns fresh people, as many as asked for.
const stubDraws = () =>
  vi
    .spyOn(service.app.get(VoterQueryService), 'samplePeople')
    .mockClear()
    .mockImplementation(async (dto) =>
      Array.from(
        { length: Number(dto.size) },
        () => ({ id: randomUUID() }) as PersonOutput,
      ),
    )

const household = (n: number, lat: number) =>
  Array.from({ length: 2 }, () => ({
    id: randomUUID(),
    firstName: null,
    lastName: null,
    lat,
    lng: -75,
    addressKey: `home-${n}`,
    displayAddress: `${n} Main St`,
  }))

type DoorPoint = ReturnType<typeof household>[number]

// The warehouse's walkable-area pick, over the given people: the first
// `households` doors left once the excluded people are out.
const pickFrom = (
  people: DoorPoint[],
  dto: { households: number; excludePersonIds?: string[] },
) => {
  const excluded = new Set(dto.excludePersonIds ?? [])
  const doors = new Map<
    string,
    { lat: number; lng: number; personIds: string[] }
  >()
  for (const p of people) {
    if (excluded.has(p.id)) continue
    const door = doors.get(p.addressKey)
    if (door) door.personIds.push(p.id)
    else {
      doors.set(p.addressKey, {
        lat: p.lat,
        lng: p.lng,
        personIds: [p.id],
      })
    }
  }
  return [...doors.values()].slice(0, dto.households)
}

// Where the people drawn live, for the area a door step opens on.
const stubAreaPoints = (people: DoorPoint[]) =>
  vi
    .spyOn(service.app.get(VoterDoorKnockingService), 'evaluatePoints')
    .mockClear()
    .mockImplementation(async (dto) => {
      const id = (dto as FilterArg).filters?.filterOperators?.id
      const only = id?.operator === 'in' ? id.values : []
      return {
        people: people.filter((p) => only.includes(p.id)),
        truncated: false,
      }
    })

const stubDoors = (households: number) => {
  const people = Array.from({ length: households }, (_, n) =>
    household(n, 40 + n * 0.0001),
  ).flat()
  stubAreaPoints(people)
  return vi
    .spyOn(service.app.get(VoterDoorKnockingService), 'walkableArea')
    .mockClear()
    .mockImplementation(async (dto) => pickFrom(people, dto))
}

const seedOffice = async (prefix: 'eo' | 'campaign' = 'eo') => {
  const slug = `${prefix}-panel-plan-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id, overrideDistrictId: randomUUID() },
  })
  if (prefix === 'eo') {
    await service.prisma.electedOffice.create({
      data: { organizationSlug: slug, userId: service.user.id },
    })
  }
  return slug
}

const setPanel = (slug: string, personId: string, value: CivicPanelStatus) =>
  service.app.get(ContactStatusService).changeStatus({
    organizationSlug: slug,
    personId,
    field: ContactStatusField.civic_panel,
    toValue: value,
    source: ContactStatusSource.manual,
    actorUserId: service.user.id,
    fallbackFromValue: CivicPanelStatus.left,
  })

const headers = (slug: string) => ({ [ORG_SLUG_HEADER]: slug })

const createPlan = (slug: string, hoursPerWeek: number) =>
  service.client.post<CivicPanelBuildPlanResponse>(
    '/v1/contacts/civic-panel/plan',
    { hoursPerWeek },
    { headers: headers(slug), validateStatus: () => true },
  )

const readPlan = (slug: string) =>
  service.client.get<CivicPanelBuildPlanResponse>(
    '/v1/contacts/civic-panel/plan',
    { headers: headers(slug), validateStatus: () => true },
  )

const prepare = (slug: string, stepId: string) =>
  service.client.post<PrepareCivicPanelBuildStepResponse>(
    `/v1/contacts/civic-panel/plan/steps/${stepId}/prepare`,
    {},
    { headers: headers(slug), validateStatus: () => true },
  )

const stepOf = (
  res: { data: CivicPanelBuildPlanResponse },
  channel: string,
  wave = 1,
) => {
  const step = res.data.plan?.steps.find(
    (s) => s.channel === channel && s.wave === wave,
  )
  if (!step) throw new Error(`no ${channel} step in wave ${wave}`)
  return step
}

const flagOff = () => {
  const flag = vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(false)
  onTestFinished(() => flag.mockRestore())
}

const sendText = (
  slug: string,
  voterFileFilterId: number,
  sendsOn: Date,
  status: OutreachStatus = OutreachStatus.paid,
) =>
  service.prisma.outreach.create({
    data: {
      organizationSlug: slug,
      outreachType: OutreachType.text,
      voterFileFilterId,
      status,
      asksToJoinCivicPanel: true,
      scheduledLocalDate: format(sendsOn, 'yyyy-MM-dd'),
    },
  })

// A district whose smallest major group is 3.125%: 96 answers, a goal of
// 240 members.
const CITY = 96
// One whose smallest major group is a little larger: a goal of 230.
const TOWN = 92

// The answers the district needs, as its cells would read.
const stubAnswersNeeded = (answers: number | null) =>
  vi
    .spyOn(
      service.app.get<CensusCompositionSource>(CENSUS_COMPOSITION_SOURCE),
      'districtAnswersNeeded',
    )
    .mockResolvedValue(answers)

// Members counted by age band and tract beside the district's census, as
// the warehouse would read them. No district row by default: no census to
// compare with.
const stubMix = (cells: RespondentCell[] | null) =>
  vi
    .spyOn(service.app.get(StatsService), 'findWeightingInputs')
    .mockClear()
    .mockResolvedValue({
      district: cells ? DISTRICT_ACS : null,
      cells: cells ?? [],
      tractAdults: TRACT_ADULTS,
    })

const acs = (overrides: Partial<Record<AcsCountKey, number>>): AcsCounts =>
  Object.fromEntries(
    ACS_COUNT_KEYS.map((key) => [key, overrides[key] ?? 0]),
  ) as AcsCounts

// 1,000 adults: 16% in each age band under 65 and 20% at 65 and over, in
// tracts of 50%, 40% and 10%.
const DISTRICT_ACS = acs({
  populationMale18To24: 80,
  populationFemale18To24: 80,
  populationMale25To34: 80,
  populationFemale25To34: 80,
  populationMale35To44: 80,
  populationFemale35To44: 80,
  populationMale45To54: 80,
  populationFemale45To54: 80,
  populationMale55To64: 80,
  populationFemale55To64: 80,
  populationMale65Plus: 100,
  populationFemale65Plus: 100,
})
const TRACT_A = '53017950100'
const TRACT_B = '53017950200'
const TRACT_C = '53017950300'
const TRACT_ADULTS = new Map([
  [TRACT_A, 500],
  [TRACT_B, 400],
  [TRACT_C, 100],
])

const members = (
  count: number,
  overrides: Partial<RespondentCell> = {},
): RespondentCell => ({
  ageBand: '35to44',
  gender: null,
  tenure: null,
  tract: TRACT_A,
  race: null,
  count,
  ...overrides,
})

beforeEach(() => {
  stubAnswersNeeded(CITY)
  stubMix(null)
})

const LARGE = { cell: 58_000, phone: 20_000, door: 60_000 }
// Nobody to call or visit, so every wave is one text.
const TEXT_ONLY = { cell: 58_000, phone: 0, door: 0 }

describe('POST /v1/contacts/civic-panel/plan', () => {
  it('texts the gap at the cold rate when nobody can be called or visited', async () => {
    const slug = await seedOffice()
    stubPools(TEXT_ONLY)
    for (let i = 0; i < 10; i++) {
      await setPanel(slug, randomUUID(), CivicPanelStatus.member)
    }

    const res = await createPlan(slug, 1)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.progress).toEqual({
      members: 10,
      goal: 240,
      answersNeeded: 96,
      expectedAnswers: 4,
      groupsCovered: 0,
      groupsTotal: 0,
    })
    expect(
      res.data.plan?.steps.map(({ channel, targetSize, status }) => ({
        channel,
        targetSize,
        status,
      })),
    ).toEqual([{ channel: 'text', targetSize: 7_667, status: 'not_started' }])
    expect(res.data.next).toMatchObject({
      channel: 'text',
      line: 'Invite residents to your civic panel by text',
    })
  })

  it('sizes calls and doors from a few hours', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)

    const res = await createPlan(slug, 1)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(
      res.data.plan?.steps.map(({ channel, position, targetSize }) => ({
        channel,
        position,
        targetSize,
      })),
    ).toEqual([
      { channel: 'text', position: 1, targetSize: 7_817 },
      { channel: 'phone_banking', position: 1, targetSize: 30 },
      { channel: 'door_knocking', position: 1, targetSize: 40 },
    ])
  })

  it('sizes two walkable areas from many hours, and caps texts at the cell phones', async () => {
    const slug = await seedOffice()
    stubPools({ cell: 900, phone: 20_000, door: 60_000 })

    const res = await createPlan(slug, 10)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(
      res.data.plan?.steps.map(({ channel, targetSize }) => [
        channel,
        targetSize,
      ]),
    ).toEqual([
      ['text', 900],
      ['phone_banking', 450],
      ['door_knocking', 100],
      ['door_knocking', 100],
    ])
  })

  it('skips calls when nobody has a phone to call', async () => {
    const slug = await seedOffice()
    stubPools({ cell: 58_000, phone: 0, door: 60_000 })

    const res = await createPlan(slug, 1)

    expect(res.data.plan?.steps.map((s) => s.channel)).toEqual([
      'text',
      'door_knocking',
    ])
  })

  it('makes a keep-fresh plan once the panel is past its goal, with no member target', async () => {
    stubPools(LARGE)
    stubAnswersNeeded(1)
    const slug = await seedOffice()
    for (let i = 0; i < 3; i++) {
      await setPanel(slug, randomUUID(), CivicPanelStatus.member)
    }

    const created = await createPlan(slug, 1)

    expect(created.status).toBe(HttpStatus.CREATED)
    expect(created.data.plan).toMatchObject({
      status: 'active',
      keepFresh: true,
      goalMembers: 3,
    })
    expect(created.data.progress).toMatchObject({ members: 3, goal: 3 })
    // Nobody short to measure, so only the official's calls and doors.
    expect(created.data.plan?.steps.map((s) => s.channel)).toEqual([
      'phone_banking',
      'door_knocking',
    ])

    const read = await readPlan(slug)
    expect(read.data.plan).toMatchObject({
      status: 'active',
      keepFresh: true,
      goalMembers: 3,
    })
  })

  it('never closes a keep-fresh plan on its members', async () => {
    stubPools(LARGE)
    stubAnswersNeeded(1)
    const slug = await seedOffice()
    for (let i = 0; i < 3; i++) {
      await setPanel(slug, randomUUID(), CivicPanelStatus.member)
    }
    await createPlan(slug, 1)
    for (let i = 0; i < 50; i++) {
      await setPanel(slug, randomUUID(), CivicPanelStatus.member)
    }

    const read = await readPlan(slug)

    expect(read.data.plan).toMatchObject({ status: 'active', keepFresh: true })
    expect(read.data.progress.members).toBe(53)
  })

  it('makes an ordinary plan, not keep-fresh, while the panel is under its goal', async () => {
    stubPools(TEXT_ONLY)
    const slug = await seedOffice()

    const res = await createPlan(slug, 1)

    expect(res.data.plan).toMatchObject({ keepFresh: false, goalMembers: 240 })
  })

  it('keeps one active plan per office', async () => {
    const slug = await seedOffice()
    stubPools(TEXT_ONLY)

    const [first, second] = await Promise.all([
      createPlan(slug, 1),
      createPlan(slug, 1),
    ])

    expect([first.status, second.status].sort()).toEqual([
      HttpStatus.CREATED,
      HttpStatus.CONFLICT,
    ])
    expect(
      await service.prisma.civicPanelBuildPlan.count({
        where: { organizationSlug: slug },
      }),
    ).toBe(1)
  })

  it('400s for no weekly time: a text alone does not build a panel', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)

    expect((await createPlan(slug, 0)).status).toBe(HttpStatus.BAD_REQUEST)
    expect((await createPlan(slug, 21)).status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('400s for an organization that is not an office', async () => {
    const slug = await seedOffice('campaign')

    expect((await createPlan(slug, 1)).status).toBe(HttpStatus.BAD_REQUEST)
    expect((await readPlan(slug)).status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('404s with the civic panel flag off', async () => {
    const slug = await seedOffice()
    flagOff()

    expect((await createPlan(slug, 1)).status).toBe(HttpStatus.NOT_FOUND)
    expect((await readPlan(slug)).status).toBe(HttpStatus.NOT_FOUND)
    expect((await prepare(slug, randomUUID())).status).toBe(
      HttpStatus.NOT_FOUND,
    )
  })
})

describe('GET /v1/contacts/civic-panel/plan', () => {
  it('reads no plan as null with the panel progress', async () => {
    const slug = await seedOffice()

    const res = await readPlan(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({
      plan: null,
      next: null,
      progress: {
        members: 0,
        goal: 240,
        answersNeeded: 96,
        expectedAnswers: 0,
        groupsCovered: 0,
        groupsTotal: 0,
      },
      balance: { status: 'tooFewMembers', inviteMore: null },
    })
  })

  it('sizes the goal to a small town', async () => {
    stubAnswersNeeded(TOWN)
    const slug = await seedOffice()
    for (let i = 0; i < 61; i++) {
      await setPanel(slug, randomUUID(), CivicPanelStatus.member)
    }

    const res = await readPlan(slug)

    expect(res.data.progress).toEqual({
      members: 61,
      goal: 230,
      answersNeeded: 92,
      expectedAnswers: 24,
      groupsCovered: 0,
      groupsTotal: 0,
    })
  })

  it('sizes the goal for the smallest major group when the district cannot be read', async () => {
    stubAnswersNeeded(null)
    const slug = await seedOffice()

    const res = await readPlan(slug)

    expect(res.data.progress).toMatchObject({ goal: 250, answersNeeded: 100 })
  })

  it('sizes the goal without the warehouse as 100 answers', async () => {
    stubAnswersNeeded(CITY).mockRestore()
    vi.spyOn(
      service.app.get(StatsService),
      'findDistrictCells',
    ).mockRejectedValue(new Error('warehouse down'))
    const slug = await seedOffice()

    const res = await readPlan(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.progress).toMatchObject({ goal: 250, answersNeeded: 100 })
  })

  it('brings a plan made toward 100 members up to the district goal', async () => {
    stubPools(TEXT_ONLY)
    const slug = await seedOffice()
    const office = await service.prisma.electedOffice.findUniqueOrThrow({
      where: { organizationSlug: slug },
    })
    const legacy = await service.prisma.civicPanelBuildPlan.create({
      data: {
        electedOfficeId: office.id,
        organizationSlug: slug,
        goalMembers: 100,
        hoursPerWeek: 1,
        steps: { create: { wave: 1, channel: 'text', targetSize: 3_334 } },
      },
    })

    const res = await readPlan(slug)

    expect(res.data.plan).toMatchObject({ status: 'active', goalMembers: 240 })
    expect(res.data.progress).toMatchObject({ goal: 240, answersNeeded: 96 })
    const stored = await service.prisma.civicPanelBuildPlan.findUniqueOrThrow({
      where: { id: legacy.id },
    })
    expect(stored.goalMembers).toBe(240)
  })

  it('lowers a goal to the district, never below the members it has', async () => {
    stubPools(TEXT_ONLY)
    stubAnswersNeeded(TOWN)
    const slug = await seedOffice()
    const office = await service.prisma.electedOffice.findUniqueOrThrow({
      where: { organizationSlug: slug },
    })
    await service.prisma.civicPanelBuildPlan.create({
      data: {
        electedOfficeId: office.id,
        organizationSlug: slug,
        goalMembers: 240,
        hoursPerWeek: 1,
        steps: { create: { wave: 1, channel: 'text', targetSize: 3_334 } },
      },
    })

    const lowered = await readPlan(slug)

    expect(lowered.data.plan?.goalMembers).toBe(230)
    expect(lowered.data.plan?.status).toBe('active')
  })
})

describe('POST /v1/contacts/civic-panel/plan/steps/:id/prepare', () => {
  it('draws a text step away from members, leavers, the invited, opt-outs and the recently reached', async () => {
    const slug = await seedOffice()
    stubPools(TEXT_ONLY)
    const member = randomUUID()
    const left = randomUUID()
    const invited = randomUUID()
    const optedOut = randomUUID()
    const reached = randomUUID()
    await setPanel(slug, member, CivicPanelStatus.member)
    await setPanel(slug, left, CivicPanelStatus.member)
    await setPanel(slug, left, CivicPanelStatus.left)
    const ask = await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        outreachType: OutreachType.text,
        status: OutreachStatus.completed,
        asksToJoinCivicPanel: true,
      },
    })
    await service.prisma.outreachTextRecipient.create({
      data: {
        outreachId: ask.id,
        organizationSlug: slug,
        personId: invited,
        phone: '+15550000001',
      },
    })
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: slug,
        personId: optedOut,
        occurredAt: subDays(new Date(), 90),
        optedOutAt: subDays(new Date(), 90),
        manual: true,
      },
    })
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: slug,
        personId: reached,
        occurredAt: subDays(new Date(), 5),
        manual: true,
      },
    })
    const plan = await createPlan(slug, 1)
    const draw = stubDraws()

    const res = await prepare(slug, stepOf(plan, 'text').id)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toMatchObject({
      channel: 'text',
      purpose: 'build_citizens_panel',
      // One member already: the gap is 239.
      size: 7_967,
      area: null,
    })
    const [request] = draw.mock.calls[0] ?? []
    expect(filterKeys(request as FilterArg)).toContain('hasCellPhone')
    expect(notInIds(request as FilterArg)).toEqual(
      expect.arrayContaining([member, left, invited, optedOut, reached]),
    )
    const list = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: res.data.voterFileFilterId },
    })
    expect(list).toMatchObject({
      organizationSlug: slug,
      hasCellPhone: true,
      civicPanelNeverInvited: true,
      notContactedRecently: true,
      sampleSize: 7_967,
      // The send keeps it; the lists index leaves it out.
      civicPanelInvite: true,
    })
  })

  it('returns the same list when pressed again', async () => {
    const slug = await seedOffice()
    stubPools(TEXT_ONLY)
    const plan = await createPlan(slug, 1)
    const draw = stubDraws()
    const stepId = stepOf(plan, 'text').id

    const first = await prepare(slug, stepId)
    const second = await prepare(slug, stepId)

    expect(second.data.voterFileFilterId).toBe(first.data.voterFileFilterId)
    expect(draw).toHaveBeenCalledTimes(1)
  })

  it('never draws one person twice across channels', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    const plan = await createPlan(slug, 1)
    const draw = stubDraws()
    const doorDraw = stubDoors(60)

    const text = await prepare(slug, stepOf(plan, 'text').id)
    const calls = await prepare(slug, stepOf(plan, 'phone_banking').id)
    const doors = await prepare(slug, stepOf(plan, 'door_knocking').id)

    expect(calls.data).toMatchObject({
      channel: 'phone_banking',
      purpose: 'build_citizens_panel',
      size: 30,
    })
    // Landlines first, so the first call draw asks for landlines.
    const callDraw = draw.mock.calls[1]?.[0] as FilterArg
    expect(filterKeys(callDraw)).toContain('hasLandline')
    expect(stepOf(await readPlan(slug), 'phone_banking').landlineFirst).toBe(
      true,
    )
    const textIds = await sampleIds(text.data.voterFileFilterId)
    expect(notInIds(callDraw)).toEqual(expect.arrayContaining(textIds))
    expect(doors.data).toMatchObject({
      channel: 'door_knocking',
      purpose: 'build_citizens_panel',
    })
    expect(doors.data.size).toBe(80)
    expect(doors.data.area?.type).toBe('Polygon')
    // The warehouse picks the step's doors over the whole district, leaving
    // out everyone the earlier steps drew.
    const doorDto = doorDraw.mock.calls[0]?.[0]
    expect(doorDto?.households).toBe(40)
    expect(doorDto?.excludePersonIds).toEqual(expect.arrayContaining(textIds))
    const all = [
      ...textIds,
      ...(await sampleIds(calls.data.voterFileFilterId)),
      ...(await sampleIds(doors.data.voterFileFilterId)),
    ]
    expect(new Set(all).size).toBe(all.length)
  })

  it('404s for another office’s step', async () => {
    stubPools(LARGE)
    const otherUser = await service.prisma.user.create({
      data: { email: `panel-plan-${randomUUID()}@example.com` },
    })
    const theirs = `eo-panel-plan-${randomUUID()}`
    await service.prisma.organization.create({
      data: { slug: theirs, ownerId: otherUser.id },
    })
    const theirOffice = await service.prisma.electedOffice.create({
      data: { organizationSlug: theirs, userId: otherUser.id },
    })
    const theirPlan = await service.prisma.civicPanelBuildPlan.create({
      data: {
        electedOfficeId: theirOffice.id,
        organizationSlug: theirs,
        goalMembers: 100,
        hoursPerWeek: 1,
        steps: {
          create: { wave: 1, channel: 'text', targetSize: 3_334 },
        },
      },
      include: { steps: true },
    })
    const mine = await seedOffice()

    const res = await prepare(mine, theirPlan.steps[0]?.id ?? '')

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

const sampleIds = (voterFileFilterId: number) =>
  service.prisma.voterFileFilterSampleMember
    .findMany({ where: { voterFileFilterId }, select: { personId: true } })
    .then((rows) => rows.map((r) => r.personId))

const joinPanel = async (slug: string, count: number) => {
  for (let i = 0; i < count; i++) {
    await setPanel(slug, randomUUID(), CivicPanelStatus.member)
  }
}

describe('steering the plan by census', () => {
  it('has too few members under 30, and leans nowhere', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    stubMix([members(29)])
    await joinPanel(slug, 29)

    const res = await createPlan(slug, 1)

    expect(res.data.balance).toEqual({
      status: 'tooFewMembers',
      inviteMore: null,
    })
    expect(res.data.plan?.steps.map((step) => step.steeredToward)).toEqual([
      null,
      null,
      null,
    ])
  })

  it('reads no comparison when the census cannot be read', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    await joinPanel(slug, 30)

    const res = await createPlan(slug, 1)

    expect(res.data.balance).toBeNull()
    expect(res.data.next?.line).toBe(
      'Invite residents to your civic panel by text',
    )
  })

  it('names who to invite next and leans each step toward them', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    // Every member 18 to 64 and in tract A: B and C, and people 65 and
    // over, are behind.
    stubMix([members(40)])
    await joinPanel(slug, 40)

    const res = await createPlan(slug, 1)

    expect(res.data.balance).toEqual({
      status: 'missingGroups',
      inviteMore: 'unreachedAreas',
    })
    expect(
      res.data.plan?.steps.map(({ channel, steeredToward }) => ({
        channel,
        steeredToward,
      })),
    ).toEqual([
      { channel: 'text', steeredToward: 'unreachedAreas' },
      // Too few people 65 and over yet: landlines first, unweighted.
      { channel: 'phone_banking', steeredToward: null },
      { channel: 'door_knocking', steeredToward: 'unreachedAreas' },
    ])
    expect(stepOf(res, 'phone_banking').landlineFirst).toBe(true)
    expect(stepOf(res, 'text').landlineFirst).toBeNull()
  })

  it('draws the text weighted toward the groups the panel trails', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    stubMix([members(40)])
    await joinPanel(slug, 40)
    const plan = await createPlan(slug, 1)
    const draw = stubDraws()

    const res = await prepare(slug, stepOf(plan, 'text').id)

    expect(res.status).toBe(HttpStatus.OK)
    const weights = draw.mock.calls[0]?.[0].weights
    expect(weights).toMatchObject({
      age: {
        '18to24': 2,
        '25to34': 2,
        '35to44': 0.5,
        '45to54': 2,
        '55to64': 2,
        '65plus': 2,
      },
      minWeight: 0.5,
      maxWeight: 2,
    })
    expect(weights?.tract[TRACT_A]).toBe(0.5)
    expect(weights?.tract[TRACT_B]).toBe(2)
    const read = await readPlan(slug)
    expect(stepOf(read, 'text').steeredToward).toBe('unreachedAreas')
  })

  it('drops landline-first once the panel holds its share of people 65 and over', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    stubMix([
      members(20, { ageBand: '65plus', tract: TRACT_A }),
      members(16, { tract: TRACT_A }),
      members(4, { tract: TRACT_C }),
    ])
    await joinPanel(slug, 40)
    const plan = await createPlan(slug, 1)
    const draw = stubDraws()

    await prepare(slug, stepOf(plan, 'phone_banking').id)

    expect(draw).toHaveBeenCalledTimes(1)
    const callDraw = draw.mock.calls[0]?.[0]
    expect(filterKeys(callDraw as FilterArg)).not.toContain('hasLandline')
    expect(filterKeys(callDraw as FilterArg)).toContain('hasAnyPhone')
    // Half the panel is 65 and over against a fifth of adults.
    expect(callDraw?.weights?.age['65plus']).toBe(0.5)
    const read = stepOf(await readPlan(slug), 'phone_banking')
    expect(read.landlineFirst).toBe(false)
    expect(read.steeredToward).toBe('unreachedAreas')
  })

  it('records a call step that dropped landline-first and leans toward the group the status names', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    // 65 and over at 22.5% against 20%, tracts at the census's 50/40/10:
    // landlines are dropped, and the step leans toward the same group the
    // balance asks to invite next.
    stubMix([
      members(9, { ageBand: '65plus', tract: TRACT_A }),
      members(11, { tract: TRACT_A }),
      members(16, { tract: TRACT_B }),
      members(4, { tract: TRACT_C }),
    ])
    await joinPanel(slug, 40)
    const plan = await createPlan(slug, 1)
    expect(stepOf(plan, 'phone_banking')).toMatchObject({
      landlineFirst: false,
      steeredToward: 'age18to24',
    })
    const draw = stubDraws()

    await prepare(slug, stepOf(plan, 'phone_banking').id)

    expect(draw).toHaveBeenCalledTimes(1)
    expect(filterKeys(draw.mock.calls[0]?.[0] as FilterArg)).not.toContain(
      'hasLandline',
    )
    expect(stepOf(await readPlan(slug), 'phone_banking')).toMatchObject({
      landlineFirst: false,
      steeredToward: 'age18to24',
    })
  })

  it('walks the tract the panel has reached least, or district-wide when it is too small', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    stubMix([members(40)])
    await joinPanel(slug, 40)
    const plan = await createPlan(slug, 1)
    const everyone = Array.from({ length: 60 }, (_, n) =>
      household(n, 40 + n * 0.0001),
    ).flat()
    stubAreaPoints(everyone)
    const inTract = (households: number) =>
      vi
        .spyOn(service.app.get(VoterDoorKnockingService), 'walkableArea')
        .mockClear()
        .mockImplementation(async (dto) =>
          pickFrom(
            dto.tract
              ? everyone.slice(0, households * 2)
              : everyone.slice(households * 2),
            dto,
          ),
        )
    const draws = (spy: ReturnType<typeof inTract>) =>
      spy.mock.calls.map(([dto]) => dto)

    const doors = inTract(45)
    const steered = await prepare(slug, stepOf(plan, 'door_knocking').id)
    expect(draws(doors).map((dto) => dto.tract)).toEqual([TRACT_B])
    expect(steered.data.size).toBe(80)
    expect(stepOf(await readPlan(slug), 'door_knocking').steeredToward).toBe(
      'unreachedAreas',
    )

    const other = await seedOffice()
    stubPools(LARGE)
    await joinPanel(other, 40)
    const otherPlan = await createPlan(other, 1)
    const fallback = inTract(10)
    await prepare(other, stepOf(otherPlan, 'door_knocking').id)
    expect(draws(fallback).map((dto) => dto.tract)).toEqual([
      TRACT_B,
      undefined,
    ])
    const read = await readPlan(other)
    expect(stepOf(read, 'door_knocking').steeredToward).toBeNull()
    expect(read.data.next?.line).toBe(
      'Invite residents to your civic panel by text',
    )
  })
})

// A panel past its goal is judged on its active members: those who answered
// a priority's text in the last 90 days. The first YOUNG members are 18 to
// 24, the rest 35 to 44, all in tract A.
const YOUNG = 15

const seedPanelPast = async (slug: string, count: number) => {
  const ids: string[] = Array.from({ length: count }, () => randomUUID())
  for (const id of ids) await setPanel(slug, id, CivicPanelStatus.member)
  vi.spyOn(service.app.get(StatsService), 'findWeightingInputs')
    .mockClear()
    .mockImplementation(async (_districtId, _dataset, personIds) => {
      const young = personIds.filter((id) => ids.indexOf(id) < YOUNG).length
      return {
        district: DISTRICT_ACS,
        cells: [
          members(young, { ageBand: '18to24' }),
          members(personIds.length - young),
        ],
        tractAdults: TRACT_ADULTS,
      }
    })
  return ids
}

const answerText = async (slug: string, personIds: string[], sentAt: Date) => {
  const office = await service.prisma.electedOffice.findUniqueOrThrow({
    where: { organizationSlug: slug },
  })
  const priority = await service.prisma.priority.create({
    data: {
      electedOfficeId: office.id,
      title: 'Streets',
      description: 'Streets',
      source: 'user_stated',
    },
  })
  const outreach = await service.prisma.outreach.create({
    data: {
      organizationSlug: slug,
      outreachType: OutreachType.text,
      status: OutreachStatus.completed,
      priorityId: priority.id,
    },
  })
  for (const personId of personIds) {
    await service.prisma.pollIndividualMessage.create({
      data: {
        id: randomUUID(),
        personId,
        sentAt,
        sender: 'CONSTITUENT',
        isOptOut: false,
        content: 'Fix the potholes',
        outreachId: outreach.id,
        electedOfficeId: office.id,
      },
    })
  }
}

describe('keeping the panel fresh by active members', () => {
  it('judges the panel on members only before its goal', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    stubAnswersNeeded(CITY)
    await seedPanelPast(slug, 30)

    const res = await readPlan(slug)

    expect(res.data.balance?.status).toBe('missingGroups')
    expect(res.data.balance?.groupsNeedingFresh).toBeUndefined()
  })

  it('counts the groups short of active members past the goal', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    stubAnswersNeeded(12)
    const ids = await seedPanelPast(slug, 30)
    // 10 of the 35 to 44s answered lately, and 5 of the 18 to 24s only long
    // ago.
    await answerText(slug, ids.slice(YOUNG, YOUNG + 10), subDays(new Date(), 5))
    await answerText(slug, ids.slice(0, 5), subDays(new Date(), 120))

    const res = await readPlan(slug)

    // Members cover 18 to 24, 35 to 44 and tract A (3 of 9 groups); the
    // active members cover 35 to 44 and tract A (2 of 9).
    expect(res.data.progress).toMatchObject({
      members: 30,
      groupsCovered: 3,
      groupsTotal: 9,
    })
    expect(res.data.balance).toMatchObject({
      status: 'missingGroups',
      groupsNeedingFresh: 7,
    })
    expect(res.data.balance?.inviteMore).not.toBeNull()
  })

  it('leaves out answers from people who are not on the panel', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    stubAnswersNeeded(12)
    const ids = await seedPanelPast(slug, 30)
    await answerText(slug, [randomUUID(), randomUUID()], new Date())
    const before = await readPlan(slug)
    expect(before.data.balance?.groupsNeedingFresh).toBe(9)

    await answerText(slug, ids.slice(0, 8), new Date())
    const after = await readPlan(slug)

    // Eight 18 to 24s in tract A cover those two groups.
    expect(after.data.balance?.groupsNeedingFresh).toBe(7)
  })

  it('leans a keep-fresh plan toward the groups short of active members', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    stubAnswersNeeded(12)
    const ids = await seedPanelPast(slug, 30)
    await answerText(slug, ids.slice(YOUNG), new Date())

    const created = await createPlan(slug, 1)

    expect(created.data.plan?.keepFresh).toBe(true)
    // Active members are short in some groups, so the text is sized to them
    // as well as the calls and doors.
    expect(created.data.plan?.steps.map((s) => s.channel)).toEqual([
      'text',
      'phone_banking',
      'door_knocking',
    ])
    expect(stepOf(created, 'text').steeredToward).toBe('unreachedAreas')
  })
})

describe('step status and waves', () => {
  it('reads a text from scheduled to waiting on replies to done', async () => {
    const slug = await seedOffice()
    stubPools(TEXT_ONLY)
    stubDraws()
    const plan = await createPlan(slug, 1)
    const stepId = stepOf(plan, 'text').id
    const { data: list } = await prepare(slug, stepId)
    const send = await sendText(
      slug,
      list.voterFileFilterId,
      addDays(new Date(), 10),
    )

    const scheduled = await readPlan(slug)
    expect(stepOf(scheduled, 'text')).toMatchObject({
      status: 'in_progress',
      outreachId: send.id,
    })
    expect(scheduled.data.next?.line).toMatch(
      /^Your civic panel invite goes out /,
    )

    await service.prisma.outreach.update({
      where: { id: send.id },
      data: { scheduledLocalDate: format(new Date(), 'yyyy-MM-dd') },
    })
    const waiting = await readPlan(slug)
    expect(stepOf(waiting, 'text').status).toBe('waiting_on_replies')
    expect(waiting.data.next).toMatchObject({ href: null, stepId })
    expect(waiting.data.next?.line).toMatch(
      /^Replies to your civic panel invite should be in by /,
    )

    await service.prisma.outreach.update({
      where: { id: send.id },
      data: { status: OutreachStatus.completed },
    })
    const done = await readPlan(slug)
    expect(stepOf(done, 'text').status).toBe('done')
  })

  it('ignores a text that never got past checkout', async () => {
    const slug = await seedOffice()
    stubPools(TEXT_ONLY)
    stubDraws()
    const plan = await createPlan(slug, 1)
    const { data: list } = await prepare(slug, stepOf(plan, 'text').id)
    await sendText(
      slug,
      list.voterFileFilterId,
      new Date(),
      OutreachStatus.pending_payment,
    )

    const res = await readPlan(slug)

    expect(stepOf(res, 'text').status).toBe('not_started')
  })

  it('reads calls as done once everyone on the list was called', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    stubDraws()
    stubDoors(60)
    const plan = await createPlan(slug, 1)
    const { data: list } = await prepare(slug, stepOf(plan, 'phone_banking').id)
    const calls = await service.prisma.phoneBankingList.create({
      data: {
        organizationSlug: slug,
        voterFileFilterId: list.voterFileFilterId,
        name: 'Civic panel calls',
        script: 'Hello',
        sheetCount: 1,
        purpose: 'build_citizens_panel',
      },
    })

    expect(stepOf(await readPlan(slug), 'phone_banking')).toMatchObject({
      status: 'in_progress',
      phoneBankingListId: calls.id,
    })

    await service.prisma.contactInteractionPhoneBanking.createMany({
      data: (await sampleIds(list.voterFileFilterId)).map((personId) => ({
        organizationSlug: slug,
        personId,
        phoneBankingListId: calls.id,
        occurredAt: new Date(),
        outcome: 'no_answer' as const,
      })),
    })

    const [joiner] = await sampleIds(list.voterFileFilterId)
    if (!joiner) throw new Error('no one drawn')
    await setPanel(slug, joiner, CivicPanelStatus.member)

    expect(stepOf(await readPlan(slug), 'phone_banking')).toMatchObject({
      status: 'done',
      reached: 30,
      joined: 1,
      markedDone: null,
    })
  })

  it('reads doors as done once the walk is marked done', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    stubDraws()
    stubDoors(60)
    const plan = await createPlan(slug, 1)
    const { data: list } = await prepare(slug, stepOf(plan, 'door_knocking').id)
    if (!list.area) throw new Error('a door step draws an area')
    const turf = await service.prisma.doorKnockingTurf.create({
      data: {
        voterFileFilterId: list.voterFileFilterId,
        name: 'Civic panel doors',
        color: '#000000',
        geoPoly: list.area,
      },
    })
    const envelope = await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        outreachType: OutreachType.nativeDoorKnocking,
        doorKnockingTurfId: turf.id,
        status: OutreachStatus.in_progress,
      },
    })

    expect(stepOf(await readPlan(slug), 'door_knocking')).toMatchObject({
      status: 'in_progress',
      doorKnockingTurfId: turf.id,
      outreachId: envelope.id,
    })

    await service.prisma.outreach.update({
      where: { id: envelope.id },
      data: { status: OutreachStatus.completed },
    })

    expect(stepOf(await readPlan(slug), 'door_knocking').status).toBe('done')
  })

  it('makes the next wave once the last is done, once, sized to the gap', async () => {
    const slug = await seedOffice()
    stubPools(TEXT_ONLY)
    const draw = stubDraws()
    const plan = await createPlan(slug, 1)
    const { data: list } = await prepare(slug, stepOf(plan, 'text').id)
    await sendText(
      slug,
      list.voterFileFilterId,
      subDays(new Date(), 20),
      OutreachStatus.completed,
    )
    for (let i = 0; i < 40; i++) {
      await setPanel(slug, randomUUID(), CivicPanelStatus.member)
    }

    const [a, b] = await Promise.all([readPlan(slug), readPlan(slug)])
    const again = await readPlan(slug)

    for (const res of [a, b, again]) expect(res.status).toBe(HttpStatus.OK)
    expect(again.data.plan?.currentWave).toBe(2)
    expect(
      again.data.plan?.steps.map(({ wave, channel, targetSize, status }) => ({
        wave,
        channel,
        targetSize,
        status,
      })),
    ).toEqual([
      { wave: 1, channel: 'text', targetSize: 8_000, status: 'done' },
      { wave: 2, channel: 'text', targetSize: 6_667, status: 'not_started' },
    ])

    const second = await prepare(slug, stepOf(again, 'text', 2).id)
    const wave1 = await sampleIds(list.voterFileFilterId)
    const wave2Draw = draw.mock.calls.at(-1)?.[0] as FilterArg
    expect(notInIds(wave2Draw)).toEqual(expect.arrayContaining(wave1))
    expect(second.data.size).toBe(6_667)
  })

  it('closes the plan once the panel reaches its goal', async () => {
    stubAnswersNeeded(TOWN)
    const slug = await seedOffice()
    stubPools(TEXT_ONLY)
    await createPlan(slug, 1)
    for (let i = 0; i < 230; i++) {
      await setPanel(slug, randomUUID(), CivicPanelStatus.member)
    }

    const res = await readPlan(slug)

    expect(res.data.plan?.status).toBe('completed')
    expect(res.data.next).toBeNull()
    expect(res.data.progress).toEqual({
      members: 230,
      goal: 230,
      answersNeeded: 92,
      expectedAnswers: 92,
      groupsCovered: 0,
      groupsTotal: 0,
    })
  })

  it('closes a plan whose district goal came down past its members', async () => {
    stubPools(TEXT_ONLY)
    const slug = await seedOffice()
    await createPlan(slug, 1)
    for (let i = 0; i < 235; i++) {
      await setPanel(slug, randomUUID(), CivicPanelStatus.member)
    }
    stubAnswersNeeded(TOWN)

    const res = await readPlan(slug)

    expect(res.data.plan).toMatchObject({
      status: 'completed',
      goalMembers: 235,
    })
  })
})

const changeHours = (slug: string, hoursPerWeek: number) =>
  service.client.patch<CivicPanelBuildPlanResponse>(
    '/v1/contacts/civic-panel/plan',
    { hoursPerWeek },
    { headers: headers(slug), validateStatus: () => true },
  )

const skip = (slug: string, stepId: string) =>
  service.client.post<CivicPanelBuildPlanResponse>(
    `/v1/contacts/civic-panel/plan/steps/${stepId}/skip`,
    {},
    { headers: headers(slug), validateStatus: () => true },
  )

const mark = (slug: string, stepId: string, done: boolean) =>
  service.client.post<CivicPanelBuildPlanResponse>(
    `/v1/contacts/civic-panel/plan/steps/${stepId}/mark`,
    { done },
    { headers: headers(slug), validateStatus: () => true },
  )

describe('POST /v1/contacts/civic-panel/plan/steps/:id/mark', () => {
  it('ticks a call step done by hand, and unticks it', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    const plan = await createPlan(slug, 1)
    const calls = stepOf(plan, 'phone_banking')

    const ticked = await mark(slug, calls.id, true)

    expect(ticked.status).toBe(HttpStatus.OK)
    expect(stepOf(ticked, 'phone_banking')).toMatchObject({
      status: 'done',
      markedDone: true,
    })

    const unticked = await mark(slug, calls.id, false)

    expect(stepOf(unticked, 'phone_banking')).toMatchObject({
      status: 'not_started',
      markedDone: false,
    })
  })

  it('409s for a step that was skipped', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    const plan = await createPlan(slug, 1)
    const calls = stepOf(plan, 'phone_banking')
    await skip(slug, calls.id)

    const res = await mark(slug, calls.id, true)

    expect(res.status).toBe(HttpStatus.CONFLICT)
  })

  it('400s for a text, which is done once it is sent', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    const plan = await createPlan(slug, 1)

    const res = await mark(slug, stepOf(plan, 'text').id, true)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('404s for another office’s step', async () => {
    const theirs = await seedOffice()
    stubPools(LARGE)
    const plan = await createPlan(theirs, 1)
    const mine = await seedOffice()

    const res = await mark(mine, stepOf(plan, 'phone_banking').id, true)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('PATCH /v1/contacts/civic-panel/plan', () => {
  it('keeps the current wave and sizes the next one from the new hours', async () => {
    const slug = await seedOffice()
    stubPools(TEXT_ONLY)
    stubDraws()
    stubDoors(300)
    const plan = await createPlan(slug, 1)

    stubPools(LARGE)
    const changed = await changeHours(slug, 2)

    expect(changed.status).toBe(HttpStatus.OK)
    expect(changed.data.plan?.hoursPerWeek).toBe(2)
    expect(changed.data.plan?.steps).toEqual(plan.data.plan?.steps)

    const { data: list } = await prepare(slug, stepOf(plan, 'text').id)
    await sendText(
      slug,
      list.voterFileFilterId,
      subDays(new Date(), 20),
      OutreachStatus.completed,
    )
    const next = await readPlan(slug)
    expect(next.data.plan?.currentWave).toBe(2)
    expect(
      next.data.plan?.steps.filter((s) => s.wave === 2).map((s) => s.channel),
    ).toEqual(['text', 'phone_banking', 'door_knocking'])
  })

  it('404s when the office has no plan', async () => {
    const slug = await seedOffice()

    const res = await changeHours(slug, 4)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('400s for hours out of range', async () => {
    const slug = await seedOffice()
    stubPools(TEXT_ONLY)
    await createPlan(slug, 1)

    expect((await changeHours(slug, 0)).status).toBe(HttpStatus.BAD_REQUEST)
    expect((await changeHours(slug, 50)).status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('404s with the civic panel flag off', async () => {
    const slug = await seedOffice()
    flagOff()

    const res = await changeHours(slug, 4)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('POST /v1/contacts/civic-panel/plan/steps/:id/skip', () => {
  it('skips a step nobody started, and next moves past it', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    stubDoors(60)
    const plan = await createPlan(slug, 1)
    const textId = stepOf(plan, 'text').id

    const res = await skip(slug, textId)

    expect(res.status).toBe(HttpStatus.OK)
    expect(stepOf(res, 'text').status).toBe('skipped')
    expect(res.data.next).toMatchObject({
      channel: 'phone_banking',
      status: 'not_started',
    })
    const again = await skip(slug, textId)
    expect(again.status).toBe(HttpStatus.OK)
  })

  it('409s for a step already started', async () => {
    const slug = await seedOffice()
    stubPools(TEXT_ONLY)
    stubDraws()
    const plan = await createPlan(slug, 1)
    const stepId = stepOf(plan, 'text').id
    const { data: list } = await prepare(slug, stepId)
    await sendText(slug, list.voterFileFilterId, addDays(new Date(), 10))
    await readPlan(slug)

    const res = await skip(slug, stepId)

    expect(res.status).toBe(HttpStatus.CONFLICT)
  })

  it('gives a prepared, skipped step’s people back to later draws', async () => {
    const slug = await seedOffice()
    stubPools(TEXT_ONLY)
    const draw = stubDraws()
    const plan = await createPlan(slug, 1)
    const { data: list } = await prepare(slug, stepOf(plan, 'text').id)
    const skippedPeople = await sampleIds(list.voterFileFilterId)

    await skip(slug, stepOf(plan, 'text').id)
    const next = await readPlan(slug)
    await prepare(slug, stepOf(next, 'text', 2).id)

    const wave2Draw = draw.mock.calls.at(-1)?.[0] as FilterArg
    expect(notInIds(wave2Draw)).not.toEqual(
      expect.arrayContaining(skippedPeople.slice(0, 1)),
    )
    // Nor can the skipped step hand its old list out again.
    expect((await prepare(slug, stepOf(plan, 'text').id)).status).toBe(
      HttpStatus.CONFLICT,
    )
  })

  it('makes the next wave once every step was skipped', async () => {
    const slug = await seedOffice()
    stubPools(TEXT_ONLY)
    const plan = await createPlan(slug, 1)

    await skip(slug, stepOf(plan, 'text').id)
    const res = await readPlan(slug)

    expect(res.data.plan?.currentWave).toBe(2)
    expect(stepOf(res, 'text', 1).status).toBe('skipped')
    expect(stepOf(res, 'text', 2).status).toBe('not_started')
    // The new wave waits on its own steps: reading again makes no third.
    expect((await readPlan(slug)).data.plan?.currentWave).toBe(2)
  })

  it('404s for another office’s step', async () => {
    const theirs = await seedOffice()
    stubPools(TEXT_ONLY)
    const plan = await createPlan(theirs, 1)
    const mine = await seedOffice()

    const res = await skip(mine, stepOf(plan, 'text').id)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('civic panel analytics', () => {
  const spyTrack = () => {
    const track = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue(undefined as never)
    onTestFinished(() => track.mockRestore())
    return track
  }

  it('tracks the plan made, its hours changed, a skip and a step ticked done', async () => {
    const track = spyTrack()
    const slug = await seedOffice()
    stubPools(LARGE)

    const plan = await createPlan(slug, 1)
    await changeHours(slug, 1)
    await changeHours(slug, 3)
    await skip(slug, stepOf(plan, 'text').id)
    await skip(slug, stepOf(plan, 'text').id)
    await mark(slug, stepOf(plan, 'phone_banking').id, true)
    await mark(slug, stepOf(plan, 'phone_banking').id, true)

    const calls = (event: string) =>
      track.mock.calls.filter(([, name]) => name === event)
    expect(calls('Civic Panel - Plan Created')).toEqual([
      [
        service.user.id,
        'Civic Panel - Plan Created',
        {
          organizationSlug: slug,
          planId: plan.data.plan?.id,
          hoursPerWeek: 1,
          goalMembers: 240,
          membersAtStart: 0,
          stepCount: 3,
          textSteps: 1,
          callSteps: 1,
          doorSteps: 1,
          surface: 'panel_page',
        },
      ],
    ])
    // Saving the same hours changes nothing, so only the move to 3 counts.
    expect(calls('Civic Panel - Plan Updated')).toEqual([
      [
        service.user.id,
        'Civic Panel - Plan Updated',
        {
          organizationSlug: slug,
          planId: plan.data.plan?.id,
          fromHours: 1,
          toHours: 3,
          surface: 'panel_page',
        },
      ],
    ])
    expect(calls('Civic Panel - Step Skipped')).toEqual([
      [
        service.user.id,
        'Civic Panel - Step Skipped',
        {
          organizationSlug: slug,
          stepId: stepOf(plan, 'text').id,
          channel: 'text',
          wave: 1,
        },
      ],
    ])
    expect(calls('Civic Panel - Step Completed')).toEqual([
      [
        service.user.id,
        'Civic Panel - Step Completed',
        {
          organizationSlug: slug,
          stepId: stepOf(plan, 'phone_banking').id,
          channel: 'phone_banking',
          wave: 1,
          how: 'marked',
        },
      ],
    ])
  })

  it('reports a ticked step done once, even when its walk finishes after', async () => {
    const slug = await seedOffice()
    stubPools(LARGE)
    stubDraws()
    stubDoors(60)
    const plan = await createPlan(slug, 1)
    const doors = stepOf(plan, 'door_knocking')
    const { data: list } = await prepare(slug, doors.id)
    if (!list.area) throw new Error('a door step draws an area')
    const turf = await service.prisma.doorKnockingTurf.create({
      data: {
        voterFileFilterId: list.voterFileFilterId,
        name: 'Civic panel doors',
        color: '#000000',
        geoPoly: list.area,
      },
    })
    const envelope = await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        outreachType: OutreachType.nativeDoorKnocking,
        doorKnockingTurfId: turf.id,
        status: OutreachStatus.in_progress,
      },
    })
    await readPlan(slug)
    const track = spyTrack()

    await mark(slug, doors.id, true)
    await service.prisma.outreach.update({
      where: { id: envelope.id },
      data: { status: OutreachStatus.completed },
    })
    await readPlan(slug)

    const completed = track.mock.calls.filter(
      ([, name]) => name === 'Civic Panel - Step Completed',
    )
    expect(completed).toEqual([
      [
        service.user.id,
        'Civic Panel - Step Completed',
        {
          organizationSlug: slug,
          stepId: doors.id,
          channel: 'door_knocking',
          wave: 1,
          how: 'marked',
        },
      ],
    ])
  })

  it('tracks a member joining and the goal reached, never who joined', async () => {
    stubAnswersNeeded(TOWN)
    const slug = await seedOffice()
    stubPools(TEXT_ONLY)
    await createPlan(slug, 1)
    const track = spyTrack()
    for (let i = 0; i < 230; i++) {
      await setPanel(slug, randomUUID(), CivicPanelStatus.member)
    }

    await readPlan(slug)
    await readPlan(slug)

    const joined = track.mock.calls.filter(
      ([, name]) => name === 'Civic Panel - Membership Changed',
    )
    expect(joined).toHaveLength(230)
    expect(joined[0]).toEqual([
      service.user.id,
      'Civic Panel - Membership Changed',
      {
        organizationSlug: slug,
        fromStatus: CivicPanelStatus.left,
        toStatus: CivicPanelStatus.member,
        source: ContactStatusSource.manual,
      },
    ])
    expect(
      track.mock.calls.filter(
        ([, name]) => name === 'Civic Panel - Goal Reached',
      ),
    ).toEqual([
      [
        service.user.id,
        'Civic Panel - Goal Reached',
        expect.objectContaining({
          organizationSlug: slug,
          members: 230,
          goalMembers: 230,
          waves: 1,
        }),
      ],
    ])
  })
})
