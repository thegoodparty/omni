import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EmailService } from '@/email/email.service'
import { ClerkInvitationsService } from '@/vendors/clerk/services/clerkInvitations.service'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '@/vendors/clerk/providers/clerk-client.provider'
import { CrmTeamMembersService } from '@/crm/crmTeamMembers.service'
import { ClerkClient, Invitation } from '@clerk/backend'
import { TeamInviteMetadata } from '@goodparty_org/contracts'
import jwt from 'jsonwebtoken'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrganizationRole } from '../generated/prisma'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'
const ORG_SLUG = 'team-org'
const TEAM_PATH = '/v1/organizations/team'

const authHeaderFor = (clerkId: string) => ({
  Authorization: `Bearer ${jwt.sign(
    { sub: clerkId },
    process.env.AUTH_SECRET!,
    {
      expiresIn: '1h',
    },
  )}`,
})

const createOrg = () =>
  service.prisma.organization.create({
    data: { slug: ORG_SLUG, ownerId: service.user.id },
  })

const createMemberUser = (opts: { email: string; clerkId?: string }) =>
  service.prisma.user.create({
    data: { email: opts.email, clerkId: opts.clerkId },
  })

const addMembership = (userId: number, role: OrganizationRole) =>
  service.prisma.organizationMembership.create({
    data: { organizationSlug: ORG_SLUG, userId, role },
  })

const createOtherOwnedOrg = async () => {
  const otherOwner = await service.prisma.user.create({
    data: { email: 'other-owner@example.com' },
  })
  return service.prisma.organization.create({
    data: { slug: ORG_SLUG, ownerId: otherOwner.id },
  })
}

