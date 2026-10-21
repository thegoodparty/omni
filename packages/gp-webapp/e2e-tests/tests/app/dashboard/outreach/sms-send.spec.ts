import { addDays, format } from 'date-fns'
import { expect, test, type Page } from '@playwright/test'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  adminAction,
  deliverStripeEvent,
  mockRecords,
  runJob,
} from 'src/helpers/vendor-mocks.helper'
import { withGatewayRetry } from 'tests/utils/headless-user'
import { eventually } from 'tests/utils/eventually'
import { authenticateTestUser } from 'tests/utils/api-registration'

// [M3-4] Win SMS Playwright spec (ENG-XXXXX / ClickUp 17tnw2b7f5p)
//
// End-to-end coverage of the Win SMS P2P send flow against the vendor-mock
// stack: compose → Stripe payment → deliver signed webhook → CAS approve.
//
// It needs a fully 10DLC-compliant Pro Win candidate (a `pro-win-10dlc-mock`
// fixture state) that gp-api does not provide yet; the test is `test.fixme`
// until M4 delivers the Peerly 10DLC mock, Route53, and Vercel mocks.
//
// @dev-only: requires the Peerly P2P mock (M3) and the 10DLC mocks (M4) which
// only run on dev or local stacks with VENDOR_MODE=mock. The spec is tagged
// @dev-only until M4 lands and removes the tag.

// ─── Stripe helper ─────────────────────────────────────────────────────────────
// Fills the Stripe PaymentElement iframe with the test card. Matches the same
// seam as robocall-send.spec.ts and pro-upgrade-v2-happy-path.spec.ts.
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
  await frame.locator('#payment-countryInput').selectOption('US')
  await page.waitForTimeout(300)
  await frame.locator('#payment-postalCodeInput').fill('82001')
  await page.waitForTimeout(500)
}

// ─── Spec ─────────────────────────────────────────────────────────────────────

