import { randomUUID } from 'node:crypto'
import { addDays, addYears, format } from 'date-fns'
import { expect, test, type Page } from '@playwright/test'
import type { AxiosInstance } from 'axios'
import { setFlagOverrides } from 'src/helpers/campaignStory.helper'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  deliverStripeEvent,
  mockAction,
  mockRecords,
  overrideCvValidation,
  peerlyAction,
  runJob,
} from 'src/helpers/vendor-mocks.helper'
import { uniqueEin } from 'src/helpers/pro-upgrade.helper'
import { authenticateTestUser } from 'tests/utils/api-registration'
import { withGatewayRetry } from 'tests/utils/headless-user'

// [M4] 10DLC registration, end to end against the vendor mocks (ENG-11404).
//
// A PR preview can't run the compliance_setup agent, so this spec plays it:
// after the candidate pays, the test calls the same gp-api routes the agent's
// MCP tools call, in the agent's order (compliance-state, domains/search,
// domains/purchase, websites/mine, verify-live, submit-to-peerly). Peerly,
// Vercel and Route53 answer from the in-process mocks, so the whole vendor
// sequence runs deterministically. The agent's judgment stays with the Judge.
//
// Runs wherever VENDOR_MODE=mock (previews, dev, local gp-api) and skips only
// if dev is rolled back with VENDOR_MODE=live.

type ComplianceState = {
  stage: string
  domain: { name: string; status: string } | null
  peerlyCvStatus: string | null
}

type TcrComplianceMine = { status?: string | null }

// Default Campaign Verify PIN of the Peerly 10DLC mock.
const MOCK_CV_PIN = '123456'

const BIO =
  'I am running for City Council because our neighborhood deserves a ' +
  'representative who shows up, listens, and follows through. For years ' +
  'I have organized with neighbors on the issues that touch daily life: ' +
  'safe streets, reliable services, affordable housing, and an open, ' +
  'accountable local government. I will bring that same energy to the ' +
  'council, fighting for transparent budgets, smart infrastructure ' +
  'investment, and a city that works for working families rather than ' +
  'the well-connected few. Together we can build a community we are all ' +
  'proud to call home, today and for the generations that follow us.'

const POLICY_FOCUS =
  'Expand affordable housing by streamlining permits, protecting renters ' +
  'from unfair increases, and partnering with builders on starter homes.'

const digitsOnly = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\D/g, '') : ''

// ─── Wizard ──────────────────────────────────────────────────────────────────

