import { expect, test, type Page } from '@playwright/test'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { authenticateTestUser } from 'tests/utils/api-registration'

// win-team-accounts (ENG-11056/ENG-11059): the manager-side "Assign to"
// modal on a nativePhoneBanking outreach's details drawer
// (app/dashboard/outreach/v2/OutreachAssignModal.tsx +
// OutreachAssigneesSection.tsx) had unit coverage only. Everything this
// section reads/writes is a client-side fetch
// (GET /v1/outreach, GET /v1/outreach/:id, GET /v1/outreach/:id/assignments,
// GET /v1/organizations/team, POST/DELETE .../assignments), so the whole
// flow is stubbable — no real phone banking list needs to exist. The
// `?outreachId=` deep link is what opens the drawer straight onto a stubbed
// row (OutreachHubPage.tsx resolves it off its own client-refetched list,
// not the server-rendered seed).
//
// The flag is 100% by default; the override cookie below is a deterministic
// belt-and-suspenders for the webapp's own SSR flag read (this section
// checks it client-side too) in case CI's Amplitude evaluation lags the
// rollout. It becomes inert, not broken, once the win-team-accounts
// flag-removal PR lands.

const FIXTURE_OUTREACH_ID = 424242

const OWNER_MEMBER = {
  userId: 1,
  name: 'Ward Owner',
  email: 'owner@test.goodparty.org',
  role: 'owner',
  createdAt: '2024-01-01T00:00:00.000Z',
}
const MANAGER_MEMBER = {
  userId: 2,
  name: 'Casey Manager',
  email: 'casey-manager@test.goodparty.org',
  role: 'campaignAdmin',
  createdAt: '2024-01-01T00:00:00.000Z',
}
const VOLUNTEER_ALEX = {
  userId: 3,
  name: 'Alex Volunteer',
  email: 'alex-volunteer@test.goodparty.org',
  role: 'volunteer',
  createdAt: '2024-01-01T00:00:00.000Z',
}
const VOLUNTEER_BLAIR = {
  userId: 4,
  name: 'Blair Volunteer',
  email: 'blair-volunteer@test.goodparty.org',
  role: 'volunteer',
  createdAt: '2024-01-01T00:00:00.000Z',
}

const outreachListFixture = [
  {
    id: FIXTURE_OUTREACH_ID,
    outreachType: 'nativePhoneBanking',
    name: 'Ward 1 Calls',
    status: 'in_progress',
    createdAt: '2026-01-01T00:00:00.000Z',
    date: '2026-01-01T00:00:00.000Z',
    phoneListId: 10,
  },
]

const outreachDetailFixture = {
  id: FIXTURE_OUTREACH_ID,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  campaignId: null,
  outreachType: 'nativePhoneBanking',
  projectId: null,
  name: 'Ward 1 Calls',
  status: 'in_progress',
  error: null,
  audienceRequest: null,
  script: null,
  message: null,
  date: '2026-01-01T00:00:00.000Z',
  imageUrl: null,
  voterFileFilterId: 1,
  doorKnockingRouteId: null,
  phoneListId: 10,
  identityId: null,
  didState: null,
  didNpaSubset: [],
  title: null,
  textCount: null,
  billableTextCount: null,
  campaignPlanDueDate: null,
  organizationSlug: null,
  archivedAt: null,
  phoneBanking: {
    listId: 10,
    entriesTotal: 25,
    entriesCalled: 5,
    peopleTotal: 25,
    peopleCalled: 5,
    byOutcome: {},
    supporters: 2,
    unsure: 1,
    nonSupporters: 2,
    byFollowUp: {},
  },
}

// A small mutable roster of assignees, closed over by the route handlers
// below so assign/unassign against the same outreach id round-trips through
// state the way the real endpoint would — the section refetches this list
// after every mutation.
type Assignee = {
  userId: number
  name: string
  role: string
  createdAt: string
  assignedByUserId: number
  assignedByName: string
  loggedCount: number
}

