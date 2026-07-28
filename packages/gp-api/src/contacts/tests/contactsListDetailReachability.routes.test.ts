import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import type { FilterObject } from '../utils/voterFileFilter.utils'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

// ENG-10798/ENG-10805: GET /v1/contacts/list-detail's reachability block is
// built from four concurrent people-api aggregates calls (base, cellphone,
// landline, address). Each fixture below uses a distinct count per aggregate
// so a wrong channel<->aggregate mapping fails the test, not just a wrong
// number.
describe('GET /v1/contacts/list-detail reachability', () => {
  const setupOrg = async (suffix: string) => {
    const slug = `eo-list-detail-reach-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: `district-list-detail-reach-${suffix}`,
      },
    })
    return slug
  }

  const mockAggregates = (aggregates: {
    base: { count: number; fenced?: boolean }
    cellphone: { count: number; fenced?: boolean }
    landline: { count: number; fenced?: boolean }
    address: { count: number; fenced?: boolean }
  }) =>
    vi
      .spyOn(service.app.get(HttpService), 'post')
      .mockImplementation((_url, body) => {
        const filters = (body as { filters: FilterObject }).filters
        const match = filters.hasCellPhone
          ? aggregates.cellphone
          : filters.hasLandline
            ? aggregates.landline
            : filters.hasAddress
              ? aggregates.address
              : aggregates.base
        return of({
          data: { avgAge: null, avgIncome: null, ...match },
        }) as never
      })

  it('maps robocall reachability from the landline aggregate, not cellphone', async () => {
    const slug = await setupOrg('mapping')
    mockAggregates({
      base: { count: 999 },
      cellphone: { count: 777 },
      landline: { count: 222 },
      address: { count: 111 },
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
      base: { count: 500, fenced: false },
      cellphone: { count: 400, fenced: true },
      landline: { count: 300, fenced: false },
      address: { count: 200, fenced: false },
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
})
