import { randomUUID } from 'crypto'
import { addDays, addYears, format } from 'date-fns'
import { expect, test } from 'src/fixtures/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import { authenticateTestUser } from 'tests/utils/api-registration'
import { eventually } from 'tests/utils/eventually'
import { uniqueEin } from 'src/helpers/pro-upgrade.helper'
import { deliverStripeEvent } from 'src/helpers/vendor-mocks.helper'
import { withGatewayRetry } from 'tests/utils/headless-user'

// The one-time variant of pro-upgrade-v2-happy-path.spec.ts: with
// win_per_campaign_pricing on, the payment step buys the Pro plan once
// ($299) through the PLAN checkout instead of subscribing, and the success
// step reads the plan receipt, with a "Good through" date and no "/mo".
//
// The webapp override cookie turns the flag on for the UI, but gp-api reads
// the flag itself (the purchase answers PLANS_NOT_AVAILABLE without it) and
// dev serves it only to the segment it targets, which is off by default. A
// staff-shaped user is the one dev can target, so the spec probes gp-api
// first and skips, rather than fails, while the flag is not served to it.

const PLANS_FLAG = 'win_per_campaign_pricing'

type CampaignMine = { id: number; isPro?: boolean }
type CampaignProState = { isPro?: boolean }
type TcrComplianceMine = { status?: string | null }

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

