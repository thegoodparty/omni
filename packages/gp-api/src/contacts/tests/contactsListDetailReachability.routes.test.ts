import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import type { PeopleAggregatesResponse } from '../contacts.types'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

const agg = (count: number, fenced?: boolean): PeopleAggregatesResponse => ({
  count,
  avgAge: null,
  avgIncome: null,
  ...(fenced === undefined ? {} : { fenced }),
})

// ENG-10798/ENG-10805: GET /v1/contacts/list-detail's reachability block is
// built from four concurrent people-db aggregate queries, resolved in a
// fixed order (base, cellphone, landline, address) via Promise.allSettled.
// Each fixture below uses a distinct count per aggregate so a wrong
// channel<->aggregate mapping fails the test, not just a wrong number.
describe('GET /v1/contacts/list-detail reachability', () => {
  const setupOrg = async (suffix: string) => {
    const slug = `eo-list-detail-reach-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        // The ported people-db services run their DTOs through Zod, whose
        // districtId field is z.guid() — a non-UUID placeholder would fail
        // validation before the aggregate query runs.
        overrideDistrictId: randomUUID(),
      },
    })
    return slug
  }

  // getAggregates runs once per channel in a fixed order — base, cellphone,
  // landline, address — so the mock returns them in that order.
  const mockAggregates = (aggregates: {
    base: PeopleAggregatesResponse
    cellphone: PeopleAggregatesResponse
    landline: PeopleAggregatesResponse
    address: PeopleAggregatesResponse
  }) =>
    vi
      .spyOn(service.app.get(VoterQueryService), 'getAggregates')
      .mockResolvedValueOnce(aggregates.base)
      .mockResolvedValueOnce(aggregates.cellphone)
      .mockResolvedValueOnce(aggregates.landline)
      .mockResolvedValueOnce(aggregates.address)

  it('maps robocall reachability from the landline aggregate, not cellphone', async () => {
    const slug = await setupOrg('mapping')
    mockAggregates({
      base: agg(999),
      cellphone: agg(777),
      landline: agg(222),
      address: agg(111),
    })

    const response = await service.client.get('/v1/contacts/list-detail', {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(response.status).toBe(200)
    expect(response.data.demographics.people).toBe(999)
    expect(response.data.reachability).toEqual(
      expect.objectContaining({
        sms: 777,
        // The bug: this used to read cellphone.count (777) instead of the
        // landline aggregate (222).
        robocall: 222,
        phoneBanking: 222,
        doorKnocking: 111,
        polls: 777,
      }),
    )
  })

  it('surfaces each channel fenced flag from its own aggregate', async () => {
    const slug = await setupOrg('fenced')
    mockAggregates({
      base: agg(500, false),
      cellphone: agg(400, true),
      landline: agg(300, false),
      address: agg(200, false),
    })

    const response = await service.client.get('/v1/contacts/list-detail', {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(response.status).toBe(200)
    expect(response.data.demographics.fenced).toBe(false)
    expect(response.data.reachability.fenced).toEqual({
      sms: true,
      robocall: false,
      phoneBanking: false,
      doorKnocking: false,
      // Polls mirrors sms's count, so it mirrors sms's fenced-ness too.
      polls: true,
    })
  })

  // ENG-10806: the tester's "counts = unavailable" bug — one failed
  // aggregate query used to fail the whole route, flipping every tile to
  // "Unavailable" at once. The four queries now settle independently.
  it('degrades only the failed channel when one non-base aggregate fails', async () => {
    const slug = await setupOrg('degraded')
    // base, cellphone, (landline fails), address — in call order.
    vi.spyOn(service.app.get(VoterQueryService), 'getAggregates')
      .mockResolvedValueOnce(agg(999))
      .mockResolvedValueOnce(agg(777))
      .mockRejectedValueOnce(new Error('landline aggregate query failed'))
      .mockResolvedValueOnce(agg(111))

    const response = await service.client.get('/v1/contacts/list-detail', {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(response.status).toBe(200)
    expect(response.data.demographics.people).toBe(999)
    expect(response.data.reachability).toEqual(
      expect.objectContaining({
        sms: 777,
        // landline failed — both channels it backs go null, not 0/missing.
        robocall: null,
        phoneBanking: null,
        doorKnocking: 111,
        polls: 777,
      }),
    )
  })

  it('fails the whole route when the base aggregate fails', async () => {
    const slug = await setupOrg('base-fail')
    // The base (first) query fails; there's nothing to render without it, so
    // the route surfaces the error rather than a partial tile set. An
    // in-process query failure propagates as a 500 — there is no external
    // gateway to attribute a 502 to.
    vi.spyOn(service.app.get(VoterQueryService), 'getAggregates')
      .mockRejectedValueOnce(new Error('base aggregate query failed'))
      .mockResolvedValueOnce(agg(1))
      .mockResolvedValueOnce(agg(1))
      .mockResolvedValueOnce(agg(1))

    const response = await service.client.get('/v1/contacts/list-detail', {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(response.status).toBe(500)
  })
})
