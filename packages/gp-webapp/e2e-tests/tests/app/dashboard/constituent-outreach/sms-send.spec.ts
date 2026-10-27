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
  adminAction,
  deliverStripeEvent,
} from 'src/helpers/vendor-mocks.helper'
import { eventually } from 'tests/utils/eventually'

// [M3-5] Serve SMS — full E2E spec.
//
// Drives the complete paid Serve SMS flow end-to-end using the vendor-mock
// stack: purpose → audience → compose (with image upload) → schedule →
// review & pay → Stripe webhook → results.upload CSV → completed.
// Then opens the outreach hub drawer and asserts the two INBOUND replies
// render under the "Responses" heading.
//
// No @dev-only tag: the Stripe webhook is delivered in-process via
// deliverStripeEvent, and results are ingested via adminAction — both bypass
// the real webhook delivery path that PR previews can't receive. S3 image
// upload CORS is handled by a Node-side relay that bypasses the browser's
// CORS check.

const IMAGE_FIXTURE = join(__dirname, '../../../../src/fixtures/heart.png')
const IMAGE_BUFFER = readFileSync(IMAGE_FIXTURE)

// Two INBOUND replies — the only rows that count as constituent responses.
// {{recipient:N}} is substituted server-side with the Nth real
// OutreachTextRecipient phone so the CSV matches the enrolled recipients.
const RESULTS_CSV = [
  'phone,message,direction',
  '{{recipient:0}},Thank you for the update!,INBOUND',
  '{{recipient:1}},Appreciate the outreach.,INBOUND',
].join('\n')

// ─── Helpers ──────────────────────────────────────────────────────────────────

// The flow shell repeats each step's title in an sr-only h2; match the
// visible h3 to stay strict-mode safe — same pattern as robocall-send.spec.ts.
const stepHeading = (page: Page, title: string) =>
  page.getByRole('heading', { level: 3, name: title, exact: true })

// Relay the S3 presigned PUT from Node so CORS doesn't block the image upload
// on PR previews. The S3 bucket allows dev.goodparty.org and localhost but not
// *.vercel.app. route.fetch() replays the request from Node, which has no
// CORS restrictions, so the PUT reaches S3 with the file bytes intact.
const relayS3ImageUploads = async (page: Page): Promise<void> => {
  await page.route(/amazonaws\.com/, async (route) => {
    if (route.request().method() !== 'PUT') {
      return route.continue()
    }
    const response = await route.fetch()
    await route.fulfill({ response })
  })
}

// ─── Stripe helper ────────────────────────────────────────────────────────────
// Fills the Stripe PaymentElement iframe — same pattern as robocall-send.spec.ts.
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
  // Pin the country first — CI runners sometimes geolocate outside the US,
  // which drops the postal-code field entirely.
  await frame.locator('#payment-countryInput').selectOption('US')
  await page.waitForTimeout(300)
  await frame.locator('#payment-postalCodeInput').fill('82001')
  await page.waitForTimeout(500)
}

// Compute the ISO date of a weekday that is at least 3 business days from
// today (1 day of buffer over the 2-business-day floor so the test does not
// flake near the floor boundary) and no more than 7 days out. Advances to the
// next month if the target falls there.
const getScheduleDate = (): { isoDate: string; crossesMonth: boolean } => {
  const now = startOfDay(new Date())
  // +3 business days keeps us safely above the 2-business-day floor.
  const target = addBusinessDays(now, 3)
  const isoDate = [
    target.getFullYear(),
    String(target.getMonth() + 1).padStart(2, '0'),
    String(target.getDate()).padStart(2, '0'),
  ].join('-')
  const crossesMonth = target.getMonth() !== now.getMonth()
  return { isoDate, crossesMonth }
}

// ─── Spec ────────────────────────────────────────────────────────────────────

