import { expect, test, type Page } from '@playwright/test'
import type { AxiosInstance } from 'axios'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import { uniqueToken } from 'src/helpers/testIdentifiers.helper'
import {
  mockRecords,
  paymentHold,
  runJob,
  seedEmailAudience,
  timeTravel,
} from 'src/helpers/vendor-mocks.helper'
import { eventually } from 'tests/utils/eventually'
import { withGatewayRetry } from 'tests/utils/headless-user'

// The payment hold sweeps (gp-api src/paymentHolds/), end to end against
// real Stripe test-mode holds. An email send scheduled more than 3 days out
// saves its card at confirm and places no hold. The test fixtures move the
// send inside that lead and run the paymentHoldPlacementSweep schedule
// through pg-boss, which places the hold off-session; for a declined hold
// they then make the send due and run paymentHoldUnpaidSweep, which
// releases it. Each fixture returns once the run is queued, so every step
// polls for its outcome.
//
// The audience is the SES-simulator stand-in email-send.spec.ts uses, so
// these sends never email a person.

// The flow shell repeats each step's title in an sr-only drawer title (h2),
// so match the visible step heading (h3) to stay strict-mode safe.
const stepHeading = (page: Page, title: string) =>
  page.getByRole('heading', { level: 3, name: title, exact: true })

const CONFIRM_PATH = /\/v1\/outreach\/email\/(\d+)\/confirm$/

type EmailSendState = {
  status: string
  sentCount: number
  cardDeclined: boolean
}

const getSend = async (
  client: AxiosInstance,
  outreachId: number,
): Promise<EmailSendState> => {
  const { data } = await client.get<EmailSendState>(
    `/v1/outreach/email/${outreachId}`,
  )
  return data
}

// 0341 attaches to the customer and then declines every charge, so the
// card saves at confirm and the off-session placement is what fails.
const DECLINED_AT_HOLD_CARD = '4000000000000341'
const GOOD_CARD = '4242424242424242'

const fillStripeCard = async (
  page: Page,
  cardNumber: string,
): Promise<void> => {
  const frame = page
    .frameLocator('iframe[title="Secure payment input frame"]')
    .first()
  const cardInput = frame.locator('#payment-numberInput')
  await expect(cardInput).toBeVisible({ timeout: 30_000 })
  await expect(cardInput).toBeEditable({ timeout: 30_000 })
  await page.waitForTimeout(1_000)
  await cardInput.fill(cardNumber)
  await page.waitForTimeout(300)
  const exp = new Date()
  exp.setFullYear(exp.getFullYear() + 2)
  const mm = String(exp.getMonth() + 1).padStart(2, '0')
  const yy = String(exp.getFullYear()).slice(-2)
  await frame.locator('#payment-expiryInput').fill(`${mm}${yy}`)
  await page.waitForTimeout(300)
  await frame.locator('#payment-cvcInput').fill('123')
  await page.waitForTimeout(300)
  // CI runners sometimes geolocate outside the US, which drops the ZIP field
  // until the country is pinned.
  await frame.locator('#payment-countryInput').selectOption('US')
  await page.waitForTimeout(300)
  const postal = frame.locator('#payment-postalCodeInput')
  if ((await postal.count()) > 0) await postal.fill('82001')
  const linkOptIn = frame.locator('#payment-linkOptInInput')
  if ((await linkOptIn.count()) > 0 && (await linkOptIn.isChecked())) {
    await linkOptIn.uncheck()
  }
  await page.waitForTimeout(500)
}

// The AI draft is answered here so the form it fills is known.
const AI_DRAFT = {
  subject: 'Meet your candidate',
  headline: null,
  body: 'Hi {{first_name}},\n\nI am running to fix our roads.',
  buttonLabel: 'Say hello',
  content: {
    layout: 'personal_letter',
    theme: 'cream_and_forest',
    subject: 'Meet your candidate',
    blocks: [
      { type: 'paragraph', text: 'Hi {{first_name}},' },
      { type: 'paragraph', text: 'I am running to fix our roads.' },
      { type: 'button', label: 'Say hello', url: '' },
    ],
  },
}

