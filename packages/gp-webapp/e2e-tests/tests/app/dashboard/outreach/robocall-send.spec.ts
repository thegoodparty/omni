import { readFileSync } from 'fs'
import { join } from 'path'
import { expect, test, type Page } from '@playwright/test'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import {
  callhubAction,
  mockRecords,
  runJob,
  timeTravel,
} from 'src/helpers/vendor-mocks.helper'
import { withGatewayRetry } from 'tests/utils/headless-user'
import { eventually } from 'tests/utils/eventually'
import type { AxiosInstance } from 'axios'

// [M2] Robocall E2E spec (ENG-11342)
//
// Drives the full robocall flow end-to-end against the vendor-mock stack:
// open drawer → pick purpose → pick audience → schedule → upload audio →
// pass compliance → authorize via Stripe → run staging/send/completion/capture
// jobs → assert Outreach.status = 'completed' and robocall.settleState = 'captured'.
//
// Gated behind the `vendor-mocks-m2` feature flag (the dark-launch key for M2).
// Skips when VENDOR_MODE !== 'mock' (dev always calls the real CallHub; previews
// and local gp-api with VENDOR_MODE=mock are the targets).

const AUDIO_FIXTURE = join(
  __dirname,
  '../../../../src/fixtures/test-audio.wav',
)
const AUDIO_BUFFER = readFileSync(AUDIO_FIXTURE)

// ─── CORS relay ──────────────────────────────────────────────────────────────
// The robocall audio presign returns an S3 URL that a PR-preview origin cannot
// POST to (CORS). Intercept the presign response to capture the policy fields,
// then intercept the S3 PUT/POST and relay it from Node — bypassing the browser
// CORS check the same way relayChatAttachmentUploads does for chat attachments.

const relayRobocallAudioUploads = async (page: Page): Promise<void> => {
  let presignFields: Record<string, string> | null = null

  await page.route(/\/api\/v1\/outreach\/robocall\/audio\/presign/, async (route) => {
    const response = await route.fetch()
    if (response.ok()) {
      const body = (await response.json()) as {
        url: string
        key: string
        fields: Record<string, string>
      }
      presignFields = body.fields
    }
    await route.fulfill({ response })
  })

  // Catch the direct-to-S3 POST that useRobocallAudioUpload makes after presign.
  // Only relay when we have the policy fields (i.e., only after a presign succeeded).
  await page.route(/amazonaws\.com/, async (route) => {
    if (route.request().method() !== 'POST' || !presignFields) {
      return route.continue()
    }
    const response = await page.request.post(route.request().url(), {
      multipart: {
        ...presignFields,
        file: {
          name: 'test-audio.wav',
          mimeType: 'audio/wav',
          buffer: AUDIO_BUFFER,
        },
      },
    })
    await route.fulfill({
      status: response.status(),
      body: await response.body(),
      headers: { 'access-control-allow-origin': '*' },
    })
  })
}

// ─── Stripe helper ────────────────────────────────────────────────────────────
// Fills the Stripe PaymentElement iframe with the Stripe-provided test card.
// Mirrors the pattern in pro-upgrade.helper.ts.

const fillStripeCard = async (page: Page): Promise<void> => {
  const frame = page.frameLocator('iframe[title="Secure payment input frame"]').first()
  const cardInput = frame.locator('#payment-numberInput')
  await expect(cardInput).toBeVisible({ timeout: 30_000 })
  await expect(cardInput).toBeEditable({ timeout: 30_000 })
  await page.waitForTimeout(1_000)

  await cardInput.fill('4242424242424242')
  await page.waitForTimeout(300)
  // Expiry: 2 years from today → format MMyy e.g. "1028"
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
  await page.waitForTimeout(300)

  // Stripe Link's save-my-info checkbox keeps the submit disabled while checked.
  const saveCheckbox = frame.getByLabel('Save my information for faster checkout')
  if (await saveCheckbox.isChecked().catch(() => false)) {
    await saveCheckbox.uncheck()
  }
  await page.waitForTimeout(500)
}

// ─── Backend pipeline helper ──────────────────────────────────────────────────
// Runs the four robocall jobs in the correct order, with the time-travels and
// vendor actions that make each sweep pick up this specific outreach:
//   staging   → time-travel send_due_now → send
//   callhub complete → time-travel dialed_48h_ago → completion → capture

