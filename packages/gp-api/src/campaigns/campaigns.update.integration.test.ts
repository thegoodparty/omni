import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { isActiveCampaign } from '@/campaigns/util/eligibility.util'
import { useTestService } from '@/test-service'
import { InternalServerErrorException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

const service = useTestService()

const seedCampaign = async () => {
  const org = await service.prisma.organization.create({
    data: { slug: 'campaign-org-update', ownerId: service.user.id },
  })
  const campaign = await service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: 'update-run',
      details: { state: 'CA' },
      organizationSlug: org.slug,
    },
  })
  return { org, campaign }
}

describe('PUT /v1/campaigns/mine (updateJsonFields)', () => {
  it('deep-merges json details, persists, and returns the campaign', async () => {
    const { org, campaign } = await seedCampaign()
    const crm = service.app.get(CrmCampaignsService)
    vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)

    const result = await service.client.put(
      '/v1/campaigns/mine',
      { details: { city: 'Oakland' } },
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(result.status).toBe(200)
    expect(result.data.id).toBe(campaign.id)
    expect(result.data.details).toMatchObject({
      state: 'CA',
      city: 'Oakland',
    })

    const persisted = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(persisted.details).toMatchObject({ state: 'CA', city: 'Oakland' })
  })

  it('tracks the campaign in the CRM on a successful update', async () => {
    const { org, campaign } = await seedCampaign()
    const crm = service.app.get(CrmCampaignsService)
    const trackSpy = vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)

    const result = await service.client.put(
      '/v1/campaigns/mine',
      { details: { city: 'Oakland' } },
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(result.status).toBe(200)
    expect(trackSpy).toHaveBeenCalledWith(campaign.id)
  })
})

describe('PUT /v1/campaigns/mine — ballotStatus column', () => {
  it('persists the top-level ballotStatus to the column', async () => {
    const { org, campaign } = await seedCampaign()
    const crm = service.app.get(CrmCampaignsService)
    vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)

    const result = await service.client.put(
      '/v1/campaigns/mine',
      { ballotStatus: 'qualified-not-filed' },
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(result.status).toBe(200)
    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.ballotStatus).toBe('qualified-not-filed')
  })

  // The deprecated details key is what a frontend from before the cutover
  // sends. It has to land on the column, not be silently stripped the way the
  // details allowlist stripped it between 2026-05-20 and this change.
  it('forwards the deprecated details.ballotStatus to the column', async () => {
    const { org, campaign } = await seedCampaign()
    const crm = service.app.get(CrmCampaignsService)
    vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)

    const result = await service.client.put(
      '/v1/campaigns/mine',
      { details: { ballotStatus: 'considering' } },
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(result.status).toBe(200)
    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.ballotStatus).toBe('considering')
    expect(row.details).not.toHaveProperty('ballotStatus')
  })

  it('drops a stale details copy on the next unrelated update', async () => {
    const { org, campaign } = await seedCampaign()
    // ballotStatus is no longer part of CampaignDetails, which is the whole
    // point — this seeds the legacy shape rows still carry.
    const legacyDetails: PrismaJson.CampaignDetails = { state: 'CA' }
    Reflect.set(legacyDetails, 'ballotStatus', 'on-ballot')
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { details: legacyDetails },
    })
    const crm = service.app.get(CrmCampaignsService)
    vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)

    await service.client.put(
      '/v1/campaigns/mine',
      { details: { city: 'Oakland' } },
      { headers: { 'x-organization-slug': org.slug } },
    )

    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.details).not.toHaveProperty('ballotStatus')
  })

  it('rejects an unknown ballotStatus rather than dropping it', async () => {
    const { org } = await seedCampaign()

    const result = await service.client.put(
      '/v1/campaigns/mine',
      { ballotStatus: 'maybe' },
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(result.status).toBe(400)
  })
})

describe('PUT /v1/campaigns/mine — signupGoal column', () => {
  it('persists the top-level signupGoal to the column', async () => {
    const { org, campaign } = await seedCampaign()
    const crm = service.app.get(CrmCampaignsService)
    vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)

    const result = await service.client.put(
      '/v1/campaigns/mine',
      { signupGoal: 'voter-outreach' },
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(result.status).toBe(200)
    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.signupGoal).toBe('voter-outreach')
  })

  it('rejects an unknown signupGoal rather than dropping it', async () => {
    const { org } = await seedCampaign()

    const result = await service.client.put(
      '/v1/campaigns/mine',
      { signupGoal: 'something-else' },
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(result.status).toBe(400)
  })

  // Unlike ballotStatus there is no legacy details copy to forward: this
  // answer has only ever been a column, and the allowlist does not name it.
  it('leaves the column unset when the goal is sent in details', async () => {
    const { org, campaign } = await seedCampaign()
    const crm = service.app.get(CrmCampaignsService)
    vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)

    const details: PrismaJson.CampaignDetails = { state: 'CA' }
    Reflect.set(details, 'signupGoal', 'voter-data')

    await service.client.put(
      '/v1/campaigns/mine',
      { details },
      {
        headers: { 'x-organization-slug': org.slug },
      },
    )

    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.signupGoal).toBeNull()
    expect(row.details).not.toHaveProperty('signupGoal')
  })
})

