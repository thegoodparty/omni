import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { Campaign, OutreachType } from '../../generated/prisma'

const service = useTestService()

let campaign: Campaign
let orgSlug: string

beforeEach(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  orgSlug = `campaign-archive-${suffix}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })

  campaign = await service.prisma.campaign.create({
    data: {
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: `archive-campaign-${suffix}`,
      details: {},
      data: {},
      aiContent: {},
    },
  })
})

const orgHeaders = (slug = orgSlug) => ({
  headers: { 'x-organization-slug': slug },
})

const createOutreach = () =>
  service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: OutreachType.nativePhoneBanking,
      name: 'GOTV calls',
    },
  })

describe('PATCH /v1/outreach/:id/archive', () => {
  it('stamps archivedAt when archiving', async () => {
    const outreach = await createOutreach()

    const res = await service.client.patch(
      `/v1/outreach/${outreach.id}/archive`,
      { archived: true },
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.id).toBe(outreach.id)
    expect(res.data.archivedAt).not.toBeNull()

    const persisted = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreach.id },
    })
    expect(persisted.archivedAt).not.toBeNull()
  })

  it('clears archivedAt on restore', async () => {
    const created = await createOutreach()
    await service.prisma.outreach.update({
      where: { id: created.id },
      data: { archivedAt: new Date() },
    })

    const res = await service.client.patch(
      `/v1/outreach/${created.id}/archive`,
      { archived: false },
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.archivedAt).toBeNull()

    const persisted = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: created.id },
    })
    expect(persisted.archivedAt).toBeNull()
  })

  it('404s for an outreach row belonging to another organization and leaves it intact', async () => {
    const outreach = await createOutreach()
    const otherSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const otherSlug = `campaign-archive-other-${otherSuffix}`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        organizationSlug: otherSlug,
        userId: service.user.id,
        slug: `archive-other-campaign-${otherSuffix}`,
        details: {},
        data: {},
        aiContent: {},
      },
    })

    const res = await service.client.patch(
      `/v1/outreach/${outreach.id}/archive`,
      { archived: true },
      { ...orgHeaders(otherSlug), validateStatus: () => true },
    )

    expect(res.status).toBe(404)
    const persisted = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreach.id },
    })
    expect(persisted.archivedAt).toBeNull()
  })
})