const runRobocallPipeline = async (
  client: AxiosInstance,
  campaignId: number,
  outreachId: number,
): Promise<void> => {
  // 1. Stage the robocall (moves it from pending_payment → scheduled in the
  //    robocall pipeline; gp-api's staging job writes the VB campaign to CallHub).
  await withGatewayRetry('robocall.staging', () =>
    runJob(client, 'robocall.staging'),
  )

  // 2. Make the scheduled send instant "now" so the send sweep picks it up.
  await withGatewayRetry('robocall.send_due_now', () =>
    timeTravel(client, outreachId, 'robocall.send_due_now'),
  )

  // 3. Send — dials through the mock CallHub (no real calls placed).
  await withGatewayRetry('robocall.send', () =>
    runJob(client, 'robocall.send'),
  )

  // 4. Mark the mock CallHub VB campaign as completed (END state = 4).
  await withGatewayRetry('callhub.campaign.complete', () =>
    callhubAction(client, campaignId, 'callhub.campaign.complete'),
  )

  // 5. Move the dialed timestamp back 48h so the completion sweep considers
  //    the campaign fully dialed and closed.
  await withGatewayRetry('robocall.dialed_48h_ago', () =>
    timeTravel(client, outreachId, 'robocall.dialed_48h_ago'),
  )

  // 6. Completion sweep — marks Outreach.status = 'completed'.
  await withGatewayRetry('robocall.completion', () =>
    runJob(client, 'robocall.completion'),
  )

  // 7. Capture sweep — sets OutreachRobocall.settleState = 'captured'.
  await withGatewayRetry('robocall.capture', () =>
    runJob(client, 'robocall.capture'),
  )
}

// ─── Spec ────────────────────────────────────────────────────────────────────

