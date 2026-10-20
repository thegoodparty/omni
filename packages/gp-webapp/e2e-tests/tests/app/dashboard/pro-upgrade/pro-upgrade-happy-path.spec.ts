import { addDays, addYears, format } from 'date-fns'
import { expect, test } from '@playwright/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { authenticateTestUser } from 'tests/utils/api-registration'
import { eventually } from 'tests/utils/eventually'
import { waitForDashboardReady } from 'src/helpers/dashboard'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import { deliverStripeEvent } from 'src/helpers/vendor-mocks.helper'

// Pro-upgrade happy path: an already-filed candidate drives the full wizard
// funnel through an embedded Stripe subscription to Pro, then lands on the
// post-payment dashboard PIN state (ENG-10475).
//
// The @dev-only tag was removed (M3-5): the Stripe `checkout.session.completed`
// event is now delivered in-process via deliverStripeEvent, which calls
// POST /v1/test-fixtures/vendor-mocks/stripe/events and fires
// paymentEventsService synchronously — no inbound webhook from Stripe is
// needed, so PR previews can run this test. The session ID is extracted from
// the checkout-session response's `clientSecret` field (Pro subscription
// returns only clientSecret, not a session id), using Stripe's format:
// `cs_<test|live>_<id>_secret_<random>` → `split('_secret_')[0]`.
//
// Side effects (no automated teardown for either):
//   - Creates a real test-mode Stripe subscription. There is no candidate-facing
//     cancel-subscription endpoint on gp-api (the only subscription writes are
//     the Stripe webhook and admin-only routes), so the test-mode subscription
//     is left in place — accumulated test-mode subs on dev are acceptable.
//   - Triggers the compliance agent (provisions a dev website/domain) via the
//     payment-success webhook. The `@test.goodparty.org` user is swept by
//     gp-api's `deleteTestUsers` (stale > 3h); the agent artifacts ride along.

// The slice of the campaign and TCR-compliance responses the API assertions
// read. The authed axios `client` is untyped, so annotate to avoid `any`.
type CampaignProState = { isPro?: boolean }
type TcrComplianceMine = { status?: string | null }

// The legacy wizard these specs assert only renders while
// outreach-pro-gating-v2 is off — pinned here so the suite reads the same
// whatever the flag's live dev rollout is (the 2026-09-28 dev ramp turned
// every PR's shard red when these ran against the v2 purchase-only flow).
// The v2 flow needs its own specs pinned on; tracked as follow-up.
test.beforeEach(async ({ page }) => {
  await setFlagOverrides(page, { 'outreach-pro-gating-v2': 'off' })
})

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