describe('PUT /v1/campaigns/mine — stale election-result reset (ENG-10954)', () => {
  // A re-running candidate reuses their campaign: didWin / primaryResult /
  // details.wonGeneral recorded for the prior race permanently fail
  // isActiveCampaign on the new race unless cleared when the election date
  // moves to a new upcoming date.
  const seedRerunCampaign = async (
    details: PrismaJson.CampaignDetails = {
      state: 'CA',
      electionDate: '2024-11-05',
      primaryElectionDate: '2024-03-05',
      wonGeneral: false,
    },
  ) => {
    const org = await service.prisma.organization.create({
      data: { slug: 'campaign-org-rerun', ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'rerun-candidate',
        didWin: false,
        primaryResult: 'lost',
        details,
        organizationSlug: org.slug,
      },
    })
    return { org, campaign }
  }

  const mockCrm = () => {
    const crm = service.app.get(CrmCampaignsService)
    vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)
  }

  const putMine = (
    orgSlug: string,
    details: Partial<PrismaJson.CampaignDetails>,
  ) =>
    service.client.put(
      '/v1/campaigns/mine',
      { details },
      { headers: { 'x-organization-slug': orgSlug } },
    )

  it('clears prior-race results when electionDate moves to an upcoming date', async () => {
    const { org, campaign } = await seedRerunCampaign()
    mockCrm()

    const result = await putMine(org.slug, { electionDate: '2030-11-05' })

    expect(result.status).toBe(200)
    const persisted = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(persisted.didWin).toBeNull()
    expect(persisted.primaryResult).toBeNull()
    expect(persisted.details).toMatchObject({
      state: 'CA',
      electionDate: '2030-11-05',
    })
    expect(persisted.details).not.toHaveProperty('wonGeneral')
    expect(persisted.details).not.toHaveProperty('primaryElectionDate')
    expect(isActiveCampaign(persisted, new Date())).toBe(true)
  })

  it('keeps recorded results when details change without the election date', async () => {
    const { org, campaign } = await seedRerunCampaign()
    mockCrm()

    const result = await putMine(org.slug, { occupation: 'Teacher' })

    expect(result.status).toBe(200)
    const persisted = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(persisted.didWin).toBe(false)
    expect(persisted.primaryResult).toBe('lost')
    expect(persisted.details).toMatchObject({
      occupation: 'Teacher',
      wonGeneral: false,
      primaryElectionDate: '2024-03-05',
    })
  })

  it('keeps recorded results when the same election date is re-sent', async () => {
    const { org, campaign } = await seedRerunCampaign()
    mockCrm()

    await putMine(org.slug, {
      electionDate: '2024-11-05',
      occupation: 'Teacher',
    })

    const persisted = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(persisted.didWin).toBe(false)
    expect(persisted.primaryResult).toBe('lost')
    expect(persisted.details).toMatchObject({ wonGeneral: false })
  })

  it('does not reset when the new election date is already past', async () => {
    const { org, campaign } = await seedRerunCampaign()
    mockCrm()

    await putMine(org.slug, { electionDate: '2024-01-02' })

    const persisted = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(persisted.didWin).toBe(false)
    expect(persisted.primaryResult).toBe('lost')
  })

  it('keeps a primaryElectionDate supplied by the same update', async () => {
    const { org, campaign } = await seedRerunCampaign()
    mockCrm()

    await putMine(org.slug, {
      electionDate: '2030-11-05',
      primaryElectionDate: '2030-03-05',
    })

    const persisted = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(persisted.didWin).toBeNull()
    expect(persisted.details).toMatchObject({
      primaryElectionDate: '2030-03-05',
    })
    expect(persisted.details).not.toHaveProperty('wonGeneral')
  })

  it('clears an explicit primaryResult sent alongside the new election date', async () => {
    const { org, campaign } = await seedRerunCampaign()
    mockCrm()

    const result = await service.client.put(
      '/v1/campaigns/mine',
      { details: { electionDate: '2030-11-05' }, primaryResult: 'lost' },
      { headers: { 'x-organization-slug': org.slug } },
    )

    expect(result.status).toBe(200)
    const persisted = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(persisted.primaryResult).toBeNull()
    expect(persisted.didWin).toBeNull()
  })

  it('does not reset on callers that omit the opt-in (admin M2M path)', async () => {
    const { campaign } = await seedRerunCampaign()
    mockCrm()
    const campaigns = service.app.get(CampaignsService)

    await campaigns.updateJsonFields(campaign.id, {
      details: { electionDate: '2030-11-05' },
    })

    const persisted = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(persisted.didWin).toBe(false)
    expect(persisted.primaryResult).toBe('lost')
    expect(persisted.details).toMatchObject({
      electionDate: '2030-11-05',
      wonGeneral: false,
    })
  })
})

