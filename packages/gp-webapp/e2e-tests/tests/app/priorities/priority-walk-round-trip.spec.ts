import { randomUUID } from 'node:crypto'
import { expect, type Page, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  createServeLeadUser,
  mintServeTicket,
  buildServeWelcomeUrl,
  redeemServeTicket,
  seedPrefilledElectedOffice,
} from 'src/helpers/serve.helper'
import { createFlowStepHeading } from 'src/helpers/door-knocking-e2e'
import { withGatewayRetry } from 'tests/utils/headless-user'

// Cheyenne City Council Ward 1: resolves in every environment and has real
// voter data, so the door-knocking pack and the list count are populated.
const CHEYENNE_WARD_1 = 'Z2lkOi8vYmFsbG90LWZhY3RvcnkvUG9zaXRpb24vMTczMjcw'

// A walkable box inside Ward 1, the shape a door card's `walkableArea` is.
const AREA = { west: -104.821, south: 41.133, east: -104.818, north: 41.136 }

type NextWindow = { next?: { router?: { push: (url: string) => void } } }

// The transcript skeleton is up until the conversation has been created and
// read, so its going away means the workspace mounted and its opening effect
// ran: a route that never committed cannot get there.
const conversationOpened = (page: Page, timeout: number) =>
  expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout })

// A priority's door card hands off to door knocking's own create flow, and
// Done on its success screen comes back to the conversation. A demo run saw
// that return never finish. The card itself is an LLM's output, so this seeds
// the priority and the card's saved list through the API and opens the exact
// handoff URL the card's "Start the walk" builds (`openDoorKnocking` in
// shared/agent-chat/cards/proposalFlows.tsx), pushed client-side the way the
// card pushes it, so Done's `router.back()` is the same back navigation.
//
// The card reading Sent is not asserted: that needs a persisted assistant
// turn carrying the proposal, which only the model writes. What the card
// resolves by, the send under its key, is asserted instead.
test.describe('priority door card round trip', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('Done after creating the walk lands back on a working priority', async ({
    page,
  }) => {
    test.setTimeout(6 * 60 * 1000)

    await setFlagOverrides(page, {
      'serve-priorities': 'on',
      'serve-citizen-panels': 'on',
    })

    // Provisioned through the API before the browser holds a session.
    const lead = await createServeLeadUser()
    const { client, electedOfficeId } = await seedPrefilledElectedOffice(lead, {
      ballotReadyPositionId: CHEYENNE_WARD_1,
    })
    client.defaults.headers.common['x-organization-slug'] =
      `eo-${electedOfficeId}`

    const { data: priority } = await withGatewayRetry(
      'POST /v1/priorities',
      () =>
        client.post<{ id: string }>('/v1/priorities', {
          title: 'Speeding on residential streets',
          description: 'Residents report cars speeding past the school.',
        }),
    )

    // What `openDoorKnocking` saves before it navigates: the card's audience
    // kept to its walkable area.
    const { data: list } = await withGatewayRetry(
      'POST /v1/voters/voter-file/filter',
      () =>
        client.post<{ id: number }>('/v1/voters/voter-file/filter', {
          name: 'Residents near the school',
          geoPoly: {
            type: 'Polygon',
            coordinates: [
              [
                [AREA.west, AREA.south],
                [AREA.east, AREA.south],
                [AREA.east, AREA.north],
                [AREA.west, AREA.north],
                [AREA.west, AREA.south],
              ],
            ],
          },
        }),
    )

    const proposalKey = randomUUID()
    const handoff = `/dashboard/door-knocking?${new URLSearchParams({
      create: '1',
      listId: String(list.id),
      proposalKey,
      priorityId: priority.id,
      stepId: 'define',
      side: 'main',
      launchSource: 'priorities',
      area: [AREA.west, AREA.south, AREA.east, AREA.north].join(','),
    }).toString()}`

    await redeemServeTicket(
      page,
      buildServeWelcomeUrl(await mintServeTicket(lead.clerkUserId)),
    )

    const priorityPath = `/dashboard/priorities/${priority.id}`
    await page.goto(priorityPath, { waitUntil: 'domcontentloaded' })
    await conversationOpened(page, 60_000)

    await page.waitForFunction(() =>
      Boolean((window as NextWindow).next?.router),
    )
    await page.evaluate((url) => {
      ;(window as NextWindow).next?.router?.push(url)
    }, handoff)
    await page.waitForURL((url) => url.pathname === '/dashboard/door-knocking')

    await expect(
      createFlowStepHeading(page, 'What do you want to do?'),
    ).toBeVisible({ timeout: 120_000 })
    await page.getByRole('button', { name: /Introduce myself/ }).click()

    await expect(
      createFlowStepHeading(page, 'Who do you want to reach?'),
    ).toBeVisible({ timeout: 30_000 })
    // The card's list arrives picked, and its count is what enables this.
    await page
      .getByRole('button', { name: /^Continue \(/ })
      .click({ timeout: 60_000 })

    await expect(createFlowStepHeading(page, 'What will you say?')).toBeVisible(
      { timeout: 30_000 },
    )
    await page.getByRole('button', { name: 'Continue', exact: true }).click()

    await expect(
      createFlowStepHeading(page, 'What do you want to name your campaign?'),
    ).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Continue', exact: true }).click()

    // The card's area arrives as the campaign's first turf, so nothing is
    // drawn by hand.
    await page
      .getByRole('button', { name: 'Create campaign', exact: true })
      .click({ timeout: 60_000 })

    await expect(
      page.getByRole('heading', { name: 'Your campaign is ready' }),
    ).toBeVisible({ timeout: 120_000 })
    await page.getByRole('button', { name: 'Done', exact: true }).click()

    // A fresh load of the priority takes about a second, so 15s is generous.
    await page.waitForURL((url) => url.pathname === priorityPath, {
      timeout: 15_000,
    })
    await conversationOpened(page, 15_000)
    await expect(
      page.getByRole('textbox', { name: 'Message about this priority' }),
    ).toBeVisible()

    // Linked: the walk went out under the card's key, and that send put the
    // define step's check out on this priority.
    const { data: sent } = await client.get<{ id: number } | null>(
      `/v1/outreach/by-proposal-key/${proposalKey}`,
    )
    expect(sent?.id).toBeTruthy()
    const { data: status } = await client.get<{
      status: {
        steps: {
          id: string
          check?: { state?: string; sentProposalKey?: string }
        }[]
      }
    }>(`/v1/priorities/${priority.id}/status`)
    const define = status.status.steps.find((step) => step.id === 'define')
    expect(define?.check?.state).toBe('out')
    expect(define?.check?.sentProposalKey).toBe(proposalKey)
  })
})
