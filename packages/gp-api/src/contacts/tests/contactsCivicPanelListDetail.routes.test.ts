import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { subDays } from 'date-fns'
import { describe, expect, it, vi } from 'vitest'
import type {
  CivicPanelSummary,
  ListDetailContactsResponse,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import {
  CivicPanelStatus,
  ContactStatusField,
  ContactStatusSource,
  DoorKnockOutcome,
  OutreachStatus,
  OutreachType,
  PhoneBankCallOutcome,
  PhoneBankingPurpose,
} from '@/generated/prisma'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

const seedOrg = async (prefix: 'eo' | 'campaign') => {
  const slug = `${prefix}-civic-panel-list-detail-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id, overrideDistrictId: randomUUID() },
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

const seedOutreach = (
  organizationSlug: string,
  name: string,
  daysAgo: number,
  data: {
    outreachType?: OutreachType
    status?: OutreachStatus
    phoneBankingListId?: number
    doorKnockingTurfId?: number
  } = {},
) =>
  service.prisma.outreach.create({
    data: {
      organizationSlug,
      name,
      outreachType: data.outreachType ?? OutreachType.text,
      status: data.status ?? OutreachStatus.completed,
      date: subDays(new Date(), daysAgo),
      phoneBankingListId: data.phoneBankingListId,
      doorKnockingTurfId: data.doorKnockingTurfId,
    },
  })

const texted = (
  organizationSlug: string,
  personId: string,
  outreachId: number,
) =>
  service.prisma.contactInteractionText.create({
    data: { organizationSlug, personId, outreachId, occurredAt: new Date() },
  })

const seedKnock = async (
  organizationSlug: string,
  personId: string,
  name: string,
  daysAgo: number,
) => {
  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug, name: `${name} list` },
  })
  const turf = await service.prisma.doorKnockingTurf.create({
    data: {
      voterFileFilterId: filter.id,
      name,
      color: '#ff0000',
      geoPoly: {
        type: 'Polygon',
        coordinates: [
          [
            [-87.66, 41.89],
            [-87.64, 41.89],
            [-87.65, 41.91],
            [-87.66, 41.89],
          ],
        ],
      },
    },
  })
  const outreach = await seedOutreach(organizationSlug, name, daysAgo, {
    outreachType: OutreachType.nativeDoorKnocking,
    doorKnockingTurfId: turf.id,
  })
  await service.prisma.contactInteractionDoorKnock.create({
    data: {
      organizationSlug,
      personId,
      outreachId: outreach.id,
      occurredAt: new Date(),
      outcome: DoorKnockOutcome.answered,
    },
  })
  return outreach
}

const seedCall = async (
  organizationSlug: string,
  personId: string,
  name: string,
  daysAgo: number,
) => {
  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug, name: `${name} list` },
  })
  const list = await service.prisma.phoneBankingList.create({
    data: {
      organizationSlug,
      voterFileFilterId: filter.id,
      name,
      script: 'Hi',
      sheetCount: 1,
      purpose: PhoneBankingPurpose.community_input,
    },
  })
  const outreach = await seedOutreach(organizationSlug, name, daysAgo, {
    outreachType: OutreachType.nativePhoneBanking,
    phoneBankingListId: list.id,
  })
  await service.prisma.contactInteractionPhoneBanking.create({
    data: {
      organizationSlug,
      personId,
      phoneBankingListId: list.id,
      occurredAt: new Date(),
      outcome: PhoneBankCallOutcome.answered,
    },
  })
  return outreach
}

const stubAggregates = () =>
  vi
    .spyOn(service.app.get(VoterQueryService), 'getListDetailAggregates')
    .mockResolvedValue({
      count: 2,
      avgAge: null,
      avgIncome: null,
      sms: 2,
      robocall: 0,
      phoneBanking: 2,
      doorKnocking: 2,
      email: 0,
    })

const panelDetail = (slug: string) =>
  service.client.get<ListDetailContactsResponse>('/v1/contacts/list-detail', {
    params: { segment: 'civicPanel' },
    headers: { [ORG_SLUG_HEADER]: slug },
    validateStatus: () => true,
  })

const summary = (slug: string) =>
  service.client.get<CivicPanelSummary>('/v1/contacts/civic-panel', {
    headers: { [ORG_SLUG_HEADER]: slug },
    validateStatus: () => true,
  })

describe('GET /v1/contacts/list-detail?segment=civicPanel', () => {
  it('lists the sends that reached a current member, newest first', async () => {
    const slug = await seedOrg('eo')
    const other = await seedOrg('eo')
    const member = randomUUID()
    const formerMember = randomUUID()
    const outsider = randomUUID()
    await setPanel(slug, member, CivicPanelStatus.member)
    await setPanel(slug, formerMember, CivicPanelStatus.member)
    await setPanel(slug, formerMember, CivicPanelStatus.left)
    stubAggregates()

    const invite = await seedOutreach(slug, 'Invite', 9)
    await texted(slug, member, invite.id)
    const knock = await seedKnock(slug, member, 'Knock', 5)
    const call = await seedCall(slug, member, 'Calls', 2)

    const nobodyOnPanel = await seedOutreach(slug, 'Fresh sample', 1)
    await texted(slug, outsider, nobodyOnPanel.id)
    const formerOnly = await seedOutreach(slug, 'Before they left', 1)
    await texted(slug, formerMember, formerOnly.id)
    const draft = await seedOutreach(slug, 'Draft', 1, {
      status: OutreachStatus.draft,
    })
    await texted(slug, member, draft.id)
    const canceled = await seedOutreach(slug, 'Canceled', 1, {
      status: OutreachStatus.canceled,
    })
    await texted(slug, member, canceled.id)
    const otherOffice = await seedOutreach(other, 'Other office', 1)
    await texted(other, member, otherOffice.id)

    const res = await panelDetail(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.demographics.people).toBe(2)
    expect(res.data.outreachHistory.map((row) => row.id)).toEqual([
      call.id,
      knock.id,
      invite.id,
    ])
    expect(res.data.outreachHistory[0]).toMatchObject({
      name: 'Calls',
      outreachType: OutreachType.nativePhoneBanking,
      status: OutreachStatus.completed,
    })

    const card = await summary(slug)
    expect(card.status).toBe(HttpStatus.OK)
    expect(new Date(String(card.data.lastOutreachAt)).getTime()).toBe(
      call.date?.getTime(),
    )
  })

  it('reads an unreached panel as having no outreach', async () => {
    const slug = await seedOrg('eo')
    await setPanel(slug, randomUUID(), CivicPanelStatus.member)
    stubAggregates()

    const res = await panelDetail(slug)
    const card = await summary(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.outreachHistory).toEqual([])
    expect(card.data.lastOutreachAt).toBeNull()
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
    stubAggregates()

    const res = await panelDetail(slug)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })
})
