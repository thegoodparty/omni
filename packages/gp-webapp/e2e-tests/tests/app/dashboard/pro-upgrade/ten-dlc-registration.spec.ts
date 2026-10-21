// [M4-10] 10DLC registration Playwright spec (ENG-11404)
//
// Drives the full 10DLC registration flow end-to-end against the vendor-mock
// stack, starting from a non-Pro candidate:
//
//   Pro wizard (value-prop → status → guidance → ein → filing-details →
//   candidate-profile → payment) → deliverStripeEvent (in-process, no inbound
//   webhook) → domain search/purchase → domain registration poll →
//   website publish → submit to Peerly → CV mock actions → enter-pin UI
//   (wrong PIN → error → correct PIN) → tcr_approved.
//
// Skips when VENDOR_MODE !== 'mock' (dev calls the real vendors; previews and
// local gp-api with VENDOR_MODE=mock are the targets).
//
// NOT @dev-only: the Stripe checkout.session.completed event is delivered
// in-process via deliverStripeEvent, so no inbound webhook delivery to the
// preview URL is required.

import { addYears, format } from 'date-fns'
import { expect, test, type Page } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { waitForDashboardReady } from 'src/helpers/dashboard'
import { openSmsWindow } from 'src/helpers/smsWindow.helper'
import {
  deliverStripeEvent,
  mockRecords,
  peerlyAction,
  runJob,
} from 'src/helpers/vendor-mocks.helper'
import { withGatewayRetry } from 'tests/utils/headless-user'
import { eventually } from 'tests/utils/eventually'

// ─── Inline types ────────────────────────────────────────────────────────────

type CampaignMine = { id: number; isPro?: boolean }
type ComplianceState = { stage: string }
type CheckoutSessionResponse = { clientSecret: string }
type DomainCandidate = { domain: string; price: number }
type DomainSearchResponse = { candidates: DomainCandidate[] }

// ─── Stripe card helper ───────────────────────────────────────────────────────
// Fills the Stripe PaymentElement iframe with the Stripe-provided test card.
// Mirrors the pattern in pro-upgrade-happy-path.spec.ts and robocall-send.spec.ts.

const fillStripeCard = async (page: Page): Promise<void> => {
  const stripeFrame = page
    .frameLocator('iframe[title="Secure payment input frame"]')
    .first()
  const cardInput = stripeFrame.locator('#payment-numberInput')
  await expect(cardInput).toBeVisible({ timeout: 30_000 })
  await expect(cardInput).toBeEditable({ timeout: 30_000 })
  await page.waitForTimeout(2_000)

  await cardInput.fill('4242424242424242')
  await page.waitForTimeout(500)
  await stripeFrame
    .locator('#payment-expiryInput')
    .fill(format(addYears(new Date(), 2), 'MMyy'))
  await page.waitForTimeout(500)
  await stripeFrame.locator('#payment-cvcInput').fill('123')
  await page.waitForTimeout(500)
  // Stripe geolocates billing country from the runner IP; CI runners are
  // sometimes outside the US (observed: Mexico 2026-09-04, 2026-10-20),
  // which drops #payment-postalCodeInput entirely — pin US first.
  await stripeFrame.locator('#payment-countryInput').selectOption('US')
  await page.waitForTimeout(500)
  await stripeFrame.locator('#payment-postalCodeInput').fill('82001')
  await page.waitForTimeout(500)
  // Stripe Link's save-my-info checkbox demands a phone number and keeps
  // the submit button disabled while checked.
  const saveCheckbox = stripeFrame.getByLabel(
    'Save my information for faster checkout',
  )
  if (await saveCheckbox.isChecked().catch(() => false)) {
    await saveCheckbox.uncheck()
  }
  await page.waitForTimeout(1_000)
}

// ─── PIN form helper ──────────────────────────────────────────────────────────
// Types a 6-digit PIN into the OTP form one character at a time. The form
// auto-advances focus to the next digit input after each keystroke.