// Guidance → status → EIN → filing details (campaign verification's own form,
// which carries the candidate profile inline and takes a manual address, so
// the spec never depends on Google Places). Stops on the payment step.
const walkWizardToPayment = async (
  page: Page,
  email: string,
  EIN: string,
): Promise<void> => {
  await page.goto('/dashboard/pro-upgrade')
  await NavigationHelper.dismissOverlays(page)
  await page.waitForURL(/\/dashboard\/pro-upgrade\/guidance/, {
    timeout: 60_000,
  })
  // The cookie banner mounts after the redirect and covers the Continue button.
  await NavigationHelper.dismissOverlays(page)
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.waitForURL(/\/dashboard\/pro-upgrade\/status/)
  await page
    .getByRole('button', { name: 'I have filed with my election authority' })
    .click()
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.waitForURL(/\/dashboard\/pro-upgrade\/ein/)
  await page.getByPlaceholder('12-3456789').fill(EIN)
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.waitForURL(/\/dashboard\/pro-upgrade\/filing-details/)
  await expect(
    page.getByText('What are your campaign filing details?'),
  ).toBeVisible()

  const bioEditor = page.locator('.ql-editor').first()
  await expect(bioEditor).toBeVisible({ timeout: 15_000 })
  await bioEditor.click()
  await bioEditor.fill(BIO)
  await page.getByRole('button', { name: 'Add a policy priority' }).click()
  await page.getByLabel('Policy title').fill('Safe and affordable housing')
  const policyFocus = page.locator('.ql-editor').last()
  await expect(policyFocus).toBeVisible({ timeout: 10_000 })
  await policyFocus.click()
  await policyFocus.fill(POLICY_FOCUS)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Edit Safe and affordable housing' }),
  ).toBeVisible({ timeout: 10_000 })

  // A fresh test campaign can arrive without an office level.
  const officeTrigger = page
    .getByRole('combobox')
    .filter({ hasText: 'Select an office level' })
  if (await officeTrigger.count()) {
    await officeTrigger.click()
    await page.getByRole('option', { name: 'Local' }).click()
  }
  // The EIN step already saved the EIN; the form only re-asks on a cold prefill.
  const einInput = page.getByLabel('EIN', { exact: true })
  if (await einInput.count()) {
    await einInput.fill(EIN)
  }

  await page.getByPlaceholder('Jane Smith').fill('Jane Smith')
  await page.getByPlaceholder('Jane for Council').fill('Jane for Council')
  await page
    .getByPlaceholder('https://')
    .fill('https://sos.wyo.gov/filing/jane-for-council')
  await page.getByPlaceholder('you@campaign.org').fill(email)
  await page.getByPlaceholder('(555) 123-4567').fill('(307) 555-1234')
  await page.getByPlaceholder('123 Main St').fill('1700 Pennsylvania Ave NW')
  await page.getByPlaceholder('Seattle').fill('Cheyenne')
  await page.getByRole('combobox').filter({ hasText: 'State' }).click()
  await page.getByRole('option', { name: 'WY' }).click()
  await page.getByPlaceholder('98103').fill('82001')

  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL(/\/dashboard\/pro-upgrade\/payment/, {
    timeout: 60_000,
  })
}

// Records the Stripe checkout session id from the response the payment step
// already makes. The test needs it to deliver the webhook a preview can't
// receive; the id is the part of the client secret before `_secret_`. Armed
// before the wizard reaches the payment step.
const captureCheckoutSessionId = (page: Page): (() => string | null) => {
  let sessionId: string | null = null
  page.on('response', async (res) => {
    if (
      res.request().method() !== 'POST' ||
      !/\/payments\/purchase\/checkout-session/.test(res.url())
    ) {
      return
    }
    const body = (await res.json()) as { clientSecret?: string }
    sessionId = body.clientSecret?.split('_secret_')[0] ?? null
  })
  return () => sessionId
}

const payWithTestCard = async (page: Page): Promise<void> => {
  const stripeFrame = page
    .frameLocator('iframe[title="Secure payment input frame"]')
    .first()

  const cardInput = stripeFrame.locator('#payment-numberInput')
  await expect(cardInput).toBeVisible({ timeout: 30_000 })
  await expect(cardInput).toBeEditable({ timeout: 30_000 })

  await cardInput.fill('4242424242424242')
  await stripeFrame
    .locator('#payment-expiryInput')
    .fill(format(addYears(new Date(), 2), 'MMyy'))
  await stripeFrame.locator('#payment-cvcInput').fill('123')
  // Stripe geolocates the billing country from the runner's IP; pin it to US
  // so the ZIP field always renders.
  await stripeFrame.locator('#payment-countryInput').selectOption('US')
  await stripeFrame.locator('#payment-postalCodeInput').fill('82001')

  // Stripe Link's save-my-info box demands a phone number and keeps the
  // submit disabled while checked. It is absent on some runner geolocations.
  const saveCheckbox = stripeFrame.locator('#payment-linkOptInInput')
  if (await saveCheckbox.count()) {
    await expect(async () => {
      if (await saveCheckbox.isChecked()) {
        await saveCheckbox.click({ timeout: 5_000 })
      }
      await expect(saveCheckbox).not.toBeChecked({ timeout: 2_000 })
    }).toPass({ timeout: 15_000 })
  }

  const completeButton = page.getByRole('button', { name: 'Complete upgrade' })
  await expect(completeButton).toBeEnabled({ timeout: 30_000 })
  await completeButton.scrollIntoViewIfNeeded()
  await completeButton.click()

  await page.waitForURL(/\/dashboard\/pro-upgrade\/success/, {
    timeout: 60_000,
  })
}

