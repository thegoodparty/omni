import { useTestService } from '@/test-service'
import { CommunityIssueDispatchService } from '@/communityIssues/services/communityIssueDispatch.service'
import { MeetingBriefingsService } from '@/meetings/services/meetingBriefings.service'
import { OrdinanceDispatchService } from '@/ordinances/services/ordinanceDispatch.service'
import { CampaignsController } from '@/campaigns/campaigns.controller'
import { addYears, format, subMonths } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Campaign, Prisma, UserRole } from '../generated/prisma'
import { WinOfficeService } from './services/winOffice.service'

const service = useTestService()

const PAST_ELECTION = format(subMonths(new Date(), 1), 'yyyy-MM-dd')
const NEXT_ELECTION = format(addYears(new Date(), 1), 'yyyy-MM-dd')

describe('a win creates a dormant elected office', () => {
  let campaign: Campaign
  let orgSlug: string
  let headers: { 'x-organization-slug': string }
  let hooks: ReturnType<typeof vi.spyOn>[]

  const createCampaign = async (
    data: Partial<Prisma.CampaignUncheckedCreateInput> = {},
  ) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const slug = `campaign-win-${suffix}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id, customPositionName: 'Mayor' },
    })
    return service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug,
        organizationSlug: slug,
        details: { electionDate: PAST_ELECTION, party: 'Green Party' },
        ...data,
      },
    })
  }

  const officesFor = (campaignId: number) =>
    service.prisma.electedOffice.findMany({ where: { campaignId } })

  const saveMine = (details: Record<string, unknown>) =>
    service.client.put('/v1/campaigns/mine', { details }, { headers })

  beforeEach(async () => {
    campaign = await createCampaign()
    orgSlug = campaign.organizationSlug
    headers = { 'x-organization-slug': orgSlug }
    hooks = [
      vi.spyOn(
        service.app.get(MeetingBriefingsService),
        'onElectedOfficeCreated',
      ),
      vi.spyOn(
        service.app.get(CommunityIssueDispatchService),
        'onElectedOfficeCreated',
      ),
      vi.spyOn(
        service.app.get(OrdinanceDispatchService),
        'onElectedOfficeCreated',
      ),
    ]
    hooks.forEach((hook) => hook.mockResolvedValue(undefined))
  })

  describe('self-reported', () => {
    it('creates one unfinished office shaped like the Pro handoff', async () => {
      const res = await saveMine({ wonGeneral: true })
      expect(res.status).toBe(200)

      const [office, ...rest] = await officesFor(campaign.id)
      expect(rest).toHaveLength(0)
      expect(office).toMatchObject({
        userId: service.user.id,
        winSource: 'self_reported',
        onboardingCompletedAt: null,
        onboardingStep: 'confirm',
        party: 'independent',
      })
      const org = await service.prisma.organization.findUniqueOrThrow({
        where: { slug: office?.organizationSlug },
      })
      expect(org.customPositionName).toBe('Mayor')
      hooks.forEach((hook) => expect(hook).not.toHaveBeenCalled())
    })

    it('never adds a second office to a campaign that has one', async () => {
      const handoff = await service.client.post(
        '/v1/elected-office',
        { onboardingStep: 'confirm' },
        { headers },
      )
      expect(handoff.status).toBe(200)

      await saveMine({ wonGeneral: true })
      await saveMine({ wonGeneral: true })

      const offices = await officesFor(campaign.id)
      expect(offices.map((o) => o.id)).toEqual([handoff.data.id])
    })

    it('deletes the dormant office and its org when the win becomes a loss', async () => {
      await saveMine({ wonGeneral: true })
      const [office] = await officesFor(campaign.id)
      await service.prisma.organizationMembership.create({
        data: {
          organizationSlug: office!.organizationSlug,
          userId: service.user.id,
          role: 'owner',
        },
      })

      await saveMine({ wonGeneral: false })

      expect(await officesFor(campaign.id)).toHaveLength(0)
      expect(
        await service.prisma.organization.findUnique({
          where: { slug: office!.organizationSlug },
        }),
      ).toBeNull()
      expect(
        await service.prisma.organizationMembership.count({
          where: { organizationSlug: office!.organizationSlug },
        }),
      ).toBe(0)
      expect(
        await service.prisma.organization.findUnique({
          where: { slug: orgSlug },
        }),
      ).not.toBeNull()
    })

    it('keeps an office whose holder finished onboarding', async () => {
      await saveMine({ wonGeneral: true })
      const [office] = await officesFor(campaign.id)
      await service.prisma.electedOffice.update({
        where: { id: office!.id },
        data: { onboardingCompletedAt: new Date() },
      })

      await saveMine({ wonGeneral: false })

      expect(await officesFor(campaign.id)).toHaveLength(1)
    })

    it('deletes the dormant office when the candidate runs again', async () => {
      await saveMine({ wonGeneral: true })
      expect(await officesFor(campaign.id)).toHaveLength(1)

      await saveMine({ electionDate: NEXT_ELECTION })

      expect(await officesFor(campaign.id)).toHaveLength(0)
    })

    it('leaves an office a win did not create', async () => {
      await service.prisma.organization.create({
        data: { slug: 'eo-lead-office', ownerId: service.user.id },
      })
      await service.prisma.electedOffice.create({
        data: {
          id: 'lead-office',
          userId: service.user.id,
          campaignId: campaign.id,
          organizationSlug: 'eo-lead-office',
        },
      })

      await saveMine({ wonGeneral: false })

      expect(await officesFor(campaign.id)).toHaveLength(1)
    })
  })

  describe('staff', () => {
    beforeEach(async () => {
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: { roles: [UserRole.admin] },
      })
    })

    it('creates the office when an admin records the win, and removes it on a loss', async () => {
      const won = await service.client.put(
        `/v1/admin/campaigns/${campaign.id}`,
        { didWin: true },
      )
      expect(won.status).toBe(200)
      const [office] = await officesFor(campaign.id)
      expect(office?.winSource).toBe('staff')

      await service.client.put(`/v1/admin/campaigns/${campaign.id}`, {
        didWin: false,
      })
      expect(await officesFor(campaign.id)).toHaveLength(0)
    })

    it('creates the office from the M2M campaign update', async () => {
      await service.app
        .get(CampaignsController)
        .updateCampaign({ id: campaign.id }, { didWin: true })

      const [office] = await officesFor(campaign.id)
      expect(office?.winSource).toBe('staff')
    })
  })

  describe('sweep (DDHQ write-back and backfill)', () => {
    it('creates offices for wins written outside gp-api, with the inferred source', async () => {
      const ddhq = await createCampaign({ didWin: true })
      const hubSpot = await createCampaign({
        data: { hubSpotUpdates: { election_results: 'Won General' } },
      })
      const self = await createCampaign({
        details: { electionDate: PAST_ELECTION, wonGeneral: true },
      })
      const lost = await createCampaign({
        didWin: false,
        data: { hubSpotUpdates: { election_results: 'Won General' } },
      })
      const rerun = await createCampaign({
        details: { electionDate: NEXT_ELECTION },
        data: { hubSpotUpdates: { election_results: 'Won General' } },
      })
      const testMode = await createCampaign({ didWin: true })
      await service.prisma.organization.update({
        where: { slug: testMode.organizationSlug },
        data: { testModeCreatedAt: new Date() },
      })

      const result = await service.app.get(WinOfficeService).sweepOnce()

      expect(result.created).toBe(3)
      const sources = async (id: number) =>
        (await officesFor(id)).map((o) => o.winSource)
      expect(await sources(ddhq.id)).toEqual(['ddhq'])
      expect(await sources(hubSpot.id)).toEqual(['ddhq'])
      expect(await sources(self.id)).toEqual(['self_reported'])
      expect(await sources(lost.id)).toEqual([])
      expect(await sources(rerun.id)).toEqual([])
      expect(await sources(testMode.id)).toEqual([])
      hooks.forEach((hook) => expect(hook).not.toHaveBeenCalled())

      expect(
        (await service.app.get(WinOfficeService).sweepOnce()).created,
      ).toBe(0)
    })

    it('skips a Pro win whose election is over a year old', async () => {
      const oldPro = await createCampaign({
        isPro: true,
        didWin: true,
        details: { electionDate: '2024-11-05' },
      })
      const recentPro = await createCampaign({ isPro: true, didWin: true })

      await service.app.get(WinOfficeService).sweepOnce()

      expect(await officesFor(oldPro.id)).toHaveLength(0)
      expect(await officesFor(recentPro.id)).toHaveLength(1)
    })

    it('runs once per daily slot across replicas', async () => {
      const winOffices = service.app.get(WinOfficeService)
      const pass = vi
        .spyOn(winOffices, 'sweepOnce')
        .mockResolvedValue({ created: 0, removed: 0 })
      const now = new Date()

      await Promise.all([winOffices.sweep(now), winOffices.sweep(now)])

      expect(pass).toHaveBeenCalledTimes(1)
      pass.mockRestore()
    })

    it('removes a dormant office whose win the pipeline withdrew', async () => {
      await saveMine({ wonGeneral: true })
      await service.prisma.campaign.update({
        where: { id: campaign.id },
        data: { didWin: false },
      })

      const result = await service.app.get(WinOfficeService).sweepOnce()

      expect(result.removed).toBe(1)
      expect(await officesFor(campaign.id)).toHaveLength(0)
    })
  })
})
