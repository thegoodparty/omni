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
 *   - A zero-landline audience, a past scheduledAt, and a scheduledAt more
 *     than ROBOCALL_MAX_SCHEDULE_DAYS out are all rejected before any row is
 *     written.
 */

import { HttpStatus } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { PeopleListResponse } from '@/contacts/schemas/person.schema'
import {
  calcRobocallTotalInCents,
  ROBOCALL_NUMBER_FEE_CENTS,
} from '@/shared/util/robocallPricing.util'
import { AnalyticsService } from '@/analytics/analytics.service'
import { HubspotSingleSendService } from '@/crm/hubspotSingleSend.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { OutreachRobocallService } from '../services/outreachRobocall.service'
import {
  OutreachStatus,
  OutreachType,
  RobocallSettleState,
} from '../../generated/prisma'

const service = useTestService()

const findContactsForFilter = vi.fn()

let orgSlug: string
let filterId: number

afterEach(() => {
  vi.unstubAllEnvs()
})

const CAMPAIGN_ID = 998

// The S3 ETag the compliance check recorded; the create gate re-reads the
// object's current ETag (mocked in beforeEach) and must match it.
const AUDIO_ETAG = '"etag-clip-v1"'

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
  // The create gate re-reads the audio's current ETag to bind it to the passing
  // verdict. Default it to the fixture's stored ETag so the happy paths match;
  // the mismatch test overrides it.
  vi.spyOn(service.app.get(S3Service), 'headObject').mockResolvedValue({
    contentLength: 1,
    etag: AUDIO_ETAG,
  })
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

  // createDraft now requires a persisted PASSING compliance verdict for the
  // audio it is about to bill for. The default body's audio has cleared it;
  // the gate-specific cases below use their own keys.
  await service.prisma.robocallComplianceResult.create({
    data: {
      audioKey: `robocall/${CAMPAIGN_ID}/clip.webm`,
      passed: true,
      checkedAt: new Date(),
      audioEtag: AUDIO_ETAG,
    },
  })
})

const orgHeaders = () => ({ headers: { 'x-organization-slug': orgSlug } })