describe('CampaignsService.updateJsonFields — update did not resolve', () => {
  it('throws and does not track when the campaign is missing', async () => {
    const campaigns = service.app.get(CampaignsService)
    const crm = service.app.get(CrmCampaignsService)
    const trackSpy = vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)

    await expect(
      campaigns.updateJsonFields(999_999, { details: { city: 'Nowhere' } }),
    ).rejects.toBeInstanceOf(InternalServerErrorException)

    expect(trackSpy).not.toHaveBeenCalled()
  })
})

// A promise plus its resolver, so the concurrency test below can wait on
// Postgres taking the row lock rather than guessing how long that takes.
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('CampaignsService.patchCampaignDetails', () => {
  // patchCampaignDetails writes through raw SQL, so this is the only place its
  // statement is ever executed. A unit test can assert the bound parameters and
  // still pass happily against a typo'd column name, a missing cast, or a `||`
  // that does not mean what the method assumes it means.
  it('merges the patch in, leaving the keys it does not name alone', async () => {
    const { campaign } = await seedCampaign()
    const campaigns = service.app.get(CampaignsService)

    await campaigns.patchCampaignDetails(campaign.id, {
      subscriptionId: 'sub_A',
    })

    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.details).toEqual({ state: 'CA', subscriptionId: 'sub_A' })
  })

  // Raw SQL does not fire Prisma's `@updatedAt`, so the column is set by hand
  // in the statement. This is what says so.
  it('still bumps updatedAt', async () => {
    const { campaign } = await seedCampaign()
    const campaigns = service.app.get(CampaignsService)
    // JS truncates the column to milliseconds, so guarantee the clock moves
    // rather than relying on the call taking longer than 1ms.
    await new Promise((resolve) => setTimeout(resolve, 5))

    await campaigns.patchCampaignDetails(campaign.id, {
      subscriptionId: 'sub_A',
    })

    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.updatedAt.getTime()).toBeGreaterThan(
      campaign.updatedAt.getTime(),
    )
  })

  // A details column holding JSON `null` rather than an object is the other
  // case the pre-change pre-read threw on. Without the jsonb_typeof guard
  // Postgres answers `invalid concatenation of jsonb objects` instead, so the
  // guard is what keeps the method's own exception the one callers see.
  it('throws when details holds JSON null rather than an object', async () => {
    const { campaign } = await seedCampaign()
    await service.prisma
      .$executeRaw`UPDATE campaign SET details = 'null'::jsonb WHERE id = ${campaign.id}`
    const campaigns = service.app.get(CampaignsService)

    await expect(
      campaigns.patchCampaignDetails(campaign.id, { subscriptionId: 'sub_A' }),
    ).rejects.toThrow(InternalServerErrorException)
  })

  it('throws for a campaign id that does not exist', async () => {
    const campaigns = service.app.get(CampaignsService)

    await expect(
      campaigns.patchCampaignDetails(999999, { subscriptionId: 'sub_A' }),
    ).rejects.toThrow(InternalServerErrorException)
  })

  // Prod 2026-09-15T07:42:51Z, reproduced against real Postgres. Stripe
  // delivered customer.subscription.created and checkout.session.completed 9ms
  // apart for sub_1UFr0v1taBPnTqn4PH8LMj6R; the first patched
  // details.subscriptionId and the second stamped details.isProUpdatedAt via
  // setIsPro. Here the first writer is an open transaction still holding the
  // row lock, so the second is guaranteed to arrive mid-flight rather than
  // merely likely to — Postgres enforces the interleaving, no sleep decides it.
  //
  // Against the pre-change shape (read the blob outside the transaction, write
  // the merged result inside a Serializable one) this raises the production
  // error verbatim: P2034, `Transaction failed due to a write conflict or a
  // deadlock`.
  it('merges onto a concurrent writer rather than failing or overwriting it', async () => {
    const { campaign } = await seedCampaign()
    const campaigns = service.app.get(CampaignsService)

    const rowLocked = deferred()
    const lockReleased = deferred()

    const concurrentWriter = service.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE campaign
        SET details = details || '{"subscriptionId":"sub_A"}'::jsonb
        WHERE id = ${campaign.id}
      `
      rowLocked.resolve()
      await lockReleased.promise
    })

    await rowLocked.promise
    const patch = campaigns.patchCampaignDetails(campaign.id, {
      isProUpdatedAt: '2026-09-15T07:42:51Z',
    })
    // Long enough for the patch's UPDATE to reach the row lock and block on it.
    setTimeout(lockReleased.resolve, 250)

    await Promise.all([concurrentWriter, patch])

    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.details).toEqual({
      state: 'CA',
      subscriptionId: 'sub_A',
      isProUpdatedAt: '2026-09-15T07:42:51Z',
    })
  })
})