test.describe('Robocall send — M2 mock pipeline', () => {
  test.use({ serviceWorkers: 'block' })

  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('full robocall flow: compose → Stripe authorize → pipeline → completed + captured', async ({
    page,
  }) => {
    test.setTimeout(6 * 60 * 1000)

    // ── 1. Provision a Pro Win campaign ──────────────────────────────────────
    const { client } = await setupProCampaignUser(page)
    const { data: mine } = await client.get<{ id: number }>(
      '/v1/campaigns/mine',
    )
    const campaignId = mine.id

    // ── 2. Skip when vendor mock is not active ───────────────────────────────
    const { vendorMode } = await mockRecords(client, campaignId)
    test.skip(
      vendorMode !== 'mock',
      'Robocall mock pipeline requires VENDOR_MODE=mock (preview / local only)',
    )

    // ── 3. Gate the M2 feature flag and relay S3 audio uploads ───────────────
    await setFlagOverrides(page, { 'vendor-mocks-m2': 'on' })
    await relayRobocallAudioUploads(page)

    // ── 4. Pre-create a voter file filter so the audience picker has a row ───
    const filterName = `E2E robocall ${Date.now()}`
    await withGatewayRetry(
      'POST /v1/voters/voter-file/filter',
      () =>
        client.post<{ id: number }>('/v1/voters/voter-file/filter', {
          name: filterName,
        }),
    )

    // ── 5. Open the robocall compose drawer ──────────────────────────────────
    await page.goto('/dashboard/outreach?compose=robocall', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)

    // ── 6. Purpose step: "Introduce myself to voters" ────────────────────────
    await expect(page.getByText('What do you want to do?')).toBeVisible({
      timeout: 30_000,
    })
    await page
      .getByRole('button', { name: 'Introduce myself to voters' })
      .click()

    // ── 7. Audience step: pick the pre-created voter list ────────────────────
    await expect(page.getByText('Who do you want to reach?')).toBeVisible({
      timeout: 30_000,
    })

    // Open the list picker (trigger text varies: "Choose a voter list" when
    // there are no recommendations; "View your lists here" when there are).
    const pickerTrigger = page.getByRole('button', {
      name: /choose a voter list|view your lists here/i,
    })
    await expect(pickerTrigger).toBeVisible({ timeout: 30_000 })
    await pickerTrigger.click()

    // Select the pre-created filter by name (it appears in the popover).
    await page.getByRole('button', { name: filterName }).click()

    // Wait for the reachable count (Continue will be disabled until it resolves).
    await expect(
      page.getByRole('button', { name: /^Continue/ }),
    ).toBeEnabled({ timeout: 30_000 })
    await page.getByRole('button', { name: /^Continue/ }).click()

    // ── 8. Schedule step: name, date and time ────────────────────────────────
    await expect(page.getByText('When do you want to send it?')).toBeVisible({
      timeout: 30_000,
    })

    // Campaign name is auto-filled from the list name; ensure it is non-empty.
    const nameInput = page.locator('#robocall-campaign-name')
    if ((await nameInput.inputValue()) === '') {
      await nameInput.fill('E2E robocall test')
    }

    // Pick a send date 7 days from now (within the 85-day window).
    await page.locator('#robocall-send-date').click()
    const targetDay = new Date()
    targetDay.setDate(targetDay.getDate() + 7)
    // If the target day fell into the next month, navigate the calendar
    // forward — Calendar renders showOutsideDays=true by default, so without
    // this both the current month's past cell and the next month's outside-day
    // cell match the same day number and Playwright strict mode rejects it.
    if (targetDay.getMonth() !== new Date().getMonth()) {
      await page.getByRole('button', { name: 'Go to the next month' }).click()
    }
    const dayNum = targetDay.getDate()
    // exact:true excludes outside-day cells whose aria-label is longer than
    // just the number (e.g. "1 (outside of current month)").
    await page
      .getByRole('gridcell', { name: String(dayNum), exact: true })
      .click()

    // Pick the 10:00 AM time slot.
    await page.locator('#robocall-send-time').click()
    await page.getByRole('option', { name: '10:00 AM' }).click()

    await page.getByRole('button', { name: 'Continue' }).click()

    // ── 9. Compose step: upload audio and wait for compliance ────────────────
    await expect(page.getByText('What do you want to say?')).toBeVisible({
      timeout: 30_000,
    })

    // Wait for the callback number to be rented (the body is gated behind it).
    await expect(
      page.getByText('Getting your callback number'),
    ).toBeHidden({ timeout: 30_000 })

    // Wait for the AI script draft to land (the textarea is read-only until it
    // does; a placeholder "Drafting your script…" appears while loading).
    await expect(page.getByPlaceholder('Drafting your script…')).toHaveCount(
      0,
      { timeout: 30_000 },
    )

    // Upload the WAV fixture via the hidden file input that "Upload audio"
    // triggers. setInputFiles dispatches the onChange event that calls
    // recorder.uploadFile, which validates MIME/duration/peak and transitions
    // the recorder to preview state.
    await page.locator('input[type="file"][accept="audio/*"]').setInputFiles({
      name: 'test-audio.wav',
      mimeType: 'audio/wav',
      buffer: AUDIO_BUFFER,
    })

    // After uploadFile processes the WAV, the record bar shows "Preview your
    // recording" with a Save button.
    await expect(page.getByText('Preview your recording')).toBeVisible({
      timeout: 15_000,
    })

    // Click Save — this uploads the blob to S3 (relayed from Node above) then
    // transitions the recorder to saved, triggering the compliance check.
    await page.getByRole('button', { name: 'Save' }).click()

    // Wait for "Recording saved" and then for the compliance verdict.
    await expect(page.getByText('Recording saved')).toBeVisible({
      timeout: 30_000,
    })

    // In mock mode the compliance endpoint skips Transcribe and always passes
    // for a campaign with a candidate name (ENG-11352). Wait for the green card.
    await expect(
      page.getByText('Your recording has everything it needs.'),
    ).toBeVisible({ timeout: 60_000 })

    await page.getByRole('button', { name: 'Continue' }).click()

    // ── 10. Review step ───────────────────────────────────────────────────────
    await expect(page.getByText('Review your campaign')).toBeVisible({
      timeout: 15_000,
    })

    // Capture the outreachId from the draft-create response that fires the
    // moment the pay step mounts (POST /v1/outreach/robocall).
    let outreachId: number | null = null
    const [draftResp] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/v1/outreach/robocall') &&
          resp.request().method() === 'POST' &&
          !resp.url().includes('/compliance') &&
          !resp.url().includes('/number') &&
          !resp.url().includes('/authorize') &&
          !resp.url().includes('/promo') &&
          !resp.url().includes('/save-card-intent'),
      ),
      page.getByRole('button', { name: 'Continue to payment' }).click(),
    ])
    const draftBody = (await draftResp.json()) as { outreachId: number }
    outreachId = draftBody.outreachId

    // ── 11. Pay step: Stripe card entry and authorize ─────────────────────────
    await expect(page.getByText('Payment')).toBeVisible({ timeout: 15_000 })

    // Wait for Stripe PaymentElement to load inside its iframe.
    const stripeFrame = page.frameLocator(
      'iframe[title="Secure payment input frame"]',
    ).first()
    await expect(stripeFrame.locator('#payment-numberInput')).toBeVisible({
      timeout: 30_000,
    })

    await fillStripeCard(page)

    // The authorize button text is "Authorize $X.XX" where X is the estimate.
    await expect(
      page.getByRole('button', { name: /^Authorize \$/ }),
    ).toBeEnabled({ timeout: 15_000 })
    await page.getByRole('button', { name: /^Authorize \$/ }).click()

    // Wait for the success screen — Stripe confirm + gp-api authorize can take
    // up to 30s.
    await expect(page.getByText("You're all set")).toBeVisible({
      timeout: 60_000,
    })

    expect(outreachId).not.toBeNull()

    // ── 12. Run the backend pipeline ──────────────────────────────────────────
    await runRobocallPipeline(client, campaignId, outreachId!)

    // ── 13. Assert final state ────────────────────────────────────────────────
    await eventually(
      {
        that: 'outreach.status = completed and robocall.settleState = captured',
        minTimeout: 500,
        maxTimeout: 15_000,
        retries: 15,
      },
      async () => {
        const { data: outreach } = await client.get<{
          status: string
          robocall?: { settleState?: string }
        }>(`/v1/outreach/${outreachId!}`)
        expect(outreach.status).toBe('completed')
        expect(outreach.robocall?.settleState).toBe('captured')
      },
    )
  })
})
