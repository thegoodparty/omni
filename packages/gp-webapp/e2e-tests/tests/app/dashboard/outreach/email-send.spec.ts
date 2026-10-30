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
  runJob,
  seedEmailAudience,
  timeTravel,
} from 'src/helpers/vendor-mocks.helper'
import { eventually } from 'tests/utils/eventually'
import { withGatewayRetry } from 'tests/utils/headless-user'

// The email send, end to end against the vendor-mock stack: compose, pick a
// voter-file list with the email filter forced on, confirm with a card Stripe
// declines at the hold, confirm again with Stripe's 4242 card (a real
// test-mode hold), then run the real due, prepare, send and settle steps and
// wait for Sent.
//
// Emails reach the people DB only through imported contacts, read from dev's
// database, which a preview's own database never feeds. So the campaign's
// email audience is a test fixture (gp-api's PeopleEmailFixtureService, mock
// vendors only) holding SES mailbox simulator addresses alone: this spec can
// never email a person. A Win campaign without it has no one to email, which
// the second case asserts.

// The flow shell repeats each step's title in an sr-only drawer title (h2),
// so match the visible step heading (h3) to stay strict-mode safe.
const stepHeading = (page: Page, title: string) =>
  page.getByRole('heading', { level: 3, name: title, exact: true })

const CONFIRM_PATH = /\/v1\/outreach\/email\/(\d+)\/confirm$/

type EmailSendState = { status: string; sentCount: number }

const getSend = async (
  client: AxiosInstance,
  outreachId: number,
): Promise<EmailSendState> => {
  const { data } = await client.get<EmailSendState>(
    `/v1/outreach/email/${outreachId}`,
  )
  return data
}

// 0341 attaches to the customer and then declines every charge, so it fails
// at the hold rather than at the card form (0002 fails at the card form).
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