const fillPin = async (page: Page, pin: string): Promise<void> => {
  // Clear any existing digits before filling so a second call (wrong → correct)
  // doesn't collide with the previous entry.
  for (let i = 1; i <= 6; i++) {
    const input = page.getByRole('textbox', { name: `Digit ${i}` })
    if (await input.isVisible()) {
      await input.fill('')
    }
  }
  const firstDigit = page.getByRole('textbox', { name: 'Digit 1' })
  await expect(firstDigit).toBeVisible({ timeout: 30_000 })
  await firstDigit.click()
  // Type with a small delay so the form's auto-advance logic fires between keys.
  await page.keyboard.type(pin, { delay: 50 })
}

// ─── Spec ────────────────────────────────────────────────────────────────────

test.describe('10DLC registration — full flow to tcr_approved', () => {
  test.use({ serviceWorkers: 'block' })

  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('Pro wizard → domain → website → Peerly → PIN entry → tcr_approved', async ({
    page,
  }) => {
    // 15 minutes: Vercel mock domain registration ~30s, Stripe confirm, PIN
    // flow, and poll loops for each compliance stage transition.
    test.setTimeout(15 * 60 * 1_000)

    // ── 1. Provision an isolated non-Pro test user ────────────────────────────
    // Isolated: this mutates account-level state (campaign → Pro, domain
    // purchase, compliance records) so the user must never be reused.
    const { user, client } = await authenticateTestUser(page, {
      isolated: true,
    })
    const { data: mine } = await client.get<CampaignMine>('/v1/campaigns/mine')
    const campaignId = mine.id

    // ── 2. Skip when vendor mock is not active ────────────────────────────────
    // Previews and local gp-api with VENDOR_MODE=mock are the targets;
    // dev always calls the real vendors (Vercel, Peerly).
    const { vendorMode } = await mockRecords(client, campaignId)
    test.skip(
      vendorMode !== 'mock',
      '10DLC mock pipeline requires VENDOR_MODE=mock (preview / local only)',
    )

    // ── 3. Setup: flag overrides + SMS window ─────────────────────────────────
    // outreach-pro-gating-v2 off → legacy wizard step order (value-prop →
    // status → guidance → ein → filing-details → candidate-profile → payment).
    // openSmsWindow sets electionDate 60 days from today so texting stays open.
    await setFlagOverrides(page, { 'outreach-pro-gating-v2': 'off' })
    await openSmsWindow(client)

    // ── 4. Arm the Stripe session response capture ────────────────────────────
    // The payment page creates the embedded checkout session via
    // POST /api/v1/payments/purchase/checkout-session. The response carries
    // `clientSecret` from which we derive the Stripe sessionId used by
    // deliverStripeEvent (Stripe embedded format:
    //   `cs_test_{sessionId}_secret_{signingKey}`).
    // Set up the listener now — before any navigation — so it doesn't miss
    // the request that fires when the payment step renders.
    const sessionResponsePromise = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/payments/purchase/checkout-session') &&
        r.request().method() === 'POST',
      { timeout: 300_000 },
    )

    // ── 5. Navigate to dashboard and enter the Pro wizard ─────────────────────
    await page.goto('/dashboard')
    await page.waitForURL(/\/dashboard/)
    await NavigationHelper.dismissOverlays(page)
    await waitForDashboardReady(page)

    await expect(
      page.getByText('76% of candidates who use Pro win'),
    ).toBeVisible({ timeout: 30_000 })

    // Retry the click until the banner's Next hydration attaches the handler.
    await expect(async () => {
      if (!/\/dashboard\/pro-upgrade\/value-prop/.test(page.url())) {
        await page
          .getByRole('button', { name: 'Get Pro' })
          .click({ timeout: 5_000 })
      }
      await page.waitForURL(/\/dashboard\/pro-upgrade\/value-prop/, {
        timeout: 10_000,
      })
    }).toPass({ timeout: 60_000 })

    // ── 6. Value-prop step ────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Get Pro for $10/mo' }).click()

    // ── 7. Filing-status step ─────────────────────────────────────────────────
    await page.waitForURL(/\/dashboard\/pro-upgrade\/status/)
    await page.getByRole('button', { name: "Yes, I'm already filed" }).click()

    // ── 8. Guidance interstitial ──────────────────────────────────────────────
    await page.waitForURL(/\/dashboard\/pro-upgrade\/guidance/)
    await page.getByRole('button', { name: "Let's go!" }).click()

    // ── 9. EIN step ───────────────────────────────────────────────────────────
    // Prefix 47 is a real IRS-issued EIN prefix, so checkEinSanity accepts it.
    await page.waitForURL(/\/dashboard\/pro-upgrade\/ein/)
    await page.getByRole('textbox').first().fill('47-1234567')
    await page.getByRole('button', { name: 'Continue' }).click()

    // ── 10. Filing-details step (manual address — no Google Places needed) ────
    // Typing in AddressAutocomplete without selecting a suggestion sets
    // `manualAddress.addressLine1`; City/State/ZIP complete the struct. The
    // backend accepts `manualAddress` when no placeId/formattedAddress pair is
    // present (tcrComplianceBase.schema.ts, "Address one-of" rule).
    await page.waitForURL(/\/dashboard\/pro-upgrade\/filing-details/)
    await page.getByPlaceholder('Jane Smith').fill('Jane Smith')
    await page.getByPlaceholder('Jane for Council').fill('Jane for Council')
    await page
      .getByPlaceholder('https://')
      .fill('https://sos.wyo.gov/filing/jane-for-council')
    await page.getByPlaceholder('jane@gmail.com').fill(user.email)
    await page.getByPlaceholder('(555) 555-5555').fill('(307) 555-1234')

    const addressInput = page.getByPlaceholder(
      'Start typing to search, or enter it yourself',
    )
    await addressInput.fill('123 Main St')
    await page.getByLabel('City').fill('Cheyenne')
    await page.getByLabel('State *').selectOption('WY')
    await page.getByLabel('ZIP').fill('82001')

    await page.getByRole('button', { name: 'Continue' }).click()

    // ── 11. Candidate-profile step ────────────────────────────────────────────
    // ≥500 plain chars so isGenuineBioPlainText passes (the completeness gate).
    await page.waitForURL(/\/dashboard\/pro-upgrade\/candidate-profile/)
    const bioEditor = page.locator('.ql-editor').first()
    await expect(bioEditor).toBeVisible({ timeout: 15_000 })
    await bioEditor.click()
    await bioEditor.fill(
      'I am running for City Council because our neighborhood deserves a ' +
        'representative who shows up, listens, and follows through. For years ' +
        'I have organized with neighbors on the issues that touch daily life: ' +
        'safe streets, reliable services, affordable housing, and an open, ' +
        'accountable local government. I will bring that same energy to the ' +
        'council, fighting for transparent budgets, smart infrastructure ' +
        'investment, and a city that works for working families rather than ' +
        'the well-connected few. Together we can build a community we are all ' +
        'proud to call home, today and for the generations that follow us.',
    )

    await page.getByRole('button', { name: 'Add a policy priority' }).click()
    await page.getByLabel('Policy title').fill('Safe and affordable housing')
    const policyEditor = page.locator('.ql-editor').last()
    await expect(policyEditor).toBeVisible({ timeout: 10_000 })
    await policyEditor.click()
    await policyEditor.fill(
      'Expand affordable housing by streamlining permits, protecting renters ' +
        'from unfair increases, and partnering with builders on starter homes.',
    )
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page
      .getByRole('button', { name: 'Edit Safe and affordable housing' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    await page.getByRole('button', { name: 'Continue' }).click()

    // ── 12. Payment step — fill Stripe card and capture checkout session ───────
    await page.waitForURL(/\/dashboard\/pro-upgrade\/payment/)

    await fillStripeCard(page)

    const completeButton = page.getByRole('button', {
      name: 'Complete upgrade',
    })
    await expect(completeButton).toBeEnabled({ timeout: 30_000 })
    await completeButton.click()

    // Wait for Stripe to confirm and the page to navigate to /success.
    await page.waitForURL(/\/dashboard\/pro-upgrade\/success/, {
      timeout: 60_000,
    })

    // ── 13. Deliver Stripe webhook in-process ──────────────────────────────────
    // Stripe embedded checkout format: `cs_test_{sessionId}_secret_{signingKey}`.
    // deliverStripeEvent calls POST /v1/test-fixtures/vendor-mocks/stripe/events,
    // which fires paymentEventsService in-process — no inbound delivery needed.
    const sessionResponse = await sessionResponsePromise
    const { clientSecret } =
      (await sessionResponse.json()) as CheckoutSessionResponse
    const sessionId = clientSecret.split('_secret_')[0]!

    await withGatewayRetry('deliverStripeEvent', () =>
      deliverStripeEvent(client, sessionId),
    )

    // ── 14. Poll until isPro flips server-side ─────────────────────────────────
    await eventually(
      {
        that: 'campaign.isPro flips via the in-process Stripe event',
        minTimeout: 500,
        maxTimeout: 10_000,
        retries: 20,
      },
      async () => {
        const { data: campaign } =
          await client.get<CampaignMine>('/v1/campaigns/mine')
        expect(campaign.isPro).toBe(true)
      },
    )

    // ── 15. Click Continue and leave the success page ──────────────────────────
    await page.getByRole('button', { name: 'Continue' }).click()

    // ── 16. Compliance state: pending_domain_purchase ──────────────────────────
    const { data: stateBeforeDomain } = await client.get<ComplianceState>(
      '/v1/campaigns/tcr-compliance/mine/compliance-state',
    )
    expect(stateBeforeDomain.stage).toBe('pending_domain_purchase')

    // ── 17. Domain search ──────────────────────────────────────────────────────
    // The Vercel mock returns available candidates regardless of the pattern.
    const { data: searchResult } = await withGatewayRetry(
      'POST /v1/domains/search',
      () =>
        client.post<DomainSearchResponse>('/v1/domains/search', {
          patterns: ['e2etest10dlc'],
        }),
    )
    expect(searchResult.candidates.length).toBeGreaterThan(0)
    const candidate = searchResult.candidates[0]!

    // ── 18. Domain purchase ────────────────────────────────────────────────────
    // Pass the same maxPrice returned by search so the server's live price
    // re-check passes (PurchaseDomain.schema.ts).
    await withGatewayRetry('POST /v1/domains/purchase', () =>
      client.post('/v1/domains/purchase', {
        domain: candidate.domain,
        maxPrice: candidate.price,
      }),
    )

    // ── 19. Poll until the domain registers ────────────────────────────────────
    // The Vercel mock completes orders asynchronously after ~30s. Poll the
    // compliance stage (which reads Domain.status) without fixed sleeps.
    await expect
      .poll(
        async () => {
          const { data } = await client.get<ComplianceState>(
            '/v1/campaigns/tcr-compliance/mine/compliance-state',
          )
          return data.stage
        },
        {
          message: 'compliance stage advances past pending_domain_purchase',
          timeout: 90_000,
          intervals: [2_000, 3_000, 5_000],
        },
      )
      .not.toBe('pending_domain_purchase')

    // ── 20. Publish website ────────────────────────────────────────────────────
    // The domain is now registered (status ≥ submitted), so the publish gate
    // passes. `contact.email` is a required publish field (assertReadyToPublish);
    // the wizard doesn't write it to the Website row, so supply it here.
    await withGatewayRetry('PUT /v1/websites/mine (publish)', () =>
      client.put('/v1/websites/mine', {
        status: 'published',
        contact: { email: user.email },
      }),
    )

    // ── 21. Compliance state: ready_to_submit ──────────────────────────────────
    await eventually(
      {
        that: 'compliance stage advances to ready_to_submit after publish',
        minTimeout: 500,
        maxTimeout: 15_000,
        retries: 15,
      },
      async () => {
        const { data } = await client.get<ComplianceState>(
          '/v1/campaigns/tcr-compliance/mine/compliance-state',
        )
        expect(data.stage).toBe('ready_to_submit')
      },
    )

    // ── 22. Submit to Peerly ───────────────────────────────────────────────────
    // Enforced precondition: compliance stage must be `ready_to_submit`.
    // gp-api reads the saved EIN, committee name, candidate name, address,
    // email, phone, and website host from the TcrCompliance row — no body.
    await withGatewayRetry(
      'POST /v1/campaigns/tcr-compliance/submit-to-peerly',
      () => client.post('/v1/campaigns/tcr-compliance/submit-to-peerly'),
    )

    // ── 23. Compliance state: awaiting_pin ────────────────────────────────────
    await eventually(
      {
        that: 'compliance stage advances to awaiting_pin after Peerly submit',
        minTimeout: 500,
        maxTimeout: 10_000,
        retries: 10,
      },
      async () => {
        const { data } = await client.get<ComplianceState>(
          '/v1/campaigns/tcr-compliance/mine/compliance-state',
        )
        expect(data.stage).toBe('awaiting_pin')
      },
    )

    // ── 24. Advance mock so the PIN box renders ────────────────────────────────
    // peerly.cv.approve skips the 2-minute auto-approve clock, advancing the
    // mock CV state to APPROVED. cvStatusPoll.scanFresh reads the APPROVED
    // state and sets CV_PIN_GATE.READY, which is what EnterPin checks before
    // rendering PinForm. The default mock CV PIN is always '123456'
    // (MOCK_CV_PIN in peerly10DlcMock.controller.ts).
    await withGatewayRetry('peerly.cv.approve', () =>
      peerlyAction(client, campaignId, 'peerly.cv.approve'),
    )
    await withGatewayRetry('cvStatusPoll.scanFresh (cv)', () =>
      runJob(client, 'cvStatusPoll.scanFresh'),
    )

    // ── 25. Enter-pin page: wrong PIN → error → correct PIN ───────────────────
    await page.goto('/dashboard/profile/texting-compliance/enter-pin')

    // Wait for PinForm to render (the page polls the CV gate until READY).
    const submitButton = page.getByRole('button', { name: 'Submit' })
    await expect(submitButton).toBeVisible({ timeout: 30_000 })

    // Wrong PIN first — the mock rejects anything other than '123456'.
    await fillPin(page, '000000')
    await submitButton.click()
    await expect(
      page.getByRole('alert').filter({ hasText: "That PIN didn't match" }),
    ).toBeVisible({ timeout: 15_000 })

    // Correct PIN — the default mock PIN (MOCK_CV_PIN = '123456').
    await fillPin(page, '123456')
    await submitButton.click()

    // After the correct PIN, EnterPin redirects to /dashboard/account.
    await page.waitForURL(/\/dashboard\/account/, { timeout: 30_000 })

    // ── 26. Activate use case and advance to tcr_approved ─────────────────────
    // peerly.usecase.activate skips the 5-minute auto-activation clock.
    // A second cvStatusPoll.scanFresh picks up the active use case and flips
    // TcrCompliance.status to 'approved', which maps to tcr_approved.
    await withGatewayRetry('peerly.usecase.activate', () =>
      peerlyAction(client, campaignId, 'peerly.usecase.activate'),
    )
    await withGatewayRetry('cvStatusPoll.scanFresh (usecase)', () =>
      runJob(client, 'cvStatusPoll.scanFresh'),
    )

    // ── 27. Assert tcr_approved ────────────────────────────────────────────────
    await eventually(
      {
        that: 'compliance stage reaches tcr_approved',
        minTimeout: 500,
        maxTimeout: 15_000,
        retries: 15,
      },
      async () => {
        const { data } = await client.get<ComplianceState>(
          '/v1/campaigns/tcr-compliance/mine/compliance-state',
        )
        expect(data.stage).toBe('tcr_approved')
      },
    )
  })
})
