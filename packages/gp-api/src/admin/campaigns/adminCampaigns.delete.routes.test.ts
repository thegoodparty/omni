import { BadGatewayException, HttpStatus } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { Campaign, UserRole } from '../../generated/prisma'

const service = useTestService()

const SUBSCRIPTION_ID = 'sub_test_admin_delete'

describe('DELETE /v1/admin/campaigns/:id', () => {
  let campaign: Campaign

  const createCampaign = async (subscriptionId?: string) => {
    const slug = `admin-delete-${randomUUID()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    return service.prisma.campaign.create({
      data: {
        slug,
        organizationSlug: slug,
        userId: service.user.id,
        isPro: Boolean(subscriptionId),
        details: subscriptionId ? { subscriptionId } : {},
      },
    })
  }

  const spyOnCancel = () =>
    vi.spyOn(service.app.get(StripeService), 'cancelSubscription')

  beforeEach(async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.admin] },
    })
    vi.spyOn(service.app.get(SlackService), 'message').mockResolvedValue(
      undefined,
    )
  })

  it('cancels the Pro subscription before deleting the campaign', async () => {
    campaign = await createCampaign(SUBSCRIPTION_ID)
    const cancel = spyOnCancel().mockResolvedValue(null)

    const res = await service.client.delete(
      `/v1/admin/campaigns/${campaign.id}`,
    )

    expect(res.status).toBe(HttpStatus.NO_CONTENT)
    expect(cancel).toHaveBeenCalledExactlyOnceWith(SUBSCRIPTION_ID)
    expect(
      await service.prisma.campaign.findUnique({ where: { id: campaign.id } }),
    ).toBeNull()
  })

  it('keeps the campaign when Stripe cannot confirm the cancel', async () => {
    campaign = await createCampaign(SUBSCRIPTION_ID)
    spyOnCancel().mockRejectedValue(
      new BadGatewayException(`Failed to cancel subscription`),
    )

    const res = await service.client.delete(
      `/v1/admin/campaigns/${campaign.id}`,
    )

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
    const kept = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(kept.details?.subscriptionId).toBe(SUBSCRIPTION_ID)
  })

  it('deletes a campaign with no subscription without calling Stripe', async () => {
    campaign = await createCampaign()
    const cancel = spyOnCancel()

    const res = await service.client.delete(
      `/v1/admin/campaigns/${campaign.id}`,
    )

    expect(res.status).toBe(HttpStatus.NO_CONTENT)
    expect(cancel).not.toHaveBeenCalled()
    expect(
      await service.prisma.campaign.findUnique({ where: { id: campaign.id } }),
    ).toBeNull()
  })
})
