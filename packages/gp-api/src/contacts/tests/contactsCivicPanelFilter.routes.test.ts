import { randomUUID } from 'node:crypto'
import { useTestService } from '@/test-service'
import {
  CivicPanelStatus,
  ContactStatusField,
  ContactStatusSource,
  FollowUpStatus,
} from '@/generated/prisma'
import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { subDays } from 'date-fns'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

// The `civicPanelMember` saved-filter dimension: Serve's civic panel as a
// list. Driven through POST /v1/contacts/count over the real pipeline; only
// the people-db query is stubbed, since what the dimension contributes is
// the `id` constraint it hands that query.
describe('POST /v1/contacts/count — civic panel filter', () => {
  const setupEoOrg = async (suffix: string) => {
    const slug = `eo-civic-panel-filter-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    return slug
  }

  const setPanel = (
    organizationSlug: string,
    personId: string,
    toValue: CivicPanelStatus,
  ) =>
    service.app.get(ContactStatusService).changeStatus({
      organizationSlug,
      personId,
      field: ContactStatusField.civic_panel,
      toValue,
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
      fallbackFromValue: CivicPanelStatus.left,
    })

  const spyOnFindPeople = () =>
    vi
      .spyOn(service.app.get(VoterQueryService), 'findPeople')
      .mockResolvedValue({
        pagination: {
          totalResults: 1,
          currentPage: 1,
          pageSize: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        people: [],
      })

  const count = (slug: string, body: Record<string, unknown>) =>
    service.client.post('/v1/contacts/count', body, {
      headers: { [ORG_SLUG_HEADER]: slug },
      validateStatus: () => true,
    })

  it('resolves to the members, leaving out anyone who left', async () => {
    const slug = await setupEoOrg('members')
    const member = randomUUID()
    const leftAgain = randomUUID()
    await setPanel(slug, member, CivicPanelStatus.member)
    await setPanel(slug, leftAgain, CivicPanelStatus.member)
    await setPanel(slug, leftAgain, CivicPanelStatus.left)

    const findPeopleSpy = spyOnFindPeople()
    await count(slug, { civicPanelMember: true })

    expect(
      findPeopleSpy.mock.calls[0]?.[0]?.filters.filterOperators.id,
    ).toEqual({ operator: 'in', values: [member], includeNull: false })
  })

  it('resolves to nobody when the panel is empty, never the district', async () => {
    const slug = await setupEoOrg('empty')

    const findPeopleSpy = spyOnFindPeople()
    const res = await count(slug, { civicPanelMember: true })

    expect(res.status).toBe(201)
    expect(res.data.count).toBe(0)
    expect(findPeopleSpy).not.toHaveBeenCalled()
  })

  it('narrows with the follow-up flag rather than replacing it', async () => {
    const slug = await setupEoOrg('both')
    const memberOwed = randomUUID()
    const memberOnly = randomUUID()
    await setPanel(slug, memberOwed, CivicPanelStatus.member)
    await setPanel(slug, memberOnly, CivicPanelStatus.member)
    await service.app.get(ContactStatusService).changeStatus({
      organizationSlug: slug,
      personId: memberOwed,
      field: ContactStatusField.follow_up,
      toValue: FollowUpStatus.requested,
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
      fallbackFromValue: FollowUpStatus.cleared,
    })

    const findPeopleSpy = spyOnFindPeople()
    await count(slug, { civicPanelMember: true, followUpRequested: true })

    expect(
      findPeopleSpy.mock.calls[0]?.[0]?.filters.filterOperators.id,
    ).toEqual({ operator: 'in', values: [memberOwed], includeNull: false })
  })

  it('saves on a list and honours it in the overlap count', async () => {
    const slug = await setupEoOrg('saved')
    const member = randomUUID()
    await setPanel(slug, member, CivicPanelStatus.member)

    const created = await service.client.post(
      '/v1/voters/voter-file/filter',
      { name: 'My civic panel', civicPanelMember: true },
      { headers: { [ORG_SLUG_HEADER]: slug }, validateStatus: () => true },
    )
    expect(created.status).toBe(201)
    const saved = await service.prisma.voterFileFilter.findFirstOrThrow({
      where: { organizationSlug: slug, name: 'My civic panel' },
    })
    expect(saved.civicPanelMember).toBe(true)

    const overlapSpy = vi
      .spyOn(service.app.get(VoterQueryService), 'getOverlapCount')
      .mockResolvedValue({ count: 0 })
    await service.client.post(
      '/v1/contacts/overlap-count',
      { civicPanelMember: true },
      { headers: { [ORG_SLUG_HEADER]: slug }, validateStatus: () => true },
    )

    expect(
      overlapSpy.mock.calls[0]?.[0]?.savedFilterSets?.[0]?.filterOperators?.id,
    ).toEqual({ operator: 'in', values: [member], includeNull: false })
  })

  // The rotation: a panel ask leaves out anyone the office reached in the
  // last 30 days, on any channel, and lets them back once that passes.
  it('leaves out members contacted in the last 30 days', async () => {
    const slug = await setupEoOrg('rested')
    const rested = randomUUID()
    const textedLastWeek = randomUUID()
    const textedLongAgo = randomUUID()
    for (const id of [rested, textedLastWeek, textedLongAgo]) {
      await setPanel(slug, id, CivicPanelStatus.member)
    }
    const texts = service.app.get(ContactInteractionTextService)
    await texts.create({
      organizationSlug: slug,
      personId: textedLastWeek,
      occurredAt: subDays(new Date(), 7),
    })
    await texts.create({
      organizationSlug: slug,
      personId: textedLongAgo,
      occurredAt: subDays(new Date(), 45),
    })

    const findPeopleSpy = spyOnFindPeople()
    await count(slug, { civicPanelMember: true, notContactedRecently: true })

    expect(
      findPeopleSpy.mock.calls[0]?.[0]?.filters.filterOperators.id,
    ).toEqual({
      operator: 'in',
      values: expect.arrayContaining([rested, textedLongAgo]),
      includeNull: false,
    })
    expect(
      findPeopleSpy.mock.calls[0]?.[0]?.filters.filterOperators.id?.values,
    ).not.toContain(textedLastWeek)
  })

  it('400s for a Win organization instead of ignoring the filter', async () => {
    const slug = `campaign-civic-panel-filter-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${slug}-campaign`,
        organizationSlug: slug,
        isPro: true,
      },
    })
    vi.spyOn(service.app.get(HttpService), 'get').mockReturnValue(
      of({
        data: {
          id: slug,
          state: 'CA',
          L2DistrictType: 'City',
          L2DistrictName: 'Springfield',
        },
        status: 200,
      }) as never,
    )

    const findPeopleSpy = spyOnFindPeople()
    const res = await count(slug, { civicPanelMember: true })

    expect(res.status).toBe(400)
    expect(findPeopleSpy).not.toHaveBeenCalled()
  })
})

// The built-in `civicPanel` segment: the panel as a list with no saved row
// behind it, read through GET /v1/contacts like any other segment.
describe('GET /v1/contacts?segment=civicPanel', () => {
  const setupEoOrg = async (suffix: string) => {
    const slug = `eo-civic-panel-segment-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    return slug
  }

  const join = (organizationSlug: string, personId: string) =>
    service.app.get(ContactStatusService).changeStatus({
      organizationSlug,
      personId,
      field: ContactStatusField.civic_panel,
      toValue: CivicPanelStatus.member,
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
      fallbackFromValue: CivicPanelStatus.left,
    })

  const list = (slug: string) =>
    service.client.get('/v1/contacts', {
      params: { segment: 'civicPanel' },
      headers: { [ORG_SLUG_HEADER]: slug },
      validateStatus: () => true,
    })

  it('lists exactly the current members', async () => {
    const slug = await setupEoOrg('members')
    const member = randomUUID()
    await join(slug, member)

    const findPeopleSpy = vi
      .spyOn(service.app.get(VoterQueryService), 'findPeople')
      .mockResolvedValue({
        pagination: {
          totalResults: 1,
          currentPage: 1,
          pageSize: 50,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        people: [],
      })
    const res = await list(slug)

    expect(res.status).toBe(200)
    expect(
      findPeopleSpy.mock.calls[0]?.[0]?.filters.filterOperators.id,
    ).toEqual({ operator: 'in', values: [member], includeNull: false })
    expect(
      await service.prisma.voterFileFilter.count({
        where: { organizationSlug: slug },
      }),
    ).toBe(0)
  })

  it('is empty, never the district, when nobody has joined', async () => {
    const slug = await setupEoOrg('empty')

    const findPeopleSpy = vi.spyOn(
      service.app.get(VoterQueryService),
      'findPeople',
    )
    const res = await list(slug)

    expect(res.status).toBe(200)
    expect(res.data.pagination.totalResults).toBe(0)
    expect(findPeopleSpy).not.toHaveBeenCalled()
  })
})
