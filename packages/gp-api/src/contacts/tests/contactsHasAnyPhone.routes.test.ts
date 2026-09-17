import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

// ENG-10957: hasAnyPhone is a count-only overlay (phone banking's builder
// count), not a persisted VoterFileFilter column. CountContactsDTO extends
// the base schema with it — without that extension the default z.object
// silently strips the key and the count quietly ignores the overlay, which
// is exactly the regression this pins against.
describe('POST /v1/contacts/count hasAnyPhone overlay', () => {
  const setupOrg = async (suffix: string) => {
    const slug = `eo-any-phone-${suffix}-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: randomUUID(),
      },
    })
    return slug
  }

  const spyOnFindPeople = () =>
    vi
      .spyOn(service.app.get(VoterQueryService), 'findPeople')
      .mockResolvedValue({
        pagination: {
          totalResults: 7,
          currentPage: 1,
          pageSize: 1,
          totalPages: 7,
          hasNextPage: true,
          hasPreviousPage: false,
        },
        people: [],
      })

  it('forwards hasAnyPhone to the people-db query', async () => {
    const slug = await setupOrg('fwd')
    const findPeopleSpy = spyOnFindPeople()

    const response = await service.client.post(
      '/v1/contacts/count',
      { hasAnyPhone: true },
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )

    expect(response.status).toBe(201)
    expect(response.data).toEqual({ count: 7 })
    expect(findPeopleSpy).toHaveBeenCalledTimes(1)
    expect(findPeopleSpy.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        filters: expect.objectContaining({
          filterOperators: expect.objectContaining({
            hasAnyPhone: expect.objectContaining({
              operator: 'is',
              value: 'not_null',
            }),
          }),
        }),
      }),
    )
  })
})
