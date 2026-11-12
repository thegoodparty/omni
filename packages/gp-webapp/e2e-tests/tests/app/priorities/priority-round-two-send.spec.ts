import { randomUUID } from 'node:crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { addBusinessDays, startOfDay } from 'date-fns'
import { expect, test, type Page } from '@playwright/test'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { setupElectedOfficeUser } from 'src/helpers/organizations'
import {
  deliverStripeEvent,
  mockRecordsForOrganization,
  runJob,
  timeTravel,
} from 'src/helpers/vendor-mocks.helper'
import { eventually } from 'tests/utils/eventually'
import { withGatewayRetry } from 'tests/utils/headless-user'

// A priority text is one purchase in two rounds. Round 1 goes out on the
// date picked. Round 2 is paid for in the same checkout and held, with a
// list that has nobody on it yet. The priorityRoundTwoDrawDue schedule draws
// that list on the last day staff can still take it, then hands the send
// off through the outreachTextSend job. This spec pays for both rounds with
// a Stripe test card, brings round 2 due, runs the schedule and waits for
// round 2 to be handed off.
//
// The round 2 purchase starts from a priority's chat card, which only the
// model writes. So the spec saves the card's sampled list and priority
// through the API, drives the Serve SMS flow with the sms-send spec's steps,
// and adds the card's link (the list, the priority, roundTwoSize) to the
// create request the review step sends. Everything from that create on is
// the product's own path.

const IMAGE_BUFFER = readFileSync(
  join(__dirname, '../../../src/fixtures/heart.png'),
)

// MIN_TEXTS_PER_ROUND in contracts: the smallest round 2 can be.
const ROUND_TWO_SIZE = 25
// Round 1 is quoted after the opt-out scrub and the phone dedupe, and a
// quote under 25 (MIN_SERVE_SMS_RECIPIENTS) is refused, so its sample keeps
// headroom over that floor.
const ROUND_ONE_SAMPLE = 40

const stepHeading = (page: Page, title: string) =>
  page.getByRole('heading', { level: 3, name: title, exact: true })

// The S3 bucket's CORS allows dev.goodparty.org but not *.vercel.app, so the
// image PUT is replayed from Node (see sms-send.spec.ts).
const relayS3ImageUploads = async (page: Page): Promise<void> => {
  await page.route(/amazonaws\.com/, async (route) => {
    if (route.request().method() !== 'PUT') {
      return route.continue()
    }
    const response = await route.fetch()
    await route.fulfill({ response })
  })
}

const fillStripeCard = async (page: Page): Promise<void> => {
  const frame = page
    .frameLocator('iframe[title="Secure payment input frame"]')
    .first()
  const cardInput = frame.locator('#payment-numberInput')
  await expect(cardInput).toBeVisible({ timeout: 30_000 })
  await expect(cardInput).toBeEditable({ timeout: 30_000 })
  await page.waitForTimeout(1_000)

  await cardInput.fill('4242424242424242')
  await page.waitForTimeout(300)
  const exp = new Date()
  exp.setFullYear(exp.getFullYear() + 2)
  const mm = String(exp.getMonth() + 1).padStart(2, '0')
  const yy = String(exp.getFullYear()).slice(-2)
  await frame.locator('#payment-expiryInput').fill(`${mm}${yy}`)
  await page.waitForTimeout(300)
  await frame.locator('#payment-cvcInput').fill('123')
  await page.waitForTimeout(300)
  // CI runners sometimes geolocate outside the US, which drops the postal
  // code field until the country is pinned.
  await frame.locator('#payment-countryInput').selectOption('US')
  await page.waitForTimeout(300)
  await frame.locator('#payment-postalCodeInput').fill('82001')
  await page.waitForTimeout(500)
}

