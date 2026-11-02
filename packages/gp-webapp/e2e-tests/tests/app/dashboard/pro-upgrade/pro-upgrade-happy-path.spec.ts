import { addDays, addYears, format } from 'date-fns'
import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { authenticateTestUser } from 'tests/utils/api-registration'
import { eventually } from 'tests/utils/eventually'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import { uniqueEin } from 'src/helpers/pro-upgrade.helper'
import { deliverStripeEvent } from 'src/helpers/vendor-mocks.helper'
import { withGatewayRetry } from 'tests/utils/headless-user'

// Pro-upgrade happy path: an already-filed candidate drives the full wizard
// funnel through an embedded Stripe subscription to Pro, and its TCR record
// reaches the post-payment PIN state (ENG-10475).
//
// The filing-details step takes a hand-typed address (the street input's
// Google Places autocomplete is a helper, never a gate), so the spec fills
// the structured fields and never depends on Google Places, which does not
// load on *.vercel.app PR previews. Runs on every PR.
//
// The Stripe `checkout.session.completed` event is delivered in-process via
// deliverStripeEvent, which calls POST /v1/test-fixtures/vendor-mocks/stripe/events
// and fires paymentEventsService synchronously — no inbound webhook from Stripe
// is needed. The session ID is extracted from the checkout-session response's
// `clientSecret` field (Pro subscription returns only clientSecret, not a
// session id), using Stripe's format:
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

  // 1. The wizard index. With the flag off the dashboard has no Pro entry
  // (the sidebar banner is flag-gated), so open it directly; it lands a
  // zero-progress candidate on the value-prop step.
  await page.goto('/dashboard/pro-upgrade')
  await page.waitForURL(/\/dashboard\/pro-upgrade\/value-prop/, {
    timeout: 60_000,
  })

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
  await page.getByRole('textbox').first().fill(uniqueEin())
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

  // Filing address is required: the agentic TCR/Peerly submit needs a postal
  // address. Fill the structured fields by hand rather than picking a Google
  // Places suggestion (.pac-item never loads on *.vercel.app previews); an
  // edited field submits as structured components.
  await page
    .getByPlaceholder('Start typing to search, or enter it yourself')
    .fill('1700 Pennsylvania Ave NW')
  await page.getByLabel('City').fill('Cheyenne')
  await page.getByRole('combobox').filter({ hasText: 'State' }).click()
  await page.getByRole('option', { name: 'WY' }).click()
  await page.getByPlaceholder('12345').fill('82001')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL(/\/dashboard\/pro-upgrade\/candidate-profile/, {
    timeout: 60_000,
  })

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

  // Stripe Link's save-my-info box demands a phone number and keeps the
  // submit disabled while checked. It is absent on some runner geolocations,
  // where the longer form also pushes the submit below the fold.
  const linkOptIn = stripeFrame.locator('#payment-linkOptInInput')
  if (await linkOptIn.count()) {
    await expect(async () => {
      if (await linkOptIn.isChecked()) {
        await linkOptIn.click({ timeout: 5_000 })
      }
      await expect(linkOptIn).not.toBeChecked({ timeout: 2_000 })
    }).toPass({ timeout: 15_000 })
  }
  await page.waitForTimeout(1_000)

  // The Pro subscription confirms client-side via Stripe (no sessionId, no
  // complete-checkout-session POST like the one-time polls purchase); on
  // confirm the step navigates to /success, so the URL change is the signal.
  const completeButton = page.getByRole('button', { name: 'Complete upgrade' })
  await expect(completeButton).toBeEnabled({ timeout: 30_000 })
  await completeButton.scrollIntoViewIfNeeded()
  await completeButton.click()

  // 9. Success — "Welcome to Pro!".
  await page.waitForURL(/\/dashboard\/pro-upgrade\/success/, {
    timeout: 60_000,
  })
  await expect(page.getByText('Welcome to Pro!')).toBeVisible()

  // Deliver the Stripe checkout.session.completed event in-process. This fires
  // paymentEventsService synchronously, flipping `isPro` without waiting for a
  // real Stripe webhook. proSessionId was captured from the checkout-session
  // response above; it must be non-null before we reach this point. On dev
  // Stripe's own webhook can land at the same moment, and the handler is
  // idempotent, so a transient write conflict (503) is safe to retry.
  expect(proSessionId).toBeTruthy()
  await withGatewayRetry('POST stripe/events', () =>
    deliverStripeEvent(client, proSessionId!),
  )

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
  // reload now that `isPro` is proven server-side. Expect the PRO badge. The
  // compliance state itself lives in the flag-gated sidebar banner, which
  // does not render with the flag off.
  await page.goto('/dashboard')
  await page.waitForURL('**/dashboard', { timeout: 30_000 })

  await expect(page.getByRole('img', { name: 'PRO' }).first()).toBeVisible({
    timeout: 30_000,
  })
})