// ─── Agent steps ─────────────────────────────────────────────────────────────

const getComplianceState = async (
  client: AxiosInstance,
): Promise<ComplianceState> => {
  const { data } = await withGatewayRetry('GET compliance-state', () =>
    client.get<ComplianceState>(
      '/v1/campaigns/tcr-compliance/mine/compliance-state',
    ),
  )
  return data
}

const DOMAIN_MAX_PRICE = 50

const searchAvailableDomain = async (
  client: AxiosInstance,
  prefix = 'janeforcouncil',
): Promise<string> => {
  const { data: search } = await client.post<{
    candidates: { domain: string; price: number }[]
  }>('/v1/domains/search', {
    patterns: [`${prefix}${randomUUID().slice(0, 8)}`],
    maxPrice: DOMAIN_MAX_PRICE,
  })
  const [candidate] = search.candidates
  expect(candidate, 'domain search returned no candidates').toBeDefined()
  return candidate!.domain
}

// Plays the compliance_setup agent from `pending_domain_purchase` through
// `submit-to-peerly`, which leaves the registration at `awaiting_pin`.
const playAgentThroughSubmit = async (
  client: AxiosInstance,
  campaignId: number,
  EIN: string,
): Promise<void> => {
  expect((await getComplianceState(client)).stage).toBe(
    'pending_domain_purchase',
  )

  const maxPrice = DOMAIN_MAX_PRICE
  const domainName = await searchAvailableDomain(client)

  // The route holds the request open until the order completes (~30s on the
  // mock), longer than some proxies wait. Purchase is idempotent per campaign,
  // so a gateway timeout is safe to retry.
  await withGatewayRetry('POST /v1/domains/purchase', () =>
    client.post('/v1/domains/purchase', { domain: domainName, maxPrice }),
  )

  // The purchase call returns once the Vercel mock completes the order (30s
  // after it is placed). A `submitted` domain counts as registered, so the
  // stage moves on to waiting for the website.
  await expect
    .poll(async () => (await getComplianceState(client)).stage, {
      message: 'the registered domain moves the stage past the purchase',
      timeout: 60_000,
      intervals: [2_000],
    })
    .toBe('pending_website_live')

  await client.put('/v1/websites/mine', { status: 'published' })

  const { data: live } = await client.post<{ verified: boolean }>(
    '/v1/websites/mine/verify-live',
  )
  expect(live.verified).toBe(true)

  // The pre-submission gate fetches the filing URL live and asks an LLM, which
  // a fixture candidate can't pass; stand in for staff's override.
  await overrideCvValidation(client)
  await client.post('/v1/campaigns/tcr-compliance/submit-to-peerly')
  expect((await getComplianceState(client)).stage).toBe('awaiting_pin')

  // The submission wrote the Peerly side of the registration, and the brand
  // request carried the EIN the candidate entered in the wizard.
  const { records } = await mockRecords(client, campaignId)
  const peerly = records.filter((r) => r.vendor === 'peerly')
  for (const kind of ['identity', 'profile', 'brand', 'cv_request']) {
    expect(
      peerly.filter((r) => r.kind === kind),
      `peerly ${kind} record`,
    ).not.toHaveLength(0)
  }
  const brand = peerly.find((r) => r.kind === 'brand')
  const brandState = brand?.state as { request?: { ein?: string } } | undefined
  expect(digitsOnly(brandState?.request?.ein)).toBe(digitsOnly(EIN))
}

// Peerly issues the PIN once Campaign Verify approves; the scan is the job
// that notices (compliance-state reads the live CV status at awaiting_pin).
const approveCampaignVerify = async (
  client: AxiosInstance,
  campaignId: number,
): Promise<void> => {
  await peerlyAction(client, campaignId, 'peerly.cv.approve')
  await runJob(client, 'cvStatusPoll.scanFresh')
}

