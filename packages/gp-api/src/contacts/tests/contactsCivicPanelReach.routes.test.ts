import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  MAX_LIST_SAMPLE_SIZE,
  type CivicPanelReachOptions,
  type CivicPanelSummary,
  type CivicPanelReachList,
  type CreateCivicPanelReachListInput,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import {
  CivicPanelStatus,
  ContactStatusField,
  ContactStatusSource,
} from '@/generated/prisma'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { FeaturesService } from '@/features/services/features.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import type { PeopleDataset } from '@/peopleDb/services/peopleDataset.service'
import { ContactsService } from '../services/contacts.service'
import { CivicPanelSummaryService } from '../services/civicPanelSummary.service'
import { ManagedCivicPanelService } from '../services/managedCivicPanel.service'
import type { ReachHomes } from '@/peopleDb/databricks/districtCensusSql.util'

const service = useTestService()

const seedOrg = async (prefix: 'eo' | 'campaign' = 'eo') => {
  const slug = `${prefix}-civic-panel-reach-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id, overrideDistrictId: randomUUID() },
  })
  return slug
}

const setPanel = (slug: string, personId: string, toValue: CivicPanelStatus) =>
  service.app.get(ContactStatusService).changeStatus({
    organizationSlug: slug,
    personId,
    field: ContactStatusField.civic_panel,
    toValue,
    source: ContactStatusSource.sms,
    actorUserId: null,
    fallbackFromValue: CivicPanelStatus.left,
  })

const DISTRICT_ID = randomUUID()

const stubWarehouse = (found: string[]) => {
  const district = vi
    .spyOn(service.app.get(ContactsService), 'resolveEligibleDistrict')
    .mockResolvedValue({
      districtId: DISTRICT_ID,
      dataset: { base: 'voters' } satisfies PeopleDataset,
    })
  const reach = vi
    .spyOn(service.app.get(VoterQueryService), 'findReachPeople')
    .mockResolvedValue(found)
  onTestFinished(() => {
    district.mockRestore()
    reach.mockRestore()
  })
  return reach
}

const post = (slug: string, body: CreateCivicPanelReachListInput) =>
  service.client.post<CivicPanelReachList>(
    '/v1/contacts/civic-panel/reach-lists',
    body,
    {
      headers: { 'X-Organization-Slug': slug },
      validateStatus: () => true,
    },
  )

describe('POST /v1/contacts/civic-panel/reach-lists', () => {
  it('saves a door list of the tract, leaving out members and who left', async () => {
    const slug = await seedOrg()
    const member = randomUUID()
    const left = randomUUID()
    await setPanel(slug, member, CivicPanelStatus.member)
    await setPanel(slug, left, CivicPanelStatus.member)
    await setPanel(slug, left, CivicPanelStatus.left)
    const found = [randomUUID(), randomUUID(), randomUUID()]
    const reach = stubWarehouse(found)

    const res = await post(slug, {
      group: { kind: 'tract', key: '37021000100' },
      channel: 'door',
      name: 'Knock doors in West Asheville',
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.people).toBe(3)
    expect(reach).toHaveBeenCalledWith(DISTRICT_ID, expect.anything(), {
      group: { kind: 'tract', tract: '37021000100' },
      channel: 'door',
      excludeIds: expect.arrayContaining([member, left]),
      limit: MAX_LIST_SAMPLE_SIZE,
    })
    const list = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: res.data.listId },
      include: { sampleMembers: { select: { personId: true } } },
    })
    expect(list).toMatchObject({
      organizationSlug: slug,
      name: 'Knock doors in West Asheville',
      sampleSize: 3,
      hasLandline: false,
      civicPanelInvite: false,
    })
    expect(list.sampleMembers.map((row) => row.personId).sort()).toEqual(
      [...found].sort(),
    )
  })

  it('saves a call list of an age group with landlines', async () => {
    const slug = await seedOrg()
    const reach = stubWarehouse([randomUUID()])

    const res = await post(slug, {
      group: { kind: 'group', group: 'age65plus' },
      channel: 'phone',
      name: 'Call people 65 and over',
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(reach.mock.calls[0]?.[2]).toMatchObject({
      group: { kind: 'age', band: '65plus' },
      channel: 'phone',
    })
    const list = await service.prisma.voterFileFilter.findUniqueOrThrow({
      where: { id: res.data.listId },
    })
    expect(list.hasLandline).toBe(true)
  })

  it('reads a precinct as its county and precinct', async () => {
    const slug = await seedOrg()
    const reach = stubWarehouse([randomUUID()])

    await post(slug, {
      group: { kind: 'precinct', key: 'Buncombe|01.1' },
      channel: 'door',
      name: 'Knock doors in Precinct 01.1',
    })

    expect(reach.mock.calls[0]?.[2]).toMatchObject({
      group: { kind: 'precinct', county: 'Buncombe', precinct: '01.1' },
    })
  })

  it('422s when nobody is left to reach', async () => {
    const slug = await seedOrg()
    stubWarehouse([])

    const res = await post(slug, {
      group: { kind: 'group', group: 'women' },
      channel: 'phone',
      name: 'Call women',
    })

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
    expect(
      await service.prisma.voterFileFilter.count({
        where: { organizationSlug: slug },
      }),
    ).toBe(0)
  })

  it('400s for a group that names nobody', async () => {
    const slug = await seedOrg()

    const res = await service.client.post(
      '/v1/contacts/civic-panel/reach-lists',
      {
        group: { kind: 'group', group: 'unreachedAreas' },
        channel: 'door',
        name: 'Knock doors',
      },
      {
        headers: { 'X-Organization-Slug': slug },
        validateStatus: () => true,
      },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('400s for a Win org', async () => {
    const slug = await seedOrg('campaign')
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${slug}-campaign`,
        organizationSlug: slug,
        isPro: true,
        details: {},
      },
    })
    stubWarehouse([randomUUID()])

    const res = await post(slug, {
      group: { kind: 'group', group: 'men' },
      channel: 'door',
      name: 'Knock doors',
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('404s with serve-citizen-panels off', async () => {
    const slug = await seedOrg()
    const flag = vi
      .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
      .mockResolvedValue(false)
    onTestFinished(() => flag.mockRestore())

    const res = await post(slug, {
      group: { kind: 'group', group: 'men' },
      channel: 'door',
      name: 'Knock doors',
    })

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

// 40 of 100 members. The first tract trails its share far behind, people 65
// and over and women trail theirs, men are at theirs.
const SUMMARY = {
  members: 40,
  joinedBy: { text: 40, door: 0, phone: 0, hand: 0 },
  reachedRecently: 0,
  askableNow: 40,
  lastOutreachAt: null,
  progress: {
    members: 40,
    goal: 100,
    answersNeeded: 40,
    expectedAnswers: 16,
    groupsCovered: 3,
    groupsTotal: 8,
  },
  balance: null,
  composition: {
    placeKind: 'tract',
    places: [
      {
        key: '37021000100',
        name: '0001.00',
        label: 'around Pine St',
        districtShare: 0.5,
        members: 2,
      },
      {
        key: '37021000200',
        name: '0002.00',
        label: 'West Asheville',
        districtShare: 0.5,
        members: 38,
      },
    ],
    groups: [
      { group: 'age65plus', districtShare: 0.3, memberShare: 0.05 },
      { group: 'women', districtShare: 0.5, memberShare: 0.3 },
      { group: 'men', districtShare: 0.5, memberShare: 1.25 },
    ],
  },
} satisfies CivicPanelSummary

const stubOptions = (homesFor: (kind: string) => ReachHomes) => {
  const spies = [
    vi
      .spyOn(service.app.get(CivicPanelSummaryService), 'summaryFor')
      .mockResolvedValue(SUMMARY),
    vi
      .spyOn(service.app.get(ManagedCivicPanelService), 'districtPlace')
      .mockResolvedValue('Asheville'),
    vi
      .spyOn(service.app.get(ContactsService), 'resolveEligibleDistrict')
      .mockResolvedValue({
        districtId: DISTRICT_ID,
        dataset: { base: 'voters' } satisfies PeopleDataset,
      }),
  ]
  const homes = vi
    .spyOn(service.app.get(VoterQueryService), 'findReachHomes')
    .mockImplementation(async (_district, _dataset, { group }) =>
      homesFor(group.kind),
    )
  onTestFinished(() => {
    for (const spy of spies) spy.mockRestore()
    homes.mockRestore()
  })
  return homes
}

const options = (slug: string) =>
  service.client.get<CivicPanelReachOptions>(
    '/v1/contacts/civic-panel/reach-options',
    {
      headers: { 'X-Organization-Slug': slug },
      validateStatus: () => true,
    },
  )

describe('GET /v1/contacts/civic-panel/reach-options', () => {
  it('offers the short tract at the door and the short groups on a call', async () => {
    const slug = await seedOrg()
    const member = randomUUID()
    await setPanel(slug, member, CivicPanelStatus.member)
    const homes = stubOptions((kind) =>
      kind === 'tract'
        ? { noCell: 120, landline: 30, homes: 200 }
        : kind === 'age'
          ? { noCell: 60, landline: 45, homes: 400 }
          : { noCell: 80, landline: 0, homes: 900 },
    )

    const res = await options(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({
      place: 'Asheville',
      mostlyNoCell: true,
      options: [
        {
          label: 'Knock doors around Pine St',
          detail: '48 seats short. 120 homes there have no cell phone on file.',
          group: { kind: 'tract', key: '37021000100' },
          channel: 'door',
          seatsShort: 48,
          homes: 120,
        },
        {
          label: 'Call people 65 and over',
          detail: '28 seats short. 45 of their homes have a landline.',
          group: { kind: 'group', group: 'age65plus' },
          channel: 'phone',
          seatsShort: 28,
          homes: 45,
        },
        {
          label: 'Knock doors for women',
          detail:
            '38 seats short. 80 of their homes have no cell phone on file.',
          group: { kind: 'group', group: 'women' },
          channel: 'door',
          seatsShort: 38,
          homes: 80,
        },
        {
          label: 'Knock doors in West Asheville',
          detail: '12 seats short. 120 homes there have no cell phone on file.',
          group: { kind: 'tract', key: '37021000200' },
          channel: 'door',
          seatsShort: 12,
          homes: 120,
        },
      ],
    })
    expect(homes.mock.calls[0]?.[2].excludeIds).toContain(member)
  })

  it('does not say most homes have no cell phone when most do', async () => {
    const slug = await seedOrg()
    stubOptions(() => ({ noCell: 20, landline: 5, homes: 200 }))

    const res = await options(slug)

    expect(res.data.mostlyNoCell).toBe(false)
    expect(res.data.options[0]?.detail).toBe(
      '48 seats short. 20 homes there have no cell phone on file.',
    )
  })

  it('offers one of two places that read the same', async () => {
    const slug = await seedOrg()
    stubOptions(() => ({ noCell: 10, landline: 0, homes: 50 }))
    vi.spyOn(
      service.app.get(CivicPanelSummaryService),
      'summaryFor',
    ).mockResolvedValue({
      ...SUMMARY,
      composition: {
        ...SUMMARY.composition,
        groups: [],
        places: SUMMARY.composition.places.map(({ label: _label, ...p }) => ({
          ...p,
          members: 0,
        })),
      },
    })

    const res = await options(slug)

    expect(res.data.options.map((option) => option.label)).toEqual([
      'Knock doors in a part of Asheville',
    ])
  })

  it('leaves out a group nobody there can be reached in', async () => {
    const slug = await seedOrg()
    stubOptions(() => ({ noCell: 0, landline: 0, homes: 50 }))

    const res = await options(slug)

    expect(res.data).toEqual({
      place: 'Asheville',
      mostlyNoCell: false,
      options: [],
    })
  })

  it('offers nothing rather than a guess when the warehouse fails', async () => {
    const slug = await seedOrg()
    const homes = stubOptions(() => ({ noCell: 1, landline: 1, homes: 1 }))
    homes.mockRejectedValue(new Error('warehouse down'))

    const res = await options(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.options).toEqual([])
  })

  it('404s with serve-citizen-panels off', async () => {
    const slug = await seedOrg()
    const flag = vi
      .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
      .mockResolvedValue(false)
    onTestFinished(() => flag.mockRestore())

    expect((await options(slug)).status).toBe(HttpStatus.NOT_FOUND)
  })
})