test.describe('priority round 2 text', () => {
  test.beforeEach(async ({ page }) => {
    await setFlagOverrides(page, {
      'serve-sms-outreach': 'on',
      'serve-priorities': 'on',
      'serve-citizen-panels': 'on',
    })
    await blockSlowScripts(page)
  })

  test('is paid with round 1, held, then drawn and handed off by its schedule', async ({
    page,
  }) => {
    test.setTimeout(10 * 60 * 1000)

    // gp-api refuses a round 2 unless serve-citizen-panels is on for the
    // official, and the override cookie never reaches gp-api. The GoodParty
    // Dev Amplitude project, which previews read too, serves it to
    // @goodparty.org users, so the official gets a staff-shaped test email.
    const { client } = await setupElectedOfficeUser(page, undefined, {
      email: `qa-${randomUUID()}+clerk_test@goodparty.org`,
    })
    const organizationSlug = String(
      client.defaults.headers['x-organization-slug'],
    )
    // The fixtures below run only against vendor mocks.
    const { vendorMode } = await mockRecordsForOrganization(
      client,
      organizationSlug,
    )
    test.skip(vendorMode !== 'mock', 'needs VENDOR_MODE=mock')

    const { data: priority } = await withGatewayRetry(
      'POST /v1/priorities',
      () =>
        client.post<{ id: string }>('/v1/priorities', {
          title: 'Fix the flooding on Maple',
          description: 'The drains back up every storm.',
        }),
    )
    // The card's audience: a sample of the district, so the rest of it is
    // the pool round 2 is drawn from.
    const { data: list } = await withGatewayRetry(
      'POST /v1/voters/voter-file/filter',
      () =>
        client.post<{ id: number }>('/v1/voters/voter-file/filter', {
          name: 'Residents asked about flooding',
          hasCellPhone: true,
          sample: { size: ROUND_ONE_SAMPLE },
        }),
    )

    await relayS3ImageUploads(page)

    await page.goto('/dashboard/constituent-outreach', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)
    await expect(page.locator('#contacts-dashboard')).toBeVisible({
      timeout: 30_000,
    })

    await page.getByRole('button', { name: 'SMS' }).click()

    await expect(
      page.getByRole('button', { name: 'Introduce myself to constituents' }),
    ).toBeVisible({ timeout: 30_000 })
    await page
      .getByRole('button', { name: 'Introduce myself to constituents' })
      .click()

    await expect(stepHeading(page, 'Who do you want to reach?')).toBeVisible({
      timeout: 30_000,
    })
    const pickerTrigger = page.getByRole('button', {
      name: /choose a constituent list/i,
    })
    await expect(pickerTrigger).toBeVisible({ timeout: 30_000 })
    await pickerTrigger.click()
    await page.getByRole('button', { name: 'All constituents' }).click()
    await expect(page.getByRole('button', { name: /^Continue/ })).toBeEnabled({
      timeout: 30_000,
    })
    await page.getByRole('button', { name: /^Continue/ }).click()

    await expect(stepHeading(page, 'What do you want to say?')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByPlaceholder('Drafting your message…')).toHaveCount(
      0,
      { timeout: 30_000 },
    )
    await page
      .locator('input[type="file"][accept*="image/png"]')
      .setInputFiles({
        name: 'heart.png',
        mimeType: 'image/png',
        buffer: IMAGE_BUFFER,
      })
    await expect(page.locator('[data-slot="sms-image-dropzone"]')).toBeHidden({
      timeout: 15_000,
    })
    await page.getByRole('button', { name: /^Continue/ }).click()

    await expect(stepHeading(page, 'When do you want to send it?')).toBeVisible(
      { timeout: 30_000 },
    )
    const nameInput = page.locator('#serve-sms-name')
    if ((await nameInput.inputValue()) === '') {
      await nameInput.fill('E2E priority round 2')
    }
    // Three business days out keeps a day clear of the two-day floor.
    const today = startOfDay(new Date())
    const sendDay = addBusinessDays(today, 3)
    const isoDate = [
      sendDay.getFullYear(),
      String(sendDay.getMonth() + 1).padStart(2, '0'),
      String(sendDay.getDate()).padStart(2, '0'),
    ].join('-')
    if (sendDay.getMonth() !== today.getMonth()) {
      await page.getByRole('button', { name: 'Go to the next month' }).click()
    }
    await page.locator(`td[data-day="${isoDate}"] button`).click()

    // Armed before the review step mounts: it creates the send and opens
    // checkout as soon as it renders.
    let roundOneId: number | null = null
    let roundTwoId: number | null = null
    await page.route(/\/api\/v1\/outreach\/serve\/sms$/, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const body = route.request().postDataJSON() as Record<string, unknown>
      const response = await route.fetch({
        postData: JSON.stringify({
          ...body,
          voterFileFilterId: list.id,
          priorityId: priority.id,
          roundTwoSize: ROUND_TWO_SIZE,
        }),
        timeout: 90_000,
      })
      if (response.ok()) {
        const created = (await response.json()) as {
          outreachId?: number
          followUp?: { outreachId: number }
        }
        roundOneId = created.outreachId ?? null
        roundTwoId = created.followUp?.outreachId ?? null
      }
      await route.fulfill({ response })
    })

    let sessionId: string | null = null
    await page.route(
      /\/api\/v1\/payments\/purchase\/complete-checkout-session$/,
      async (route) => {
        try {
          const body = JSON.parse(route.request().postData() ?? '{}') as {
            checkoutSessionId?: string
          }
          if (body.checkoutSessionId) sessionId = body.checkoutSessionId
        } catch {
          // A body that does not parse carries no session id.
        }
        await route.continue()
      },
    )

    await page.getByRole('button', { name: /^Continue/ }).click()

    await expect(stepHeading(page, 'Review & pay')).toBeVisible({
      timeout: 30_000,
    })
    const stripeFrame = page
      .frameLocator('iframe[title="Secure payment input frame"]')
      .first()
    // Stripe mounts only once the create returns, which may take its 90s.
    await expect(stripeFrame.locator('#payment-numberInput')).toBeVisible({
      timeout: 90_000,
    })
    expect(roundOneId, 'the create made round 1').toBeGreaterThan(0)
    expect(
      roundTwoId,
      'the create held a round 2 (the pool past round 1 was too small)',
    ).toBeGreaterThan(0)

    await fillStripeCard(page)
    const saveCheckbox = stripeFrame.getByLabel(
      'Save my information for faster checkout',
    )
    if (await saveCheckbox.isChecked().catch(() => false)) {
      await saveCheckbox.uncheck()
    }
    await page.waitForTimeout(500)
    const payButton = page.getByRole('button', { name: 'Complete Purchase' })
    await expect(payButton).toBeEnabled({ timeout: 30_000 })
    await payButton.scrollIntoViewIfNeeded()
    await payButton.click()
    await expect(
      page.getByRole('heading', { name: 'Payment successful!' }),
    ).toBeVisible({ timeout: 60_000 })
    expect(sessionId).toBeTruthy()

    // One checkout pays both rounds: round 1 goes to delivery now, round 2
    // waits for its draw.
    await deliverStripeEvent(client, sessionId!)

    const readStatus = async (outreachId: number) => {
      const { data } = await client.get<{ status: string }>(
        `/v1/outreach/serve/${outreachId}`,
      )
      return data.status
    }
    await eventually(
      {
        that: 'round 1 is handed off and round 2 is held for its draw',
        minTimeout: 500,
        maxTimeout: 5_000,
        retries: 10,
      },
      async () => {
        expect(await readStatus(roundOneId!)).toBe('in_progress')
        expect(await readStatus(roundTwoId!)).toBe('pending')
      },
    )

    await timeTravel(client, roundTwoId!, 'priority.round_two_due_now')
    await runJob(client, 'priority.roundTwoDrawDue')

    // The draw samples the district and fits the model before it hands off.
    await eventually(
      {
        that: 'round 2 is drawn and handed off by its schedule',
        minTimeout: 2_000,
        maxTimeout: 10_000,
        retries: 30,
      },
      async () => {
        expect(await readStatus(roundTwoId!)).toBe('in_progress')
      },
    )
  })
})
