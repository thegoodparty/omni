import { join } from 'path'
import { addDays, format } from 'date-fns'
import { expect, test, type Page } from '@playwright/test'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  adminAction,
  applyProWin10DlcMock,
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
// The candidate is a Pro Win user whose 10DLC registration is approved. The
// `pro-win-10dlc-mock` fixture state runs the real registration server-side
// against the Peerly, Vercel and Route53 mocks (no `internalTestingAt`, which
// the P2P send gate blocks). It needs VENDOR_MODE=mock, so the test skips on a
// live-mode deploy. Every call here is real gp-api traffic; nothing is stubbed.

const HEADSHOT_FIXTURE = join(__dirname, '../../../../src/fixtures/heart.png')

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

test.describe('Win SMS send', () => {
  test.use({ serviceWorkers: 'block' })

  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('happy path: compose → schedule → Stripe pay → CAS approve → outreach scheduled', async ({
    page,
  }) => {
    test.setTimeout(8 * 60 * 1000)

    // ── 1. Register a user and read its campaign ───────────────────────────
    const { user, client } = await authenticateTestUser(page, {
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
      'Win SMS mock pipeline requires VENDOR_MODE=mock (preview / local only)',
    )

    // ── 3. Make it a 10DLC-approved Pro Win candidate ──────────────────────
    const fixture = await applyProWin10DlcMock(client, user.id)
    expect(fixture.stage).toBe('tcr_approved')
    expect(fixture.peerlyIdentityId).toBeTruthy()

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
    // Continue stays disabled while the AI draft is in flight. The step also
    // blocks Continue until the message carries an image: a campaign with no
    // profile photo attaches one here, the way a candidate would.
    await expect(
      page.getByText('What do you want to say?').first(),
    ).toBeVisible({
      timeout: 30_000,
    })
    // Scoped to the compose dialog: the dashboard chat footer has its own
    // hidden file input.
    const composeDialog = page.getByRole('dialog', {
      name: 'What do you want to say?',
    })
    await composeDialog
      .locator('input[type="file"]')
      .setInputFiles(HEADSHOT_FIXTURE)
    await expect(composeDialog.getByAltText('Attachment preview')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('button', { name: /^Continue/ })).toBeEnabled({
      timeout: 60_000,
    })
    await page.getByRole('button', { name: /^Continue/ }).click()

    // ── 10. Schedule step: date, time (the name is auto-filled) ──────────
    await expect(page.getByText('When do you want to send it?')).toBeVisible({
      timeout: 30_000,
    })

    // Arm the checkout-session capture before the review step mounts: the
    // session is requested as soon as the draft lands. The one-time session
    // response carries the Stripe session id the webhook delivery needs.
    let sessionId = ''
    page.on('response', async (res) => {
      if (
        res.request().method() !== 'POST' ||
        !/\/payments\/purchase\/create-checkout-session/.test(res.url())
      ) {
        return
      }
      const body = (await res.json()) as { id?: string }
      if (body.id) sessionId = body.id
    })

    // Pick a date 4 days out (clear of the 48h floor). The calendar opens on
    // the current month; each day button (not its cell, which carries the ISO
    // form) is tagged with the browser's toLocaleDateString (M/D/YYYY in en-US).
    await page.getByRole('button', { name: 'Pick a date' }).click()
    const targetDay = addDays(new Date(), 4)
    if (targetDay.getMonth() !== new Date().getMonth()) {
      await page.getByRole('button', { name: 'Go to the next month' }).click()
    }
    await page
      .locator(`button[data-day="${format(targetDay, 'M/d/yyyy')}"]`)
      .click()

    // The send time defaults to 10:00 AM, inside the 9 AM to 8 PM window.
    await expect(
      page.getByRole('combobox').filter({ hasText: '10:00 AM' }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Continue' }).click()

    // ── 11. If the phone list is still building, finish it ────────────────
    // The audience step's Continue kicks off the Peerly build. runJob finishes
    // it synchronously in mock mode if the poll hasn't resolved yet.
    await withGatewayRetry('p2p.phoneListFinish', () =>
      runJob(client, 'p2p.phoneListFinish'),
    )

    // ── 12. Review step ───────────────────────────────────────────────────
    // "Review & pay" for a charged send, "Review and send" when the Pro free
    // texts offer covers the audience.
    const reviewHeading = page
      .getByRole('heading', { name: /Review (& pay|and send)/ })
      .first()
    await expect(reviewHeading).toBeVisible({ timeout: 30_000 })

    const scheduleButton = page.getByRole('button', {
      name: 'Schedule campaign',
    })
    const completeButton = page.getByRole('button', {
      name: 'Complete Purchase',
    })
    await expect(scheduleButton.or(completeButton)).toBeVisible({
      timeout: 60_000,
    })

    if (await scheduleButton.isVisible()) {
      // Free path: the offer covers the send, so there is no card to fill.
      await scheduleButton.scrollIntoViewIfNeeded()
      await expect(scheduleButton).toBeEnabled({ timeout: 15_000 })
      await scheduleButton.click()
    } else {
      // ── 13. Fill Stripe card and submit ─────────────────────────────────
      await fillStripeCard(page)
      await expect(completeButton).toBeEnabled({ timeout: 15_000 })
      await completeButton.scrollIntoViewIfNeeded()
      await completeButton.click()
    }

    // ── 14. Wait for the success screen ───────────────────────────────────
    await expect(
      page.getByRole('heading', { name: /Payment successful|Scheduled/ }),
    ).toBeVisible({ timeout: 60_000 })

    // ── 15. Deliver the Stripe webhook to finalize a charged outreach ─────
    if (sessionId) {
      await deliverStripeEvent(client, sessionId)
    }

    // ── 16. CAS approve ───────────────────────────────────────────────────
    // GET /v1/outreach returns the campaign's rows; the SMS send is the p2p one.
    let outreachId = 0
    await eventually(
      { that: 'p2p outreach row exists for this campaign', maxTimeout: 15_000 },
      async () => {
        const { data } =
          await client.get<{ id: number; outreachType: string }[]>(
            '/v1/outreach',
          )
        const row = data.find((o) => o.outreachType === 'p2p')
        if (!row) throw new Error('Outreach row not found yet')
        outreachId = row.id
      },
    )

    expect(outreachId).toBeGreaterThan(0)

    const approval = await adminAction(client, outreachId, 'cas.approve')
    expect(approval.status).toBe('applied')
  })

  // TODO(M4): add a phone-list failure test once a Peerly phone-list failure
  // mock action is delivered. The mock needs to make POST /phonelists return a
  // non-success response so gp-api propagates the error and SmsFlow renders
  // the "couldn't prepare this audience" inline error with a "Try again" CTA.
})