test.describe('Serve SMS send — vendor-mock payment + results pipeline', () => {
  test.use({ serviceWorkers: 'block' })

  test.beforeEach(async ({ page }) => {
    // Activate the Serve SMS feature flag before auth so the flag cookie lands
    // before the first page load. Must precede setupElectedOfficeUser.
    await setFlagOverrides(page, { 'serve-sms-outreach': 'on' })
    await blockSlowScripts(page)
  })

  test('full serve SMS flow: compose → Stripe pay → webhook → CSV results → replies visible', async ({
    page,
  }) => {
    test.setTimeout(8 * 60 * 1000)

    // ── 1. Provision an isolated elected office user ─────────────────────────
    const { client } = await setupElectedOfficeUser(page)

    // ── 2. Relay S3 image uploads before any navigation ──────────────────────
    await relayS3ImageUploads(page)

    // ── 3. Navigate to Constituent Outreach hub ──────────────────────────────
    await page.goto('/dashboard/constituent-outreach', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    // The Contacts rail item resolves once the elected-office query settles —
    // it is the hydration signal for all Serve nav items.
    await expect(page.locator('#contacts-dashboard')).toBeVisible({
      timeout: 30_000,
    })

    // ── 4. Open the SMS flow ──────────────────────────────────────────────────
    await page.getByRole('button', { name: 'SMS' }).click()

    // ── 5. Purpose step ───────────────────────────────────────────────────────
    await expect(
      page.getByRole('button', { name: 'Introduce myself to constituents' }),
    ).toBeVisible({ timeout: 30_000 })
    await page
      .getByRole('button', { name: 'Introduce myself to constituents' })
      .click()

    // ── 6. Audience step: pick "All constituents" (the universe row) ──────────
    await expect(stepHeading(page, 'Who do you want to reach?')).toBeVisible({
      timeout: 30_000,
    })

    // The picker trigger reads "Choose a constituent list" when no
    // recommendation is shown (a fresh isolated user has no saved lists).
    const pickerTrigger = page.getByRole('button', {
      name: /choose a constituent list/i,
    })
    await expect(pickerTrigger).toBeVisible({ timeout: 30_000 })
    await pickerTrigger.click()

    // "All constituents" is the universe row at the top of the picker; it only
    // renders once the elected-office query has settled (to avoid flashing the
    // Win name "All voters" before the Serve label is known).
    await page.getByRole('button', { name: 'All constituents' }).click()

    // Continue is enabled once the reachable count resolves.
    await expect(page.getByRole('button', { name: /^Continue/ })).toBeEnabled({
      timeout: 30_000,
    })
    await page.getByRole('button', { name: /^Continue/ }).click()

    // ── 7. Compose step: upload image, wait for draft, click Continue ─────────
    await expect(stepHeading(page, 'What do you want to say?')).toBeVisible({
      timeout: 30_000,
    })

    // Wait for the AI draft to land before uploading the image — the textarea
    // is read-only until the draft populates, so uploading first means the
    // Continue button would stay disabled (no draft text).
    await expect(page.getByPlaceholder('Drafting your message…')).toHaveCount(
      0,
      { timeout: 30_000 },
    )

    // Upload the image through the hidden file input the dropzone reveals.
    await page
      .locator('input[type="file"][accept*="image/png"]')
      .setInputFiles({
        name: 'heart.png',
        mimeType: 'image/png',
        buffer: IMAGE_BUFFER,
      })

    // The image preview appears once the file is accepted.
    await expect(page.locator('[data-slot="sms-image-dropzone"]')).toBeHidden({
      timeout: 15_000,
    })

    await page.getByRole('button', { name: /^Continue/ }).click()

    // ── 8. Schedule step: name (if empty) and date ────────────────────────────
    await expect(stepHeading(page, 'When do you want to send it?')).toBeVisible(
      { timeout: 30_000 },
    )

    const nameInput = page.locator('#serve-sms-name')
    if ((await nameInput.inputValue()) === '') {
      await nameInput.fill('E2E serve SMS test')
    }

    const { isoDate, crossesMonth } = getScheduleDate()
    if (crossesMonth) {
      await page.getByRole('button', { name: 'Go to the next month' }).click()
    }
    await page.locator(`td[data-day="${isoDate}"] button`).click()

    // ── 9. Set up interceptors before the review step mounts ─────────────────
    // The review step creates the outreach on mount and opens the Stripe
    // checkout immediately; interceptors must be armed before we get there.
    // Arming after the Continue click is too late — the review step can mount
    // and fire its requests before the awaited page.route() calls resolve.

    let outreachId: number | null = null
    await page.route(/\/api\/v1\/outreach\/serve\/sms$/, async (route) => {
      const response = await route.fetch({ timeout: 90_000 })
      if (response.ok()) {
        const body = (await response.json()) as { outreachId?: number }
        if (body.outreachId) outreachId = body.outreachId
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
          // noop — corrupt body is not our concern here
        }
        await route.continue()
      },
    )

    await page.getByRole('button', { name: /^Continue/ }).click()

    // ── 10. Review step: wait for Stripe, fill card, pay ─────────────────────
    await expect(stepHeading(page, 'Review & pay')).toBeVisible({
      timeout: 30_000,
    })

    // The review step fetches the outreach on mount; wait for the Stripe
    // PaymentElement to be ready before filling the card.
    const stripeFrame = page
      .frameLocator('iframe[title="Secure payment input frame"]')
      .first()
    // Stripe mounts only after POST /outreach/serve/sms returns, and that call
    // is allowed 90s above (route.fetch). Wait as long as the request may take,
    // or a slow dev gp-api fails the spec while the request is still in flight
    // (ENG-11477).
    await expect(stripeFrame.locator('#payment-numberInput')).toBeVisible({
      timeout: 90_000,
    })

    await fillStripeCard(page)

    // Uncheck "Save my information for faster checkout" (Stripe Link) — when
    // checked it demands a phone number and the submit button stays disabled.
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

    // ── 11. Wait for the success screen ──────────────────────────────────────
    // Stripe confirm + gp-api POST /outreach/serve/sms can take up to 30s.
    await expect(
      page.getByRole('heading', { name: 'Payment successful!' }),
    ).toBeVisible({
      timeout: 60_000,
    })

    expect(outreachId).toBeGreaterThan(0)
    expect(sessionId).toBeTruthy()

    // ── 12. Deliver the Stripe checkout.session.completed event ───────────────
    // In-process delivery fires paymentEventsService synchronously, so the
    // outreach flips to in_progress without waiting for a real Stripe webhook.
    await deliverStripeEvent(client, sessionId!)

    await eventually(
      {
        that: 'outreach.status = in_progress after Stripe event',
        minTimeout: 500,
        maxTimeout: 5_000,
        retries: 10,
      },
      async () => {
        const { data: outreach } = await client.get<{ status: string }>(
          `/v1/outreach/serve/${outreachId}`,
        )
        expect(outreach.status).toBe('in_progress')
      },
    )

    // ── 13. Upload results CSV via admin action ────────────────────────────────
    // Two INBOUND rows make two replies; OUTBOUND rows are the sent messages
    // and are excluded from the Responses section.
    // Retry on 409: the queue consumer writes OutreachTextRecipient rows in a
    // step after transitioning status to in_progress, so there is a short
    // window where status = in_progress but no recipients exist yet.
    await eventually(
      {
        that: 'results.upload accepted (recipients written by queue consumer)',
        minTimeout: 1_000,
        maxTimeout: 10_000,
        retries: 10,
      },
      () => adminAction(client, outreachId!, 'results.upload', RESULTS_CSV),
    )

    await eventually(
      {
        that: 'outreach.status = completed after results upload',
        minTimeout: 500,
        maxTimeout: 5_000,
        retries: 10,
      },
      async () => {
        const { data: outreach } = await client.get<{ status: string }>(
          `/v1/outreach/serve/${outreachId}`,
        )
        expect(outreach.status).toBe('completed')
      },
    )

    // ── 14. Hub drawer: assert replies under "Responses" heading ──────────────
    await page.goto('/dashboard/constituent-outreach', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    // Wait for the hub to render the outreach history table.
    await expect(page.locator('#contacts-dashboard')).toBeVisible({
      timeout: 30_000,
    })

    // Clickable history rows carry role="button", and a completed send's
    // status cell reads "Done" (historyStatus.util.ts), not "completed".
    await page
      .getByRole('table')
      .getByRole('button')
      .filter({ hasText: 'Done' })
      .first()
      .click()

    // The section title is an Overline div, not a heading. exact keeps it
    // from matching the row's "2 responses" results cell.
    await expect(page.getByText('Responses', { exact: true })).toBeVisible({
      timeout: 15_000,
    })

    // Both INBOUND reply bodies should be visible.
    await expect(page.getByText('Thank you for the update!')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText('Appreciate the outreach.')).toBeVisible({
      timeout: 15_000,
    })
  })
})
