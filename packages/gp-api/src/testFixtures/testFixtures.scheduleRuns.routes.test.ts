import { HttpStatus } from '@nestjs/common'
import { subDays } from 'date-fns'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ElectedOfficeWinSource,
  OutreachStatus,
  OutreachType,
} from '@/generated/prisma'
import { DRAFT_RETENTION_DAYS } from '@/outreach/services/outreachDraftExpiry.service'
import { useTestService } from '@/test-service'
import {
  appEnvOverrides,
  useAppEnvOverrides,
} from '@/shared/test-utils/appEnvOverrides'

useAppEnvOverrides({ IS_NON_PROD_DEPLOY: true, VENDOR_MODE: 'mock' })

const service = useTestService({ jobs: true })

const TEST_USER_EMAIL = 'qa-00000000-0000-0000-0000-000000000000@goodparty.org'

const seedCampaign = async (userId: number) => {
  const slug = `test-campaign-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: userId },
  })
  return service.prisma.campaign.create({
    data: { userId, slug, organizationSlug: slug },
  })
}

const seedDraft = async (campaignId: number, organizationSlug: string) =>
  service.prisma.outreach.create({
    data: {
      campaignId,
      organizationSlug,
      outreachType: OutreachType.p2p,
      status: OutreachStatus.draft,
    },
  })

const runJob = (name: string) =>
  service.client.post(
    `/v1/test-fixtures/vendor-mocks/jobs/${name}/run`,
    {},
    { validateStatus: () => true },
  )

beforeEach(async () => {
  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { email: TEST_USER_EMAIL },
  })
})

describe('the outreachDraftExpiry fixtures', () => {
  const timeTravel = (outreachId: number) =>
    service.client.post(
      '/v1/test-fixtures/vendor-mocks/time-travel',
      { outreachId, action: 'draft.past_retention' },
      { validateStatus: () => true },
    )

  it('expires a draft moved past its retention through the schedule', async () => {
    const campaign = await seedCampaign(service.user.id)
    const stale = await seedDraft(campaign.id, campaign.organizationSlug)
    const fresh = await seedDraft(campaign.id, campaign.organizationSlug)

    const travelled = await timeTravel(stale.id)
    expect(travelled.status).toBe(HttpStatus.CREATED)
    const backdated = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: stale.id },
    })
    expect(backdated.createdAt.getTime()).toBeLessThan(
      subDays(new Date(), DRAFT_RETENTION_DAYS).getTime(),
    )

    const res = await runJob('outreachDraftExpiry')
    expect(res.status).toBe(HttpStatus.CREATED)
    await service.jobs.settle()

    expect(
      await service.prisma.outreach.findUnique({ where: { id: stale.id } }),
    ).toBeNull()
    expect(
      await service.prisma.outreach.findUnique({ where: { id: fresh.id } }),
    ).not.toBeNull()
  })

  it('refuses to backdate an outreach that is not a saved draft', async () => {
    const campaign = await seedCampaign(service.user.id)
    const sent = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: campaign.organizationSlug,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.pending,
      },
    })

    const res = await timeTravel(sent.id)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it("refuses another user's draft", async () => {
    const other = await service.prisma.user.create({
      data: {
        email: `other-${Math.random().toString(36).slice(2)}@example.com`,
        firstName: 'Other',
        lastName: 'User',
      },
    })
    const campaign = await seedCampaign(other.id)
    const draft = await seedDraft(campaign.id, campaign.organizationSlug)

    const res = await timeTravel(draft.id)

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })
})

describe('the winOfficeSweep fixtures', () => {
  const ddhqWin = (campaignId: number) =>
    service.client.post(
      '/v1/test-fixtures/vendor-mocks/actions',
      { campaignId, action: 'ddhq.result.won' },
      { validateStatus: () => true },
    )

  it('creates the office for a DDHQ win only once the schedule runs', async () => {
    const campaign = await seedCampaign(service.user.id)

    const res = await ddhqWin(campaign.id)
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(
      await service.prisma.campaign.findUniqueOrThrow({
        where: { id: campaign.id },
      }),
    ).toMatchObject({ didWin: true })
    expect(
      await service.prisma.electedOffice.findMany({
        where: { campaignId: campaign.id },
      }),
    ).toEqual([])

    const run = await runJob('winOfficeSweep')
    expect(run.status).toBe(HttpStatus.CREATED)
    await service.jobs.settle()

    expect(
      await service.prisma.electedOffice.findMany({
        where: { campaignId: campaign.id },
      }),
    ).toEqual([
      expect.objectContaining({
        userId: service.user.id,
        winSource: ElectedOfficeWinSource.ddhq,
        onboardingCompletedAt: null,
      }),
    ])
  })

  it('writes no win for a non-test user', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'real@example.com' },
    })
    const campaign = await seedCampaign(service.user.id)

    const res = await ddhqWin(campaign.id)

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
    expect(
      await service.prisma.campaign.findUniqueOrThrow({
        where: { id: campaign.id },
      }),
    ).toMatchObject({ didWin: null })
  })

  it('writes no win where vendors are live', async () => {
    appEnvOverrides.VENDOR_MODE = 'live'
    const campaign = await seedCampaign(service.user.id)

    const res = await ddhqWin(campaign.id)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(
      await service.prisma.campaign.findUniqueOrThrow({
        where: { id: campaign.id },
      }),
    ).toMatchObject({ didWin: null })
  })
})

describe('the schedule runs', () => {
  it.each(['outreachDraftExpiry', 'winOfficeSweep'])(
    '%s is not served where vendors are live',
    async (name) => {
      appEnvOverrides.VENDOR_MODE = 'live'

      const res = await runJob(name)

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    },
  )

  it('refuses a non-test user', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'real@example.com' },
    })

    const res = await runJob('winOfficeSweep')

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })
})
