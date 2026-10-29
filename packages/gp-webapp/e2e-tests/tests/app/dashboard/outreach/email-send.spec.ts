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
  timeTravel,
} from 'src/helpers/vendor-mocks.helper'
import { eventually } from 'tests/utils/eventually'
import { withGatewayRetry } from 'tests/utils/headless-user'

// The email send, end to end against the vendor-mock stack: upload a small
// list, compose, confirm with Stripe's 4242 card (a real test-mode hold),
// then run the real due, send and settle sweeps and wait for Sent.
//
// Only SES mailbox simulator addresses are ever uploaded, so this spec can
// never email a person, even if a deploy it runs against sends for real.

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

  test('upload, compose, pay with 4242, and the send goes out', async ({
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
    const csv = [
      'Email,First Name',
      ...addresses.map((a, i) => `${a},Sim${i}`),
    ].join('\n')

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

    // ── Audience: a CSV of simulator addresses ───────────────────────────
    await expect(stepHeading(page, 'Who do you want to reach?')).toBeVisible({
      timeout: 30_000,
    })
    await page.locator('#email-list-file').setInputFiles({
      name: 'simulator-list.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    })
    await page.locator('#email-consent').click()
    await page.getByRole('button', { name: 'Check my list' }).click()
    await expect(page.getByTestId('email-upload-summary')).toContainText('3', {
      timeout: 30_000,
    })
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
    await fillStripeCard(page)
    const payButton = page.getByRole('button', { name: 'Pay and send' })
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
})
