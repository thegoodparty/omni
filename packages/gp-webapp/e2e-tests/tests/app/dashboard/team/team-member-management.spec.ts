import { expect, test, type Page } from '@playwright/test'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { authenticateTestUser } from 'tests/utils/api-registration'

// win-team-accounts (ENG-10816/ENG-11058/ENG-11067): team-page.spec.ts only
// covers the member list, its stats columns, and opening the invite drawer
// to its first step — the two-step invite flow's actual submission, role
// change, member removal, and pending-invite revoke were e2e-untested
// (unit/route tested only). All of it is client-side fetches against
// GET/PATCH/DELETE /v1/organizations/team*, so the whole flow is stubbable
// with a small mutable roster, mirroring team-page.spec.ts's own stub
// pattern (this file duplicates rather than imports it — a parallel PR is
// rewriting that spec).
//
// The flag is 100% by default; the override cookie is a deterministic
// belt-and-suspenders for the webapp's SSR flag read in case CI's Amplitude
// evaluation lags the rollout. It becomes inert, not broken, once the
// win-team-accounts flag-removal PR lands.

const zeroStats = (userId: number) => ({
  userId,
  doorsKnocked: 0,
  callsMade: 0,
  totalLogged: 0,
  lastActivityAt: null,
})

const stubTeamStats = (page: Page, userIds: number[]) =>
  page.route(/\/api\/v1\/organizations\/team\/stats(\?|$)/, (route) => {
    if (route.request().method() !== 'GET') {
      return route.continue()
    }
    return route.fulfill({ json: { stats: userIds.map(zeroStats) } })
  })

test.describe('Invite drawer', () => {
  test.use({ serviceWorkers: 'block' })

  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('the two-step flow collects who to invite, then a role, and posts the expected payload', async ({
    page,
  }) => {
    test.setTimeout(2 * 60 * 1000)
    await setFlagOverrides(page, { 'win-team-accounts': 'on' })
    // Isolated: two tests in this file both call authenticateTestUser, and
    // a cache hit skips its own signInUser (the cached user's Clerk session
    // was only ever established in whichever test first created it) —
    // fatal when both land on the same worker. Isolation makes each test
    // sign in for real regardless of scheduling.
    const { user: owner } = await authenticateTestUser(page, {
      isolated: true,
    })

    await page.route(/\/api\/v1\/organizations\/team(\?|$)/, (route) => {
      if (route.request().method() !== 'GET') {
        return route.continue()
      }
      return route.fulfill({
        json: {
          members: [
            {
              userId: owner.id,
              name: owner.name,
              email: owner.email,
              role: 'owner',
              createdAt: '2024-01-01T00:00:00.000Z',
            },
          ],
          pendingInvites: [],
        },
      })
    })
    await stubTeamStats(page, [owner.id])

    let invitePayload: unknown
    await page.route('**/api/v1/organizations/team/invites', (route) => {
      if (route.request().method() !== 'POST') {
        return route.continue()
      }
      invitePayload = route.request().postDataJSON()
      return route.fulfill({
        json: {
          status: 'pending',
          invite: {
            id: 'invite-e2e-1',
            email: 'new-volunteer@test.goodparty.org',
            name: 'New Volunteer',
            role: 'volunteer',
            createdAt: new Date().toISOString(),
            outreachId: null,
          },
        },
      })
    })

    await page.goto('/team', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)

    // Settle guard: wait for the People card's own query to resolve before
    // interacting — clicking Invite immediately after navigation can race
    // hydration on a cold dev load.
    await expect(page.getByText('1 person on this campaign')).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole('button', { name: 'Invite' }).click()
    await expect(
      page.getByRole('heading', { name: 'Who do you want to invite?' }),
    ).toBeVisible({ timeout: 30_000 })

    await page.getByLabel('Name').fill('New Volunteer')
    await page.getByLabel('Phone number').fill('5555550123')
    await page.getByLabel('Email').fill('new-volunteer@test.goodparty.org')
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(
      page.getByRole('heading', {
        name: 'What role would you like to assign?',
      }),
    ).toBeVisible({ timeout: 30_000 })
    await page.getByRole('radio', { name: /Volunteer/ }).click()
    await page.getByRole('button', { name: 'Send invite' }).click()

    // The drawer closes on success (InviteMemberDrawer's onSuccess).
    await expect(
      page.getByRole('heading', {
        name: 'What role would you like to assign?',
      }),
    ).toHaveCount(0, { timeout: 30_000 })

    expect(invitePayload).toMatchObject({
      name: 'New Volunteer',
      email: 'new-volunteer@test.goodparty.org',
      role: 'volunteer',
      phone: '5555550123',
    })
  })
})

