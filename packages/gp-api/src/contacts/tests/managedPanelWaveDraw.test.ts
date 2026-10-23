import { randomUUID } from 'node:crypto'
import { subDays } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_LIST_SAMPLE_SIZE } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import {
  CivicPanelStatus,
  ContactStatusField,
  ContactStatusSource,
  ManagedCivicPanelStatus,
} from '@/generated/prisma'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { StatsService } from '@/peopleDb/services/stats.service'
import type { PersonOutput } from '@/contacts/schemas/person.schema'
import { ManagedPanelWaveDrawService } from '@/contacts/services/managedPanelWaveDraw.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import {
  ACS_COUNT_KEYS,
  type AcsCountKey,
  type AcsCounts,
  type RespondentCell,
} from '@/peopleDb/databricks/districtCensusSql.util'

const service = useTestService()

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

// The cell phones people-db would count for the invite's criteria.
const stubCells = (cells: number) =>
  vi
    .spyOn(service.app.get(VoterQueryService), 'findPeople')
    .mockClear()
    .mockImplementation(async () => page(cells) as never)

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
const TRACT_ADULTS = new Map([
  [TRACT_A, 500],
  [TRACT_B, 400],
  ['53017950300', 100],
])

// Members counted by cell beside the district's census. No district row
// by default: no census to compare with.
const stubMix = (cells: RespondentCell[] | null) =>
  vi
    .spyOn(service.app.get(StatsService), 'findWeightingInputs')
    .mockClear()
    .mockResolvedValue({
      district: cells ? DISTRICT_ACS : null,
      cells: cells ?? [],
      tractAdults: TRACT_ADULTS,
    })

const membersAged35to44InTractA = (count: number): RespondentCell => ({
  ageBand: '35to44',
  gender: null,
  tenure: null,
  tract: TRACT_A,
  race: null,
  count,
})

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

const joinPanel = async (slug: string, count: number) => {
  const ids = Array.from({ length: count }, () => randomUUID())
  for (const id of ids) await setPanel(slug, id, CivicPanelStatus.member)
  return ids
}

