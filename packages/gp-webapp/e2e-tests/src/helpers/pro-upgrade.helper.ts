import { expect, type Page } from '@playwright/test'
import type { AxiosInstance } from 'axios'
import { addYears, format } from 'date-fns'
import { eventually } from 'tests/utils/eventually'

// Seed helpers for the pre-payment Pro-upgrade wizard. These write the same
// canonical state the wizard steps persist, hitting the same gp-api endpoints,
// so `deriveProUpgradeStep` (app/dashboard/pro-upgrade/proUpgradeStep.ts)
// resolves the resume step from real persisted state — not from anything faked.
//
// Live in src/helpers/ (not app/) per e2e-tests/CLAUDE.md: this dir is a
// separate workspace with no Next runtime, so it must not import app code.

// A shape-valid, sanity-passing EIN (prefix 47 is an IRS-issued prefix; not a
// placeholder / all-same-digit value), so `checkEinSanity` treats it as a real
// EIN and the derivation counts the EIN step as complete.
export const SEED_VALID_EIN = '47-1234567'

// Seed the EIN step's persisted output plus the filing-status answer.
//
// The EIN step itself only writes `details.einNumber` / `details.validatedEin`
// (EinStep.tsx -> updateCampaign -> PUT /v1/campaigns/mine). But reaching the
// EIN step at all requires the filing-status question to have been answered
// "yes, already filed" first (it persists `details.hasFiledForRace`), otherwise
// `deriveProUpgradeStep` routes a candidate with progress to the STATUS step,
// not a data step. So an honest "EIN-only" resume seed must also set
// hasFiledForRace=true — that answer is a real upstream prerequisite of the EIN
// step, not a shortcut.
export const seedEinAndFiled = async (client: AxiosInstance): Promise<void> => {
  await client.put('/v1/campaigns/mine', {
    details: {
      einNumber: SEED_VALID_EIN,
      validatedEin: true,
      hasFiledForRace: true,
    },
  })
}

// Seed the filing-details step's persisted output by submitting the TCR
// registration through the same endpoint the step uses (FilingDetailsStep.tsx
// -> submitTcrCompliance -> POST /v1/campaigns/tcr-compliance/agentic). The
// created record defaults to `submitted`, which `getTcrComplianceStatusCompletions`
// counts as `filingComplete`, advancing the derived resume step past
// filing-details. Non-federal payload (CANDIDATE committee, no FEC id) — the
// seeded campaign runs for a local office (Cheyenne City Council, the
// authenticateTestUser default), which maps to officeLevel `local`.
export const seedFilingComplete = async (
  client: AxiosInstance,
  email: string,
): Promise<void> => {
  await client.post('/v1/campaigns/tcr-compliance/agentic', {
    ein: SEED_VALID_EIN,
    placeId: 'ChIJ-seed-place-id',
    formattedAddress: '123 Capitol Ave, Cheyenne, WY 82001, USA',
    committeeName: 'Jane for Council',
    // tcrComplianceBaseShape requires a filing URL that includes a path.
    filingUrl: 'https://sos.wyo.gov/filing/jane-for-council',
    email,
    phone: '+13075551234',
    officeLevel: 'local',
    committeeType: 'CANDIDATE',
  })
}

// ≥500 plain chars and free of the compliance fallback-template marker, so
// isGenuineBioPlainText accepts it (the completeness gate the wizard's
// candidate-profile step enforces).
const SEED_GENUINE_BIO =
  'I am running for City Council because our neighborhood deserves a ' +
  'representative who shows up, listens, and follows through. For years I ' +
  'have organized with neighbors on the issues that touch daily life: safe ' +
  'streets, reliable services, affordable housing, and an open, accountable ' +
  'local government. I will bring that same energy to the council, fighting ' +
  'for transparent budgets, smart infrastructure investment, and a city ' +
  'that works for working families rather than the well-connected few. ' +
  'Together we can build a community we are all proud to call home, today ' +
  'and for the generations that follow us.'

// Seed the candidate-profile step's persisted output — the same
// `website.content.about` slice `saveAboutFields` writes (bio + one genuine
// policy priority) — so `isCandidateProfileComplete` passes and the wizard
// derivation advances past candidate-profile. GET /v1/websites/mine returns
// null (200) when the campaign has no website yet; create it first then, the
// same order saveAboutFields uses.
export const seedCandidateProfileComplete = async (
  client: AxiosInstance,
): Promise<void> => {
  const { data: website } = await client.get<{ id?: number } | null>(
    '/v1/websites/mine',
  )
  if (!website) {
    await client.post('/v1/websites', {})
  }
  await client.put('/v1/websites/mine', {
    about: {
      bio: SEED_GENUINE_BIO,
      issues: [
        {
          title: 'Safe and affordable housing',
          description:
            'Expand affordable housing by streamlining permits, protecting ' +
            'renters from unfair increases, and partnering with builders ' +
            'on starter homes.',
        },
      ],
    },
  })
}

type CampaignProState = { isPro?: boolean }

// Flip the campaign to Pro through the only path that can set `isPro`: the
// embedded Stripe payment step plus its `checkout.session.completed` webhook
// (there is no candidate- or test-facing API write — see the deferred-AC note
// in pro-upgrade-step-resume.spec.ts). Callers must have seeded every
// pre-payment step (seedEinAndFiled + seedFilingComplete +
// seedCandidateProfileComplete) so the wizard entry derives straight to
// /payment. @dev-only by nature: the webhook needs the warm dev stack and can
// run past 90s, so the isPro poll widens retries to ~240s (same budget as
// pro-upgrade-happy-path.spec.ts, which owns the funnel-UI coverage this
// helper deliberately skips).
export const upgradeCampaignToProViaStripe = async (
  page: Page,
  client: AxiosInstance,
): Promise<void> => {
  await page.goto('/dashboard/pro-upgrade')
  await page.waitForURL(/\/dashboard\/pro-upgrade\/payment/, {
    timeout: 60_000,
  })

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
  await stripeFrame.locator('#payment-postalCodeInput').fill('82001')
  await page.waitForTimeout(500)

  // Stripe Link's save-my-info checkbox demands a phone number and keeps the
  // submit disabled while checked.
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

  await page.waitForURL(/\/dashboard\/pro-upgrade\/success/, {
    timeout: 60_000,
  })

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
}