// Builds a one-address send through the product's flow, scheduled five days
// out at 10:00 AM, and pays for it with `cardNumber`. Returns the send's id
// once confirm has answered.
const scheduleEmailSendInFiveDays = async (
  page: Page,
  cardNumber: string,
): Promise<{ client: AxiosInstance; outreachId: number }> => {
  await setFlagOverrides(page, { 'win-email-outreach': 'on' })
  await page.route('**/v1/outreach/email/draft', (route) =>
    route.fulfill({ json: AI_DRAFT }),
  )
  const { client } = await setupProCampaignUser(page)
  const { data: mine } = await client.get<{ id: number }>('/v1/campaigns/mine')
  const { vendorMode } = await mockRecords(client, mine.id)
  test.skip(
    vendorMode !== 'mock',
    'The hold sweeps run only against the vendor mocks (skipped when VENDOR_MODE=live)',
  )

  const label = uniqueToken()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  const address = `success+e2e${label}hold@simulator.amazonses.com`
  await seedEmailAudience(client, {
    campaignId: mine.id,
    people: [{ email: address, firstName: 'Sim' }],
  })

  await page.goto('/dashboard/outreach/email', {
    waitUntil: 'domcontentloaded',
  })
  await NavigationHelper.dismissOverlays(page)

  await expect(stepHeading(page, 'What do you want to do?')).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole('button', { name: 'Introduce myself to voters' }).click()

  await expect(stepHeading(page, 'Who do you want to reach?')).toBeVisible({
    timeout: 30_000,
  })
  await expect(
    page.getByText('1 person with an email address').first(),
  ).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: /^Continue/ }).click()

  await expect(stepHeading(page, 'What do you want to say?')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.locator('#email-subject')).toHaveValue(
    'Meet your candidate',
    { timeout: 30_000 },
  )
  await page.locator('#email-title').fill('Fixing our roads')
  await page.getByRole('button', { name: /^Continue/ }).click()

  await expect(stepHeading(page, 'How should it look?')).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole('radio', { name: 'Short' }).click()
  await page.locator('#email-button-url').fill('https://goodparty.org')
  await page.getByRole('button', { name: /^Continue/ }).click()

  // Five days out is past the 3-day lead, so confirm saves the card and the
  // placement sweep places the hold later. The day can fall in next month.
  await expect(stepHeading(page, 'When should it go out?')).toBeVisible({
    timeout: 30_000,
  })
  await page.locator('#email-send-date').click()
  const targetDay = new Date()
  targetDay.setDate(targetDay.getDate() + 5)
  if (targetDay.getMonth() !== new Date().getMonth()) {
    await page.getByRole('button', { name: 'Go to the next month' }).click()
  }
  const targetIso = [
    targetDay.getFullYear(),
    String(targetDay.getMonth() + 1).padStart(2, '0'),
    String(targetDay.getDate()).padStart(2, '0'),
  ].join('-')
  await page.locator(`td[data-day="${targetIso}"] button`).click()
  await page.locator('#email-send-time').click()
  await page.getByRole('option', { name: '10:00 AM' }).click()
  await page.getByRole('button', { name: /^Continue/ }).click()

  await expect(stepHeading(page, 'Ready to send?')).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole('button', { name: 'Continue to payment' }).click()

  await expect(stepHeading(page, 'How do you want to pay?')).toBeVisible({
    timeout: 30_000,
  })
  await fillStripeCard(page, cardNumber)
  const payButton = page.getByRole('button', { name: 'Pay and schedule' })
  await expect(payButton).toBeEnabled({ timeout: 15_000 })
  await payButton.scrollIntoViewIfNeeded()
  const confirmResponse = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      CONFIRM_PATH.test(new URL(res.url()).pathname),
  )
  await payButton.click()
  const confirmed = await confirmResponse
  expect(confirmed.status()).toBe(201)
  expect((await confirmed.json()).outcome).toBe('scheduled')
  const outreachId = Number(
    CONFIRM_PATH.exec(new URL(confirmed.url()).pathname)?.[1],
  )
  expect(outreachId).toBeGreaterThan(0)
  await expect(page.getByTestId('email-success')).toContainText(
    'Your email is scheduled',
    { timeout: 60_000 },
  )
  return { client, outreachId }
}

