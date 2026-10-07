import { BadRequestException } from '@nestjs/common'
import { afterEach, describe, expect, it, MockInstance, vi } from 'vitest'
import { CampaignStrategyService } from '@/campaignStrategy/services/campaignStrategy.service'
import { useTestService } from '@/test-service'

const PATH = '/v1/campaigns/launch'
const ORG = { headers: { 'X-Organization-Slug': 'launch-org' } }

// Launch is where every onboarding flow converges, so it is the one place a
// plan is guaranteed to start; the follow-on flow for returning candidates
// never fired the webapp's pre-warm and left them with no plan at all.
describe('POST /v1/campaigns/launch', () => {
  const service = useTestService()

  const seedCampaign = async (overrides: Record<string, unknown> = {}) => {
    await service.prisma.organization.create({
      data: {
        slug: 'launch-org',
        ownerId: service.user.id,
        customPositionName: 'Town Council',
      },
    })
    return service.prisma.campaign.create({
      data: {
        organizationSlug: 'launch-org',
        userId: service.user.id,
        slug: 'launch-org',
        isActive: false,
        details: { raceId: 'br-race', electionDate: '2026-11-03' },
        ...overrides,
      },
    })
  }

  // Restored per test rather than via vi.restoreAllMocks(): the harness
  // stubs session verification with a spy of its own, and restoring all mocks
  // tears that down and 401s every request that follows.
  let generate: MockInstance<
    CampaignStrategyService['getOrGenerateStrategicLandscape']
  >
  const spyGenerate = () => {
    generate = vi.spyOn(
      service.app.get(CampaignStrategyService),
      'getOrGenerateStrategicLandscape',
    )
    return generate
  }

  afterEach(() => {
    generate.mockRestore()
  })

  it('starts plan generation for the campaign it launched', async () => {
    const campaign = await seedCampaign()
    const generate = spyGenerate().mockResolvedValue({ status: 'generating' })

    const res = await service.client.post(PATH, {}, ORG)

    expect(res.status).toBe(200)
    expect(generate).toHaveBeenCalledTimes(1)
    const arg = generate.mock.calls[0]?.[0]
    expect(arg?.id).toBe(campaign.id)
    expect(arg?.user?.id).toBe(service.user.id)
  })

  it('still launches when generation is refused', async () => {
    const campaign = await seedCampaign()
    spyGenerate().mockRejectedValue(
      new BadRequestException('Campaign has no raceId'),
    )

    const res = await service.client.post(PATH, {}, ORG)

    expect(res.status).toBe(200)
    const after = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(after.isActive).toBe(true)
  })

  it('does not trigger again for a campaign that is already launched', async () => {
    await seedCampaign({ isActive: true })
    const generate = spyGenerate().mockResolvedValue({ status: 'generating' })

    const res = await service.client.post(PATH, {}, ORG)

    expect(res.status).toBe(200)
    expect(generate).not.toHaveBeenCalled()
  })
})