const stubOutreachAssignFlow = async (page: Page) => {
  let assignees: Assignee[] = []

  await page.route(/\/api\/v1\/outreach(\?|$)/, (route) => {
    if (route.request().method() !== 'GET') {
      return route.continue()
    }
    return route.fulfill({ json: outreachListFixture })
  })

  await page.route(
    new RegExp(`/api/v1/outreach/${FIXTURE_OUTREACH_ID}(\\?|$)`),
    (route) => {
      if (route.request().method() !== 'GET') {
        return route.continue()
      }
      return route.fulfill({ json: outreachDetailFixture })
    },
  )

  await page.route(/\/api\/v1\/organizations\/team(\?|$)/, (route) => {
    if (route.request().method() !== 'GET') {
      return route.continue()
    }
    return route.fulfill({
      json: {
        members: [
          OWNER_MEMBER,
          MANAGER_MEMBER,
          VOLUNTEER_ALEX,
          VOLUNTEER_BLAIR,
        ],
        pendingInvites: [],
      },
    })
  })

  await page.route(
    new RegExp(`/api/v1/outreach/${FIXTURE_OUTREACH_ID}/assignments(\\?|$)`),
    (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        return route.fulfill({ json: { assignees } })
      }
      if (method === 'POST') {
        const body = route.request().postDataJSON() as {
          assigneeUserId: number
        }
        const member = [
          OWNER_MEMBER,
          MANAGER_MEMBER,
          VOLUNTEER_ALEX,
          VOLUNTEER_BLAIR,
        ].find((candidate) => candidate.userId === body.assigneeUserId)
        const created: Assignee = {
          userId: body.assigneeUserId,
          name: member?.name ?? `Member #${body.assigneeUserId}`,
          role: member?.role ?? 'volunteer',
          createdAt: new Date().toISOString(),
          assignedByUserId: OWNER_MEMBER.userId,
          assignedByName: OWNER_MEMBER.name,
          loggedCount: 0,
        }
        assignees = [
          ...assignees.filter((a) => a.userId !== created.userId),
          created,
        ]
        return route.fulfill({ json: created })
      }
      return route.continue()
    },
  )

  await page.route(
    new RegExp(
      `/api/v1/outreach/${FIXTURE_OUTREACH_ID}/assignments/(\\d+)(\\?|$)`,
    ),
    (route) => {
      if (route.request().method() !== 'DELETE') {
        return route.continue()
      }
      const match = route
        .request()
        .url()
        .match(/assignments\/(\d+)/)
      const userId = match ? Number(match[1]) : undefined
      assignees = assignees.filter((a) => a.userId !== userId)
      return route.fulfill({ status: 204 })
    },
  )
}

test.describe('Outreach assign-to-member modal', () => {
  test.use({ serviceWorkers: 'block' })

  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('search filters the roster, assigning updates the reassign title and per-assignee logged count, and unassigning reverts both', async ({
    page,
  }) => {
    test.setTimeout(2 * 60 * 1000)
    await setFlagOverrides(page, { 'win-team-accounts': 'on' })
    await authenticateTestUser(page)
    await stubOutreachAssignFlow(page)

    await page.goto(`/dashboard/outreach?outreachId=${FIXTURE_OUTREACH_ID}`, {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    await expect(
      page.getByRole('heading', { name: 'Ward 1 Calls' }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('No one is assigned yet.')).toBeVisible()

    await page.getByRole('button', { name: 'Assign someone' }).click()
    await expect(
      page.getByRole('dialog', { name: /Assign to Ward 1 Calls/ }),
    ).toBeVisible({ timeout: 30_000 })

    // Search narrows the roster to the matching name only.
    await page.getByPlaceholder('Search by name, email, or phone').fill('Blair')
    await expect(
      page.getByRole('button', { name: new RegExp(VOLUNTEER_BLAIR.name) }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: new RegExp(VOLUNTEER_ALEX.name) }),
    ).toHaveCount(0)

    await page.getByPlaceholder('Search by name, email, or phone').fill('')

    // Assigning Alex flips the dialog from "Assign to" to "Reassign" — the
    // same open dialog, recomputed off the live assignee set.
    await page
      .getByRole('button', { name: new RegExp(VOLUNTEER_ALEX.name) })
      .click()
    const assignModal = page.getByRole('dialog', {
      name: /Reassign Ward 1 Calls/,
    })
    await expect(assignModal).toBeVisible({ timeout: 30_000 })

    // Close the assign modal specifically — the outreach details drawer
    // underneath is its own dialog and stays open the whole test, so a bare
    // getByRole('dialog') would never reach zero.
    await assignModal.getByRole('button', { name: 'Close' }).click()
    await expect(
      page.getByRole('dialog', { name: /Reassign Ward 1 Calls/ }),
    ).toHaveCount(0)

    // The section behind the modal shows the assignee, their role, and a
    // real (zero) logged count — the zero is deliberate signal, not absence.
    await expect(page.getByText(VOLUNTEER_ALEX.name)).toBeVisible()
    await expect(page.getByText('0 logged')).toBeVisible()

    // Unassign via the same modal reverts the title and the section.
    await page.getByRole('button', { name: 'Assign someone' }).click()
    await expect(
      page.getByRole('dialog', { name: /Reassign Ward 1 Calls/ }),
    ).toBeVisible({ timeout: 30_000 })
    await page
      .getByRole('button', { name: new RegExp(VOLUNTEER_ALEX.name) })
      .click()
    await expect(
      page.getByRole('dialog', { name: /Assign to Ward 1 Calls/ }),
    ).toBeVisible({ timeout: 30_000 })
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close' })
      .click()

    await expect(page.getByText('No one is assigned yet.')).toBeVisible()
  })
})
