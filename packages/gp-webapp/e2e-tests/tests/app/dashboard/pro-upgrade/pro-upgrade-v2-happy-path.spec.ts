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

// Purchase-only (outreach-pro-gating-v2) happy path: a filed candidate walks
// guidance → status → EIN → the filing-details form (campaign verification's
// own form, asked before payment) → an embedded Stripe subscription → the
// success screen's submitted confirmation. The filing record must exist
// BEFORE payment, and the compliance kickoff must ride the payment webhook —
// the mechanism that replaced the post-payment campaign-verification handoff
// candidates never came back for.
//
// @dev-only: the `isPro` flip and the deferred compliance-agent kickoff are
// driven by the live Stripe `checkout.session.completed` webhook in
// `paymentEventsService` — an inbound delivery an ephemeral per-PR preview
// can't receive. Same justification and side effects as
// pro-upgrade-happy-path.spec.ts (test-mode subscription left in place; the
// @test.goodparty.org user is swept by gp-api's deleteTestUsers).

type CampaignProState = { isPro?: boolean }
type TcrComplianceMine = { status?: string | null }

// The purchase-only step set only renders while outreach-pro-gating-v2 is on —
// pinned so the suite reads the same whatever the flag's live rollout is.
test.beforeEach(async ({ page }) => {
  await setFlagOverrides(page, { 'outreach-pro-gating-v2': 'on' })
})

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

test('filed candidate submits filing details before payment and lands on the submitted confirmation @dev-only', async ({
  page,
}) => {
  // The isPro poll below can sleep up to ~240s on the Stripe webhook.
  test.setTimeout(15 * 60 * 1000)

  // Isolated: mutates account-level state (campaign → Pro).
  const { user, client } = await authenticateTestUser(page, { isolated: true })

  // Move the election out of the 19-day texting cutoff so the "About 1 to 2
  // weeks" PIN-timing row (GuidanceStep.tsx:143-146 filters it when
  // smsCompliance='closed') renders regardless of the live Cheyenne election
  // day. Same guard applied to pro-upgrade-v2-entry/resume in e7bd8a6c; the
  // closed path stays covered by pro-upgrade-v2-cutoff.spec.ts.
  await client.put('/v1/campaigns/mine', {
    details: { electionDate: format(addDays(new Date(), 90), 'yyyy-MM-dd') },
  })

  // 1. Entry — purchase-only always opens on the guidance overview.
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

  // 2. Filing status — the purchase-only cards are a selection confirmed by
  // Continue (held until one is picked).
  await page.waitForURL(/\/dashboard\/pro-upgrade\/status/)
  await page
    .getByRole('button', { name: 'I have filed with my election authority' })
    .click()
  await page.getByRole('button', { name: 'Continue' }).click()

  // 3. EIN — shape-valid, sanity-passing (47 is an IRS-issued prefix).
  await page.waitForURL(/\/dashboard\/pro-upgrade\/ein/)
  await page.getByPlaceholder('12-3456789').fill('47-1234567')
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
    await einInput.fill('47-1234567')
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
  const saveCheckbox = stripeFrame.getByLabel(
    'Save my information for faster checkout',
  )
  if (await saveCheckbox.isChecked().catch(() => false)) {
    await saveCheckbox.uncheck()
  }
  await page.waitForTimeout(1_000)

  const completeButton = page.getByRole('button', { name: 'Complete upgrade' })
  await expect(completeButton).toBeEnabled({ timeout: 30_000 })
  await completeButton.click()

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
    page.getByRole('button', { name: 'Start verification' }),
  ).toHaveCount(0)

  // THE mechanism under test, half two: the webhook flips isPro server-side
  // and carries the deferred compliance kickoff with it.
  await eventually(
    {
      that: 'the campaign isPro flips server-side via the Stripe webhook',
      minTimeout: 1_000,
      maxTimeout: 15_000,
      retries: 20,
    },
    async () => {
      const res = await client.get<CampaignProState>('/v1/campaigns/mine')
      expect(res.status).toBe(200)
      expect(res.data.isPro).toBe(true)
    },
  )

  // The single centered Done exits to the dashboard once Pro lands.
  const doneButton = page.getByRole('button', { name: 'Done' })
  await expect(doneButton).toBeEnabled({ timeout: 60_000 })
  await doneButton.click()

  // 7. Dashboard post-payment state: PRO badge and the membership banner's
  // in-review message — never needs-verification.
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
  await page.goto('/dashboard')
  await waitForDashboardReady(page)
  await expect(page.getByRole('img', { name: 'PRO' }).first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('Verification is in review')).toBeVisible({
    timeout: 30_000,
  })
  await expect(
    page.getByText('Verify your campaign to send texts.'),
  ).toHaveCount(0)
})
