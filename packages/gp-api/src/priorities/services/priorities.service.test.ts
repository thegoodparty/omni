import { useTestService } from '@/test-service'
import { beforeEach, describe, expect, it } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import { PrioritySource } from '../../generated/prisma'
import { PrioritiesService } from './priorities.service'

const service = useTestService()

let priorities: PrioritiesService

const createOffice = async (campaignId?: number) => {
  const id = uuidv7()
  const slug = `eo-${id}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { id, userId: service.user.id, organizationSlug: slug, campaignId },
  })
  return id
}

const createCampaign = async (
  details: { customIssues?: { title: string; position: string }[] } = {},
) => {
  const slug = `campaign-${uuidv7()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: { slug, userId: service.user.id, organizationSlug: slug, details },
  })
  return campaign.id
}

beforeEach(() => {
  priorities = service.app.get(PrioritiesService)
})

describe('PrioritiesService.seedFromWin', () => {
  it('seeds from Campaign.details.customIssues', async () => {
    const campaignId = await createCampaign({
      customIssues: [
        { title: 'Affordable housing', position: 'Build more units' },
        { title: 'Safe streets', position: 'Fund traffic calming' },
      ],
    })
    const officeId = await createOffice(campaignId)

    await priorities.seedFromWin(officeId)

    const seeded = await priorities.listActive(officeId)
    expect(seeded).toHaveLength(2)
    expect(seeded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Affordable housing',
          description: 'Build more units',
          source: PrioritySource.win_import,
          sourceCampaignPositionId: null,
        }),
      ]),
    )
  })

  it('falls back to campaignPositions when customIssues is absent', async () => {
    const campaignId = await createCampaign({})
    const position = await service.prisma.position.create({
      data: { name: `Education ${uuidv7()}` },
    })
    const cp = await service.prisma.campaignPosition.create({
      data: {
        campaignId,
        positionId: position.id,
        description: 'Fully fund local schools',
      },
    })
    const officeId = await createOffice(campaignId)

    await priorities.seedFromWin(officeId)

    const seeded = await priorities.listActive(officeId)
    expect(seeded).toHaveLength(1)
    expect(seeded[0]).toMatchObject({
      title: position.name,
      description: 'Fully fund local schools',
      source: PrioritySource.win_import,
      sourceCampaignPositionId: cp.id,
    })
  })

  it('skips seeding when the office has no linked campaign', async () => {
    const officeId = await createOffice()

    await priorities.seedFromWin(officeId)

    expect(await priorities.listActive(officeId)).toHaveLength(0)
  })

  it('is idempotent across repeated runs', async () => {
    const campaignId = await createCampaign({
      customIssues: [{ title: 'Parks', position: 'Expand green space' }],
    })
    const officeId = await createOffice(campaignId)

    await priorities.seedFromWin(officeId)
    await priorities.seedFromWin(officeId)

    expect(await priorities.listActive(officeId)).toHaveLength(1)
  })
})

describe('PrioritiesService CRUD', () => {
  it('archive hides a priority from listActive', async () => {
    const officeId = await createOffice()
    const created = await priorities.create(
      officeId,
      { title: 'Transit', description: 'More buses' },
      PrioritySource.user_stated,
    )

    expect(await priorities.listActive(officeId)).toHaveLength(1)

    const archived = await priorities.archive(created.id, officeId)
    expect(archived).toBe(true)
    expect(await priorities.listActive(officeId)).toHaveLength(0)
  })

  it('update is scoped to the owning office', async () => {
    const officeId = await createOffice()
    const created = await priorities.create(
      officeId,
      { title: 'Original', description: 'desc' },
      PrioritySource.user_stated,
    )

    const otherOfficeId = uuidv7()
    const result = await priorities.update(created.id, otherOfficeId, {
      title: 'Hijacked',
    })

    expect(result).toBeNull()
    const reread = await priorities.listActive(officeId)
    expect(reread[0]).toMatchObject({ title: 'Original' })
  })
})
