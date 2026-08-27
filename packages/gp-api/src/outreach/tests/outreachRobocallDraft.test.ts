/**
 * Robocall draft-first create (payment-rebuild foundation).
 *
 * Contract under test:
 *   - POST /v1/outreach/robocall persists a pending_payment spine + satellite
 *     BEFORE payment and returns the SERVER-derived landline count + amount.
 *   - The satellite lands with settleState = pending_payment and none of the
 *     hold/settlement fields set — those are later slices.
 *   - The billable count comes from the audience (voterFileFilterId) with the
 *     landline dimension forced — never a client-supplied count.
 *   - A zero-landline audience and a past scheduledAt are both rejected before
 *     any row is written.
 */

import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { PeopleListResponse } from '@/contacts/schemas/person.schema'
import { calcRobocallAmountInCents } from '@/shared/util/robocallPricing.util'
import {
  OutreachStatus,
  OutreachType,
  RobocallSettleState,
} from '../../generated/prisma'

const service = useTestService()

const findContactsForFilter = vi.fn()

let orgSlug: string
let filterId: number

const CAMPAIGN_ID = 998

const peopleListWithTotal = (totalResults: number): PeopleListResponse => ({
  people: [],
  pagination: {
    totalResults,
    currentPage: 1,
    pageSize: 1,
    totalPages: totalResults > 0 ? 1 : 0,
    hasNextPage: false,
    hasPreviousPage: false,
  },
})

beforeEach(async () => {
  const contacts = service.app.get(ContactsService)
  vi.spyOn(contacts, 'findContactsForFilter').mockImplementation(
    findContactsForFilter,
  )

  orgSlug = `campaign-${CAMPAIGN_ID}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })

  await service.prisma.campaign.create({
    data: {
      id: CAMPAIGN_ID,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe',
      isPro: true,
      details: { state: 'TX', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })

  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: orgSlug, name: 'saved list' },
  })
  filterId = filter.id
})

const orgHeaders = () => ({ headers: { 'x-organization-slug': orgSlug } })

const validDraftBody = () => ({
  voterFileFilterId: filterId,
  audioKey: `robocall/${CAMPAIGN_ID}/clip.webm`,
  callbackNumber: '+15125550123',
  scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  script: 'This is Jane Doe. Paid for by Jane for Council, 512-555-0123.',
})

const postDraft = (body: object) =>
  service.client.post('/v1/outreach/robocall', body, orgHeaders())

describe('POST /v1/outreach/robocall — draft-first create', () => {
  it('persists a pending_payment spine + satellite with the server count', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))

    const res = await postDraft(validDraftBody())

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      outreachId: expect.any(Number),
      billableCount: 500,
      amountInCents: calcRobocallAmountInCents(500),
    })

    // The count is derived with the landline dimension forced on.
    expect(findContactsForFilter).toHaveBeenCalledWith(
      expect.objectContaining({ hasLandline: true }),
      { resultsPerPage: 1, page: 1 },
      expect.objectContaining({ slug: orgSlug }),
    )

    const spine = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: res.data.outreachId },
      include: { robocall: true },
    })
    expect(spine.outreachType).toBe(OutreachType.robocall)
    expect(spine.status).toBe(OutreachStatus.pending_payment)
    expect(spine.voterFileFilterId).toBe(filterId)
    expect(spine.robocall).toMatchObject({
      audioKey: `robocall/${CAMPAIGN_ID}/clip.webm`,
      callbackNumber: '+15125550123',
      billableCount: 500,
      amountInCents: calcRobocallAmountInCents(500),
      settleState: RobocallSettleState.pending_payment,
    })
    // Payment / settlement fields stay unset until the later slices.
    expect(spine.robocall?.authorizationIntentId).toBeNull()
    expect(spine.robocall?.capturedAmountInCents).toBeNull()
    expect(spine.robocall?.payAttempt).toBe(0)
  })

  it('rejects an audioKey from another campaign, writing no row', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))

    const res = await postDraft({
      ...validDraftBody(),
      audioKey: 'robocall/12345/clip.webm',
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    const rows = await service.prisma.outreach.count({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toBe(0)
  })

  it('rejects a filter that is not the org’s', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))

    const res = await postDraft({
      ...validDraftBody(),
      voterFileFilterId: filterId + 9999,
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('rejects an audience with no reachable landlines, writing no row', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(0))

    const res = await postDraft(validDraftBody())

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    const rows = await service.prisma.outreach.count({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toBe(0)
  })

  it('rejects a scheduledAt in the past, writing no row', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))

    const res = await postDraft({
      ...validDraftBody(),
      scheduledAt: new Date(Date.now() - 86_400_000).toISOString(),
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    const rows = await service.prisma.outreach.count({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toBe(0)
  })

  // A double-click / retry must not mint a second billable anchor the
  // hold/settlement slices could charge twice.
  it('is idempotent on a repeat submit: same audio returns the same draft', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))

    const first = await postDraft(validDraftBody())
    const second = await postDraft(validDraftBody())

    expect(first.status).toBe(HttpStatus.CREATED)
    expect(second.data.outreachId).toBe(first.data.outreachId)

    const rows = await service.prisma.outreachRobocall.count({
      where: { outreach: { campaignId: CAMPAIGN_ID } },
    })
    expect(rows).toBe(1)
  })
})
