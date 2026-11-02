import { readFileSync } from 'fs'
import { join } from 'path'
import { expect, test, type Page } from '@playwright/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import {
  callhubAction,
  mockAction,
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
// Skips when VENDOR_MODE !== 'mock' (only if dev is rolled back with
// VENDOR_MODE=live; previews, dev and local gp-api run the mock).

const AUDIO_FIXTURE = join(__dirname, '../../../../src/fixtures/test-audio.wav')
const AUDIO_BUFFER = readFileSync(AUDIO_FIXTURE)

// ─── CORS relay ──────────────────────────────────────────────────────────────
// The robocall audio presign returns an S3 URL that a PR-preview origin cannot
// POST to (CORS). Intercept the presign response to capture the policy fields,
// then intercept the S3 PUT/POST and relay it from Node — bypassing the browser
// CORS check the same way relayChatAttachmentUploads does for chat attachments.

const relayRobocallAudioUploads = async (page: Page): Promise<void> => {
  let presignFields: Record<string, string> | null = null

  await page.route(
    /\/api\/v1\/outreach\/robocall\/audio\/presign/,
    async (route) => {
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
    },
  )

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

// The flow shell repeats each step's title in an sr-only drawer title (h2),
// so match the visible step heading (h3) to stay strict-mode safe.
const stepHeading = (page: Page, title: string) =>
  page.getByRole('heading', { level: 3, name: title, exact: true })

const AUTHORIZE_PATH = /\/v1\/outreach\/robocall\/(\d+)\/authorize$/

// ─── Stripe helper ────────────────────────────────────────────────────────────
// Fills the Stripe PaymentElement iframe with the Stripe-provided test card.
// Mirrors the pattern in pro-upgrade.helper.ts.

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
  await page.waitForTimeout(500)
}

// ─── Backend pipeline helper ──────────────────────────────────────────────────
// Runs the four robocall jobs in order, with the time-travels and vendor
// actions that make each sweep pick up this specific outreach, and asserts the
// mocked CallHub voice broadcast moves PAUSE (2) → START (1) → END (4).

// CALLHUB_VB_STATUS in gp-api's callhubCampaign.schema.ts
const VB_STATUS = { START: 1, PAUSE: 2, ABORT: 3, END: 4 } as const

const expectVbCampaignStatus = async (
  client: AxiosInstance,
  campaignId: number,
  status: number,
): Promise<void> => {
  const { records } = await mockRecords(client, campaignId)
  const vbCampaigns = records.filter(
    (r) => r.vendor === 'callhub' && r.kind === 'vb_campaign',
  )
  expect(vbCampaigns).toHaveLength(1)
  expect(vbCampaigns[0]?.state).toMatchObject({ status })
}

// The mocked CallHub phonebook staging loaded must hold exactly the audience
// the UI quoted (the CSV rows the mock imports via bulk_create).
const expectPhonebookCount = async (
  client: AxiosInstance,
  campaignId: number,
  audienceSize: number,
): Promise<void> => {
  const { records } = await mockRecords(client, campaignId)
  const phonebooks = records.filter(
    (r) => r.vendor === 'callhub' && r.kind === 'phonebook',
  )
  expect(phonebooks).toHaveLength(1)
  const state = phonebooks[0]?.state as { count?: number } | undefined
  // Deployed envs may set ROBOCALL_TEST_OVERRIDE_NUMBER (robocallPhonebook.
  // service.ts), which loads ONLY that one number and never the real audience
  // (the preview does: it staged 1 against a 1,570-person list). Accept that
  // single-number load or the full audience, and nothing in between.
  expect([1, audienceSize]).toContain(state?.count)
}

// Staging only claims runs due within [now - 30 min, now + 6 h], and the flow
// schedules a day out, so bring the send to now - 1 min first.
const makeRobocallDue = async (
  client: AxiosInstance,
  outreachId: number,
): Promise<void> => {
  await withGatewayRetry('robocall.send_due_now', () =>
    timeTravel(client, outreachId, 'robocall.send_due_now'),
  )
}

const getRobocallSettleState = async (
  client: AxiosInstance,
  outreachId: number,
): Promise<{ status: string; settleState?: string }> => {
  const { data } = await client.get<{
    status: string
    robocall?: { settleState?: string }
  }>(`/v1/outreach/${outreachId}`)
  return { status: data.status, settleState: data.robocall?.settleState }
}

// Time-travels the send to now, runs the staging sweep, and asserts the
// CallHub broadcast was created PAUSED. Stops short of dialing, which is the
// window in which a candidate can still cancel.
const stageRobocall = async (
  client: AxiosInstance,
  campaignId: number,
  outreachId: number,
): Promise<void> => {
  await makeRobocallDue(client, outreachId)
  await withGatewayRetry('robocall.staging', () =>
    runJob(client, 'robocall.staging'),
  )
  await expectVbCampaignStatus(client, campaignId, VB_STATUS.PAUSE)
}