test.describe('Email send — mock pipeline', () => {
  test.use({ serviceWorkers: 'block' })

  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('pick a list, compose, a declined card, pay with 4242, and the send goes out', async ({
    page,
  }) => {
    test.setTimeout(6 * 60 * 1000)

    await setFlagOverrides(page, { 'win-email-outreach': 'on' })
    const { client } = await setupProCampaignUser(page)
    const { data: mine } = await client.get<{ id: number }>(
      '/v1/campaigns/mine',
    )
    const { vendorMode } = await mockRecords(client, mine.id)
    test.skip(
      vendorMode !== 'mock',
      'The email pipeline runs against the SES mock (skipped when VENDOR_MODE=live)',
    )

    const label = uniqueToken()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    const addresses = ['success', 'success', 'success'].map(
      (kind, i) => `${kind}+e2e${label}n${i}@simulator.amazonses.com`,
    )
    await seedEmailAudience(client, {
      campaignId: mine.id,
      people: addresses.map((email, i) => ({ email, firstName: `Sim${i}` })),
    })

    await page.goto('/dashboard/outreach/email', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    // ── Goal ─────────────────────────────────────────────────────────────
    await expect(stepHeading(page, 'What do you want to do?')).toBeVisible({
      timeout: 30_000,
    })
    await page
      .getByRole('button', { name: 'Introduce myself to voters' })
      .click()

    // ── Compose ──────────────────────────────────────────────────────────
    await expect(stepHeading(page, 'What do you want to say?')).toBeVisible({
      timeout: 30_000,
    })
    await page.locator('#email-subject').fill('Meet your candidate')
    const body = page.locator('[aria-label="Message body"]').first()
    await body.click()
    await page.keyboard.type('I am running to fix our roads. Say hello.')
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Audience: a voter-file list, email forced on ────────────────────
    await expect(stepHeading(page, 'Who do you want to reach?')).toBeVisible({
      timeout: 30_000,
    })
    await page.getByText('Choose a voter list').click()
    await page.getByRole('button', { name: /All voters/ }).click()
    await expect(
      page
        .getByText(`Email ${addresses.length} voters with an email address`)
        .first(),
    ).toBeVisible({ timeout: 60_000 })
    await page.locator('#email-consent').click()
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Schedule: send as soon as it is paid (the default) ──────────────
    await expect(stepHeading(page, 'When should it go out?')).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole('button', { name: 'Next' }).click()

    // ── Review ───────────────────────────────────────────────────────────
    await expect(stepHeading(page, 'Ready to send?')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId('email-price')).toContainText('$0.50')
    await page.getByRole('button', { name: 'Continue to payment' }).click()

    // ── Pay: a real Stripe test-mode hold ────────────────────────────────
    await expect(stepHeading(page, 'How do you want to pay?')).toBeVisible({
      timeout: 30_000,
    })
    // A decline at confirm keeps the send a draft on this step.
    await fillStripeCard(page, DECLINED_AT_HOLD_CARD)
    const payButton = page.getByRole('button', { name: 'Pay and send' })
    await expect(payButton).toBeEnabled({ timeout: 15_000 })
    await payButton.scrollIntoViewIfNeeded()
    const declinedConfirm = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        CONFIRM_PATH.test(new URL(res.url()).pathname),
    )
    await payButton.click()
    expect((await declinedConfirm).status()).toBe(402)
    await expect(
      page.getByText('Your card was declined. Try another card.'),
    ).toBeVisible({ timeout: 30_000 })
    await expect(stepHeading(page, 'How do you want to pay?')).toBeVisible()
    await page.getByRole('button', { name: 'Use a different card' }).click()

    await fillStripeCard(page, GOOD_CARD)
    await expect(payButton).toBeEnabled({ timeout: 15_000 })
    await payButton.scrollIntoViewIfNeeded()
    const confirmRequest = page.waitForRequest(
      (req) =>
        req.method() === 'POST' &&
        CONFIRM_PATH.test(new URL(req.url()).pathname),
    )
    await payButton.click()
    const outreachId = Number(
      CONFIRM_PATH.exec(new URL((await confirmRequest).url()).pathname)?.[1],
    )
    expect(outreachId).toBeGreaterThan(0)
    await expect(page.getByTestId('email-status')).toContainText('Scheduled.', {
      timeout: 60_000,
    })

    // ── The pipeline: due → prepare (the queue) → send → settle ──────────
    // The crons run these too; running them here only saves the wait. Each
    // is safe beside its cron.
    await withGatewayRetry('email.send_due_now', () =>
      timeTravel(client, outreachId, 'email.send_due_now'),
    )
    await withGatewayRetry('email.due', () => runJob(client, 'email.due'))
    await eventually(
      {
        that: 'every simulator address is sent',
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
        expect(send.sentCount).toBe(addresses.length)
      },
    )

    await withGatewayRetry('email.sent_6m_ago', () =>
      timeTravel(client, outreachId, 'email.sent_6m_ago'),
    )
    await eventually(
      {
        that: 'the send is settled and completed',
        minTimeout: 2_000,
        maxTimeout: 10_000,
        retries: 15,
      },
      async () => {
        await withGatewayRetry('email.settle', () =>
          runJob(client, 'email.settle'),
        )
        expect((await getSend(client, outreachId)).status).toBe('completed')
      },
    )

    // ── Sent, as the candidate sees it ───────────────────────────────────
    await page.goto(`/dashboard/outreach/email/${outreachId}`, {
      waitUntil: 'domcontentloaded',
    })
    const status = page.getByTestId('email-status')
    await expect(status).toContainText('Sent.', { timeout: 30_000 })
    await expect(status).toContainText('3 emails went out.')
  })

  test('a Win list with no one to email says so and stops', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    await setFlagOverrides(page, { 'win-email-outreach': 'on' })
    await setupProCampaignUser(page)

    await page.goto('/dashboard/outreach/email', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    await expect(stepHeading(page, 'What do you want to do?')).toBeVisible({
      timeout: 30_000,
    })
    await page
      .getByRole('button', { name: 'Introduce myself to voters' })
      .click()
    await expect(stepHeading(page, 'What do you want to say?')).toBeVisible({
      timeout: 30_000,
    })
    await page.locator('#email-subject').fill('Meet your candidate')
    const body = page.locator('[aria-label="Message body"]').first()
    await body.click()
    await page.keyboard.type('I am running to fix our roads. Say hello.')
    await page.getByRole('button', { name: 'Next' }).click()

    await expect(stepHeading(page, 'Who do you want to reach?')).toBeVisible({
      timeout: 30_000,
    })
    await page.getByText('Choose a voter list').click()
    await page.getByRole('button', { name: /All voters/ }).click()
    await expect(page.getByTestId('email-audience-empty')).toContainText(
      'No one in this list has an email address yet.',
      { timeout: 60_000 },
    )
    await expect(page.locator('#email-consent')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
})
