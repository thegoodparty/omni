import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { CampaignTasksService } from '@/campaigns/tasks/services/campaignTasks.service'
import { isActiveCampaign } from '@/campaigns/util/eligibility.util'
import { useTestService } from '@/test-service'
import { InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

  // The other cause of a zero rowcount, and the only one that happens in
  // practice — `details` is NOT NULL with a `{}` default. The pre-read this
  // replaced reported it as the same 500 as the malformed column above, which
  // told whoever was paging through the logs that the row was broken when the
  // id was simply wrong.
  it('404s on a campaign id that does not resolve', async () => {
    const campaigns = service.app.get(CampaignsService)

    await expect(
      campaigns.patchCampaignDetails(999999, { subscriptionId: 'sub_A' }),
    ).rejects.toBeInstanceOf(NotFoundException)
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

describe('CampaignsService.updateJsonFields — concurrent campaign writer', () => {
  // Prod 2026-08-28T06:02:51Z, reproduced against real Postgres. A
  // GET /v1/campaigns/mine/status poll (request d0b40c51) stamped
  // data.lastVisited 9ms after this method read the row and 4ms before it
  // aborted, and the candidate's save was discarded with a 400. Nine of those
  // in the 30 days to 2026-09-17, plus one more on 2026-09-16, all identical.
  //
  // Here the poll is an open transaction still holding the row lock, so the
  // save is guaranteed to arrive mid-flight rather than merely likely to —
  // Postgres enforces the interleaving, no sleep decides it.
  //
  // This one test kills four separate mutations, which is why it is the whole
  // concurrency suite. Against the pre-change shape (Serializable, read taking
  // no lock) it raises the production error verbatim: P2034, `Transaction
  // failed due to a write conflict or a deadlock`. Keeping Serializable
  // alongside the new lock raises the same thing from the lock statement.
  // Dropping Serializable without taking the lock, or taking it AFTER the
  // read, loses `lastVisited` instead — the silent variant, with no error at
  // all.
  it('merges onto a concurrent writer rather than failing or overwriting it', async () => {
    const { campaign } = await seedCampaign()
    const crm = service.app.get(CrmCampaignsService)
    vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)
    const campaigns = service.app.get(CampaignsService)

    const rowLocked = deferred()
    const lockReleased = deferred()

    const concurrentPoll = service.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE campaign
        SET data = data || '{"lastVisited":1788968553573}'::jsonb
        WHERE id = ${campaign.id}
      `
      rowLocked.resolve()
      await lockReleased.promise
    })

    await rowLocked.promise
    const save = campaigns.updateJsonFields(campaign.id, {
      data: { someField: 'value' },
    })
    // Long enough for the save's lock statement to reach the row lock and
    // block on it.
    setTimeout(lockReleased.resolve, 250)

    await Promise.all([concurrentPoll, save])

    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.data).toEqual({
      lastVisited: 1788968553573,
      someField: 'value',
    })
  })
})

describe('CampaignsService.getStatus', () => {
  // The campaign getStatus is handed is whatever UseCampaignGuard read before
  // the handler started, so anything committed after that read is invisible to
  // it. Staged directly rather than raced, because the outcome does not depend
  // on timing: the previous `data: { ...data, lastVisited }` rebuilt the whole
  // column from that stale object and dropped someField, answering 200 with no
  // log line. In prod the window is this request's own duration, observed at
  // 1017ms (request 47eeaa03, 2026-09-09T15:42:34Z).
  it('stamps onto the committed row, not onto the row it was handed', async () => {
    const { campaign } = await seedCampaign()
    const campaigns = service.app.get(CampaignsService)

    await service.prisma.$executeRaw`
      UPDATE campaign SET data = '{"someField":"value"}'::jsonb WHERE id = ${campaign.id}
    `

    await campaigns.getStatus(campaign)

    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.data).toMatchObject({ someField: 'value' })
    expect(row.data.lastVisited).toEqual(expect.any(Number))
  })

  // Raw SQL does not fire Prisma's `@updatedAt`, so the column is set by hand
  // in the statement. This passes against the pre-change source too — its
  // evidence is the mutation, not a revert: dropping `updated_at = NOW()`
  // leaves updatedAt unchanged and fails it.
  it('still bumps updatedAt', async () => {
    const { campaign } = await seedCampaign()
    const campaigns = service.app.get(CampaignsService)
    // JS truncates the column to milliseconds, so guarantee the clock moves
    // rather than relying on the call taking longer than 1ms.
    await new Promise((resolve) => setTimeout(resolve, 5))

    await campaigns.getStatus(campaign)

    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.updatedAt.getTime()).toBeGreaterThan(
      campaign.updatedAt.getTime(),
    )
  })

  // `{ ...null, lastVisited }` used to yield `{ lastVisited }`, so a data
  // column holding JSON null rebuilt itself into an object. Also passes
  // against the pre-change source; its evidence is the mutation. Dropping the
  // jsonb_typeof CASE does not raise — `jsonb` concatenates a scalar with an
  // object into an ARRAY — so the column silently becomes
  // `[null, {"lastVisited":...}]` and this test reads keys `['0','1']`.
  it('rebuilds a data column holding JSON null rather than failing on it', async () => {
    const { campaign } = await seedCampaign()
    await service.prisma
      .$executeRaw`UPDATE campaign SET data = 'null'::jsonb WHERE id = ${campaign.id}`
    const campaigns = service.app.get(CampaignsService)

    await campaigns.getStatus(campaign)

    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(Object.keys(row.data)).toEqual(['lastVisited'])
  })

  // The previous `model.update` raised Prisma's P2025 here, which the exception
  // filter answers 404 to. A raw UPDATE matching no row would instead say
  // nothing, so the rowcount is checked; dropping that check resolves with a
  // status payload for a campaign that no longer exists.
  it('throws when the campaign vanished between the guard read and the stamp', async () => {
    const { campaign } = await seedCampaign()
    const campaigns = service.app.get(CampaignsService)
    await service.prisma.campaign.delete({ where: { id: campaign.id } })

    await expect(campaigns.getStatus(campaign)).rejects.toThrow(
      NotFoundException,
    )
  })
})

describe('CampaignsService.setIsPro', () => {
  // The real CampaignTasksService would post to Slack. Its own
  // `proUpgradeSlackNotifiedAt` guard is not what these tests are about.
  const buildService = () => {
    vi.spyOn(
      service.app.get(CampaignTasksService),
      'notifySlackOnProUpgrade',
    ).mockResolvedValue(undefined)
    return service.app.get(CampaignsService)
  }

  // The transient failure the bug needs, and nothing more: raise on any
  // statement that changes `details`, so the isPro flip still succeeds and the
  // stamp is the one write that fails. Postgres enforces it, so it lands
  // identically whether the stamp runs inside the flip's transaction or on the
  // pool after it — the same injection proves the old shape broken and the new
  // one sound, with no test-only branch deciding which.
  const failDetailsWrites = async () => {
    await service.prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_details_write() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'details write failed'; END;
      $$ LANGUAGE plpgsql
    `)
    await service.prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_details_write
      BEFORE UPDATE OF details ON campaign
      FOR EACH ROW WHEN (NEW.details IS DISTINCT FROM OLD.details)
      EXECUTE FUNCTION test_fail_details_write()
    `)
  }
  const allowDetailsWrites = () =>
    service.prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_details_write ON campaign',
    )

  // Forces the two deliveries below to overlap, and lets Postgres rather than
  // a sleep in the test decide the interleaving: whoever wins holds its
  // transaction open inside pg_sleep while the loser is still arriving. It
  // fires only on a real isPro change, so the loser — which by then finds the
  // campaign already Pro — is not slowed in turn.
  //
  // Both shapes overlap under it, and that is the point. On the pre-change
  // shape nothing locks the loser's read, so it gets in before the winner
  // commits and its update then raises 40001. On this one the loser is still
  // waiting for the row lock and reads only after the commit.
  const slowTheProFlip = async () => {
    await service.prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_slow_pro_flip() RETURNS trigger AS $$
      BEGIN PERFORM pg_sleep(0.4); RETURN NEW; END;
      $$ LANGUAGE plpgsql
    `)
    await service.prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_slow_pro_flip
      BEFORE UPDATE OF is_pro ON campaign
      FOR EACH ROW WHEN (NEW.is_pro IS DISTINCT FROM OLD.is_pro)
      EXECUTE FUNCTION test_slow_pro_flip()
    `)
  }

  // DDL outlives the row cleanup between tests.
  afterEach(async () => {
    await allowDetailsWrites()
    await service.prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_slow_pro_flip ON campaign',
    )
  })

  // Two real concurrent deliveries, which is the semantics this change is
  // actually about: not that the loser fails more gracefully, but that it
  // stops failing and reaches the correct answer instead.
  //
  // Exactly one transition, and every one-time side effect hanging off it
  // fires exactly once — the Slack announcement, the free-texts grant and the
  // isProUpdatedAt stamp. Against the pre-change shape the loser raises the
  // production error verbatim: P2034, `Transaction failed due to a write
  // conflict or a deadlock`. The gate was never really computing
  // becamePro=false for a duplicate; it was relying on Stripe to redeliver
  // into a row that had become Pro in the meantime.
  it('lets a duplicate delivery succeed with becamePro=false, firing the one-time effects once', async () => {
    const { campaign } = await seedCampaign()
    const slack = vi
      .spyOn(service.app.get(CampaignTasksService), 'notifySlackOnProUpgrade')
      .mockResolvedValue(undefined)
    const campaigns = service.app.get(CampaignsService)
    await slowTheProFlip()

    const deliveries = await Promise.all([
      campaigns.setIsPro(campaign.id, true, false),
      campaigns.setIsPro(campaign.id, true, false),
    ])

    expect(deliveries.map((d) => d.becamePro).sort()).toEqual([false, true])
    expect(slack).toHaveBeenCalledExactlyOnceWith(campaign.id)

    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.isPro).toBe(true)
    expect(row.hasFreeTextsOffer).toBe(true)
    expect(row.freeTextsOfferRedeemedAt).toBeNull()
    expect(row.details.isProUpdatedAt).toEqual(expect.any(String))
  })

  // The one that matters. This is not "two writes, either of which can fail" —
  // it is a state that closes its own repair path behind it.
  // `isBecomingProFirstTime` is derived from the PRIOR isPro, so once the flip
  // has committed alone, every redelivery Stripe makes reads isPro=true,
  // computes false, and skips the stamp. At-least-once delivery cannot heal a
  // state it can no longer recognise as incomplete: the campaign is Pro
  // forever with no `isProUpdatedAt` and no Slack announcement, and the CRM
  // sync publishes it to HubSpot as Pro with no `pro_upgrade_date`. A
  // transient failure becomes permanent.
  it('leaves the transition for a redelivery to re-run when the stamp fails', async () => {
    const { campaign } = await seedCampaign()
    const campaigns = buildService()

    await failDetailsWrites()
    await expect(campaigns.setIsPro(campaign.id, true, false)).rejects.toThrow(
      'details write failed',
    )

    // Stripe redelivers, into a database that has recovered.
    await allowDetailsWrites()
    const redelivery = await campaigns.setIsPro(campaign.id, true, false)

    expect(redelivery.becamePro).toBe(true)
    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.isPro).toBe(true)
    expect(row.details.isProUpdatedAt).toEqual(expect.any(String))
  })

  // The same fact stated as the mechanism rather than the consequence: one
  // commit, so a failed stamp takes the flip with it and there is no half
  // state for a redelivery to misread.
  it('rolls the flip back with the stamp instead of committing half of it', async () => {
    const { campaign } = await seedCampaign()
    const campaigns = buildService()

    await failDetailsWrites()
    await expect(campaigns.setIsPro(campaign.id, true, false)).rejects.toThrow(
      'details write failed',
    )

    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.isPro).toBe(false)
    expect(row.details.isProUpdatedAt).toBeUndefined()
  })

  // What the `jsonb_typeof` CASE is for. `patchCampaignDetails` answers a
  // non-object `details` column with a 500, which was survivable when the
  // stamp ran after the commit — the Pro flip had already landed. Inside the
  // transaction that same 500 would roll back a paying customer's upgrade over
  // a column shape that cannot occur (`Json @default("{}")`, NOT NULL), so the
  // statement coerces instead of refusing.
  //
  // Two mutations. Against the pre-change shape the flip commits and the stamp
  // 500s, unrepairably, exactly as in the first test. Dropping the CASE does
  // not raise either — `jsonb` concatenates a scalar with an object into an
  // ARRAY — so the column silently becomes `[null, {"isProUpdatedAt":...}]`
  // and the read below finds no string there.
  it('stamps onto a details column holding JSON null rather than failing the upgrade', async () => {
    const { campaign } = await seedCampaign()
    await service.prisma
      .$executeRaw`UPDATE campaign SET details = 'null'::jsonb WHERE id = ${campaign.id}`
    const campaigns = buildService()

    const result = await campaigns.setIsPro(campaign.id, true, false)

    expect(result.becamePro).toBe(true)
    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.isPro).toBe(true)
    expect(row.details.isProUpdatedAt).toEqual(expect.any(String))
  })

  // Stripe's at-least-once delivery, reduced to its two webhooks. The first
  // delivery is an open transaction still holding the campaign row lock, so
  // the second is guaranteed to arrive mid-flight rather than merely likely to
  // — Postgres enforces the interleaving, no sleep decides it.
  //
  // Three mutations die here. Against the pre-change shape (Serializable, read
  // taking no lock) it raises the production error verbatim: P2034,
  // `Transaction failed due to a write conflict or a deadlock` — 1 prod and
  // ~679 dev from this transaction in the 30 days to 2026-09-17, the dev
  // figure inflated by the test-set-pro E2E route. Keeping Serializable
  // alongside the new lock raises the same thing one statement earlier, from
  // the lock. Dropping Serializable WITHOUT taking the lock is the silent
  // variant: the read still sees its pre-wait snapshot, so becamePro comes
  // back true for a duplicate and the stamp overwrites the first delivery's
  // real upgrade date.
  it('recognises a duplicate delivery instead of failing on it', async () => {
    const { campaign } = await seedCampaign()
    const campaigns = buildService()
    const FIRST_DELIVERY_STAMP = '2026-09-15T07:42:51Z'

    const rowLocked = deferred()
    const lockReleased = deferred()

    const firstDelivery = service.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE campaign
        SET is_pro = true,
            details = details || ${JSON.stringify({
              isProUpdatedAt: FIRST_DELIVERY_STAMP,
            })}::jsonb
        WHERE id = ${campaign.id}
      `
      rowLocked.resolve()
      await lockReleased.promise
    })

    await rowLocked.promise
    const secondDelivery = campaigns.setIsPro(campaign.id, true, false)
    // Long enough for the second delivery's lock statement to reach the row
    // lock and block on it.
    setTimeout(lockReleased.resolve, 250)

    const [, result] = await Promise.all([firstDelivery, secondDelivery])

    expect(result.becamePro).toBe(false)
    const row = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(row.details.isProUpdatedAt).toBe(FIRST_DELIVERY_STAMP)
  })
})
