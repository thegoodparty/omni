import { randomUUID } from 'node:crypto'
import { BadGatewayException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ElectionsService } from '@/elections/services/elections.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

describe('GET /v1/contacts district resolution (ENG-11258)', () => {
  const setupOrg = async () => {
    const slug = `eo-district-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id, positionId: randomUUID() },
    })
    return slug
  }

  const spyOnFindPeople = () =>
    vi
      .spyOn(service.app.get(VoterQueryService), 'findPeople')
      .mockResolvedValue({
        pagination: {
          totalResults: 0,
          currentPage: 1,
          pageSize: 10,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        people: [],
      })

  const list = (slug: string) =>
    service.client.get('/v1/contacts', {
      params: { page: 1, resultsPerPage: 10 },
      headers: { [ORG_SLUG_HEADER]: slug },
    })

  it('serves from the cached district when election-api fails after a successful lookup', async () => {
    const slug = await setupOrg()
    spyOnFindPeople()
    const getPositionById = vi
      .spyOn(service.app.get(ElectionsService), 'getPositionById')
      .mockResolvedValue({ id: 'pos', district: { id: randomUUID() } } as never)

    expect((await list(slug)).status).toBe(200)

    getPositionById.mockRejectedValue(
      new BadGatewayException('election-api down'),
    )
    const second = await list(slug)

    expect(second.status).toBe(200)
    expect(getPositionById).toHaveBeenCalledTimes(1)
  })

  it('still fails when election-api is down and no district was ever resolved', async () => {
    const slug = await setupOrg()
    spyOnFindPeople()
    vi.spyOn(
      service.app.get(ElectionsService),
      'getPositionById',
    ).mockRejectedValue(new BadGatewayException('election-api down'))

    expect((await list(slug)).status).toBe(502)
  })
})