test.describe('Win SMS send @dev-only', () => {
  test.use({ serviceWorkers: 'block' })

  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('happy path: compose → schedule → Stripe pay → CAS approve → outreach scheduled', async ({
    page,
  }) => {
    // ENG-11434: the `pro-win-10dlc-mock` fixture (POST
    // /v1/test-fixtures/users/:id/states/pro-win-10dlc-mock) does not exist in
    // gp-api (404), and this spec needs a Pro 10DLC-compliant candidate. The
    // fixture lands with M4; remove this fixme and provision the user through
    // it then. Until then this spec must not gate the post-merge E2E check.
    test.fixme(true, 'Blocked on the M4 pro-win-10dlc-mock fixture (ENG-11434)')

    test.setTimeout(8 * 60 * 1000)

    // ── 1. Provision a 10DLC-approved Pro Win candidate ────────────────────
    const { client } = await authenticateTestUser(page, {
      isolated: true,
    })
    const { data: mine } = await client.get<{ id: number }>(
      '/v1/campaigns/mine',
    )
    const campaignId = mine.id

    // ── 2. Skip when vendor mock is not active ─────────────────────────────
    const { vendorMode } = await mockRecords(client, campaignId)
    test.skip(
      vendorMode !== 'mock',
      'Win SMS mock pipeline requires VENDOR_MODE=mock (dev / local only)',
    )

    // ── 4. Force vendor-mocks-m3 flag and open SMS window ──────────────────
    await setFlagOverrides(page, { 'vendor-mocks-m3': 'on' })

    // Move election date so texting window is open (19-day cutoff guard).
    await withGatewayRetry('PUT /v1/campaigns/mine', () =>
      client.put('/v1/campaigns/mine', {
        details: {
          electionDate: format(addDays(new Date(), 60), 'yyyy-MM-dd'),
        },
      }),
    )

    // ── 5. Pre-create a voter file filter so the audience picker has a row ─
    const filterName = `E2E sms-send ${Date.now()}`
    await withGatewayRetry('POST /v1/voters/voter-file/filter', () =>
      client.post<{ id: number }>('/v1/voters/voter-file/filter', {
        name: filterName,
      }),
    )

    // ── 6. Open the SMS compose drawer ────────────────────────────────────
    await page.goto('/dashboard/outreach?compose=text', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    // ── 7. Purpose step ───────────────────────────────────────────────────
    await expect(
      page.getByRole('button', { name: 'Introduce myself to voters' }),
    ).toBeVisible({ timeout: 30_000 })
    await page
      .getByRole('button', { name: 'Introduce myself to voters' })
      .click()

    // ── 8. Audience step: pick the pre-created filter ─────────────────────
    await expect(
      page.getByRole('button', {
        name: /Choose a voter list|view your lists/i,
      }),
    ).toBeVisible({ timeout: 30_000 })
    await page
      .getByRole('button', { name: /Choose a voter list|view your lists/i })
      .click()
    await page.getByRole('button', { name: filterName }).click()
    await expect(page.getByRole('button', { name: /^Continue/ })).toBeEnabled({
      timeout: 30_000,
    })
    await page.getByRole('button', { name: /^Continue/ }).click()

    // ── 9. Compose step ───────────────────────────────────────────────────
    // Wait for the AI draft to load (message field becomes non-empty).
    await expect(page.getByRole('button', { name: /^Continue/ })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole('button', { name: /^Continue/ })).toBeEnabled({
      timeout: 60_000,
    })
    await page.getByRole('button', { name: /^Continue/ }).click()

    // ── 10. Schedule step: name, date, time ──────────────────────────────
    await expect(page.getByText('When do you want to send?')).toBeVisible({
      timeout: 30_000,
    })

    // Pick a date 4 days from now (clear of the 48h floor and weekend edges).
    const targetDay = addDays(new Date(), 4)
    const targetIso = format(targetDay, 'yyyy-MM-dd')
    if (targetDay.getMonth() !== new Date().getMonth()) {
      await page.getByRole('button', { name: 'Go to the next month' }).click()
    }
    await page.locator(`td[data-day="${targetIso}"] button`).click()

    // Pick 10:00 AM time slot.
    await page.getByRole('option', { name: '10:00 AM' }).click()

    // ── 11. Arm the checkout-session interceptor before advancing to Review ──
    // The checkout-session request fires as the Review step mounts. Registering
    // the route after "Review & pay" is visible races and misses it.
    let sessionId = ''
    await page.route(
      /\/api\/v1\/payments\/purchase\/checkout-session/,
      async (route) => {
        const response = await route.fetch()
        if (response.ok()) {
          const body = (await response.json()) as { id?: string }
          if (body.id) sessionId = body.id
        }
        await route.fulfill({ response })
      },
    )

    await page.getByRole('button', { name: 'Continue' }).click()

    // ── 12. If the phone list is still building, finish it ────────────────
    // The audience step's Continue kicks off the Peerly build. runJob finishes
    // it synchronously in mock mode if the poll hasn't resolved yet.
    await withGatewayRetry('p2p.phoneListFinish', () =>
      runJob(client, 'p2p.phoneListFinish'),
    )

    // ── 13. Review step: wait for payment form ────────────────────────────
    await expect(page.getByText(/Review & pay/i)).toBeVisible({
      timeout: 30_000,
    })

    // Wait for the payment section to appear (checkout session resolved).
    const paymentFrame = page.frameLocator(
      'iframe[title="Secure payment input frame"]',
    )
    await expect(paymentFrame.locator('#payment-numberInput')).toBeVisible({
      timeout: 60_000,
    })

    // ── 14. Fill Stripe card and submit ───────────────────────────────────
    await fillStripeCard(page)

    const completeButton = page.getByRole('button', {
      name: 'Complete Purchase',
    })
    await expect(completeButton).toBeEnabled({ timeout: 15_000 })
    await completeButton.scrollIntoViewIfNeeded()

    // Intercept the outreach create/completion requests to capture outreachId.
    // The SmsFlow creates the outreach draft before the checkout session, so
    // we read the id from the complete-checkout-session response.
    let outreachId = 0
    await page.route(
      /\/api\/v1\/payments\/purchase\/complete-checkout-session/,
      async (route) => {
        const response = await route.fetch()
        if (response.ok()) {
          const body = (await response.json()) as { outreachId?: number }
          if (body.outreachId) outreachId = body.outreachId
        }
        await route.fulfill({ response })
      },
    )

    await completeButton.click()

    // ── 15. Wait for the success screen ───────────────────────────────────
    await expect(page.getByText(/Payment successful|Scheduled/)).toBeVisible({
      timeout: 60_000,
    })

    // ── 16. Deliver the Stripe webhook to finalize the outreach ───────────
    if (sessionId) {
      await deliverStripeEvent(client, sessionId)
    }

    // ── 17. CAS approve ───────────────────────────────────────────────────
    // Resolve outreachId from API if the page interception missed it.
    if (!outreachId) {
      await eventually(
        { that: 'outreach row exists for this campaign', maxTimeout: 15_000 },
        async () => {
          const { data } = await client.get<{
            outreach: { id: number; status: string }[]
          }>('/v1/outreach')
          const row = data.outreach.find(
            (o) => o.status === 'pending_payment' || o.status === 'paid',
          )
          if (!row) throw new Error('Outreach row not found yet')
          outreachId = row.id
        },
      )
    }

    expect(outreachId).toBeGreaterThan(0)

    const approval = await adminAction(client, outreachId, 'cas.approve')
    expect(approval.status).toBe('applied')
  })

  // TODO(M4): add a phone-list failure test once a Peerly phone-list failure
  // mock action is delivered. The mock needs to make POST /phonelists return a
  // non-success response so gp-api propagates the error and SmsFlow renders
  // the "couldn't prepare this audience" inline error with a "Try again" CTA.
})