const runRobocallPipeline = async (
  client: AxiosInstance,
  campaignId: number,
  outreachId: number,
  audienceSize: number,
): Promise<void> => {
  await stageRobocall(client, campaignId, outreachId)
  await expectPhonebookCount(client, campaignId, audienceSize)

  await withGatewayRetry('robocall.send', () => runJob(client, 'robocall.send'))
  await expectVbCampaignStatus(client, campaignId, VB_STATUS.START)

  await withGatewayRetry('callhub.campaign.complete', () =>
    callhubAction(client, campaignId, 'callhub.campaign.complete'),
  )
  await expectVbCampaignStatus(client, campaignId, VB_STATUS.END)

  // Completion settles a dialed run once dialedAt is ROBOCALL_RUN_HOURS old.
  await withGatewayRetry('robocall.dialed_48h_ago', () =>
    timeTravel(client, outreachId, 'robocall.dialed_48h_ago'),
  )

  await withGatewayRetry('robocall.completion', () =>
    runJob(client, 'robocall.completion'),
  )

  await withGatewayRetry('robocall.capture', () =>
    runJob(client, 'robocall.capture'),
  )
}

// ─── Compose + authorize helper ──────────────────────────────────────────────
// Drives the robocall flow from the compose drawer through the Stripe
// authorize step for an already-provisioned Pro Win campaign. Shared by every
// test in this file; returns the new outreach id and the audience size the
// audience step displayed. The caller owns campaign setup and the mock-mode
// skip, so this runs only against a live mock stack.

// Provisions a Pro Win campaign and skips the test when the vendor mock is
// not active (VENDOR_MODE=live).
const setupRobocallCampaign = async (
  page: Page,
): Promise<{ client: AxiosInstance; campaignId: number }> => {
  const { client } = await setupProCampaignUser(page)
  const { data: mine } = await client.get<{ id: number }>('/v1/campaigns/mine')
  const campaignId = mine.id

  const { vendorMode } = await mockRecords(client, campaignId)
  test.skip(
    vendorMode !== 'mock',
    'Robocall mock pipeline requires VENDOR_MODE=mock (skipped when VENDOR_MODE=live)',
  )
  return { client, campaignId }
}

