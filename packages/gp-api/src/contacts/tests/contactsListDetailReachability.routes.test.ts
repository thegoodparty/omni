import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import type { PeopleAggregatesResponse } from '../contacts.types'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

const agg = (count: number): PeopleAggregatesResponse => ({
  count,
  avgAge: null,
  avgIncome: null,
})

// ENG-10798/ENG-10805/ENG-10914: GET /v1/contacts/list-detail's reachability
// block is built from people-db aggregate queries in a fixed order (base,
// cellphone, landline, anyPhone, address). The load-bearing `base` is
// resolved FIRST and gates the four channel scans (skipped when base fails);
// the four channels then still settle INDEPENDENTLY via Promise.allSettled
// (ENG-10806), so one slow channel can't blank the others. Each fixture below
// uses a distinct count per aggregate so a wrong channel<->aggregate mapping
// fails the test, not just a wrong number.
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

  // vitest.config sets clearMocks:true, which clears CALL state before each
  // test but does NOT reset queued mock*Once IMPLEMENTATIONS. With
  // load-shedding a base-failure test consumes only the base mock (the 3
  // channel scans are skipped), so its unconsumed channel mockResolvedValueOnce
  // would otherwise bleed into the next test's getAggregates queue. Reset the
  // spy's implementation queue after every test so each test is order-independent.
  afterEach(() => {
    vi.spyOn(service.app.get(VoterQueryService), 'getAggregates').mockReset()
  })

  // getAggregates runs once per channel in a fixed order — base, cellphone,
  // landline, anyPhone, address — so the mock returns them in that order.
  const mockAggregates = (aggregates: {
    base: PeopleAggregatesResponse
    cellphone: PeopleAggregatesResponse
    landline: PeopleAggregatesResponse
    anyPhone: PeopleAggregatesResponse
    address: PeopleAggregatesResponse
  }) =>
    vi
      .spyOn(service.app.get(VoterQueryService), 'getAggregates')
      .mockResolvedValueOnce(aggregates.base)
      .mockResolvedValueOnce(aggregates.cellphone)
      .mockResolvedValueOnce(aggregates.landline)
      .mockResolvedValueOnce(aggregates.anyPhone)
      .mockResolvedValueOnce(aggregates.address)

  it('maps robocall from the landline aggregate and phoneBanking from the any-phone aggregate', async () => {
    const slug = await setupOrg('mapping')
    mockAggregates({
      base: agg(999),
      cellphone: agg(777),
      landline: agg(222),
      anyPhone: agg(555),
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
        // Robocall stays landline-only (ENG-10914 doesn't change it).
        robocall: 222,
        // phoneBanking (ENG-10914): any phone, cell or landline — its own
        // aggregate, no longer the landline one robocall uses.
        phoneBanking: 555,
        doorKnocking: 111,
        polls: 777,
      }),
    )
  })

  // ENG-10806: the tester's "counts = unavailable" bug — one failed
  // aggregate query used to fail the whole route, flipping every tile to
  // "Unavailable" at once. The four channel queries settle independently.
  it('degrades only robocall when the landline aggregate fails, leaving phoneBanking intact', async () => {
    const slug = await setupOrg('degraded-landline')
    // base, cellphone, (landline fails), anyPhone, address — in call order.
    vi.spyOn(service.app.get(VoterQueryService), 'getAggregates')
      .mockResolvedValueOnce(agg(999))
      .mockResolvedValueOnce(agg(777))
      .mockRejectedValueOnce(new Error('landline aggregate query failed'))
      .mockResolvedValueOnce(agg(555))
      .mockResolvedValueOnce(agg(111))

    const response = await service.client.get('/v1/contacts/list-detail', {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(response.status).toBe(200)
    expect(response.data.demographics.people).toBe(999)
    expect(response.data.reachability).toEqual(
      expect.objectContaining({
        sms: 777,
        // landline failed — only robocall (which it backs) goes null.
        robocall: null,
        // phoneBanking now has its own any-phone aggregate (ENG-10914) and
        // is unaffected by the landline failure.
        phoneBanking: 555,
        doorKnocking: 111,
        polls: 777,
      }),
    )
  })

  it('degrades only phoneBanking when the any-phone aggregate fails, leaving robocall intact', async () => {
    const slug = await setupOrg('degraded-anyphone')
    // base, cellphone, landline, (anyPhone fails), address — in call order.
    vi.spyOn(service.app.get(VoterQueryService), 'getAggregates')
      .mockResolvedValueOnce(agg(999))
      .mockResolvedValueOnce(agg(777))
      .mockResolvedValueOnce(agg(222))
      .mockRejectedValueOnce(new Error('any-phone aggregate query failed'))
      .mockResolvedValueOnce(agg(111))

    const response = await service.client.get('/v1/contacts/list-detail', {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(response.status).toBe(200)
    expect(response.data.demographics.people).toBe(999)
    expect(response.data.reachability).toEqual(
      expect.objectContaining({
        sms: 777,
        robocall: 222,
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
    // gateway to attribute a 502 to. Only the base mock is queued: load-shedding
    // means the four channel scans are never fired on the base-failure path
    // (asserted directly in the next test).
    vi.spyOn(
      service.app.get(VoterQueryService),
      'getAggregates',
    ).mockRejectedValueOnce(new Error('base aggregate query failed'))

    const response = await service.client.get('/v1/contacts/list-detail', {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(response.status).toBe(500)
  })

  // Load-shedding: the base tile is resolved first and gates the four channel
  // scans. When base fails, the route can't render anything anyway, so the
  // channel aggregates are NOT fired — during a people-db statement-timeout
  // incident this stops a failing list-detail from launching 4 extra doomed
  // DistrictVoter->Voter scans that only deepen the overload. So getAggregates
  // runs exactly once on the base-failure path.
  it('does not fire the channel aggregates when the base aggregate fails', async () => {
    const slug = await setupOrg('base-fail-loadshed')
    const spy = vi
      .spyOn(service.app.get(VoterQueryService), 'getAggregates')
      .mockRejectedValueOnce(new Error('base aggregate query failed'))
      .mockResolvedValue(agg(1))

    const response = await service.client.get('/v1/contacts/list-detail', {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(response.status).toBe(500)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