test('filed candidate upgrades to Pro and reaches the post-payment PIN state', async ({
  page,
}) => {
  // deliverStripeEvent delivers the webhook in-process, so the isPro flip is
  // near-instant; the budget can be much tighter than the old 15-minute window.
  test.setTimeout(8 * 60 * 1000)

  // Isolated: this mutates account-level state (campaign → Pro), so it must
  // never reuse the per-worker cached user. Default race (Cheyenne City Council
  // - Ward 1) is a local office, matching the manual run.
  const { user, client } = await authenticateTestUser(page, { isolated: true })

  // Inside the 19-day texting cutoff SuccessStep swaps "Welcome to Pro!" for
  // the closed-window screen, so keep the default Cheyenne race clear of it.
  // The closed path is covered by pro-upgrade-v2-cutoff.spec.ts.
  await client.put('/v1/campaigns/mine', {
    details: { electionDate: format(addDays(new Date(), 90), 'yyyy-MM-dd') },
  })

  // 1. Dashboard — the non-Pro candidate sees the Get Pro banner; click into
  // the wizard.
  await page.goto('/dashboard')
  await page.waitForURL(/\/dashboard/)
  await NavigationHelper.dismissOverlays(page)
  // Closes any stray task-detail dialog (which aria-hides the whole page) and
  // waits for the campaign-gated chrome, like the sibling pro-upgrade specs.
  await waitForDashboardReady(page)

  await expect(
    page.getByText('76% of candidates who use Pro win'),
  ).toBeVisible()

  // A click that lands before hydration attaches the banner's handler is
  // swallowed (observed in CI: click fired on the half-hydrated dashboard,
  // then no navigation for 45s), so retry the click until the URL moves.
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

  // 2. Value prop.
  await page.getByRole('button', { name: 'Get Pro for $10/mo' }).click()

  // 3. Filing status — "Yes, I'm already filed".
  await page.waitForURL(/\/dashboard\/pro-upgrade\/status/)
  await page.getByRole('button', { name: "Yes, I'm already filed" }).click()

  // 4. Guidance interstitial.
  await page.waitForURL(/\/dashboard\/pro-upgrade\/guidance/)
  await page.getByRole('button', { name: "Let's go!" }).click()

  // 5. EIN — a shape-valid, sanity-passing EIN (47 is an IRS-issued prefix).
  await page.waitForURL(/\/dashboard\/pro-upgrade\/ein/)
  await page.getByRole('textbox').first().fill('47-1234567')
  await page.getByRole('button', { name: 'Continue' }).click()

  // 6. Filing details. Email and phone are both required (ENG-10483: Peerly
  // needs both); the filing address is optional. Fill candidate name,
  // committee, filing link, email, and phone, and skip the Google-autocomplete
  // address, which is flaky in e2e and not required for submission.
  await page.waitForURL(/\/dashboard\/pro-upgrade\/filing-details/)
  await page.getByPlaceholder('Jane Smith').fill('Jane Smith')
  await page.getByPlaceholder('Jane for Council').fill('Jane for Council')
  await page
    .getByPlaceholder('https://')
    .fill('https://sos.wyo.gov/filing/jane-for-council')

  await page.getByPlaceholder('jane@gmail.com').fill(user.email)
  await page.getByPlaceholder('(555) 555-5555').fill('(307) 555-1234')

  // Filing address is required: the agentic TCR/Peerly submit resolves a postal
  // address from this place_id, so the step blocks Continue until a real Google
  // Places suggestion is selected. Type a known address, wait for Google's
  // `.pac-item` dropdown (appended to <body>), and pick the first suggestion —
  // ArrowDown+Enter so react-google-autocomplete fires onPlaceSelected.
  const addressInput = page.getByPlaceholder(
    'Start typing to search, or enter it yourself',
  )
  await addressInput.click()
  await addressInput.pressSequentially('1700 Pennsylvania Ave NW, Washington', {
    delay: 80,
  })
  const suggestion = page.locator('.pac-item').first()
  await expect(suggestion).toBeVisible({ timeout: 15_000 })
  await addressInput.press('ArrowDown')
  await addressInput.press('Enter')

  // onPlaceSelected resolves the place details asynchronously and only then
  // writes the place (with its place_id) into form state; until that lands,
  // Continue fails validation and silently no-ops (its error banner clears
  // itself once the write arrives). There is no stable DOM signal for the
  // write — arrowing through suggestions already rewrites the input text — so
  // retry Continue until the wizard actually advances. Re-clicks during a real
  // submit are no-ops (the form's submittingRef/loading guard).
  await expect(async () => {
    if (!/\/dashboard\/pro-upgrade\/candidate-profile/.test(page.url())) {
      await page
        .getByRole('button', { name: 'Continue' })
        .click({ timeout: 5_000 })
    }
    await page.waitForURL(/\/dashboard\/pro-upgrade\/candidate-profile/, {
      timeout: 15_000,
    })
  }).toPass({ timeout: 90_000 })

  // 7. Candidate profile — ≥200-char bio (Quill editor) + one policy priority
  // with a ≥100-char focus.
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
  const policyFocus = page.locator('.ql-editor').last()
  await expect(policyFocus).toBeVisible({ timeout: 10_000 })
  await policyFocus.click()
  await policyFocus.fill(
    'Expand affordable housing by streamlining permits, protecting renters ' +
      'from unfair increases, and partnering with builders on starter homes.',
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page
    .getByRole('button', { name: 'Edit Safe and affordable housing' })
    .waitFor({ state: 'visible', timeout: 10_000 })

  // Arm the checkout-session interceptor before clicking Continue. PaymentContent
  // POSTs to /checkout-session on mount, so the interceptor must be live before
  // the navigation that mounts it; arming after waitForURL is too late.
  // gp-api returns only `clientSecret` for Pro subscriptions (no `id` field),
  // so derive the session ID from the Stripe client secret format:
  // `cs_test_<id>_secret_<random>` → `split('_secret_')[0]` gives `cs_test_<id>`.
  let proSessionId: string | null = null
  await page.route(
    /\/api\/v1\/payments\/purchase\/checkout-session$/,
    async (route) => {
      const response = await route.fetch()
      if (response.ok()) {
        const body = (await response.json()) as { clientSecret?: string }
        if (body.clientSecret) {
          proSessionId = body.clientSecret.split('_secret_')[0] ?? null
        }
      }
      await route.fulfill({ response })
    },
  )

  await page.getByRole('button', { name: 'Continue' }).click()

  // 8. Payment — embedded Stripe Payment Element.
  await page.waitForURL(/\/dashboard\/pro-upgrade\/payment/)

  const stripeFrame = page
    .frameLocator('iframe[title="Secure payment input frame"]')
    .first()

  const cardInput = stripeFrame.locator('#payment-numberInput')
  const expiryInput = stripeFrame.locator('#payment-expiryInput')
  const cvcInput = stripeFrame.locator('#payment-cvcInput')
  const zipInput = stripeFrame.locator('#payment-postalCodeInput')

  await expect(cardInput).toBeVisible({ timeout: 30_000 })
  await expect(cardInput).toBeEditable({ timeout: 30_000 })
  await page.waitForTimeout(2_000)

  // A future MMYY computed each run so the test doesn't rot.
  const futureExpiry = format(addYears(new Date(), 2), 'MMyy')

  await cardInput.fill('4242424242424242')
  await page.waitForTimeout(500)
  await expiryInput.fill(futureExpiry)
  await page.waitForTimeout(500)
  await cvcInput.fill('123')
  await page.waitForTimeout(500)
  // Stripe geolocates the billing country from the client IP, and the card
  // form renders a ZIP field only for countries that collect one. CI runners
  // are sometimes geolocated outside the US (observed: Mexico, 2026-09-04),
  // which drops #payment-postalCodeInput entirely - pin the country first.
  await stripeFrame.locator('#payment-countryInput').selectOption('US')
  await page.waitForTimeout(500)
  await zipInput.fill('82001')
  await page.waitForTimeout(500)

  // Uncheck "Save my information for faster checkout" (Stripe Link) — when
  // checked it demands a phone number and the submit button stays disabled.
  const saveCheckbox = stripeFrame.getByLabel(
    'Save my information for faster checkout',
  )
  if (await saveCheckbox.isChecked().catch(() => false)) {
    await saveCheckbox.uncheck()
  }
  await page.waitForTimeout(1_000)

  // The Pro subscription confirms client-side via Stripe; on confirm the step
  // navigates to /success, so the URL change is the signal.
  const completeButton = page.getByRole('button', { name: 'Complete upgrade' })
  await expect(completeButton).toBeEnabled({ timeout: 30_000 })
  await completeButton.click()

  // 9. Success — "Welcome to Pro!".
  await page.waitForURL(/\/dashboard\/pro-upgrade\/success/, {
    timeout: 60_000,
  })
  await expect(page.getByText('Welcome to Pro!')).toBeVisible()

  // Deliver the Stripe checkout.session.completed event in-process. This fires
  // paymentEventsService synchronously, flipping `isPro` without waiting for a
  // real Stripe webhook. proSessionId was captured from the checkout-session
  // response above; it must be non-null before we reach this point.
  expect(proSessionId).toBeTruthy()
  await deliverStripeEvent(client, proSessionId!)

  await page.getByRole('button', { name: 'Continue' }).click()

  // The webhook flips `isPro` server-side (never client-side); prove it via the
  // authed client before asserting the dependent dashboard UI. In-process
  // delivery is near-instant, so a short poll is sufficient.
  await eventually(
    {
      that: 'the campaign isPro flips server-side via deliverStripeEvent',
      minTimeout: 500,
      maxTimeout: 2_000,
      retries: 5,
    },
    async () => {
      const res = await client.get<CampaignProState>('/v1/campaigns/mine')
      expect(res.status).toBe(200)
      expect(res.data.isPro).toBe(true)
    },
  )

  // The filing-details submit created a TCR-compliance record; it defaults to
  // `submitted` (awaiting PIN), which drives the post-payment compliance card.
  const tcr = await client.get<TcrComplianceMine>(
    '/v1/campaigns/tcr-compliance/mine',
  )
  expect(tcr.status).toBe(200)
  expect(tcr.data.status).toBe('submitted')

  // 10. Dashboard post-payment state. The success-step exit refreshes the
  // shared campaign cache, but the webhook usually lands after that refresh,
  // so the already-rendered dashboard can still show the non-Pro state —
  // reload now that `isPro` is proven server-side. Expect: PRO badge, the
  // compliance card in the Get Pro banner's slot, and the banner gone. For a
  // fresh submission the card shows the awaiting-PIN in-review state — the
  // "Enter your PIN" box appears only once Peerly CampaignVerify approves,
  // days later (the CV gate, ENG-10785) — never within this test's window.
  await page.goto('/dashboard')
  await page.waitForURL('**/dashboard', { timeout: 30_000 })

  await expect(page.getByRole('img', { name: 'PRO' }).first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(
    page.getByText('Your registration is being verified'),
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('76% of candidates who use Pro win')).toHaveCount(
    0,
  )
})