const composeAndAuthorizeRobocall = async (
  page: Page,
  client: AxiosInstance,
): Promise<{ outreachId: number; audienceSize: number }> => {
  // ── Relay S3 audio uploads ────────────────────────────────────────────
  await relayRobocallAudioUploads(page)

  // ── 4. Pre-create a voter file filter so the audience picker has a row ───
  const filterName = `E2E robocall ${Date.now()}`
  await withGatewayRetry('POST /v1/voters/voter-file/filter', () =>
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
  await expect(stepHeading(page, 'What do you want to do?')).toBeVisible({
    timeout: 30_000,
  })
  await page.getByRole('button', { name: 'Introduce myself to voters' }).click()

  // ── 7. Audience step: pick the pre-created voter list ────────────────────
  await expect(stepHeading(page, 'Who do you want to reach?')).toBeVisible({
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

  // Wait for the reachable count (Continue will be disabled until it resolves),
  // and keep the number the UI showed: "Continue (1,234)".
  const continueButton = page.getByRole('button', { name: /^Continue/ })
  await expect(continueButton).toBeEnabled({ timeout: 30_000 })
  const continueLabel = (await continueButton.textContent()) ?? ''
  const audienceSize = Number(
    /\(([\d,]+)\)/.exec(continueLabel)?.[1]?.replace(/,/g, ''),
  )
  expect(audienceSize).toBeGreaterThan(0)
  await continueButton.click()

  // ── 8. Schedule step: name, date and time ────────────────────────────────
  await expect(stepHeading(page, 'When do you want to send it?')).toBeVisible({
    timeout: 30_000,
  })

  // Campaign name is auto-filled from the list name; ensure it is non-empty.
  const nameInput = page.locator('#robocall-campaign-name')
  if ((await nameInput.inputValue()) === '') {
    await nameInput.fill('E2E robocall test')
  }

  // Tomorrow: authorize places the hold only for a send within
  // ROBOCALL_HOLD_WINDOW_DAYS (3), and staging only claims authorized runs.
  // A later send is deferred (card saved, no hold) and never stages. The
  // pipeline then time-travels the send to now. Tomorrow can fall in next
  // month, so page the calendar when it does.
  await page.locator('#robocall-send-date').click()
  const targetDay = new Date()
  targetDay.setDate(targetDay.getDate() + 1)
  if (targetDay.getMonth() !== new Date().getMonth()) {
    await page.getByRole('button', { name: 'Go to the next month' }).click()
  }
  const targetIso = [
    targetDay.getFullYear(),
    String(targetDay.getMonth() + 1).padStart(2, '0'),
    String(targetDay.getDate()).padStart(2, '0'),
  ].join('-')
  await page.locator(`td[data-day="${targetIso}"] button`).click()

  // Pick the 10:00 AM time slot.
  await page.locator('#robocall-send-time').click()
  await page.getByRole('option', { name: '10:00 AM' }).click()

  await page.getByRole('button', { name: 'Continue' }).click()

  // ── 9. Compose step: upload audio and wait for compliance ────────────────
  await expect(stepHeading(page, 'What do you want to say?')).toBeVisible({
    timeout: 30_000,
  })

  // Wait for the callback number to be rented (the body is gated behind it).
  await expect(page.getByText('Getting your callback number')).toBeHidden({
    timeout: 30_000,
  })

  // Wait for the AI script draft to land (the textarea is read-only until it
  // does; a placeholder "Drafting your script…" appears while loading).
  await expect(page.getByPlaceholder('Drafting your script…')).toHaveCount(0, {
    timeout: 30_000,
  })

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
  await expect(stepHeading(page, 'Review your campaign')).toBeVisible({
    timeout: 15_000,
  })

  await page.getByRole('button', { name: 'Continue to payment' }).click()

  // ── 11. Pay step: Stripe card entry and authorize ─────────────────────────
  await expect(stepHeading(page, 'Payment')).toBeVisible({ timeout: 15_000 })

  // Wait for Stripe PaymentElement to load inside its iframe.
  const stripeFrame = page
    .frameLocator('iframe[title="Secure payment input frame"]')
    .first()
  await expect(stripeFrame.locator('#payment-numberInput')).toBeVisible({
    timeout: 30_000,
  })

  await fillStripeCard(page)

  // The button sits below the fold of the drawer's own scroll container,
  // where a click without scrolling first never reaches it.
  const authorizeButton = page.getByRole('button', { name: /^Authorize \$/ })
  await expect(authorizeButton).toBeEnabled({ timeout: 15_000 })
  await authorizeButton.scrollIntoViewIfNeeded()
  const authorizeRequest = page.waitForRequest(
    (req) =>
      req.method() === 'POST' &&
      AUTHORIZE_PATH.test(new URL(req.url()).pathname),
  )
  await authorizeButton.click()
  const outreachId = Number(
    AUTHORIZE_PATH.exec(new URL((await authorizeRequest).url()).pathname)?.[1],
  )

  // Wait for the success screen — Stripe confirm + gp-api authorize can take
  // up to 30s.
  await expect(page.getByText("You're all set")).toBeVisible({
    timeout: 60_000,
  })

  // The success summary lists the caller ID; the CallHub mock always rents
  // this number (callhubMock.controller.ts).
  // eslint-disable-next-line e2e-ids/no-literal-identifiers -- the mock's output, not an input
  await expect(page.getByText('+15551234567', { exact: true })).toBeVisible()

  expect(outreachId).toBeGreaterThan(0)

  return { outreachId, audienceSize }
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

    const { client, campaignId } = await setupRobocallCampaign(page)
    const { outreachId, audienceSize } = await composeAndAuthorizeRobocall(
      page,
      client,
    )

    // ── 12. Run the backend pipeline ──────────────────────────────────────────
    await runRobocallPipeline(client, campaignId, outreachId, audienceSize)

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
        }>(`/v1/outreach/${outreachId}`)
        expect(outreach.status).toBe('completed')
        expect(outreach.robocall?.settleState).toBe('captured')
      },
    )
  })

  test('cancel before dial: staged robocall is canceled, aborted at CallHub, hold released', async ({
    page,
  }) => {
    test.setTimeout(6 * 60 * 1000)

    const { client, campaignId } = await setupRobocallCampaign(page)
    const { outreachId } = await composeAndAuthorizeRobocall(page, client)

    // Staged but not dialed: the CallHub broadcast exists, PAUSED, and the
    // outreach spine is still `pending` (the drawer's cancelable state).
    await stageRobocall(client, campaignId, outreachId)

    // ── Cancel from the outreach drawer ──────────────────────────────────────
    await page.goto('/dashboard/outreach', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)
    const row = page.locator(`#outreach-row-${outreachId}`)
    await expect(row).toBeVisible({ timeout: 30_000 })
    // The page is loaded on domcontentloaded, so the row click can land before
    // React hydrates and be dropped, leaving the drawer closed. Retry until the
    // drawer's footer button shows.
    //
    // The footer button and the confirm dialog's action share the label, so
    // scope the second to the dialog.
    const cancelButton = page.getByRole('button', { name: 'Cancel campaign' })
    await expect(async () => {
      if (!(await cancelButton.isVisible())) await row.click({ timeout: 2_000 })
      await expect(cancelButton).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 30_000 })
    await cancelButton.click()
    const confirmDialog = page.getByRole('alertdialog')
    await expect(confirmDialog).toContainText('Cancel this campaign?')
    const cancelRequest = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        new URL(res.url()).pathname.endsWith(
          `/v1/outreach/${outreachId}/cancel`,
        ),
    )
    await confirmDialog
      .getByRole('button', { name: 'Cancel campaign', exact: true })
      .click()
    expect((await cancelRequest).ok()).toBe(true)

    // ── Spine canceled, hold released ────────────────────────────────────────
    // settleState `cancelled` is the satellite state OutreachRobocallCancelService
    // claims before voiding the Stripe hold and restoring any promo.
    await eventually(
      {
        that: 'outreach.status = canceled and robocall.settleState = cancelled',
        minTimeout: 500,
        maxTimeout: 15_000,
        retries: 15,
      },
      async () => {
        const { data: outreach } = await client.get<{
          status: string
          robocall?: { settleState?: string }
        }>(`/v1/outreach/${outreachId}`)
        expect(outreach.status).toBe('canceled')
        expect(outreach.robocall?.settleState).toBe('cancelled')
      },
    )

    // ── CallHub abort ────────────────────────────────────────────────────────
    // Cancel queues the PAUSED broadcast for the orphan-cleanup sweep, which
    // ABORTs it (status 3). Run that sweep on demand instead of waiting on cron.
    await withGatewayRetry('robocall.callhubCleanup', () =>
      runJob(client, 'robocall.callhubCleanup'),
    )
    await expectVbCampaignStatus(client, campaignId, VB_STATUS.ABORT)

    // ── Drawer reflects the canceled state ───────────────────────────────────
    // A successful cancel closes the drawer. Reopen the row: a canceled row
    // keeps its history, so the footer offers archive (not Delete, which is
    // draft/phone-banking only) and no longer offers Cancel.
    await expect(confirmDialog).toBeHidden({ timeout: 15_000 })
    await row.click()
    await expect(
      page.getByRole('button', { name: 'Move to archive' }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole('button', { name: 'Cancel campaign' }),
    ).toHaveCount(0)
  })
  test('failure: CallHub broadcast create fails, staging reverts to authorized and recovers on the next sweep', async ({
    page,
  }) => {
    test.setTimeout(6 * 60 * 1000)

    const { client, campaignId } = await setupRobocallCampaign(page)
    const { outreachId } = await composeAndAuthorizeRobocall(page, client)

    // ── Arm one CallHub create failure, then run the first sweep ─────────────
    await withGatewayRetry('callhub.campaign.fail', () =>
      mockAction(client, campaignId, 'callhub.campaign.fail'),
    )
    await makeRobocallDue(client, outreachId)
    await withGatewayRetry('robocall.staging', () =>
      runJob(client, 'robocall.staging'),
    )

    // ── Staging reverted: still authorized, no CallHub broadcast ─────────────
    // The sweep catches the vendor error per record, so the job itself still
    // succeeds and the draft goes back to `authorized` with no pk_str.
    await eventually(
      {
        that: 'robocall.settleState reverted to authorized',
        minTimeout: 500,
        maxTimeout: 15_000,
        retries: 15,
      },
      async () => {
        expect(await getRobocallSettleState(client, outreachId)).toEqual({
          status: 'pending',
          settleState: 'authorized',
        })
      },
    )
    const { records: afterFail } = await mockRecords(client, campaignId)
    expect(
      afterFail.filter(
        (r) => r.vendor === 'callhub' && r.kind === 'vb_campaign',
      ),
    ).toHaveLength(0)

    // ── The candidate sees nothing wrong ─────────────────────────────────────
    await page.goto('/dashboard/outreach', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)
    const row = page.locator(`#outreach-row-${outreachId}`)
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText('Scheduled')
    await expect(row).not.toContainText(/fail|error|unavailable/i)

    // ── Next sweep: the failure was one-shot, so staging recovers ────────────
    await withGatewayRetry('robocall.staging', () =>
      runJob(client, 'robocall.staging'),
    )
    await expectVbCampaignStatus(client, campaignId, VB_STATUS.PAUSE)
    // A staged run is `authorized` with its CallHub handle committed; the
    // broadcast existing (PAUSED, found via that handle) is the staged proof.
    expect(await getRobocallSettleState(client, outreachId)).toEqual({
      status: 'pending',
      settleState: 'authorized',
    })
  })
})
