import {
  AUTH_PROVIDER_TOKEN,
  AuthProvider,
} from '@/authentication/interfaces/auth-provider.interface'
import { ElectionsService } from '@/elections/services/elections.service'
import { useTestService } from '@/test-service'
import { BadGatewayException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = useTestService()

describe('GET /v1/campaigns/list', () => {
  beforeEach(async () => {
    vi.spyOn(
      service.app.get<AuthProvider>(AUTH_PROVIDER_TOKEN),
      'verifyM2MToken',
    ).mockResolvedValue({ id: 'mt_test', subject: 'test-machine' })

    const slug = `list-degrade-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id, positionId: 'pos-1' },
    })
    await service.prisma.campaign.create({
      data: {
        slug,
        organizationSlug: slug,
        userId: service.user.id,
        details: {},
      },
    })
  })

  const list = () =>
    service.client.get('/v1/campaigns/list', {
      params: { userId: service.user.id },
      headers: { Authorization: 'Bearer mt_test' },
    })

  it('returns the campaign with a null positionName when election-api is unavailable', async () => {
    vi.spyOn(
      service.app.get(ElectionsService),
      'getPositionById',
    ).mockRejectedValue(new BadGatewayException('election-api down'))

    const result = await list()

    expect(result.status).toBe(200)
    expect(result.data.data).toHaveLength(1)
    expect(result.data.data[0].positionName).toBeNull()
  })

  it('returns the resolved positionName when election-api answers', async () => {
    vi.spyOn(
      service.app.get(ElectionsService),
      'getPositionById',
    ).mockResolvedValue({ id: 'pos-1', name: 'Mayor' } as never)

    const result = await list()

    expect(result.status).toBe(200)
    expect(result.data.data[0].positionName).toBe('Mayor')
  })
})
