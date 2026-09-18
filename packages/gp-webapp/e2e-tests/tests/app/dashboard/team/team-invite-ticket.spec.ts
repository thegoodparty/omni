import { randomUUID } from 'crypto'
import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { clerkBackend, createHeadlessTestUser } from 'tests/utils/headless-user'
import { clerkThrottle } from 'tests/utils/throttle-requests-with-retry'

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
    // Headroom for the accept retry loop below: three 60s outcome waits plus
    // two 12s backoffs on top of throttled setup.
    test.setTimeout(7 * 60 * 1000)

    const owner = await createHeadlessTestUser({ product: 'win' })
    const inviteeEmail = `test-${Date.now()}-invitee@test.goodparty.org`

    // Through clerkThrottle like every other direct Clerk SDK call in the
    // suite: it spends from the same instance-wide 100req/10s budget, and
    // Clerk errors aren't axios errors, so only the limiter's own 429 retry
    // covers this path (ENG-11105).
    const invitation = await clerkThrottle(() =>
      clerkBackend.invitations.createInvitation({
        emailAddress: inviteeEmail,
        redirectUrl: `${baseURL}/team-invite`,
        notify: false,
        publicMetadata: {
          organizationSlug: owner.orgSlug!,
          role: 'campaignAdmin',
          name: 'Ticket Invitee',
          invitedByUserId: owner.user.id,
        },
      }),
    )

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
      const acceptButton = page.getByRole('button', {
        name: 'Accept invitation',
      })
      const errorAlert = page.getByRole('alert')
      await acceptButton.click()

      // Ticket sign-up (account created, email pre-verified — no OTP) +
      // server-side accept + hard nav. Either half can fail transiently when
      // the instance-wide Clerk budget is exhausted (another run's shards, the
      // 6-hourly test-user sweep — this spec failed all its retries inside the
      // 18:00 UTC sweep window, run 35376397843). The page surfaces that as a
      // role="alert" with the button re-enabled, and a re-click resumes where
      // it failed — a failed sign-up left the ticket unconsumed, and a failed
      // accept retries against the session the sign-up just created. So drive
      // through the error state instead of holding one blind 90s wait open;
      // only a genuinely dead ticket ("already been used") fails fast.
      // Only the URL decides success — racing the alert against the
      // navigation misread a slow but successful accept as a failure (the
      // page has other role="alert" nodes, e.g. Next's route announcer).
      // The alert is read purely as a diagnostic after a timed-out wait.
      const ACCEPT_ATTEMPTS = 3
      for (let attempt = 1; ; attempt++) {
        const navigated = await page
          .waitForURL((url) => url.pathname === '/dashboard', {
            timeout: 60_000,
          })
          .then(
            () => true,
            () => false,
          )
        if (navigated) break
        const alertText = await errorAlert
          .textContent({ timeout: 1_000 })
          .catch(() => null)
        expect(alertText ?? '').not.toContain('already been used')
        expect(
          attempt,
          `accept never reached /dashboard (alert: ${alertText ?? 'none'})`,
        ).toBeLessThan(ACCEPT_ATTEMPTS)
        // Clerk's rate windows are 10s — wait one out so the re-click isn't
        // spent inside the same exhausted budget.
        await page.waitForTimeout(12_000)
        if (new URL(page.url()).pathname === '/dashboard') break
        await expect(acceptButton).toBeEnabled({ timeout: 30_000 })
        await acceptButton.click()
      }

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
      await clerkThrottle(() =>
        clerkBackend.invitations.revokeInvitation(invitation.id),
      ).catch(() => undefined)
    }
  })
})
