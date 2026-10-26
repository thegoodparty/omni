import { join } from 'path'
import { addDays, format } from 'date-fns'
import { expect, test, type Page } from '@playwright/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  adminAction,
  applyProWin10DlcMock,
  deliverStripeEvent,
  mockAction,
  mockRecords,
  runJob,
  timeTravel,
} from 'src/helpers/vendor-mocks.helper'
import { withGatewayRetry } from 'tests/utils/headless-user'
import { eventually } from 'tests/utils/eventually'
import { authenticateTestUser } from 'tests/utils/api-registration'

// [M3-4] Win SMS Playwright spec (ENG-XXXXX / ClickUp 17tnw2b7f5p)
//
// End-to-end coverage of the Win SMS P2P send flow against the vendor-mock
// stack: compose → Stripe payment → deliver signed webhook → CAS approve →
// send day (in_progress) → send day passed (completed), with the Peerly mock
// job asserted to carry the composed message, a phone list and booked
// canvassers.
//
// The candidate is a Pro Win user whose 10DLC registration is approved. The
// `pro-win-10dlc-mock` fixture state runs the real registration server-side
// against the Peerly, Vercel and Route53 mocks (no `internalTestingAt`, which
// the P2P send gate blocks). It needs VENDOR_MODE=mock, so the test skips on a
// live-mode deploy. Every call here is real gp-api traffic; nothing is stubbed.

const HEADSHOT_FIXTURE = join(__dirname, '../../../../src/fixtures/heart.png')

// Whitespace-insensitive compare: the editor renders one paragraph per line,
// so line breaks do not survive a read of the DOM the way the stored text has
// them. Every other character must match.
const normalize = (text: string): string => text.replace(/\s+/g, '')

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

// ─── Shared setup ─────────────────────────────────────────────────────────────

// Steps 1-4: a registered, 10DLC-approved Pro Win candidate with a saved
// voter file filter for the audience picker.
const setUpWinSmsCandidate = async (page: Page) => {
  // ── 1. Register a user and read its campaign ───────────────────────────
  const { user, client } = await authenticateTestUser(page, {
    isolated: true,
  })
  const { data: mine } = await client.get<{ id: number }>('/v1/campaigns/mine')
  const campaignId = mine.id

  // ── 2. Skip when vendor mock is not active ─────────────────────────────
  const { vendorMode } = await mockRecords(client, campaignId)
  test.skip(
    vendorMode !== 'mock',
    'Win SMS mock pipeline requires VENDOR_MODE=mock (skipped when VENDOR_MODE=live)',
  )

  // ── 3. Make it a 10DLC-approved Pro Win candidate ──────────────────────
  const fixture = await applyProWin10DlcMock(client, user.id)
  expect(fixture.stage).toBe('tcr_approved')
  expect(fixture.peerlyIdentityId).toBeTruthy()

  // ── 4. Pre-create a voter file filter so the audience picker has a row ─
  const filterName = `E2E sms-send ${Date.now()}`
  await withGatewayRetry('POST /v1/voters/voter-file/filter', () =>
    client.post<{ id: number }>('/v1/voters/voter-file/filter', {
      name: filterName,
    }),
  )
  return { user, client, campaignId, filterName }
}

// Steps 6-8 up to picking the pre-created filter: opens the compose drawer,
// chooses the purpose and selects the audience. Continue is left to the caller.
const openAudienceStep = async (page: Page, filterName: string) => {
  // ── 6. Open the SMS compose drawer ────────────────────────────────────
  await page.goto('/dashboard/outreach?compose=text', {
    waitUntil: 'domcontentloaded',
  })
  await NavigationHelper.dismissOverlays(page)

  // ── 7. Purpose step ───────────────────────────────────────────────────
  await expect(
    page.getByRole('button', { name: 'Introduce myself to voters' }),
  ).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Introduce myself to voters' }).click()

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
}