test('filed candidate buys Pro once and lands on the success step with a Good through date', async ({
  page,
}) => {
  // deliverStripeEvent delivers the webhook in-process, so the isPro flip is
  // near-instant.
  test.setTimeout(8 * 60 * 1000)

  // Isolated: mutates account-level state (campaign → Pro).
  await setFlagOverrides(page, { [PLANS_FLAG]: 'on' })
  const { user, client } = await authenticateTestUser(page, {
    isolated: true,
    user: { email: `qa-${randomUUID()}+clerk_test@goodparty.org` },
  })

  const mine = await client.get<CampaignMine>('/v1/campaigns/mine')
  const probe = await client.post(
    '/v1/payments/purchase/create-checkout-session',
    {
      type: 'PLAN',
      metadata: { campaignId: mine.data.id, plan: 'pro' },
      returnUrl: 'https://example.invalid/',
    },
    { validateStatus: () => true },
  )
  test.skip(
    probe.status === 403,
    `gp-api does not serve ${PLANS_FLAG} to this user on this environment`,
  )

  // Move the election out of the 19-day texting cutoff so the "About 1 to 2
  // weeks" PIN-timing row (GuidanceStep.tsx:143-146 filters it when
  // smsCompliance='closed') renders regardless of the live Cheyenne election
  // day. Same guard as pro-upgrade-v2-entry/resume; the
  // closed path stays covered by pro-upgrade-v2-cutoff.spec.ts.
  await client.put('/v1/campaigns/mine', {
    details: { electionDate: format(addDays(new Date(), 90), 'yyyy-MM-dd') },
  })

  // 1. Entry — the wizard always opens on the guidance overview.
  await page.goto('/dashboard/pro-upgrade')
  await NavigationHelper.dismissOverlays(page)
  await page.waitForURL(/\/dashboard\/pro-upgrade\/guidance/, {
    timeout: 60_000,
  })
  await expect(
    page.getByText("Let's gather a few things to unlock Pro"),
  ).toBeVisible()
  // The overview names the verification details gathered before payment.
  await expect(page.getByText('Your filing details')).toBeVisible()
  await expect(page.getByText('Contact details')).toBeVisible()
  await expect(page.getByText('About 1 to 2 weeks')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  // 2. Filing status — the cards are a selection confirmed by
  // Continue (held until one is picked).
  await page.waitForURL(/\/dashboard\/pro-upgrade\/status/)
  await page
    .getByRole('button', { name: 'I have filed with my election authority' })
    .click()
  await page.getByRole('button', { name: 'Continue' }).click()

  // 3. EIN — shape-valid, sanity-passing (47 is an IRS-issued prefix).
  await page.waitForURL(/\/dashboard\/pro-upgrade\/ein/)
  const ein = uniqueEin()
  await page.getByPlaceholder('12-3456789').fill(ein)
  await page.getByRole('button', { name: 'Continue' }).click()

  // 4. Filing details — campaign verification's form, before payment. The
  // verification variant's address fields are plain structured inputs (no
  // Google Places dependency), and a fresh test user's incomplete profile
  // renders the bio + policy-priority section inline.
  await page.waitForURL(/\/dashboard\/pro-upgrade\/filing-details/)
  await expect(
    page.getByText('What are your campaign filing details?'),
  ).toBeVisible()

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

  // Office level seeds from the campaign for established users; a freshly
  // created test campaign can arrive empty, so pick it when it's unset.
  const officeTrigger = page
    .getByRole('combobox')
    .filter({ hasText: 'Select an office level' })
  if (await officeTrigger.count()) {
    // Office level was unset, so pick Local.
    await officeTrigger.click()
    await page.getByRole('option', { name: 'Local' }).click()
  }
  // The EIN step already saved the EIN; the form only re-asks when its
  // prefill misses (fresh campaign / cold cache).
  const einInput = page.getByLabel('EIN', { exact: true })
  if (await einInput.count()) {
    // The EIN field rendered, so fill it inline.
    await einInput.fill(ein)
  }

  await page.getByPlaceholder('Jane Smith').fill('Jane Smith')
  await page.getByPlaceholder('Jane for Council').fill('Jane for Council')
  await page
    .getByPlaceholder('https://')
    .fill('https://sos.wyo.gov/filing/jane-for-council')
  await page.getByPlaceholder('you@campaign.org').fill(user.email)
  await page.getByPlaceholder('(555) 123-4567').fill('(307) 555-1234')
  await page.getByPlaceholder('123 Main St').fill('1700 Pennsylvania Ave NW')
  await page.getByPlaceholder('Seattle').fill('Cheyenne')
  await page.getByRole('combobox').filter({ hasText: 'State' }).click()
  await page.getByRole('option', { name: 'WY' }).click()
  await page.getByPlaceholder('98103').fill('82001')

  // Capture the PLAN session id from the response the payment step makes on
  // mount, and fail if anything calls the subscription session: with the
  // flag on it answers 410.
  let sessionId: string | null = null
  let subscriptionCalls = 0
  await page.route(
    /\/api\/v1\/payments\/purchase\/create-checkout-session$/,
    async (route) => {
      const response = await route.fetch()
      if (response.ok()) {
        const body = (await response.json()) as { id?: string }
        sessionId = body.id ?? null
      }
      await route.fulfill({ response })
    },
  )
  await page.route(
    /\/api\/v1\/payments\/purchase\/checkout-session$/,
    async (route) => {
      subscriptionCalls += 1
      await route.continue()
    },
  )

  // The wizard labels this submit Continue (payment completes the submission
  // for the candidate), and it only advances once createAgentic lands.
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL(/\/dashboard\/pro-upgrade\/payment/, {
    timeout: 60_000,
  })

  // THE mechanism under test, half one: the filing record exists before any
  // payment, awaiting the webhook-deferred kickoff.
  const preTcr = await client.get<TcrComplianceMine>(
    '/v1/campaigns/tcr-compliance/mine',
  )
  expect(preTcr.status).toBe(200)
  expect(preTcr.data.status).toBe('submitted')
  const prePay = await client.get<CampaignProState>('/v1/campaigns/mine')
  expect(prePay.data.isPro).not.toBe(true)

  // 5. Payment — embedded Stripe Payment Element (same seams as the legacy
  // happy path, including the geolocation and Stripe Link guards).
  const stripeFrame = page
    .frameLocator('iframe[title="Secure payment input frame"]')
    .first()
  const cardInput = stripeFrame.locator('#payment-numberInput')
  await expect(cardInput).toBeVisible({ timeout: 30_000 })
  await expect(cardInput).toBeEditable({ timeout: 30_000 })
  await page.waitForTimeout(2_000)

  const futureExpiry = format(addYears(new Date(), 2), 'MMyy')
  await cardInput.fill('4242424242424242')
  await page.waitForTimeout(500)
  await stripeFrame.locator('#payment-expiryInput').fill(futureExpiry)
  await page.waitForTimeout(500)
  await stripeFrame.locator('#payment-cvcInput').fill('123')
  await page.waitForTimeout(500)
  await stripeFrame.locator('#payment-countryInput').selectOption('US')
  await page.waitForTimeout(500)
  await stripeFrame.locator('#payment-postalCodeInput').fill('82001')
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

  const completeButton = page.getByRole('button', { name: 'Pay $299' })
  await expect(completeButton).toBeEnabled({ timeout: 30_000 })
  await completeButton.scrollIntoViewIfNeeded()
  await completeButton.click()

  // Deliver checkout.session.completed in-process: the real handler flips
  // isPro and runs the deferred compliance kickoff, no Stripe inbound needed.
  // On dev Stripe's own webhook can land at the same moment, and the handler
  // is idempotent, so a transient write conflict (503) is safe to retry.
  await page.waitForURL(/\/dashboard\/pro-upgrade\/success/, {
    timeout: 60_000,
  })
  expect(sessionId).toBeTruthy()
  expect(subscriptionCalls).toBe(0)
  await withGatewayRetry('POST stripe/events', () =>
    deliverStripeEvent(client, sessionId!),
  )

  // 6. Success — the submitted confirmation, never the Start-verification
  // handoff: the filing is already on record.
  await page.waitForURL(/\/dashboard\/pro-upgrade\/success/, {
    timeout: 60_000,
  })
  await expect(page.getByText('Welcome to Pro')).toBeVisible()
  await expect(
    page.getByText('Your campaign has been submitted for verification.'),
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('A PIN is on its way')).toBeVisible()
  await expect(
    page.getByText(
      /Entering the PIN unlocks texting and your \$175 outreach credit/,
    ),
  ).toBeVisible()
  await page.getByRole('button', { name: /Your receipt/ }).click()
  await expect(page.getByText('Good through')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('$299.00').first()).toBeVisible()
  await expect(page.getByText(/\/mo/)).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Start verification' }),
  ).toHaveCount(0)

  // THE mechanism under test, half two: the webhook flips isPro server-side
  // and carries the deferred compliance kickoff with it.
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
})
