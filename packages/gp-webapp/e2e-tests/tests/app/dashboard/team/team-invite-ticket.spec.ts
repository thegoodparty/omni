import { randomUUID } from 'crypto'
import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { clerkBackend, createHeadlessTestUser } from 'tests/utils/headless-user'

// The real new-user invite path (ENG-11027): a Clerk invitation's hosted
// accept URL redirects to /team-invite with __clerk_ticket, the signed-out
// invitee creates their account through the ticket, and accept lands them in
// the inviter's org. The invitation is created directly via the Clerk
// backend API rather than POST team/invites — that route is flag-gated
// per-user and a fresh headless owner doesn't carry the win-team-accounts
// flag, while everything this spec exercises (/team-invite, accept) is
// deliberately ungated. notify:false keeps Clerk from emailing the throwaway
// address; the returned invitation.url is the same hosted link the email
// would carry.
test.describe('Team invite — new-user ticket redemption', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('a signed-out invitee redeems the emailed link end to end and joins as a manager', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(4 * 60 * 1000)

    const owner = await createHeadlessTestUser({ product: 'win' })
    const inviteeEmail = `test-${Date.now()}-invitee@test.goodparty.org`

    const invitation = await clerkBackend.invitations.createInvitation({
      emailAddress: inviteeEmail,
      redirectUrl: `${baseURL}/team-invite`,
      notify: false,
      publicMetadata: {
        organizationSlug: owner.orgSlug!,
        role: 'campaignAdmin',
        name: 'Ticket Invitee',
        invitedByUserId: owner.user.id,
      },
    })

    try {
      expect(invitation.url).toBeTruthy()

      // The Clerk-hosted accept endpoint verifies the ticket and redirects to
      // our redirectUrl with __clerk_ticket appended — exactly what the email
      // link does.
      await page.goto(invitation.url!, { waitUntil: 'domcontentloaded' })
      await page.waitForURL(/\/team-invite/, { timeout: 30_000 })

      await expect(
        page.getByText('You’ve been invited to join a campaign team'),
      ).toBeVisible({ timeout: 30_000 })

      await page.getByLabel('First name').fill('Ticket')
      await page.getByLabel('Last name').fill('Invitee')
      await page.getByLabel('Password').fill(`Test${randomUUID()}!`)
      await page.getByRole('button', { name: 'Accept invitation' }).click()

      // Ticket sign-up (account created, email pre-verified — no OTP) +
      // server-side accept + hard nav.
      await page.waitForURL((url) => url.pathname === '/dashboard', {
        timeout: 90_000,
      })

      // The durable assertion is the membership itself: the owner's team
      // list shows the invitee as a persisted manager and the invitation is
      // no longer pending.
      const { data: team } = await owner.client.get<{
        members: { email: string; role: string }[]
        pendingInvites: { email: string }[]
      }>('/v1/organizations/team', {
        headers: { 'X-Organization-Slug': owner.orgSlug! },
      })
      const member = team.members.find(
        (candidate) => candidate.email === inviteeEmail,
      )
      expect(member?.role).toBe('campaignAdmin')
      expect(
        team.pendingInvites.filter((invite) => invite.email === inviteeEmail),
      ).toEqual([])
    } finally {
      // A failed run leaves the invitation pending forever (the nightly test
      // sweeper removes users, not invitations) — revoke it so it can't
      // accumulate in the instance-wide pending list. A consumed invitation
      // 400s here, which is fine.
      await clerkBackend.invitations
        .revokeInvitation(invitation.id)
        .catch(() => undefined)
    }
  })
})