// Steps 9-10: composes the message (attaching an image) and schedules it, ending
// on the schedule step's Continue. Returns the composed message as the
// candidate saw it.
const composeAndSchedule = async (page: Page): Promise<string> => {
  // ── 9. Compose step ───────────────────────────────────────────────────
  // Continue stays disabled while the AI draft is in flight. The step also
  // blocks Continue until the message carries an image: a campaign with no
  // profile photo attaches one here, the way a candidate would.
  await expect(page.getByText('What do you want to say?').first()).toBeVisible({
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
  // Capture the composed message as the candidate sees it, before it leaves
  // the browser. The merge-tag chip stands for its Peerly token
  // ({first_name}, carried on the chip's data-token-text), so the chip is
  // read as that token and the text compares to what Peerly stores verbatim.
  const composedMessage = normalize(
    await composeDialog
      .locator('[aria-label="Message body"]')
      .first()
      .evaluate((el) => {
        const copy = el.cloneNode(true) as HTMLElement
        copy.querySelectorAll('[data-token-id]').forEach((chip) => {
          chip.replaceWith(chip.getAttribute('data-token-text') ?? '')
        })
        return copy.innerText || copy.textContent || ''
      }),
  )
  expect(composedMessage.length).toBeGreaterThan(0)
  await page.getByRole('button', { name: /^Continue/ }).click()

  // ── 10. Schedule step: date, time (the name is auto-filled) ──────────
  await expect(page.getByText('When do you want to send it?')).toBeVisible({
    timeout: 30_000,
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
  return composedMessage
}

// ─── Spec ─────────────────────────────────────────────────────────────────────

test.describe('Win SMS send', () => {
  test.use({ serviceWorkers: 'block' })

  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('happy path: compose → schedule → Stripe pay → CAS approve → in progress → completed', async ({
    page,
  }) => {
    test.setTimeout(8 * 60 * 1000)

    const { client, campaignId, filterName } = await setUpWinSmsCandidate(page)

    await openAudienceStep(page, filterName)
    await expect(page.getByRole('button', { name: /^Continue/ })).toBeEnabled({
      timeout: 30_000,
    })
    await page.getByRole('button', { name: /^Continue/ }).click()

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

    const composedMessage = await composeAndSchedule(page)

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

    const isFreeSend = await scheduleButton.isVisible()
    if (isFreeSend) {
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
    // The review step requests a checkout session even when the offer makes
    // the send free, so only a paid send has a completed session to deliver.
    if (!isFreeSend && sessionId) {
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

    // The outreach status as gp-api reports it.
    const outreachStatus = async (): Promise<string | null> => {
      const { data } =
        await client.get<{ id: number; status: string | null }[]>(
          '/v1/outreach',
        )
      return data.find((o) => o.id === outreachId)?.status ?? null
    }

    // ── 17. Send day arrives → in_progress ────────────────────────────────
    // The sweep reads the Peerly job's start_date: today (UTC) means sending.
    await timeTravel(client, outreachId, 'sms.start_date_today')
    await runJob(client, 'outreach.completion')
    await eventually(
      { that: 'outreach is in_progress on its send day', maxTimeout: 15_000 },
      async () => {
        expect(await outreachStatus()).toBe('in_progress')
      },
    )

    // ── 18. Send day passes → completed ───────────────────────────────────
    await timeTravel(client, outreachId, 'sms.start_date_passed')
    await runJob(client, 'outreach.completion')
    await eventually(
      {
        that: 'outreach is completed once its send day passed',
        maxTimeout: 15_000,
      },
      async () => {
        expect(await outreachStatus()).toBe('completed')
      },
    )

    // ── 19. The Peerly mock job carries the send ──────────────────────────
    const { records } = await mockRecords(client, campaignId)
    const job = records.find(
      (r) => r.vendor === 'peerly' && r.kind === 'p2p_job',
    )
    expect(job, 'Peerly p2p_job mock record').toBeTruthy()
    const jobState = job?.state as {
      templates?: { text?: string }[]
      phoneListId?: number | string
      canvassersBooked?: boolean
    }
    expect(normalize(jobState.templates?.[0]?.text ?? '')).toBe(composedMessage)
    expect(jobState.phoneListId).toBeTruthy()
    expect(jobState.canvassersBooked).toBe(true)

    // ── 20. The outreach hub shows it as done ─────────────────────────────
    await page.goto('/dashboard/outreach', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)
    await expect(
      page.locator('tbody tr').filter({ hasText: 'Done' }).first(),
    ).toBeVisible({ timeout: 30_000 })
  })

  // ENG-11486: with win_sms_hold_billing on, a failed Peerly phone-list upload
  // is treated as transient by the queued build and retried silently, so no
  // failure card reaches the user. Once fixed, the card shows on the review step
  // promptly, Try again rebuilds the list, and no checkout session is created
  // before the retry succeeds.
  test.fixme('failure: Peerly phone-list build fails, the user retries and reaches review', async ({
    page,
  }) => {
    test.setTimeout(5 * 60 * 1000)

    const { client, campaignId, filterName } = await setUpWinSmsCandidate(page)

    const checkoutSessions: string[] = []
    page.on('request', (req) => {
      if (
        req.method() === 'POST' &&
        /\/payments\/purchase\/create-checkout-session/.test(req.url())
      ) {
        checkoutSessions.push(req.url())
      }
    })

    await openAudienceStep(page, filterName)
    await expect(page.getByRole('button', { name: /^Continue/ })).toBeEnabled({
      timeout: 30_000,
    })

    // One-shot: fails the next POST /phonelists for this campaign only.
    await mockAction(client, campaignId, 'peerly.phonelist.fail')
    await page.getByRole('button', { name: /^Continue/ }).click()
    await composeAndSchedule(page)

    const failure = page.getByText(
      "We couldn't prepare this audience. Try again.",
    )
    await expect(failure).toBeVisible({ timeout: 60_000 })
    expect(checkoutSessions).toEqual([])

    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(failure).toBeHidden({ timeout: 30_000 })
    await withGatewayRetry('p2p.phoneListFinish', () =>
      runJob(client, 'p2p.phoneListFinish'),
    )
    await expect(
      page.getByRole('heading', { name: /Review (& pay|and send)/ }).first(),
    ).toBeVisible({ timeout: 30_000 })
  })
})
