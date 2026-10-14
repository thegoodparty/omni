import { randomUUID } from 'node:crypto'
import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { subDays } from 'date-fns'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import {
  CivicPanelStatus,
  ContactStatusField,
  ContactStatusSource,
} from '@/generated/prisma'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

// The civic panel's history as list filters: panel status (member, left,
// never invited), how and when a member joined, and when the office last
// reached someone. Driven through POST /v1/contacts/count over the real
// pipeline; only the people-db query is stubbed, since what each dimension
// contributes is the `id` constraint it hands that query.
describe('POST /v1/contacts/count — civic panel history filters', () => {
  const setupEoOrg = async (suffix: string) => {
    const slug = `eo-civic-panel-history-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    return slug
  }

  const setPanel = async (
    organizationSlug: string,
    personId: string,
    toValue: CivicPanelStatus,
    source: ContactStatusSource = ContactStatusSource.manual,
    at?: Date,
  ) => {
    const event = await service.app.get(ContactStatusService).changeStatus({
      organizationSlug,
      personId,
      field: ContactStatusField.civic_panel,
      toValue,
      source,
      actorUserId: null,
      sourceId: source === ContactStatusSource.manual ? null : randomUUID(),
      fallbackFromValue: CivicPanelStatus.left,
    })
    if (at && event) {
      await service.prisma.contactStatusEvent.update({
        where: { id: event.id },
        data: { createdAt: at },
      })
    }
  }

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

  const idFilterOf = (spy: ReturnType<typeof spyOnFindPeople>) =>
    spy.mock.calls[0]?.[0]?.filters.filterOperators.id

  it('resolves left to people who left, never to people who never joined', async () => {
    const slug = await setupEoOrg('left')
    const member = randomUUID()
    const leaver = randomUUID()
    await setPanel(slug, member, CivicPanelStatus.member)
    await setPanel(slug, leaver, CivicPanelStatus.member)
    await setPanel(slug, leaver, CivicPanelStatus.left)
    // Leaving someone who was never on: changeStatus no-ops on left -> left,
    // so they stay never invited rather than reading as left.
    await setPanel(slug, randomUUID(), CivicPanelStatus.left)

    const spy = spyOnFindPeople()
    await count(slug, { civicPanelLeft: true })

    expect(idFilterOf(spy)).toEqual({
      operator: 'in',
      values: [leaver],
      includeNull: false,
    })
  })

  it('ORs member and left within the status group', async () => {
    const slug = await setupEoOrg('member-or-left')
    const member = randomUUID()
    const leaver = randomUUID()
    await setPanel(slug, member, CivicPanelStatus.member)
    await setPanel(slug, leaver, CivicPanelStatus.member)
    await setPanel(slug, leaver, CivicPanelStatus.left)

    const spy = spyOnFindPeople()
    await count(slug, { civicPanelMember: true, civicPanelLeft: true })

    expect(idFilterOf(spy)?.operator).toBe('in')
    expect([...(idFilterOf(spy)?.values ?? [])].sort()).toEqual(
      [member, leaver].sort(),
    )
  })

  it('leaves out everyone invited by any channel for never invited', async () => {
    const slug = await setupEoOrg('never')
    const member = randomUUID()
    const askedByText = randomUUID()
    const askedAtDoor = randomUUID()
    const askedOnCall = randomUUID()
    const textedWithoutAsk = randomUUID()
    await setPanel(slug, member, CivicPanelStatus.member)

    const asking = await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        campaignId: null,
        outreachType: 'text',
        status: 'completed',
        asksToJoinCivicPanel: true,
      },
    })
    const plain = await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        campaignId: null,
        outreachType: 'text',
        status: 'completed',
      },
    })
    await service.prisma.outreachTextRecipient.create({
      data: {
        outreachId: asking.id,
        organizationSlug: slug,
        personId: askedByText,
        phone: '+15550000001',
      },
    })
    await service.prisma.outreachTextRecipient.create({
      data: {
        outreachId: plain.id,
        organizationSlug: slug,
        personId: textedWithoutAsk,
        phone: '+15550000002',
      },
    })
    await service.prisma.contactInteractionDoorKnock.create({
      data: {
        organizationSlug: slug,
        personId: askedAtDoor,
        occurredAt: new Date(),
        outcome: 'answered',
        joinCivicPanel: 'no',
      },
    })
    await service.prisma.contactInteractionPhoneBanking.create({
      data: {
        organizationSlug: slug,
        personId: askedOnCall,
        occurredAt: new Date(),
        outcome: 'answered',
        joinCivicPanel: 'no',
      },
    })

    const spy = spyOnFindPeople()
    await count(slug, { civicPanelNeverInvited: true })

    const idFilter = idFilterOf(spy)
    expect(idFilter?.operator).toBe('notIn')
    expect([...(idFilter?.values ?? [])].sort()).toEqual(
      [member, askedByText, askedAtDoor, askedOnCall].sort(),
    )
    expect(idFilter?.values).not.toContain(textedWithoutAsk)
  })

  it('keeps members in when never invited is picked beside member', async () => {
    const slug = await setupEoOrg('never-or-member')
    const member = randomUUID()
    const leaver = randomUUID()
    await setPanel(slug, member, CivicPanelStatus.member)
    await setPanel(slug, leaver, CivicPanelStatus.member)
    await setPanel(slug, leaver, CivicPanelStatus.left)

    const spy = spyOnFindPeople()
    await count(slug, { civicPanelMember: true, civicPanelNeverInvited: true })

    expect(idFilterOf(spy)).toMatchObject({
      operator: 'notIn',
      values: [leaver],
    })
  })

  it('matches current members by how they last joined', async () => {
    const slug = await setupEoOrg('joined-by')
    const byText = randomUUID()
    const atDoor = randomUUID()
    const byHand = randomUUID()
    const leftAfterText = randomUUID()
    await setPanel(slug, byText, CivicPanelStatus.member, 'sms')
    await setPanel(slug, atDoor, CivicPanelStatus.member, 'door_knock')
    await setPanel(slug, byHand, CivicPanelStatus.member)
    await setPanel(slug, leftAfterText, CivicPanelStatus.member, 'sms')
    await setPanel(slug, leftAfterText, CivicPanelStatus.left)

    const spy = spyOnFindPeople()
    await count(slug, {
      civicPanelJoinedByText: true,
      civicPanelJoinedByDoor: true,
    })

    expect([...(idFilterOf(spy)?.values ?? [])].sort()).toEqual(
      [byText, atDoor].sort(),
    )
  })

  it('matches current members by when they last joined', async () => {
    const slug = await setupEoOrg('joined-when')
    const early = randomUUID()
    const inRange = randomUUID()
    const lastDay = randomUUID()
    await setPanel(
      slug,
      early,
      CivicPanelStatus.member,
      'sms',
      new Date('2026-09-20T12:00:00Z'),
    )
    await setPanel(
      slug,
      inRange,
      CivicPanelStatus.member,
      'sms',
      new Date('2026-10-02T12:00:00Z'),
    )
    await setPanel(
      slug,
      lastDay,
      CivicPanelStatus.member,
      'manual',
      new Date('2026-10-09T23:30:00Z'),
    )

    const spy = spyOnFindPeople()
    await count(slug, {
      civicPanelJoinedFrom: '2026-10-01',
      civicPanelJoinedTo: '2026-10-09',
    })

    expect([...(idFilterOf(spy)?.values ?? [])].sort()).toEqual(
      [inRange, lastDay].sort(),
    )
  })

  it('resolves to nobody when no member joined that way', async () => {
    const slug = await setupEoOrg('joined-none')
    await setPanel(slug, randomUUID(), CivicPanelStatus.member)

    const spy = spyOnFindPeople()
    const res = await count(slug, { civicPanelJoinedByPhone: true })

    expect(res.status).toBe(201)
    expect(res.data.count).toBe(0)
    expect(spy).not.toHaveBeenCalled()
  })

  it('matches people whose last contact on any channel falls in the range', async () => {
    const slug = await setupEoOrg('last-asked')
    const lastAskedInRange = randomUUID()
    const askedAgainSince = randomUUID()
    const askedBefore = randomUUID()
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: slug,
        personId: lastAskedInRange,
        occurredAt: new Date('2026-09-10T12:00:00Z'),
      },
    })
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: slug,
        personId: askedAgainSince,
        occurredAt: new Date('2026-09-11T12:00:00Z'),
      },
    })
    await service.prisma.contactInteractionDoorKnock.create({
      data: {
        organizationSlug: slug,
        personId: askedAgainSince,
        occurredAt: subDays(new Date(), 1),
        outcome: 'answered',
      },
    })
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: slug,
        personId: askedBefore,
        occurredAt: new Date('2026-08-01T12:00:00Z'),
      },
    })

    const spy = spyOnFindPeople()
    await count(slug, {
      lastReachedFrom: '2026-09-01',
      lastReachedTo: '2026-09-30',
    })

    expect(idFilterOf(spy)).toEqual({
      operator: 'in',
      values: [lastAskedInRange],
      includeNull: false,
    })
  })

  it('saves every new dimension on a list and reads them back', async () => {
    const slug = await setupEoOrg('saved')
    const created = await service.client.post(
      '/v1/voters/voter-file/filter',
      {
        name: 'Recent text joiners',
        civicPanelMember: true,
        civicPanelLeft: true,
        civicPanelNeverInvited: false,
        civicPanelJoinedByText: true,
        civicPanelJoinedFrom: '2026-10-01',
        civicPanelJoinedTo: null,
        lastReachedTo: '2026-09-30',
      },
      { headers: { [ORG_SLUG_HEADER]: slug }, validateStatus: () => true },
    )
    expect(created.status).toBe(201)
    expect(created.data).toMatchObject({
      civicPanelLeft: true,
      civicPanelJoinedByText: true,
      civicPanelJoinedFrom: '2026-10-01',
      civicPanelJoinedTo: null,
      lastReachedTo: '2026-09-30',
    })
  })

  it('400s on a date that is not a calendar day', async () => {
    const slug = await setupEoOrg('bad-date')
    const res = await count(slug, { civicPanelJoinedFrom: 'last week' })
    expect(res.status).toBe(400)
  })

  it('400s every new dimension for a Win organization', async () => {
    const slug = `campaign-civic-panel-history-${Date.now()}`
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

    const spy = spyOnFindPeople()
    for (const body of [
      { civicPanelLeft: true },
      { civicPanelNeverInvited: true },
      { civicPanelJoinedByDoor: true },
      { civicPanelJoinedFrom: '2026-10-01' },
      { lastReachedTo: '2026-10-01' },
    ]) {
      const res = await count(slug, body)
      expect(res.status).toBe(400)
    }
    expect(spy).not.toHaveBeenCalled()
  })
})