const runPlacementSweep = async (
  client: AxiosInstance,
  outreachId: number,
): Promise<void> => {
  await withGatewayRetry('email.send_in_2_days', () =>
    timeTravel(client, outreachId, 'email.send_in_2_days'),
  )
  await withGatewayRetry('paymentHolds.placement', () =>
    runJob(client, 'paymentHolds.placement'),
  )
}

test.describe('Email payment hold sweeps', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('the placement sweep holds the card three days out, and the send goes out on that hold', async ({
    page,
  }) => {
    test.setTimeout(6 * 60 * 1000)

    const { client, outreachId } = await scheduleEmailSendInFiveDays(
      page,
      GOOD_CARD,
    )
    expect((await paymentHold(client, outreachId)).state).toBe('scheduled')

    await runPlacementSweep(client, outreachId)
    await eventually(
      {
        that: 'the placement sweep holds the card',
        minTimeout: 2_000,
        maxTimeout: 10_000,
        retries: 15,
      },
      async () => {
        expect(await paymentHold(client, outreachId)).toEqual({
          state: 'held',
          declineCode: null,
        })
      },
    )

    // A send starts only on a held hold, so going out is the proof the
    // sweep's hold is one Stripe will capture.
    await withGatewayRetry('email.send_due_now', () =>
      timeTravel(client, outreachId, 'email.send_due_now'),
    )
    await withGatewayRetry('email.due', () => runJob(client, 'email.due'))
    await eventually(
      {
        that: 'the send goes out on the placed hold',
        minTimeout: 2_000,
        maxTimeout: 10_000,
        retries: 20,
      },
      async () => {
        await withGatewayRetry('email.sweep', () =>
          runJob(client, 'email.sweep'),
        )
        const send = await getSend(client, outreachId)
        expect(send.status).toBe('in_progress')
        expect(send.sentCount).toBe(1)
      },
    )
  })

  test('a hold declined by the placement sweep asks for a card, and the unpaid sweep releases it at send time', async ({
    page,
  }) => {
    test.setTimeout(6 * 60 * 1000)

    const { client, outreachId } = await scheduleEmailSendInFiveDays(
      page,
      DECLINED_AT_HOLD_CARD,
    )

    await runPlacementSweep(client, outreachId)
    await eventually(
      {
        that: 'the placement sweep records the decline',
        minTimeout: 2_000,
        maxTimeout: 10_000,
        retries: 15,
      },
      async () => {
        expect((await paymentHold(client, outreachId)).state).toBe(
          'hold_failed',
        )
      },
    )

    await page.goto(`/dashboard/outreach/email/${outreachId}`, {
      waitUntil: 'domcontentloaded',
    })
    const status = page.getByTestId('email-status')
    await expect(status).toContainText('We need a card.', { timeout: 30_000 })
    await expect(page.getByTestId('email-update-card')).toBeVisible()

    // No card came, so at its send time the unpaid sweep releases the hold.
    // The send fails to start without a held hold, whichever runs first.
    await withGatewayRetry('email.send_due_now', () =>
      timeTravel(client, outreachId, 'email.send_due_now'),
    )
    await withGatewayRetry('paymentHolds.unpaid', () =>
      runJob(client, 'paymentHolds.unpaid'),
    )
    await eventually(
      {
        that: 'the unpaid sweep releases the hold',
        minTimeout: 2_000,
        maxTimeout: 10_000,
        retries: 15,
      },
      async () => {
        expect((await paymentHold(client, outreachId)).state).toBe('released')
      },
    )
    await eventually(
      {
        that: 'the send is failed with no card asked for',
        minTimeout: 2_000,
        maxTimeout: 10_000,
        retries: 15,
      },
      async () => {
        await withGatewayRetry('email.due', () => runJob(client, 'email.due'))
        const send = await getSend(client, outreachId)
        expect(send.status).toBe('failed')
        expect(send.cardDeclined).toBe(false)
      },
    )

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(status).toContainText("It didn't go out.", {
      timeout: 30_000,
    })
    await expect(status).toContainText('Your card was not charged.')
    await expect(page.getByTestId('email-update-card')).toHaveCount(0)
  })
})
