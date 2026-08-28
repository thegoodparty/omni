import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { BadGatewayException } from '@nestjs/common'
import type { PeopleListDetailAggregatesResponse } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

// ENG-10798/ENG-10805/ENG-10914: GET /v1/contacts/list-detail's reachability
// block is derived from a single people-db call that returns the demographics
// and every channel count together. Distinct counts per field below so a wrong
// channel<->field mapping fails the test, not just a wrong number.
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

  const mockAggregates = (
    aggregates: Partial<PeopleListDetailAggregatesResponse>,
  ) =>
    vi
      .spyOn(service.app.get(VoterQueryService), 'getListDetailAggregates')
      .mockResolvedValue({
        count: 999,
        avgAge: null,
        avgIncome: null,
        sms: 777,
        robocall: 222,
        phoneBanking: 555,
        doorKnocking: 111,
        ...aggregates,
      })

  it('maps robocall from the landline count and phoneBanking from the any-phone count', async () => {
    const slug = await setupOrg('mapping')
    const spy = mockAggregates({})

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
        // conditional count, not the landline one robocall uses.
        phoneBanking: 555,
        doorKnocking: 111,
        // Polls are delivered by text, so reachability mirrors sms 1:1.
        polls: 777,
      }),
    )
    // The whole grid comes from one people-db call. Five per request was
    // ~half of prod's Databricks statement volume and manufactured the
    // in-flight concurrency that triggers a compute-provisioning wait.
    expect(spy).toHaveBeenCalledOnce()
  })

  // All-or-nothing: there is no per-channel settling to degrade to, so a
  // failing aggregate has to fail the route rather than render zeroed or
  // partially-blank tiles that read as real numbers.
  it('fails the whole route when the aggregate call fails', async () => {
    const slug = await setupOrg('fail')
    vi.spyOn(
      service.app.get(VoterQueryService),
      'getListDetailAggregates',
    ).mockRejectedValue(new BadGatewayException('warehouse unavailable'))

    const response = await service.client.get('/v1/contacts/list-detail', {
      headers: { [ORG_SLUG_HEADER]: slug },
    })

    expect(response.status).toBe(502)
  })
})