const validDraftBody = () => ({
  voterFileFilterId: filterId,
  audioKey: `robocall/${CAMPAIGN_ID}/clip.webm`,
  callbackNumber: '+15125550123',
  // Offset-annotated (the schema rejects a bare UTC 'Z').
  scheduledAt: new Date(Date.now() + 3 * 86_400_000)
    .toISOString()
    .replace('Z', '+00:00'),
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
      amountInCents: calcRobocallTotalInCents(500),
      numberFeeInCents: ROBOCALL_NUMBER_FEE_CENTS,
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
      amountInCents: calcRobocallTotalInCents(500),
      settleState: RobocallSettleState.pending_payment,
    })
    // Payment / settlement fields stay unset until the later slices.
    expect(spine.robocall?.authorizationIntentId).toBeNull()
    expect(spine.robocall?.capturedAmountInCents).toBeNull()
    expect(spine.robocall?.payAttempt).toBe(0)
    // The passing compliance verdict is mirrored onto the draft so the dial
    // step has a durable per-draft fact to gate on.
    expect(spine.robocall?.compliancePassedAt).not.toBeNull()
  })

  it('emits the Scheduled milestone once on a fresh create, not on an idempotent repeat', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))
    const trackSpy = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue(undefined as never)

    const res = await postDraft(validDraftBody())
    expect(res.status).toBe(HttpStatus.CREATED)

    const scheduled = trackSpy.mock.calls.filter(
      (c) => c[1] === EVENTS.Robocall.Scheduled,
    )
    expect(scheduled).toHaveLength(1)
    // Deterministic messageId for downstream dedup.
    expect(scheduled[0]?.[4]).toBe(`${res.data.outreachId}:scheduled`)

    // An idempotent repeat (same audioKey → the existing pending_payment draft)
    // must NOT re-emit: a second Scheduled email would read as a second booking.
    const repeat = await postDraft(validDraftBody())
    expect(repeat.data.outreachId).toBe(res.data.outreachId)
    expect(
      trackSpy.mock.calls.filter((c) => c[1] === EVENTS.Robocall.Scheduled),
    ).toHaveLength(1)
  })

  it('sends the Scheduled single-send email with the scheduled date and amount', async () => {
    vi.stubEnv('HUBSPOT_ROBOCALL_SCHEDULED_EMAIL_ID', '4251')
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))
    const singleSendSpy = vi
      .spyOn(service.app.get(HubspotSingleSendService), 'sendSingleSend')
      .mockResolvedValue(undefined as never)
    const body = validDraftBody()

    const res = await postDraft(body)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(singleSendSpy).toHaveBeenCalledTimes(1)
    expect(singleSendSpy).toHaveBeenCalledWith({
      emailId: 4251,
      to: service.user.email,
      customProperties: {
        outreach_id: String(res.data.outreachId),
        scheduled_at: body.scheduledAt,
        amount_dollars: String(calcRobocallTotalInCents(500) / 100),
      },
    })
  })

  it('does not send a single-send email when HUBSPOT_ROBOCALL_SCHEDULED_EMAIL_ID is unset', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))
    const singleSendSpy = vi
      .spyOn(service.app.get(HubspotSingleSendService), 'sendSingleSend')
      .mockResolvedValue(undefined as never)

    const res = await postDraft(validDraftBody())

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(singleSendSpy).not.toHaveBeenCalled()
  })

  it('still creates the draft when the Scheduled single-send call fails', async () => {
    vi.stubEnv('HUBSPOT_ROBOCALL_SCHEDULED_EMAIL_ID', '4251')
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))
    vi.spyOn(
      service.app.get(HubspotSingleSendService),
      'sendSingleSend',
    ).mockRejectedValue(new Error('hubspot down'))

    const res = await postDraft(validDraftBody())

    expect(res.status).toBe(HttpStatus.CREATED)
    const spine = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: res.data.outreachId },
    })
    expect(spine.status).toBe(OutreachStatus.pending_payment)
  })

  // Local calendar day, not the UTC date: an evening local send whose UTC
  // instant lands on the next day must store the LOCAL day.
  it('captures the local calendar day, not the UTC date', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))
    // A far-future local day at 20:00 -05:00 -> 01:00Z the NEXT day.
    const localDay = new Date(Date.now() + 10 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const res = await postDraft({
      ...validDraftBody(),
      scheduledAt: `${localDay}T20:00:00-05:00`,
    })

    const spine = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: res.data.outreachId },
    })
    expect(spine.scheduledLocalDate).toBe(localDay)
    // The UTC instant is the next day — prove we didn't store that.
    expect(spine.date?.toISOString().slice(0, 10)).not.toBe(localDay)
  })

  it('rejects a Z (UTC, no offset) scheduledAt, writing no row', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))

    const res = await postDraft({
      ...validDraftBody(),
      scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    const rows = await service.prisma.outreach.count({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toBe(0)
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
      // Offset-annotated (passes the Z refine) so the future-date guard, not
      // the offset refine, is what rejects it.
      scheduledAt: new Date(Date.now() - 86_400_000)
        .toISOString()
        .replace('Z', '+00:00'),
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    const rows = await service.prisma.outreach.count({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toBe(0)
  })

  it('rejects a scheduledAt more than 85 days out, writing no row', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))

    const res = await postDraft({
      ...validDraftBody(),
      scheduledAt: new Date(Date.now() + 86 * 86_400_000)
        .toISOString()
        .replace('Z', '+00:00'),
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    const rows = await service.prisma.outreach.count({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toBe(0)
  })

  it('accepts a scheduledAt within 85 days', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))

    const res = await postDraft({
      ...validDraftBody(),
      scheduledAt: new Date(Date.now() + 80 * 86_400_000)
        .toISOString()
        .replace('Z', '+00:00'),
    })

    expect(res.status).toBe(HttpStatus.CREATED)
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

  // The money-critical backstop: when the pre-INSERT lookup misses (the true
  // concurrent race), the INSERT trips unique(audio_key) and the P2002 catch
  // must recover the winner's draft rather than mint a second anchor. Forced
  // deterministically — a Promise.all serializes at the DB layer and would
  // take the read-before-write path instead, never exercising the catch.
  it('recovers from the unique(audio_key) race via the P2002 catch', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))
    const body = validDraftBody()

    // The committed winner.
    const winner = await postDraft(body)

    // Force the loser's pre-INSERT lookup to miss once; its recovery lookup in
    // the catch falls through to the real winner row.
    const robocall = service.app.get(OutreachRobocallService)
    const findFirstSpy = vi
      .spyOn(robocall, 'findFirst')
      .mockResolvedValueOnce(null)

    const loser = await postDraft(body)

    expect(loser.status).toBe(HttpStatus.CREATED)
    expect(loser.data.outreachId).toBe(winner.data.outreachId)
    // Pre-INSERT miss + the catch's recovery lookup.
    expect(findFirstSpy).toHaveBeenCalledTimes(2)
    const rows = await service.prisma.outreachRobocall.count({
      where: { outreach: { campaignId: CAMPAIGN_ID } },
    })
    expect(rows).toBe(1)
    findFirstSpy.mockRestore()
  })

  // MONEY/LEGAL gate: a paid draft can only be created for audio that passed
  // the server-side compliance check, backstopping the client UI gate.
  it('rejects audio with no passing compliance verdict, writing no row', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))

    const res = await postDraft({
      ...validDraftBody(),
      // A valid same-campaign key that never cleared compliance.
      audioKey: `robocall/${CAMPAIGN_ID}/uncleared.webm`,
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.data.message).toContain('compliance')
    // The gate rejects before the people-db count is derived.
    expect(findContactsForFilter).not.toHaveBeenCalled()
    const rows = await service.prisma.outreach.count({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toBe(0)
  })

  it('rejects audio whose compliance verdict FAILED, writing no row', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))
    await service.prisma.robocallComplianceResult.create({
      data: {
        audioKey: `robocall/${CAMPAIGN_ID}/failed.webm`,
        passed: false,
        checkedAt: new Date(),
      },
    })

    const res = await postDraft({
      ...validDraftBody(),
      audioKey: `robocall/${CAMPAIGN_ID}/failed.webm`,
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    const rows = await service.prisma.outreach.count({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toBe(0)
  })

  it('rejects audio whose bytes changed since compliance (ETag mismatch), writing no row', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))
    // The audio's current ETag no longer matches the ETag the verdict was bound
    // to — a re-upload to the presigned key after the pass. Fail closed.
    vi.spyOn(service.app.get(S3Service), 'headObject').mockResolvedValue({
      contentLength: 1,
      etag: '"etag-SWAPPED"',
    })

    const res = await postDraft(validDraftBody())

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    const rows = await service.prisma.outreach.count({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toBe(0)
  })

  it('rejects a passing verdict with no bound ETag (stale), writing no row', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))
    // A verdict recorded before the ETag bind (or whose capture failed) is not
    // trusted — the candidate must re-run compliance.
    await service.prisma.robocallComplianceResult.create({
      data: {
        audioKey: `robocall/${CAMPAIGN_ID}/noetag.webm`,
        passed: true,
        checkedAt: new Date(),
        audioEtag: null,
      },
    })

    const res = await postDraft({
      ...validDraftBody(),
      audioKey: `robocall/${CAMPAIGN_ID}/noetag.webm`,
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    const rows = await service.prisma.outreach.count({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toBe(0)
  })

  it('stamps compliancePassedAt from the passing verdict at create', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))
    const checkedAt = new Date('2026-08-20T12:00:00.000Z')
    await service.prisma.robocallComplianceResult.create({
      data: {
        audioKey: `robocall/${CAMPAIGN_ID}/cleared.webm`,
        passed: true,
        checkedAt,
        audioEtag: AUDIO_ETAG,
      },
    })

    const res = await postDraft({
      ...validDraftBody(),
      audioKey: `robocall/${CAMPAIGN_ID}/cleared.webm`,
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    const satellite = await service.prisma.outreachRobocall.findUniqueOrThrow({
      where: { outreachId: res.data.outreachId },
    })
    expect(satellite.compliancePassedAt?.toISOString()).toBe(
      checkedAt.toISOString(),
    )
    // The verdict's ETag is frozen onto the draft so the dial path re-verifies
    // against the exact approved bytes.
    expect(satellite.complianceAudioEtag).toBe(AUDIO_ETAG)
  })

  it('rejects a non-Pro campaign, writing no row', async () => {
    await service.prisma.campaign.update({
      where: { id: CAMPAIGN_ID },
      data: { isPro: false },
    })

    const res = await postDraft(validDraftBody())

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    // The Pro gate rejects before the service does any people-db work.
    expect(findContactsForFilter).not.toHaveBeenCalled()
    const rows = await service.prisma.outreach.count({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toBe(0)
  })
})