const enterPin = async (page: Page, pin: string): Promise<void> => {
  await page.goto('/dashboard/profile/texting-compliance/enter-pin')
  const firstDigit = page.getByRole('textbox', { name: 'Digit 1' })
  await expect(firstDigit).toBeVisible({ timeout: 30_000 })
  for (const [index, digit] of [...pin].entries()) {
    await page.getByRole('textbox', { name: `Digit ${index + 1}` }).fill(digit)
  }
  await page.getByRole('button', { name: 'Submit' }).click()
}

// ─── Spec ────────────────────────────────────────────────────────────────────

test.describe('10DLC registration — M4 vendor mocks', () => {
  test.use({ serviceWorkers: 'block' })

  test.beforeEach(async ({ page }) => {
    // The purchase-only wizard (filing details before payment) is the one this
    // spec walks; pin it so the live flag rollout can't change the steps.
    await setFlagOverrides(page, { 'outreach-pro-gating-v2': 'on' })
    await blockSlowScripts(page)
  })

  // Registers a Pro candidate through the wizard and Stripe, which leaves the
  // registration at `pending_domain_purchase`. Skips where the vendors are not
  // mocked.
  const registerPro = async (
    page: Page,
  ): Promise<{ client: AxiosInstance; campaignId: number; ein: string }> => {
    const { user, client } = await authenticateTestUser(page, {
      isolated: true,
    })
    const { data: campaign } = await client.get<{ id: number }>(
      '/v1/campaigns/mine',
    )
    const { vendorMode } = await mockRecords(client, campaign.id)
    test.skip(
      vendorMode !== 'mock',
      '10DLC registration spec requires VENDOR_MODE=mock (skipped when VENDOR_MODE=live)',
    )

    // Texting closes 19 days before the election; keep it well clear.
    await client.put('/v1/campaigns/mine', {
      details: { electionDate: format(addDays(new Date(), 90), 'yyyy-MM-dd') },
    })

    const ein = uniqueEin()
    const checkoutSessionId = captureCheckoutSessionId(page)
    await walkWizardToPayment(page, user.email, ein)
    await payWithTestCard(page)
    const sessionId = checkoutSessionId()
    expect(sessionId, 'checkout session id').not.toBeNull()
    await deliverStripeEvent(client, sessionId!)
    await expect
      .poll(
        async () =>
          (await client.get<{ isPro?: boolean }>('/v1/campaigns/mine')).data
            .isPro,
        { message: 'the delivered webhook flips isPro', timeout: 60_000 },
      )
      .toBe(true)

    return { client, campaignId: campaign.id, ein }
  }

  // Plays the agent on top of `registerPro` up to `awaiting_pin`.
  const registerUntilAwaitingPin = async (
    page: Page,
  ): Promise<{ client: AxiosInstance; campaignId: number }> => {
    const { client, campaignId, ein } = await registerPro(page)
    await playAgentThroughSubmit(client, campaignId, ein)
    return { client, campaignId }
  }

  test('registers a candidate from the Pro wizard to tcr_approved', async ({
    page,
  }) => {
    test.setTimeout(10 * 60 * 1000)

    const { client, campaignId } = await registerUntilAwaitingPin(page)

    await approveCampaignVerify(client, campaignId)
    await enterPin(page, MOCK_CV_PIN)

    await expect
      .poll(
        async () =>
          (
            await client.get<TcrComplianceMine>(
              '/v1/campaigns/tcr-compliance/mine',
            )
          ).data.status,
        { message: 'the correct PIN moves the registration to pending' },
      )
      .toBe('pending')

    await peerlyAction(client, campaignId, 'peerly.usecase.activate')
    await runJob(client, 'tcr.complianceSweep')

    await expect
      .poll(async () => (await getComplianceState(client)).stage, {
        message: 'the compliance sweep approves the registration',
      })
      .toBe('tcr_approved')
    const { data: tcr } = await client.get<TcrComplianceMine>(
      '/v1/campaigns/tcr-compliance/mine',
    )
    expect(tcr.status).toBe('approved')
  })

  test('shows the wrong-PIN error when the PIN does not match', async ({
    page,
  }) => {
    test.setTimeout(10 * 60 * 1000)

    const { client, campaignId } = await registerUntilAwaitingPin(page)

    await peerlyAction(client, campaignId, 'peerly.cv.setPin', {
      pin: '999999',
    })
    await approveCampaignVerify(client, campaignId)
    await enterPin(page, MOCK_CV_PIN)

    await expect(
      page.getByText(/That PIN didn.t match\. Double-check and try again\./),
    ).toBeVisible()
    const { data: tcr } = await client.get<TcrComplianceMine>(
      '/v1/campaigns/tcr-compliance/mine',
    )
    expect(tcr.status).toBe('submitted')
  })

  test('shows no PIN entry when Campaign Verify rejects the registration', async ({
    page,
  }) => {
    test.setTimeout(10 * 60 * 1000)

    const { client, campaignId } = await registerUntilAwaitingPin(page)

    await peerlyAction(client, campaignId, 'peerly.cv.reject', {
      reason: 'E2E rejection',
    })
    await runJob(client, 'cvStatusPoll.scanFresh')

    await page.goto('/dashboard/profile/texting-compliance/enter-pin')
    // The scan marks the registration rejected, and the page has no rejected
    // state of its own: it falls back to the generic "step isn't available".
    await expect(page.getByText('This step isn’t available yet.')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole('textbox', { name: 'Digit 1' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Submit' })).toHaveCount(0)

    expect((await getComplianceState(client)).stage).toBe('tcr_rejected')
    const { data: tcr } = await client.get<TcrComplianceMine>(
      '/v1/campaigns/tcr-compliance/mine',
    )
    expect(tcr.status).toBe('rejected')
  })

  test('retries a failed domain order and offers no taken domain', async ({
    page,
  }) => {
    test.setTimeout(10 * 60 * 1000)

    const { client, campaignId } = await registerPro(page)
    expect((await getComplianceState(client)).stage).toBe(
      'pending_domain_purchase',
    )

    // The Route53 mock reports every `taken-` name as unavailable, so a search
    // for one must not offer it, while a normal pattern in the same search does.
    const takenPattern = `taken-${randomUUID().slice(0, 8)}`
    const { data: search } = await client.post<{
      candidates: { domain: string }[]
    }>('/v1/domains/search', {
      patterns: [takenPattern, `janeforcouncil${randomUUID().slice(0, 8)}`],
      maxPrice: DOMAIN_MAX_PRICE,
    })
    expect(search.candidates.length).toBeGreaterThan(0)
    for (const { domain } of search.candidates) {
      expect(domain.startsWith('taken-'), `${domain} is offered`).toBe(false)
    }

    const domainName = await searchAvailableDomain(client)
    const purchaseBody = { domain: domainName, maxPrice: DOMAIN_MAX_PRICE }

    await mockAction(client, campaignId, 'vercel.order.fail')
    const failed = await client.post('/v1/domains/purchase', purchaseBody, {
      validateStatus: () => true,
    })
    expect(
      failed.status,
      'the failed order fails the purchase',
    ).toBeGreaterThanOrEqual(400)

    const { data: status } = await client.get<{ message: string }>(
      '/v1/domains/status',
    )
    expect(status.message).toBe('INACTIVE')
    expect((await getComplianceState(client)).stage).toBe(
      'pending_domain_purchase',
    )

    // The armed failure was consumed by that one order.
    const retried = await withGatewayRetry('POST /v1/domains/purchase', () =>
      client.post('/v1/domains/purchase', purchaseBody),
    )
    expect(retried.status).toBeLessThan(300)

    await expect
      .poll(async () => (await getComplianceState(client)).stage, {
        message: 'the retried order moves the stage past the purchase',
        timeout: 60_000,
        intervals: [2_000],
      })
      .toBe('pending_website_live')

    await client.put('/v1/websites/mine', { status: 'published' })
    const { data: live } = await client.post<{ verified: boolean }>(
      '/v1/websites/mine/verify-live',
    )
    expect(live.verified).toBe(true)
  })
})