test.describe('Member management', () => {
  test.use({ serviceWorkers: 'block' })

  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('the owner can change a role, remove a member, and revoke a pending invite', async ({
    page,
  }) => {
    test.setTimeout(2 * 60 * 1000)
    await setFlagOverrides(page, { 'win-team-accounts': 'on' })
    // See the "Invite drawer" test above for why this is isolated.
    const { user: owner } = await authenticateTestUser(page, {
      isolated: true,
    })

    const MANAGER = {
      userId: 900501,
      name: 'Casey Manager',
      email: 'casey-manager@test.goodparty.org',
      role: 'campaignAdmin',
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    const PENDING_INVITE = {
      id: 'invite-e2e-2',
      email: 'pending-person@test.goodparty.org',
      name: 'Pending Person',
      role: 'volunteer',
      createdAt: '2024-01-01T00:00:00.000Z',
      outreachId: null,
    }

    let members = [
      {
        userId: owner.id,
        name: owner.name,
        email: owner.email,
        role: 'owner',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      MANAGER,
    ]
    let pendingInvites = [PENDING_INVITE]

    await page.route(/\/api\/v1\/organizations\/team(\?|$)/, (route) => {
      if (route.request().method() !== 'GET') {
        return route.continue()
      }
      return route.fulfill({ json: { members, pendingInvites } })
    })
    await stubTeamStats(page, [owner.id, MANAGER.userId])

    await page.route(
      new RegExp(`/api/v1/organizations/team/members/${MANAGER.userId}(\\?|$)`),
      (route) => {
        const method = route.request().method()
        if (method === 'PATCH') {
          const body = route.request().postDataJSON() as { role: string }
          members = members.map((member) =>
            member.userId === MANAGER.userId
              ? { ...member, role: body.role }
              : member,
          )
          return route.fulfill({
            json: members.find((m) => m.userId === MANAGER.userId),
          })
        }
        if (method === 'DELETE') {
          members = members.filter((member) => member.userId !== MANAGER.userId)
          return route.fulfill({ status: 204 })
        }
        return route.continue()
      },
    )

    await page.route(
      new RegExp(
        `/api/v1/organizations/team/invites/${PENDING_INVITE.id}(\\?|$)`,
      ),
      (route) => {
        if (route.request().method() !== 'DELETE') {
          return route.continue()
        }
        pendingInvites = pendingInvites.filter(
          (invite) => invite.id !== PENDING_INVITE.id,
        )
        return route.fulfill({ status: 204 })
      },
    )

    await page.goto('/team', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)

    // Scoped to the member's own row throughout: "Campaign Manager" and
    // "Volunteer" both also appear as headings in the page's "How roles
    // work" card, so an unscoped text match would pass before any change.
    const managerRow = page.getByRole('row').filter({ hasText: MANAGER.email })
    await expect(managerRow).toBeVisible({ timeout: 30_000 })
    await expect(managerRow.getByText('Campaign Manager')).toBeVisible()

    // Role change: Campaign Manager -> Volunteer.
    await page.getByRole('button', { name: `Manage ${MANAGER.name}` }).click()
    await page.getByRole('menuitem', { name: 'Make Volunteer' }).click()
    await expect(
      managerRow.getByText('Volunteer', { exact: true }),
    ).toBeVisible({ timeout: 30_000 })

    // Removal: the member's row disappears entirely.
    await page.getByRole('button', { name: `Manage ${MANAGER.name}` }).click()
    await page.getByRole('menuitem', { name: 'Remove from team' }).click()
    await expect(managerRow).toHaveCount(0, { timeout: 30_000 })

    // Pending-invite revoke.
    await expect(page.getByText(PENDING_INVITE.email)).toBeVisible()
    await page
      .getByRole('button', {
        name: `Revoke invite for ${PENDING_INVITE.email}`,
      })
      .click()
    await expect(page.getByText('No pending invites.')).toBeVisible({
      timeout: 30_000,
    })
  })
})