const enroll = async (
  overrides: {
    goalMembers?: number
    freeTextCap?: number
    freeTextsUsed?: number
    status?: ManagedCivicPanelStatus
  } = {},
) => {
  const slug = `eo-managed-wave-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id, overrideDistrictId: randomUUID() },
  })
  const enrollment = await service.prisma.managedCivicPanel.create({
    data: {
      organizationSlug: slug,
      inviteMessage: 'Hi, it is Mayor Lee.',
      consentVersion: '2026-10-22',
      approvedAt: new Date(),
      goalMembers: 240,
      ...overrides,
    },
  })
  return { slug, id: enrollment.id }
}

const draw = (enrollmentId: string) =>
  service.app.get(ManagedPanelWaveDrawService).drawNextWave(enrollmentId)

const sampleIds = async (voterFileFilterId: number | null) =>
  (
    await service.prisma.voterFileFilterSampleMember.findMany({
      where: { voterFileFilterId: voterFileFilterId ?? -1 },
      select: { personId: true },
    })
  ).map((row) => row.personId)

const markSent = (waveId: string) =>
  service.prisma.managedPanelWave.update({
    where: { id: waveId },
    data: { sentAt: new Date() },
  })

beforeEach(() => {
  stubCells(58_000)
  stubDraws()
  stubMix(null)
})

describe('drawing a managed panel wave', () => {
  it('sizes the wave from the member gap at the cold text rate', async () => {
    const { slug, id } = await enroll()
    await joinPanel(slug, 10)

    const res = await draw(id)

    // 230 members short at 3%.
    expect(res).toMatchObject({ outcome: 'drawn', size: 7_667 })
    if (res.outcome !== 'drawn') throw new Error(res.outcome)
    expect(res.wave).toMatchObject({ wave: 1, sentAt: null })
    expect(await sampleIds(res.wave.voterFileFilterId)).toHaveLength(7_667)
  })

  it('caps the wave at the reachable cell phones', async () => {
    const { id } = await enroll()
    stubCells(500)

    expect(await draw(id)).toMatchObject({ outcome: 'drawn', size: 500 })
  })

  it('caps the wave at the largest sample a list holds', async () => {
    const { id } = await enroll({ goalMembers: 1_000 })

    expect(await draw(id)).toMatchObject({
      outcome: 'drawn',
      size: MAX_LIST_SAMPLE_SIZE,
    })
  })

  it('caps the wave at the free texts left', async () => {
    const { id } = await enroll({ freeTextCap: 15_000, freeTextsUsed: 14_900 })

    expect(await draw(id)).toMatchObject({ outcome: 'drawn', size: 100 })
  })

  it('saves the draw as a hidden, frozen civic panel invite list', async () => {
    const { slug, id } = await enroll()

    const res = await draw(id)

    if (res.outcome !== 'drawn') throw new Error(res.outcome)
    const list = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: res.wave.voterFileFilterId ?? -1 },
    })
    expect(list).toMatchObject({
      organizationSlug: slug,
      name: 'Civic panel invite',
      hasCellPhone: true,
      civicPanelNeverInvited: true,
      notContactedRecently: true,
      sampleSize: 8_000,
      // The send keeps it; the lists index leaves it out.
      civicPanelInvite: true,
    })
  })

  it('leans the draw toward the groups the panel trails', async () => {
    const { slug, id } = await enroll()
    stubMix([membersAged35to44InTractA(40)])
    await joinPanel(slug, 40)
    const sample = stubDraws()

    const res = await draw(id)

    if (res.outcome !== 'drawn') throw new Error(res.outcome)
    expect(res.wave.steeredToward).toBe('unreachedAreas')
    const weights = sample.mock.calls[0]?.[0].weights
    expect(weights?.age).toMatchObject({ '35to44': 0.5, '65plus': 2 })
    expect(weights?.tract[TRACT_A]).toBe(0.5)
    expect(weights?.tract[TRACT_B]).toBe(2)
  })

  it('leans nowhere under 30 members', async () => {
    const { slug, id } = await enroll()
    stubMix([membersAged35to44InTractA(10)])
    await joinPanel(slug, 10)
    const sample = stubDraws()

    const res = await draw(id)

    if (res.outcome !== 'drawn') throw new Error(res.outcome)
    expect(res.wave.steeredToward).toBeNull()
    expect(sample.mock.calls[0]?.[0].weights).toBeUndefined()
  })

  it('leaves out members, earlier waves and opt-outs', async () => {
    const { slug, id } = await enroll()
    const [member] = await joinPanel(slug, 1)
    const optedOut = randomUUID()
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: slug,
        personId: optedOut,
        occurredAt: subDays(new Date(), 90),
        optedOutAt: subDays(new Date(), 90),
        manual: true,
      },
    })
    const first = await draw(id)
    if (first.outcome !== 'drawn') throw new Error(first.outcome)
    await markSent(first.wave.id)
    const firstIds = await sampleIds(first.wave.voterFileFilterId)
    const sample = stubDraws()

    const second = await draw(id)

    if (second.outcome !== 'drawn') throw new Error(second.outcome)
    expect(second.wave.wave).toBe(2)
    const [request] = sample.mock.calls[0] ?? []
    expect(filterKeys(request as FilterArg)).toContain('hasCellPhone')
    expect(notInIds(request as FilterArg)).toEqual(
      expect.arrayContaining([member, optedOut, ...firstIds]),
    )
    const list = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: second.wave.voterFileFilterId ?? -1 },
    })
    expect(list.name).toBe('Civic panel invite, batch 2')
  })

  it('returns the wave not yet sent instead of drawing another', async () => {
    const { id } = await enroll()
    const sample = stubDraws()

    const first = await draw(id)
    const again = await draw(id)

    if (first.outcome !== 'drawn') throw new Error(first.outcome)
    expect(again).toEqual({
      outcome: 'pending',
      wave: first.wave,
      size: first.size,
    })
    expect(sample).toHaveBeenCalledTimes(1)
    expect(
      await service.prisma.managedPanelWave.count({
        where: { enrollmentId: id },
      }),
    ).toBe(1)
  })

  it('makes one wave when a draw overlaps one that finished meanwhile', async () => {
    const { slug, id } = await enroll()
    // The second draw counts its pool only once the first has made its
    // wave, so it passed the unsent check before that wave existed.
    const { promise: gate, resolve: release } = Promise.withResolvers<void>()
    let counts = 0
    vi.spyOn(
      service.app.get(ContactsService),
      'countWithin',
    ).mockImplementation(async () => {
      counts += 1
      if (counts > 1) await gate
      return 58_000
    })

    const first = draw(id)
    const second = draw(id)
    await Promise.race([first, second])
    release()
    const [a, b] = await Promise.all([first, second])

    expect(
      await service.prisma.managedPanelWave.findMany({
        where: { enrollmentId: id },
        select: { wave: true },
      }),
    ).toEqual([{ wave: 1 }])
    expect([a.outcome, b.outcome].sort()).toEqual(['drawn', 'pending'])
    if (!('wave' in a) || !('wave' in b)) throw new Error('no wave')
    expect(a.wave.id).toBe(b.wave.id)
    // The losing draw's list is dropped.
    expect(
      await service.prisma.voterFileFilter.count({
        where: { organizationSlug: slug, civicPanelInvite: true },
      }),
    ).toBe(1)
  })

  it('reads as exhausted when nobody is left to text', async () => {
    const { id } = await enroll()
    stubCells(0)

    expect(await draw(id)).toEqual({ outcome: 'exhausted' })
    expect(
      await service.prisma.managedPanelWave.count({
        where: { enrollmentId: id },
      }),
    ).toBe(0)
  })

  it('reads as exhausted when the draw comes back empty', async () => {
    const { id } = await enroll()
    vi.spyOn(
      service.app.get(VoterQueryService),
      'samplePeople',
    ).mockResolvedValue([])

    expect(await draw(id)).toEqual({ outcome: 'exhausted' })
    expect(
      await service.prisma.managedPanelWave.count({
        where: { enrollmentId: id },
      }),
    ).toBe(0)
  })

  it('draws nothing once the panel reaches its goal', async () => {
    const { slug, id } = await enroll({ goalMembers: 3 })
    await joinPanel(slug, 3)

    expect(await draw(id)).toEqual({ outcome: 'goal_reached', members: 3 })
  })

  it('draws nothing once the free texts are spent', async () => {
    const { id } = await enroll({ freeTextCap: 100, freeTextsUsed: 100 })

    expect(await draw(id)).toEqual({ outcome: 'out_of_free_texts' })
  })

  it('draws nothing for a panel that is not building', async () => {
    const { id } = await enroll({ status: ManagedCivicPanelStatus.paused })

    expect(await draw(id)).toEqual({
      outcome: 'not_building',
      status: ManagedCivicPanelStatus.paused,
    })
  })
})
