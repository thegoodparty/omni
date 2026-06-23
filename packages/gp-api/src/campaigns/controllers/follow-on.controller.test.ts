import { useTestService } from '@/test-service'
import { ElectionsService } from '@/elections/services/elections.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { ConflictException } from '@nestjs/common'
import { CampaignsService } from '../services/campaigns.service'
import { CrmCampaignsService } from '../services/crmCampaigns.service'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = useTestService()

const spyOnTrack = () => {
  const analytics = service.app.get(AnalyticsService)
  return vi.spyOn(analytics, 'track').mockResolvedValue({} as never)
}

const spyOnGroup = () => {
  const analytics = service.app.get(AnalyticsService)
  return vi.spyOn(analytics, 'group').mockResolvedValue(undefined)
}

describe('POST /v1/campaigns/follow-on', () => {
  beforeEach(() => {
    // createForUser fires a CRM sync that resolves the new org's position and
    // district via the election-api, which isn't reachable in the harness.
    // That sync is incidental to the follow-on behavior under test, so stub it.
    const crm = service.app.get(CrmCampaignsService)
    vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)

    // Default the next-election lookup to null ("election-api unreachable") so
    // same-office tests deterministically fall back to the office term end;
    // tests that need a resolved date or a definitive no-election override it.
    const elections = service.app.get(ElectionsService)
    vi.spyOn(elections, 'getNextElectionForPosition').mockResolvedValue(null)

    // The held-office positionId is translated to election-api's internal id
    // via a network lookup that isn't reachable here. Default it to identity so
    // same-office tests keep their seeded positionId; the translation test
    // below overrides it.
    vi.spyOn(elections, 'resolveInternalPositionId').mockImplementation(
      async (positionId: string) => positionId,
    )
  })

  it('inherits the held office position and carries isPro on a same-office run', async () => {
    // Previous (won) campaign that earned the office, carrying Pro.
    await service.prisma.organization.create({
      data: { slug: 'campaign-50', ownerId: service.user.id },
    })
    const prevCampaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'prev-run',
        isPro: true,
        didWin: true,
        details: { electionDate: '2099-11-03' },
        organizationSlug: 'campaign-50',
      },
    })

    // The held-office org carries the position to inherit.
    await service.prisma.organization.create({
      data: {
        slug: 'eo-source',
        ownerId: service.user.id,
        positionId: 'pos-source',
        overrideDistrictId: 'district-source',
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-source',
        userId: service.user.id,
        termEndDate: new Date('2099-01-05T00:00:00Z'),
        campaignId: prevCampaign.id,
      },
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-source',
      details: { electionDate: '2099-11-03', state: 'CA' },
    })

    expect(result.status).toBe(201)
    expect(result.data).toMatchObject({ isPro: true, didWin: null })

    const newOrg = await service.prisma.organization.findUnique({
      where: { slug: `campaign-${result.data.id}` },
    })
    expect(newOrg).toMatchObject({
      positionId: 'pos-source',
      overrideDistrictId: 'district-source',
      ownerId: service.user.id,
    })
  })

  it('derives the electionDate from the held office term end on same-office', async () => {
    // The held-office org with a future term end — the cadence-derived boundary
    // used as the re-election's next-election date.
    await service.prisma.organization.create({
      data: {
        slug: 'eo-term',
        ownerId: service.user.id,
        positionId: 'pos-term',
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-term',
        userId: service.user.id,
        termEndDate: new Date('2099-01-05T00:00:00Z'),
      },
    })

    // Mirrors the production same-office payload: no details, so no
    // electionDate is supplied by the client.
    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-term',
    })

    expect(result.status).toBe(201)
    expect(result.data.details.electionDate).toBe('2099-01-05')

    // The derived future date makes the campaign active, so derive-on-read no
    // longer mislabels it "past" and a duplicate re-election is rejected.
    const second = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-term',
    })
    expect(second.status).toBe(409)

    const campaignCount = await service.prisma.campaign.count({
      where: { userId: service.user.id },
    })
    expect(campaignCount).toBe(1)
  })

  it('translates a BallotReady positionId to the internal id before dating and on the new org', async () => {
    // The held-office org stores a BallotReady position id (admin prefill);
    // next-election and the new org must use the resolved internal id instead.
    const elections = service.app.get(ElectionsService)
    vi.spyOn(elections, 'resolveInternalPositionId').mockResolvedValue(
      'pos-internal',
    )
    const nextElectionSpy = vi
      .spyOn(elections, 'getNextElectionForPosition')
      .mockResolvedValue({ electionDate: '2100-11-02' })

    await service.prisma.organization.create({
      data: {
        slug: 'eo-brid',
        ownerId: service.user.id,
        positionId: 'br-old',
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-brid',
        userId: service.user.id,
        termEndDate: null,
      },
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-brid',
    })

    expect(result.status).toBe(201)
    // next-election was keyed on the resolved internal id, not the BR id.
    expect(nextElectionSpy).toHaveBeenCalledWith('pos-internal')
    expect(result.data.details.electionDate).toBe('2100-11-02')

    // The new campaign org carries the internal id, not the BR id.
    const newOrg = await service.prisma.organization.findUnique({
      where: { slug: `campaign-${result.data.id}` },
    })
    expect(newOrg).toMatchObject({ positionId: 'pos-internal' })
  })

  it('uses the election-api next-election date over the term end on same-office', async () => {
    const elections = service.app.get(ElectionsService)
    vi.spyOn(elections, 'getNextElectionForPosition').mockResolvedValue({
      electionDate: '2100-11-02',
    })

    await service.prisma.organization.create({
      data: {
        slug: 'eo-next',
        ownerId: service.user.id,
        positionId: 'pos-next',
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-next',
        userId: service.user.id,
        termEndDate: new Date('2099-01-05T00:00:00Z'),
      },
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-next',
    })

    expect(result.status).toBe(201)
    // election-api's resolved date wins over the term-end proxy.
    expect(result.data.details.electionDate).toBe('2100-11-02')
  })

  it('honors a definitive no-election from election-api over the term end', async () => {
    // election-api is reachable and answers { electionDate: null } (the
    // position has no upcoming general). That authoritative "none" must win
    // over the term-end proxy, so the guard rejects rather than dating the
    // campaign to the cadence guess.
    const elections = service.app.get(ElectionsService)
    vi.spyOn(elections, 'getNextElectionForPosition').mockResolvedValue({
      electionDate: null,
    })

    await service.prisma.organization.create({
      data: {
        slug: 'eo-definitive',
        ownerId: service.user.id,
        positionId: 'pos-definitive',
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-definitive',
        userId: service.user.id,
        termEndDate: new Date('2099-01-05T00:00:00Z'),
      },
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-definitive',
    })

    expect(result.status).toBe(400)

    const campaignCount = await service.prisma.campaign.count({
      where: { userId: service.user.id },
    })
    expect(campaignCount).toBe(0)
  })

  it('ignores a client-injected electionDate on same-office and still rejects', async () => {
    // election-api definitively has no upcoming election, so the server resolves
    // none. A client-supplied details.electionDate must not slip past the guard.
    const elections = service.app.get(ElectionsService)
    vi.spyOn(elections, 'getNextElectionForPosition').mockResolvedValue({
      electionDate: null,
    })

    await service.prisma.organization.create({
      data: {
        slug: 'eo-injected',
        ownerId: service.user.id,
        positionId: 'pos-injected',
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-injected',
        userId: service.user.id,
        termEndDate: null,
      },
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-injected',
      details: { electionDate: '2099-11-03' },
    })

    expect(result.status).toBe(400)

    const campaignCount = await service.prisma.campaign.count({
      where: { userId: service.user.id },
    })
    expect(campaignCount).toBe(0)
  })

  it('rejects a same-office run with no resolvable election date', async () => {
    // election-api yields nothing (default stub) and the office has no term end
    // to fall back to — the guard must refuse rather than create a campaign
    // that derive-on-read would immediately mark "past".
    await service.prisma.organization.create({
      data: {
        slug: 'eo-noelection',
        ownerId: service.user.id,
        positionId: 'pos-noelection',
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-noelection',
        userId: service.user.id,
        termEndDate: null,
      },
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-noelection',
    })

    expect(result.status).toBe(400)

    const campaignCount = await service.prisma.campaign.count({
      where: { userId: service.user.id },
    })
    expect(campaignCount).toBe(0)
  })

  it('blocks a second follow-on once the first created an active campaign', async () => {
    await service.prisma.organization.create({
      data: {
        slug: 'eo-repeat',
        ownerId: service.user.id,
        positionId: 'pos-repeat',
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-repeat',
        userId: service.user.id,
        termEndDate: new Date('2099-01-05T00:00:00Z'),
      },
    })

    const body = {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-repeat',
      details: { electionDate: '2099-11-03', state: 'CA' },
    }

    const first = await service.client.post('/v1/campaigns/follow-on', body)
    expect(first.status).toBe(201)

    // The campaign just created is active (future electionDate), so the
    // per-user eligibility re-check inside the locked transaction rejects a
    // second run.
    const second = await service.client.post('/v1/campaigns/follow-on', body)
    expect(second.status).toBe(409)

    const campaignCount = await service.prisma.campaign.count({
      where: { userId: service.user.id },
    })
    expect(campaignCount).toBe(1)
  })

  it('returns 409 when the user already has an active campaign', async () => {
    await service.prisma.organization.create({
      data: { slug: 'campaign-60', ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'active-run',
        details: { electionDate: '2099-11-03' },
        organizationSlug: 'campaign-60',
      },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'eo-source-2',
        ownerId: service.user.id,
        positionId: 'pos-source-2',
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-source-2',
        userId: service.user.id,
        termEndDate: new Date('2099-01-05T00:00:00Z'),
      },
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-source-2',
      details: { electionDate: '2099-11-03', state: 'CA' },
    })

    expect(result.status).toBe(409)
  })

  it('returns 404 and creates nothing when fromOrganizationSlug belongs to another user', async () => {
    const otherUser = await service.prisma.user.create({
      data: {
        id: 456,
        clerkId: 'user_other_456',
        email: 'other@goodparty.org',
        firstName: 'Other',
        lastName: 'User',
      },
    })
    await service.prisma.organization.create({
      data: {
        slug: 'eo-not-mine',
        ownerId: otherUser.id,
        positionId: 'pos-not-mine',
      },
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-not-mine',
      details: { electionDate: '2099-11-03', state: 'CA' },
    })

    expect(result.status).toBe(404)

    const campaignCount = await service.prisma.campaign.count({
      where: { userId: service.user.id },
    })
    expect(campaignCount).toBe(0)
  })

  it('returns 400 when same-office fromOrganizationSlug is not an elected-office org', async () => {
    // An owned campaign-* org passes the ownership guard but has no
    // electedOffice, so inheriting from it would strip isPro and pull the
    // wrong position.
    await service.prisma.organization.create({
      data: {
        slug: 'campaign-70',
        ownerId: service.user.id,
        positionId: 'pos-old',
      },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'won-run',
        isPro: true,
        didWin: true,
        details: { electionDate: '2099-11-03' },
        organizationSlug: 'campaign-70',
      },
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'campaign-70',
      details: { electionDate: '2099-11-03', state: 'CA' },
    })

    expect(result.status).toBe(400)

    // Only the pre-existing won campaign should remain; no follow-on created.
    const campaignCount = await service.prisma.campaign.count({
      where: { userId: service.user.id },
    })
    expect(campaignCount).toBe(1)
  })

  it('creates a campaign from the body position on a new-office run', async () => {
    const electionsService = service.app.get(ElectionsService)
    vi.spyOn(electionsService, 'getPositionByBallotReadyId').mockResolvedValue({
      id: 'pos-new',
      brPositionId: 'br-new',
      brDatabaseId: 'db-new',
      state: 'CA',
      name: 'City Council',
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'new-office',
      ballotReadyPositionId: 'br-new',
      details: { electionDate: '2099-11-03', state: 'CA' },
    })

    expect(result.status).toBe(201)

    const newOrg = await service.prisma.organization.findUnique({
      where: { slug: `campaign-${result.data.id}` },
    })
    expect(newOrg).toMatchObject({
      positionId: 'pos-new',
      ownerId: service.user.id,
    })
  })

  it('fires FollowOnCreated with the resolved intent/isPro/electionDate', async () => {
    const trackSpy = spyOnTrack()

    // Previous (won) campaign that earned the office, carrying Pro — the
    // isPro source inherited by the re-election.
    await service.prisma.organization.create({
      data: { slug: 'campaign-90', ownerId: service.user.id },
    })
    const prevCampaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'prev-pro-run',
        isPro: true,
        didWin: true,
        details: { electionDate: '2099-11-03' },
        organizationSlug: 'campaign-90',
      },
    })

    // Held-office org with a future term end; the cadence-derived boundary
    // becomes the event's electionDate.
    await service.prisma.organization.create({
      data: {
        slug: 'eo-created',
        ownerId: service.user.id,
        positionId: 'pos-created',
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-created',
        userId: service.user.id,
        termEndDate: new Date('2099-01-05T00:00:00Z'),
        campaignId: prevCampaign.id,
      },
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-created',
    })

    expect(result.status).toBe(201)
    expect(trackSpy).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Campaigns.FollowOnCreated,
      {
        campaignId: result.data.id,
        intent: 'same-office',
        isPro: true,
        inheritedFromOrganizationSlug: 'eo-created',
        electionDate: '2099-01-05',
      },
    )
  })

  it('groups the new campaign slug with derived traits and still fires FollowOnCreated', async () => {
    const trackSpy = spyOnTrack()
    const groupSpy = spyOnGroup()

    await service.prisma.organization.create({
      data: {
        slug: 'eo-grouped',
        ownerId: service.user.id,
        positionId: 'pos-grouped',
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-grouped',
        userId: service.user.id,
        termEndDate: new Date('2099-01-05T00:00:00Z'),
      },
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-grouped',
    })

    expect(result.status).toBe(201)

    // The new campaign gets its own org-scoped group carrying the derived
    // election date — it never overwrites the prior campaign's user identity.
    expect(groupSpy).toHaveBeenCalledWith(
      service.user.id,
      `campaign-${result.data.id}`,
      { officeElectionDate: '2099-01-05' },
    )
    // The ENG-10403 event still fires alongside the group.
    expect(trackSpy).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Campaigns.FollowOnCreated,
      expect.objectContaining({
        campaignId: result.data.id,
        intent: 'same-office',
      }),
    )
  })

  it('fires FollowOnBlocked active_campaign_exists on the 409 eligibility path', async () => {
    const trackSpy = spyOnTrack()

    await service.prisma.organization.create({
      data: { slug: 'campaign-91', ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'active-blocking-run',
        details: { electionDate: '2099-11-03' },
        organizationSlug: 'campaign-91',
      },
    })

    await service.prisma.organization.create({
      data: {
        slug: 'eo-blocked',
        ownerId: service.user.id,
        positionId: 'pos-blocked',
      },
    })
    await service.prisma.electedOffice.create({
      data: {
        organizationSlug: 'eo-blocked',
        userId: service.user.id,
        termEndDate: null,
      },
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'eo-blocked',
    })

    expect(result.status).toBe(409)
    expect(trackSpy).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Campaigns.FollowOnBlocked,
      { intent: 'same-office', reason: 'active_campaign_exists' },
    )
  })

  it('fires FollowOnBlocked invalid_source_org on the 400 non-EO source path', async () => {
    const trackSpy = spyOnTrack()

    // An owned campaign-* org passes the ownership guard but has no
    // electedOffice, so a same-office inherit is rejected.
    await service.prisma.organization.create({
      data: {
        slug: 'campaign-92',
        ownerId: service.user.id,
        positionId: 'pos-old',
      },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'won-not-eo-run',
        isPro: true,
        didWin: true,
        details: { electionDate: '2099-11-03' },
        organizationSlug: 'campaign-92',
      },
    })

    const result = await service.client.post('/v1/campaigns/follow-on', {
      intent: 'same-office',
      fromOrganizationSlug: 'campaign-92',
    })

    expect(result.status).toBe(400)
    expect(trackSpy).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Campaigns.FollowOnBlocked,
      { intent: 'same-office', reason: 'invalid_source_org' },
    )
  })

  it('fires FollowOnBlocked concurrent_active_campaign on the in-transaction race re-check', async () => {
    const trackSpy = spyOnTrack()

    // The in-transaction re-check only runs when a request reaches the service
    // having passed the controller's eligibility gate while no active campaign
    // existed, then loses the advisory lock to a concurrent request that
    // committed one first. The controller guard intercepts any sequential
    // second request, so this branch is reached by calling the service
    // directly with a canStartCampaign:true eligibility and a pre-seeded
    // active campaign — the deterministic stand-in for the losing racer.
    await service.prisma.organization.create({
      data: { slug: 'campaign-93', ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: 'race-active-run',
        details: { electionDate: '2099-11-03' },
        organizationSlug: 'campaign-93',
      },
    })

    const campaigns = service.app.get(CampaignsService)

    await expect(
      campaigns.createFollowOn(
        service.user,
        { intent: 'new-office', ballotReadyPositionId: 'br-race' },
        {
          hasActiveCampaign: true,
          holdsOffice: false,
          canStartCampaign: true,
          canGainOffice: true,
          reelectionOfficeSlug: null,
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException)

    expect(trackSpy).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Campaigns.FollowOnBlocked,
      { intent: 'new-office', reason: 'concurrent_active_campaign' },
    )

    // The losing racer created nothing — only the pre-seeded campaign remains.
    const campaignCount = await service.prisma.campaign.count({
      where: { userId: service.user.id },
    })
    expect(campaignCount).toBe(1)
  })
})
