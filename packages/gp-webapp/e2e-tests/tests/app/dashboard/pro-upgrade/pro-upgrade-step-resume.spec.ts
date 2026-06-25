import { expect, test } from '@playwright/test'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  seedEinAndFiled,
  seedFilingComplete,
} from 'src/helpers/pro-upgrade.helper'

// E2E coverage for the Pro-upgrade wizard's step derivation, resume, and isPro
// routing (ENG-10322 AC #3/#4). The wizard has no server-side session: every
// entry re-derives the resume step from canonical state via
// `deriveProUpgradeStep` (app/dashboard/pro-upgrade/proUpgradeStep.ts). The
// pure function is unit-tested; these tests prove the routing end-to-end.
//
// Each scenario seeds canonical state through the authed `client` (the same
// gp-api endpoints the wizard steps write to) rather than clicking through
// every step, so assertions are fast and independent. `isolated: true` gives
// each test its own user because these mutate campaign-level state (EIN,
// filing, isPro).

const PRO_UPGRADE_PATH = '/dashboard/pro-upgrade'

// The slice of GET /v1/campaigns/mine the no-mutation assertion reads. The
// authed axios `client` is untyped, so annotate the response to avoid `any`.
type CampaignWizardState = {
  isPro?: boolean
  details?: {
    einNumber?: string | null
    hasFiledForRace?: boolean | null
  }
}

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

test.describe('pro-upgrade step derivation & resume', () => {
  test('resumes on the first incomplete step after partial completion', async ({
    page,
  }) => {
    const { user, client } = await authenticateTestUser(page, {
      isolated: true,
    })

    // Seed EIN + the "already filed" answer (its real upstream prerequisite),
    // but no filing details — the first incomplete step is filing-details.
    await seedEinAndFiled(client)

    await page.goto(PRO_UPGRADE_PATH)
    await NavigationHelper.dismissOverlays(page)

    // Re-entry lands on the first incomplete step (filing-details), NOT the
    // value-prop intro — completed prerequisites (EIN) are skipped.
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/filing-details`, {
      timeout: 30_000,
    })
    expect(new URL(page.url()).pathname).toBe(
      `${PRO_UPGRADE_PATH}/filing-details`,
    )

    // Advance the seed: complete the filing-details step via its endpoint. On
    // reload the derived entry must move forward to candidate-profile.
    await seedFilingComplete(client, user.email)

    await page.goto(PRO_UPGRADE_PATH)
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/candidate-profile`, {
      timeout: 30_000,
    })
    expect(new URL(page.url()).pathname).toBe(
      `${PRO_UPGRADE_PATH}/candidate-profile`,
    )
  })

  test('"Maybe later" exits to /dashboard with no state mutation', async ({
    page,
  }) => {
    const { client } = await authenticateTestUser(page, { isolated: true })

    // Fresh campaign with no progress derives to the value-prop intro.
    await page.goto(PRO_UPGRADE_PATH)
    await NavigationHelper.dismissOverlays(page)
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/value-prop`, {
      timeout: 30_000,
    })

    const { data: before } =
      await client.get<CampaignWizardState>('/v1/campaigns/mine')

    await page.getByRole('button', { name: 'Maybe later' }).click()

    await page.waitForURL('**/dashboard', { timeout: 30_000 })
    expect(new URL(page.url()).pathname).toBe('/dashboard')

    // "Maybe later" is a pure navigation — it must not persist anything. Assert
    // the canonical wizard inputs are untouched (no EIN, no filing answer).
    const { data: after } =
      await client.get<CampaignWizardState>('/v1/campaigns/mine')
    expect(after.isPro).toBe(before.isPro)
    expect(after.details?.einNumber).toBe(before.details?.einNumber)
    expect(after.details?.hasFiledForRace).toBe(before.details?.hasFiledForRace)
  })

  // AC #4 (isPro candidate entering the wizard is routed to the post-payment
  // success surface, never to /payment) is intentionally deferred here.
  //
  // `deriveProUpgradeStep` returns SUCCESS the moment `campaign.isPro` is true,
  // but there is no honest way to set `isPro` from this test:
  //   - It is written server-side ONLY by the Stripe `checkout.session.completed`
  //     webhook. The candidate's own `PUT /v1/campaigns/mine` cannot set it
  //     (the update schema has no top-level isPro), and the only direct write,
  //     `PUT /admin/campaigns/:id`, is `@Roles(admin)` — the test user is a
  //     plain candidate, so there is no QA/test API path to force isPro.
  //   - Driving a real Stripe checkout to flip it would additionally require
  //     UI-seeding a complete candidate profile (a 500+ char website bio + a
  //     policy priority) to even reach `/payment`, plus a `@dev-only` tag and
  //     manual Stripe-subscription cleanup. That is the happy-path Pro-upgrade
  //     ticket's flow, not this step-derivation spec.
  //
  // Per ENG-10477's fallback guidance, this is left as a documented TODO rather
  // than faked: once the happy-path Pro-upgrade e2e exists and lands a post-Pro
  // user, assert here that `goto('/dashboard/pro-upgrade')` for that user
  // resolves to `/dashboard/pro-upgrade/success` and never `/payment`. The
  // routing branch itself is unit-covered in proUpgradeStep.test.ts.
  test.fixme('isPro candidate is routed to success, never to /payment', () => {
    throw new Error('deferred — see comment above')
  })
})
