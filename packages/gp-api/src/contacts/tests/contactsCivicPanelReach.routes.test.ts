import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  MAX_LIST_SAMPLE_SIZE,
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