const mockInvitation = (overrides: Partial<Invitation> = {}): Invitation =>
  ({
    id: 'inv_1',
    emailAddress: 'invitee@example.com',
    publicMetadata: {
      organizationSlug: ORG_SLUG,
      role: 'campaignAdmin',
      name: 'Invitee Name',
      invitedByUserId: 1,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'pending',
    ...overrides,
  }) as unknown as Invitation

const stubClerkInvitations = () => service.app.get(ClerkInvitationsService)
const stubFeatures = () => service.app.get(FeaturesService)
const stubEmail = () => service.app.get(EmailService)
const stubAnalytics = () => service.app.get(AnalyticsService)
const stubCrmTeamMembers = () => service.app.get(CrmTeamMembersService)

// Every membership-creation/role-change path fire-and-forgets a HubSpot
// sync (ENG-10826). Default it to a resolved no-op so tests that don't
// care about it don't leave a real, unmocked DB lookup racing in the
// background into the next test — individual tests below re-spy this to
// assert on it or to simulate a HubSpot failure.
beforeEach(() => {
  vi.spyOn(stubCrmTeamMembers(), 'syncTeamMember').mockResolvedValue(undefined)
})

const createCampaignWithHubspotId = (hubspotId: string) =>
  service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${ORG_SLUG}-campaign`,
      organizationSlug: ORG_SLUG,
      data: { hubspotId },
    },
  })

describe('GET /v1/organizations/team', () => {
  it('lists the owner via fallback with no members or invites', async () => {
    await createOrg()
    vi.spyOn(
      stubClerkInvitations(),
      'listPendingTeamInvitations',
    ).mockResolvedValue([])

    const result = await service.client.get(TEAM_PATH, {
      headers: { [ORG_SLUG_HEADER]: ORG_SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data.members).toEqual([
      expect.objectContaining({
        userId: service.user.id,
        role: 'owner',
        email: service.user.email,
      }),
    ])
    expect(result.data.pendingInvites).toEqual([])
  })

  it('includes members and pending invites scoped to this org', async () => {
    await createOrg()
    const member = await createMemberUser({ email: 'member@example.com' })
    await addMembership(member.id, OrganizationRole.campaignAdmin)
    vi.spyOn(
      stubClerkInvitations(),
      'listPendingTeamInvitations',
    ).mockResolvedValue([mockInvitation()])

    const result = await service.client.get(TEAM_PATH, {
      headers: { [ORG_SLUG_HEADER]: ORG_SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: member.id, role: 'campaignAdmin' }),
      ]),
    )
    expect(result.data.pendingInvites).toEqual([
      expect.objectContaining({
        id: 'inv_1',
        email: 'invitee@example.com',
        role: 'campaignAdmin',
      }),
    ])
  })

  it('404s for a non-member', async () => {
    await createOtherOwnedOrg()

    const result = await service.client.get(TEAM_PATH, {
      headers: { [ORG_SLUG_HEADER]: ORG_SLUG },
    })

    expect(result.status).toBe(404)
  })
})

describe('POST /v1/organizations/team/invites', () => {
  const INVITES_PATH = `${TEAM_PATH}/invites`

  it('404s when the flag is disabled, even for the owner', async () => {
    await createOrg()
    vi.spyOn(stubFeatures(), 'isFeatureEnabled').mockResolvedValueOnce(false)

    const result = await service.client.post(
      INVITES_PATH,
      { email: 'new@example.com', name: 'New Person', role: 'campaignAdmin' },
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )

    expect(result.status).toBe(404)
  })

  it('rejects a role other than campaignAdmin', async () => {
    await createOrg()

    const result = await service.client.post(
      INVITES_PATH,
      { email: 'new@example.com', name: 'New Person', role: 'volunteer' },
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )

    expect(result.status).toBe(400)
  })

  it('404s for a non-member', async () => {
    await createOtherOwnedOrg()

    const result = await service.client.post(
      INVITES_PATH,
      { email: 'new@example.com', name: 'New Person', role: 'campaignAdmin' },
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )

    expect(result.status).toBe(404)
  })

  it('a campaignAdmin member can invite', async () => {
    await createOrg()
    const admin = await createMemberUser({
      email: 'admin@example.com',
      clerkId: 'user_admin_1',
    })
    await addMembership(admin.id, OrganizationRole.campaignAdmin)
    const createInvitation = vi
      .spyOn(stubClerkInvitations(), 'createTeamInvitation')
      .mockResolvedValue(mockInvitation({ emailAddress: 'brandnew@x.com' }))
    vi.spyOn(
      stubClerkInvitations(),
      'listPendingTeamInvitations',
    ).mockResolvedValue([])
    vi.spyOn(stubAnalytics(), 'track').mockResolvedValue(undefined as never)

    const result = await service.client.post(
      INVITES_PATH,
      { email: 'brandnew@x.com', name: 'Brand New', role: 'campaignAdmin' },
      {
        headers: {
          [ORG_SLUG_HEADER]: ORG_SLUG,
          ...authHeaderFor('user_admin_1'),
        },
      },
    )

    expect(result.status).toBe(201)
    expect(createInvitation).toHaveBeenCalled()
  })

  describe('existing-account branch', () => {
    it('creates the membership row and sends the notification email', async () => {
      await createOrg()
      const invitee = await createMemberUser({ email: 'known@example.com' })
      const sendEmail = vi
        .spyOn(stubEmail(), 'sendTeamMemberAddedEmail')
        .mockResolvedValue(undefined as never)
      vi.spyOn(stubAnalytics(), 'track').mockResolvedValue(undefined as never)

      const result = await service.client.post(
        INVITES_PATH,
        {
          email: ' Known@Example.com ',
          name: 'Known Person',
          role: 'campaignAdmin',
        },
        { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
      )

      expect(result.status).toBe(201)
      expect(result.data).toEqual({
        status: 'added',
        member: expect.objectContaining({
          userId: invitee.id,
          email: 'known@example.com',
          role: 'campaignAdmin',
        }),
      })
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ id: invitee.id }),
        expect.any(String),
      )

      const rows = await service.prisma.organizationMembership.findMany({
        where: { organizationSlug: ORG_SLUG, userId: invitee.id },
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.role).toBe(OrganizationRole.campaignAdmin)
      // Flush the fire-and-forget HubSpot sync before the test ends — the
      // default mock is re-installed per test, but a call still in flight
      // when the next test's beforeEach re-spies would otherwise land on
      // that test's spy instead.
      await vi.waitFor(() =>
        expect(stubCrmTeamMembers().syncTeamMember).toHaveBeenCalled(),
      )
    })

    it('syncs a HubSpot contact with role and company id', async () => {
      await createOrg()
      await createCampaignWithHubspotId('company-123')
      const invitee = await service.prisma.user.create({
        data: {
          email: 'synced@example.com',
          firstName: 'Sandy',
          lastName: 'Synced',
        },
      })
      vi.spyOn(stubEmail(), 'sendTeamMemberAddedEmail').mockResolvedValue(
        undefined as never,
      )
      vi.spyOn(stubAnalytics(), 'track').mockResolvedValue(undefined as never)
      const syncTeamMember = vi
        .spyOn(stubCrmTeamMembers(), 'syncTeamMember')
        .mockResolvedValue(undefined)

      const result = await service.client.post(
        INVITES_PATH,
        {
          email: 'synced@example.com',
          name: 'ignored — role invite name, not the member record',
          role: 'campaignAdmin',
        },
        { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
      )

      expect(result.status).toBe(201)
      expect(result.data.member.userId).toBe(invitee.id)
      await vi.waitFor(() => expect(syncTeamMember).toHaveBeenCalled())
      expect(syncTeamMember).toHaveBeenCalledWith({
        email: 'synced@example.com',
        name: 'Sandy Synced',
        role: 'campaignAdmin',
        crmCompanyId: 'company-123',
      })
    })

    it('does not fail the request when the HubSpot sync throws', async () => {
      await createOrg()
      const invitee = await createMemberUser({ email: 'resilient@x.com' })
      vi.spyOn(stubEmail(), 'sendTeamMemberAddedEmail').mockResolvedValue(
        undefined as never,
      )
      vi.spyOn(stubAnalytics(), 'track').mockResolvedValue(undefined as never)
      // Mocks the dependency to throw what production would throw on a
      // HubSpot outage — asserts the try/catch around the fire-and-forget
      // dispatch, not a mock standing in for that behavior.
      const syncTeamMember = vi
        .spyOn(stubCrmTeamMembers(), 'syncTeamMember')
        .mockRejectedValue(new Error('hubspot down'))

      const result = await service.client.post(
        INVITES_PATH,
        {
          email: 'resilient@x.com',
          name: 'Resilient Person',
          role: 'campaignAdmin',
        },
        { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
      )

      expect(result.status).toBe(201)
      await vi.waitFor(() => expect(syncTeamMember).toHaveBeenCalled())
      const rows = await service.prisma.organizationMembership.findMany({
        where: { organizationSlug: ORG_SLUG, userId: invitee.id },
      })
      expect(rows).toHaveLength(1)
    })

    it('409s when the invitee is already a member', async () => {
      await createOrg()
      const invitee = await createMemberUser({ email: 'already@example.com' })
      await addMembership(invitee.id, OrganizationRole.campaignAdmin)

      const result = await service.client.post(
        INVITES_PATH,
        {
          email: 'already@example.com',
          name: 'Already',
          role: 'campaignAdmin',
        },
        { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
      )

      expect(result.status).toBe(409)
    })

    it('409s when the invitee is the organization owner', async () => {
      await createOrg()

      const result = await service.client.post(
        INVITES_PATH,
        {
          email: service.user.email,
          name: 'Owner',
          role: 'campaignAdmin',
        },
        { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
      )

      expect(result.status).toBe(409)
    })

    it('works for an email that already owns another campaign', async () => {
      await createOrg()
      const otherOwner = await createMemberUser({
        email: 'multi-campaign@example.com',
      })
      await service.prisma.organization.create({
        data: { slug: 'their-own-org', ownerId: otherOwner.id },
      })
      vi.spyOn(stubEmail(), 'sendTeamMemberAddedEmail').mockResolvedValue(
        undefined as never,
      )

      const result = await service.client.post(
        INVITES_PATH,
        {
          email: 'multi-campaign@example.com',
          name: 'Multi Campaign',
          role: 'campaignAdmin',
        },
        { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
      )

      expect(result.status).toBe(201)
      await vi.waitFor(() =>
        expect(stubCrmTeamMembers().syncTeamMember).toHaveBeenCalled(),
      )
    })

    it('still returns 201 when the notification email fails to send', async () => {
      await createOrg()
      const invitee = await createMemberUser({ email: 'email-down@x.com' })
      vi.spyOn(stubEmail(), 'sendTeamMemberAddedEmail').mockRejectedValue(
        new Error('mailgun down'),
      )

      const result = await service.client.post(
        INVITES_PATH,
        {
          email: 'email-down@x.com',
          name: 'Email Down',
          role: 'campaignAdmin',
        },
        { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
      )

      expect(result.status).toBe(201)
      const row = await service.prisma.organizationMembership.findUnique({
        where: {
          organizationSlug_userId: {
            organizationSlug: ORG_SLUG,
            userId: invitee.id,
          },
        },
      })
      expect(row).not.toBeNull()
      await vi.waitFor(() =>
        expect(stubCrmTeamMembers().syncTeamMember).toHaveBeenCalled(),
      )
    })
  })

  describe('new-email branch', () => {
    it('creates a Clerk invitation with the right metadata and writes nothing to Postgres', async () => {
      await createOrg()
      const createInvitation = vi
        .spyOn(stubClerkInvitations(), 'createTeamInvitation')
        .mockResolvedValue(mockInvitation({ emailAddress: 'fresh@x.com' }))
      vi.spyOn(
        stubClerkInvitations(),
        'listPendingTeamInvitations',
      ).mockResolvedValue([])

      const result = await service.client.post(
        INVITES_PATH,
        { email: 'fresh@x.com', name: 'Fresh Person', role: 'campaignAdmin' },
        { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
      )

      expect(result.status).toBe(201)
      expect(result.data).toEqual({
        status: 'pending',
        invite: expect.objectContaining({
          id: 'inv_1',
          email: 'fresh@x.com',
          role: 'campaignAdmin',
        }),
      })
      expect(createInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          emailAddress: 'fresh@x.com',
          publicMetadata: {
            organizationSlug: ORG_SLUG,
            role: 'campaignAdmin',
            name: 'Fresh Person',
            invitedByUserId: service.user.id,
          },
        }),
      )

      const rows = await service.prisma.organizationMembership.findMany({
        where: { organizationSlug: ORG_SLUG },
      })
      expect(rows).toHaveLength(0)
    })

    it('409s when an invitation is already pending for the email', async () => {
      await createOrg()
      vi.spyOn(
        stubClerkInvitations(),
        'listPendingTeamInvitations',
      ).mockResolvedValue([mockInvitation({ emailAddress: 'pending@x.com' })])

      const result = await service.client.post(
        INVITES_PATH,
        { email: 'pending@x.com', name: 'Pending', role: 'campaignAdmin' },
        { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
      )

      expect(result.status).toBe(409)
    })

    it('502s and persists nothing when Clerk throws', async () => {
      await createOrg()
      vi.spyOn(
        stubClerkInvitations(),
        'listPendingTeamInvitations',
      ).mockResolvedValue([])
      // Earlier tests in this file stub createTeamInvitation itself;
      // clearMocks resets call history but not implementations, so restore
      // the real method here — this test needs its actual try/catch to run.
      vi.spyOn(stubClerkInvitations(), 'createTeamInvitation').mockRestore()
      // Reject at the raw Clerk SDK call, not at ClerkInvitationsService —
      // exercises the real try/catch that converts a Clerk failure into a
      // BadGatewayException, not a mock standing in for that behavior.
      const clerkClient = service.app.get<ClerkClient>(
        CLERK_CLIENT_PROVIDER_TOKEN,
      )
      vi.spyOn(clerkClient.invitations, 'createInvitation').mockRejectedValue(
        new Error('clerk_error: down'),
      )

      const result = await service.client.post(
        INVITES_PATH,
        { email: 'boom@x.com', name: 'Boom', role: 'campaignAdmin' },
        { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
      )

      expect(result.status).toBe(502)
      const rows = await service.prisma.organizationMembership.findMany({
        where: { organizationSlug: ORG_SLUG },
      })
      expect(rows).toHaveLength(0)
    })
  })

  it('fires Team - Member Invited with role/invitedByRole/listScoped', async () => {
    await createOrg()
    vi.spyOn(
      stubClerkInvitations(),
      'listPendingTeamInvitations',
    ).mockResolvedValue([])
    vi.spyOn(stubClerkInvitations(), 'createTeamInvitation').mockResolvedValue(
      mockInvitation({ emailAddress: 'track-me@x.com' }),
    )
    const track = vi
      .spyOn(stubAnalytics(), 'track')
      .mockResolvedValue(undefined as never)

    const result = await service.client.post(
      INVITES_PATH,
      { email: 'track-me@x.com', name: 'Track Me', role: 'campaignAdmin' },
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )

    expect(result.status).toBe(201)
    await vi.waitFor(() => expect(track).toHaveBeenCalled())
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      'Team - Member Invited',
      { role: 'campaignAdmin', invitedByRole: 'owner', listScoped: false },
    )
  })
})

describe('DELETE /v1/organizations/team/invites/:id', () => {
  it('revokes a pending invitation belonging to this org', async () => {
    await createOrg()
    vi.spyOn(
      stubClerkInvitations(),
      'listPendingTeamInvitations',
    ).mockResolvedValue([mockInvitation({ id: 'inv_mine' })])
    const revoke = vi
      .spyOn(stubClerkInvitations(), 'revokeInvitation')
      .mockResolvedValue(mockInvitation({ id: 'inv_mine', revoked: true }))
    const clearByEmail = vi
      .spyOn(stubClerkInvitations(), 'clearTeamInviteMetadataByEmail')
      .mockResolvedValue(undefined)

    const result = await service.client.delete(
      `${TEAM_PATH}/invites/inv_mine`,
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )

    expect(result.status).toBe(204)
    expect(revoke).toHaveBeenCalledWith('inv_mine')
    expect(clearByEmail).toHaveBeenCalledWith('invitee@example.com')
  })

  it('404s revoking an id that belongs to another org', async () => {
    await createOrg()
    vi.spyOn(
      stubClerkInvitations(),
      'listPendingTeamInvitations',
    ).mockResolvedValue([])

    const result = await service.client.delete(
      `${TEAM_PATH}/invites/inv_other_org`,
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )

    expect(result.status).toBe(404)
  })

  it('still revokes when clearing the signed-up invitee metadata fails', async () => {
    await createOrg()
    vi.spyOn(
      stubClerkInvitations(),
      'listPendingTeamInvitations',
    ).mockResolvedValue([mockInvitation({ id: 'inv_mine' })])
    const revoke = vi
      .spyOn(stubClerkInvitations(), 'revokeInvitation')
      .mockResolvedValue(mockInvitation({ id: 'inv_mine', revoked: true }))
    vi.spyOn(
      stubClerkInvitations(),
      'clearTeamInviteMetadataByEmail',
    ).mockRejectedValue(new Error('down'))

    const result = await service.client.delete(
      `${TEAM_PATH}/invites/inv_mine`,
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )

    expect(result.status).toBe(204)
    expect(revoke).toHaveBeenCalledWith('inv_mine')
  })

  it('a revoked invite cannot be accepted by an invitee who already signed up', async () => {
    await createOrg()
    await service.prisma.user.create({
      data: { email: 'signed-up@x.com', clerkId: 'user_signedup_1' },
    })

    // Stands in for Clerk's real publicMetadata store: the invitee already
    // signed up, so their own Clerk user carries the invite metadata that
    // accept reads. clearTeamInviteMetadataByEmail (called by revoke) is
    // what must null it out — accept must not still see it afterward.
    let liveMetadata: TeamInviteMetadata | null = {
      organizationSlug: ORG_SLUG,
      role: 'campaignAdmin',
      name: 'Signed Up',
      invitedByUserId: service.user.id,
    }
    vi.spyOn(
      stubClerkInvitations(),
      'getTeamInviteMetadata',
    ).mockImplementation(() => Promise.resolve(liveMetadata))
    vi.spyOn(
      stubClerkInvitations(),
      'clearTeamInviteMetadataByEmail',
    ).mockImplementation(() => {
      liveMetadata = null
      return Promise.resolve()
    })
    vi.spyOn(
      stubClerkInvitations(),
      'listPendingTeamInvitations',
    ).mockResolvedValue([
      mockInvitation({
        id: 'inv_signed_up',
        emailAddress: 'signed-up@x.com',
      }),
    ])
    vi.spyOn(stubClerkInvitations(), 'revokeInvitation').mockResolvedValue(
      mockInvitation({ id: 'inv_signed_up', revoked: true }),
    )

    const revokeResult = await service.client.delete(
      `${TEAM_PATH}/invites/inv_signed_up`,
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )
    expect(revokeResult.status).toBe(204)

    const acceptResult = await service.client.post(
      `${TEAM_PATH}/invites/accept`,
      {},
      { headers: authHeaderFor('user_signedup_1') },
    )
    expect(acceptResult.status).toBe(404)
  })
})

describe('POST /v1/organizations/team/invites/accept', () => {
  const ACCEPT_PATH = `${TEAM_PATH}/invites/accept`

  it('creates a membership row and clears Clerk metadata on the happy path', async () => {
    await createOrg()
    const invitee = await service.prisma.user.create({
      data: { email: 'accepting@x.com', clerkId: 'user_accept_1' },
    })
    vi.spyOn(stubClerkInvitations(), 'getTeamInviteMetadata').mockResolvedValue(
      {
        organizationSlug: ORG_SLUG,
        role: 'campaignAdmin',
        name: 'Accepting Person',
        invitedByUserId: service.user.id,
      },
    )
    const clear = vi
      .spyOn(stubClerkInvitations(), 'clearTeamInviteMetadata')
      .mockResolvedValue(undefined)
    vi.spyOn(stubAnalytics(), 'track').mockResolvedValue(undefined as never)

    const result = await service.client.post(
      ACCEPT_PATH,
      {},
      { headers: authHeaderFor('user_accept_1') },
    )

    expect(result.status).toBe(201)
    expect(result.data).toEqual({
      organizationSlug: ORG_SLUG,
      role: 'campaignAdmin',
    })
    expect(clear).toHaveBeenCalledWith('user_accept_1')

    const row = await service.prisma.organizationMembership.findUnique({
      where: {
        organizationSlug_userId: {
          organizationSlug: ORG_SLUG,
          userId: invitee.id,
        },
      },
    })
    expect(row).not.toBeNull()

    const updatedUser = await service.prisma.user.findUnique({
      where: { id: invitee.id },
    })
    expect(updatedUser?.name).toBe('Accepting Person')
    await vi.waitFor(() =>
      expect(stubCrmTeamMembers().syncTeamMember).toHaveBeenCalled(),
    )
  })

  it('syncs a HubSpot contact with role and company id on accept', async () => {
    await createOrg()
    await createCampaignWithHubspotId('company-456')
    await service.prisma.user.create({
      data: { email: 'accept-synced@x.com', clerkId: 'user_accept_sync_1' },
    })
    vi.spyOn(stubClerkInvitations(), 'getTeamInviteMetadata').mockResolvedValue(
      {
        organizationSlug: ORG_SLUG,
        role: 'volunteer',
        name: 'Synced Acceptor',
        invitedByUserId: service.user.id,
      },
    )
    vi.spyOn(
      stubClerkInvitations(),
      'clearTeamInviteMetadata',
    ).mockResolvedValue(undefined)
    vi.spyOn(stubAnalytics(), 'track').mockResolvedValue(undefined as never)
    const syncTeamMember = vi
      .spyOn(stubCrmTeamMembers(), 'syncTeamMember')
      .mockResolvedValue(undefined)

    const result = await service.client.post(
      ACCEPT_PATH,
      {},
      { headers: authHeaderFor('user_accept_sync_1') },
    )

    expect(result.status).toBe(201)
    await vi.waitFor(() => expect(syncTeamMember).toHaveBeenCalled())
    expect(syncTeamMember).toHaveBeenCalledWith({
      email: 'accept-synced@x.com',
      name: 'Synced Acceptor',
      role: 'volunteer',
      crmCompanyId: 'company-456',
    })
  })

  it('does not fail accept when the HubSpot sync throws', async () => {
    await createOrg()
    await service.prisma.user.create({
      data: { email: 'accept-resilient@x.com', clerkId: 'user_accept_res_1' },
    })
    vi.spyOn(stubClerkInvitations(), 'getTeamInviteMetadata').mockResolvedValue(
      {
        organizationSlug: ORG_SLUG,
        role: 'campaignAdmin',
        name: 'Resilient Acceptor',
        invitedByUserId: service.user.id,
      },
    )
    vi.spyOn(
      stubClerkInvitations(),
      'clearTeamInviteMetadata',
    ).mockResolvedValue(undefined)
    vi.spyOn(stubAnalytics(), 'track').mockResolvedValue(undefined as never)
    const syncTeamMember = vi
      .spyOn(stubCrmTeamMembers(), 'syncTeamMember')
      .mockRejectedValue(new Error('hubspot down'))

    const result = await service.client.post(
      ACCEPT_PATH,
      {},
      { headers: authHeaderFor('user_accept_res_1') },
    )

    expect(result.status).toBe(201)
    await vi.waitFor(() => expect(syncTeamMember).toHaveBeenCalled())
  })

  it('does not overwrite an existing user name', async () => {
    await createOrg()
    const invitee = await service.prisma.user.create({
      data: {
        email: 'named@x.com',
        clerkId: 'user_named_1',
        firstName: 'Existing',
      },
    })
    vi.spyOn(stubClerkInvitations(), 'getTeamInviteMetadata').mockResolvedValue(
      {
        organizationSlug: ORG_SLUG,
        role: 'campaignAdmin',
        name: 'Invite Name',
        invitedByUserId: service.user.id,
      },
    )
    vi.spyOn(
      stubClerkInvitations(),
      'clearTeamInviteMetadata',
    ).mockResolvedValue(undefined)

    const result = await service.client.post(
      ACCEPT_PATH,
      {},
      { headers: authHeaderFor('user_named_1') },
    )

    expect(result.status).toBe(201)
    const updatedUser = await service.prisma.user.findUnique({
      where: { id: invitee.id },
    })
    expect(updatedUser?.name).not.toBe('Invite Name')
    await vi.waitFor(() =>
      expect(stubCrmTeamMembers().syncTeamMember).toHaveBeenCalled(),
    )
  })

  it('is idempotent on a double accept', async () => {
    await createOrg()
    await service.prisma.user.create({
      data: { email: 'twice@x.com', clerkId: 'user_twice_1' },
    })
    vi.spyOn(stubClerkInvitations(), 'getTeamInviteMetadata').mockResolvedValue(
      {
        organizationSlug: ORG_SLUG,
        role: 'campaignAdmin',
        name: 'Twice',
        invitedByUserId: service.user.id,
      },
    )
    vi.spyOn(
      stubClerkInvitations(),
      'clearTeamInviteMetadata',
    ).mockResolvedValue(undefined)

    const first = await service.client.post(
      ACCEPT_PATH,
      {},
      { headers: authHeaderFor('user_twice_1') },
    )
    const second = await service.client.post(
      ACCEPT_PATH,
      {},
      { headers: authHeaderFor('user_twice_1') },
    )

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.data).toEqual(first.data)

    const rows = await service.prisma.organizationMembership.findMany({
      where: { organizationSlug: ORG_SLUG },
    })
    expect(rows).toHaveLength(1)
    await vi.waitFor(() =>
      expect(stubCrmTeamMembers().syncTeamMember).toHaveBeenCalled(),
    )
  })

  it('404s with no invite metadata', async () => {
    await service.prisma.user.create({
      data: { email: 'nothing@x.com', clerkId: 'user_nothing_1' },
    })
    vi.spyOn(stubClerkInvitations(), 'getTeamInviteMetadata').mockResolvedValue(
      null,
    )

    const result = await service.client.post(
      ACCEPT_PATH,
      {},
      { headers: authHeaderFor('user_nothing_1') },
    )

    expect(result.status).toBe(404)
  })
})

describe('PATCH /v1/organizations/team/members/:userId', () => {
  it('the owner can promote a member and role change fires the analytics event', async () => {
    await createOrg()
    const member = await createMemberUser({ email: 'role-change@x.com' })
    await addMembership(member.id, OrganizationRole.volunteer)
    const track = vi
      .spyOn(stubAnalytics(), 'track')
      .mockResolvedValue(undefined as never)

    const result = await service.client.patch(
      `${TEAM_PATH}/members/${member.id}`,
      { role: 'campaignAdmin' },
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )

    expect(result.status).toBe(200)
    expect(result.data.role).toBe('campaignAdmin')
    await vi.waitFor(() => expect(track).toHaveBeenCalled())
    expect(track).toHaveBeenCalledWith(service.user.id, 'Team - Role Changed', {
      fromRole: 'volunteer',
      toRole: 'campaignAdmin',
    })
    await vi.waitFor(() =>
      expect(stubCrmTeamMembers().syncTeamMember).toHaveBeenCalled(),
    )
  })

  it('syncs the new role to the HubSpot contact', async () => {
    await createOrg()
    await createCampaignWithHubspotId('company-789')
    const member = await createMemberUser({ email: 'role-synced@x.com' })
    await addMembership(member.id, OrganizationRole.volunteer)
    vi.spyOn(stubAnalytics(), 'track').mockResolvedValue(undefined as never)
    const syncTeamMember = vi
      .spyOn(stubCrmTeamMembers(), 'syncTeamMember')
      .mockResolvedValue(undefined)

    const result = await service.client.patch(
      `${TEAM_PATH}/members/${member.id}`,
      { role: 'campaignAdmin' },
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )

    expect(result.status).toBe(200)
    await vi.waitFor(() => expect(syncTeamMember).toHaveBeenCalled())
    expect(syncTeamMember).toHaveBeenCalledWith({
      email: 'role-synced@x.com',
      name: null,
      role: 'campaignAdmin',
      crmCompanyId: 'company-789',
    })
  })

  it('does not fail a role change when the HubSpot sync throws', async () => {
    await createOrg()
    const member = await createMemberUser({ email: 'role-resilient@x.com' })
    await addMembership(member.id, OrganizationRole.volunteer)
    vi.spyOn(stubAnalytics(), 'track').mockResolvedValue(undefined as never)
    const syncTeamMember = vi
      .spyOn(stubCrmTeamMembers(), 'syncTeamMember')
      .mockRejectedValue(new Error('hubspot down'))

    const result = await service.client.patch(
      `${TEAM_PATH}/members/${member.id}`,
      { role: 'campaignAdmin' },
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )

    expect(result.status).toBe(200)
    await vi.waitFor(() => expect(syncTeamMember).toHaveBeenCalled())
  })

  it('403s for a campaignAdmin', async () => {
    await createOrg()
    const admin = await createMemberUser({
      email: 'admin2@x.com',
      clerkId: 'user_admin_2',
    })
    await addMembership(admin.id, OrganizationRole.campaignAdmin)
    const target = await createMemberUser({ email: 'target@x.com' })
    await addMembership(target.id, OrganizationRole.volunteer)

    const result = await service.client.patch(
      `${TEAM_PATH}/members/${target.id}`,
      { role: 'campaignAdmin' },
      {
        headers: {
          [ORG_SLUG_HEADER]: ORG_SLUG,
          ...authHeaderFor('user_admin_2'),
        },
      },
    )

    expect(result.status).toBe(403)
  })

  it('400s when the target is the owner', async () => {
    await createOrg()

    const result = await service.client.patch(
      `${TEAM_PATH}/members/${service.user.id}`,
      { role: 'campaignAdmin' },
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )

    expect(result.status).toBe(400)
  })

  it('400s for a role other than campaignAdmin', async () => {
    await createOrg()
    const member = await createMemberUser({ email: 'volunteer-req@x.com' })
    await addMembership(member.id, OrganizationRole.campaignAdmin)

    const result = await service.client.patch(
      `${TEAM_PATH}/members/${member.id}`,
      { role: 'volunteer' },
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )

    expect(result.status).toBe(400)
  })

  it('404s a non-existent member', async () => {
    await createOrg()

    const result = await service.client.patch(
      `${TEAM_PATH}/members/999999`,
      { role: 'campaignAdmin' },
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )

    expect(result.status).toBe(404)
  })

  it('400s on a non-numeric :userId instead of 500ing', async () => {
    await createOrg()

    const result = await service.client.patch(
      `${TEAM_PATH}/members/abc`,
      { role: 'campaignAdmin' },
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )

    expect(result.status).toBe(400)
  })
})

describe('DELETE /v1/organizations/team/members/:userId', () => {
  it('the owner can remove a member and removal fires the analytics event', async () => {
    await createOrg()
    const member = await createMemberUser({ email: 'to-remove@x.com' })
    await addMembership(member.id, OrganizationRole.campaignAdmin)
    const track = vi
      .spyOn(stubAnalytics(), 'track')
      .mockResolvedValue(undefined as never)

    const result = await service.client.delete(
      `${TEAM_PATH}/members/${member.id}`,
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )

    expect(result.status).toBe(204)
    const row = await service.prisma.organizationMembership.findUnique({
      where: {
        organizationSlug_userId: {
          organizationSlug: ORG_SLUG,
          userId: member.id,
        },
      },
    })
    expect(row).toBeNull()
    await vi.waitFor(() => expect(track).toHaveBeenCalled())
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      'Team - Member Removed',
      { role: 'campaignAdmin' },
    )
  })

  it("a removed member's next org-scoped request 404s", async () => {
    await createOrg()
    const member = await createMemberUser({
      email: 'kicked@x.com',
      clerkId: 'user_kicked_1',
    })
    await addMembership(member.id, OrganizationRole.campaignAdmin)

    await service.client.delete(`${TEAM_PATH}/members/${member.id}`, {
      headers: { [ORG_SLUG_HEADER]: ORG_SLUG },
    })

    const result = await service.client.get(TEAM_PATH, {
      headers: {
        [ORG_SLUG_HEADER]: ORG_SLUG,
        ...authHeaderFor('user_kicked_1'),
      },
    })

    expect(result.status).toBe(404)
  })

  it('403s for a campaignAdmin, including removing themselves', async () => {
    await createOrg()
    const admin = await createMemberUser({
      email: 'admin3@x.com',
      clerkId: 'user_admin_3',
    })
    await addMembership(admin.id, OrganizationRole.campaignAdmin)

    const result = await service.client.delete(
      `${TEAM_PATH}/members/${admin.id}`,
      {
        headers: {
          [ORG_SLUG_HEADER]: ORG_SLUG,
          ...authHeaderFor('user_admin_3'),
        },
      },
    )

    expect(result.status).toBe(403)
  })

  it('400s when the target is the owner', async () => {
    await createOrg()

    const result = await service.client.delete(
      `${TEAM_PATH}/members/${service.user.id}`,
      { headers: { [ORG_SLUG_HEADER]: ORG_SLUG } },
    )

    expect(result.status).toBe(400)
  })

  it('400s on a non-numeric :userId instead of 500ing', async () => {
    await createOrg()

    const result = await service.client.delete(`${TEAM_PATH}/members/abc`, {
      headers: { [ORG_SLUG_HEADER]: ORG_SLUG },
    })

    expect(result.status).toBe(400)
  })
})
