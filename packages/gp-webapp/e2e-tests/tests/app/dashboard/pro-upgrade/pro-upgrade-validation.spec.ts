import { expect, test, type Page } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  seedEinAndFiled,
  seedFilingComplete,
} from 'src/helpers/pro-upgrade.helper'

// Proves the three front-end validation gates actually block advance in the
// live wizard, not just in isolated unit tests (ENG-10479). The wizard's
// client-side validation is the only gate before data goes to the TCR/Peerly
// pipeline (no backend EIN verification — ENG-10330), so an e2e here guards
// against a refactor silently dropping a gate — the "over-mocking hides the
// real guard" trap. Assertions are on the user-visible error copy and the URL
// not advancing, never on validator internals.
//
// Pre-payment only: no Stripe checkout, no webhook, so this runs on every PR
// preview (NOT @dev-only). Each test seeds canonical wizard state through the
// authed `client` (the same gp-api endpoints the wizard steps write to) so it
// lands directly on the step under test instead of clicking through the whole
// flow. `isolated: true` because each seeds campaign-level state (filing
// answer, EIN, filing details) that would leak into a shared cached user.

const PRO_UPGRADE_PATH = '/dashboard/pro-upgrade'

// The slice of GET /v1/campaigns/mine the EIN test reads to confirm a blocked
// attempt did not persist. The authed axios `client` is untyped, so annotate
// the response to avoid `any`.
type CampaignEinState = {
  details?: {
    einNumber?: string | null
  }
}

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

test.describe('pro-upgrade front-end validation gates', () => {
  test('EIN sanity gate blocks a placeholder EIN and a clean EIN advances', async ({
    page,
  }) => {
    const { client } = await authenticateTestUser(page, { isolated: true })

    // Answer "already filed" only (no EIN yet) so step derivation lands on the
    // EIN step — the real upstream prerequisite of that step.
    await client.put('/v1/campaigns/mine', {
      details: { hasFiledForRace: true },
    })

    await page.goto(PRO_UPGRADE_PATH)
    await NavigationHelper.dismissOverlays(page)
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/ein`, { timeout: 30_000 })

    const einField = page.getByLabel('Campaign EIN')
    // 00-0000000 is an all-zero placeholder (checkEinSanity → reason
    // 'placeholder'), so Continue must surface the placeholder copy and stay on
    // the EIN step.
    await einField.fill('00-0000000')
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(
      page.getByText('That looks like a placeholder, not a real EIN.'),
    ).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(`${PRO_UPGRADE_PATH}/ein`)

    // The blocked attempt must not have persisted the bad EIN (Continue returns
    // before updateCampaign when sanity fails).
    const { data: afterBlocked } =
      await client.get<CampaignEinState>('/v1/campaigns/mine')
    expect(afterBlocked.details?.einNumber ?? null).toBeNull()

    // A shape-valid, IRS-prefix EIN passes sanity and advances to filing-details.
    await einField.fill('47-1234567')
    await page.getByRole('button', { name: 'Continue' }).click()

    await page.waitForURL(`**${PRO_UPGRADE_PATH}/filing-details`, {
      timeout: 30_000,
    })
    expect(new URL(page.url()).pathname).toBe(
      `${PRO_UPGRADE_PATH}/filing-details`,
    )
  })

  test('filing-details gate requires email, phone, and a filing address', async ({
    page,
  }) => {
    const { client } = await authenticateTestUser(page, { isolated: true })

    // Seed EIN + "already filed" so derivation lands on filing-details (the EIN
    // step is complete, filing details are not).
    await seedEinAndFiled(client)

    await page.goto(PRO_UPGRADE_PATH)
    await NavigationHelper.dismissOverlays(page)
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/filing-details`, {
      timeout: 30_000,
    })

    // Fill committee name + a valid filing link + email, but leave phone blank.
    // Email + phone are both required (Peerly delivers the PIN to one of them),
    // so submit must be blocked and the summary must name Filing Phone.
    await page.getByLabel('Campaign committee name').fill('Jane for Council')
    await page
      .getByLabel('Campaign filing link')
      .fill('https://sos.wyo.gov/filing/jane-for-council')
    await page.getByPlaceholder('jane@gmail.com').fill('jane@example.com')

    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(
      page.getByText('Please fix the following fields:'),
    ).toBeVisible()
    await expect(page.getByText('Filing Phone')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(
      `${PRO_UPGRADE_PATH}/filing-details`,
    )

    // Fill the phone but leave the address blank. The filing address is now
    // required (the agentic Peerly submission resolves the postal address from
    // it), so submit must still be blocked and the summary must name Filing
    // Address.
    await page.getByPlaceholder('(555) 555-5555').fill('4155551234')

    await page.getByRole('button', { name: 'Continue' }).click()

    // `exact` so this matches only the banner's field label, not the helper
    // copy below the inputs ("Your filing address is required…"), which also
    // contains the phrase (getByText is case-insensitive substring by default).
    await expect(
      page.getByText('Filing Address', { exact: true }),
    ).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(
      `${PRO_UPGRADE_PATH}/filing-details`,
    )
    // This test proves the gate *blocks* (its stated purpose). The happy-path
    // advance is intentionally not asserted here: it would require a live
    // createAgentic submit plus a Google Places selection, and advance-on-valid
    // is already covered by the EIN step (advances to filing-details) and the
    // bio step (advances to payment) in this same file.
  })

  test('bio gate blocks a <500-char bio and a >=500-char bio advances', async ({
    page,
  }) => {
    const { user, client } = await authenticateTestUser(page, {
      isolated: true,
    })

    // Seed EIN + filing-status + a complete filing record so derivation lands
    // directly on candidate-profile (the only remaining incomplete step).
    await seedEinAndFiled(client)
    await seedFilingComplete(client, user.email)

    await page.goto(PRO_UPGRADE_PATH)
    await NavigationHelper.dismissOverlays(page)
    await page.waitForURL(`**${PRO_UPGRADE_PATH}/candidate-profile`, {
      timeout: 30_000,
    })

    // Add a valid policy priority first so the policy-priority gate is satisfied
    // and the bio length is the only thing left blocking advance — this isolates
    // the assertion to the bio gate.
    await addPolicyPriority(page)

    // The bio editor is a Quill contenteditable; target its editable region.
    const bioEditor = page.locator('.ql-editor').first()
    await expect(bioEditor).toBeVisible()

    // A short bio (< 500 plain chars) must block submit with the bio copy and
    // keep the URL on candidate-profile.
    await bioEditor.click()
    await bioEditor.fill('Too short a bio.')
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(
      page.getByText('Your bio requires 500 characters'),
    ).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(
      `${PRO_UPGRADE_PATH}/candidate-profile`,
    )

    // Extend the bio past the 500-char minimum; submit now persists the profile
    // and advances to payment.
    await bioEditor.click()
    await bioEditor.fill('a'.repeat(600))
    await page.getByRole('button', { name: 'Continue' }).click()

    await page.waitForURL(`**${PRO_UPGRADE_PATH}/payment`, { timeout: 30_000 })
    expect(new URL(page.url()).pathname).toBe(`${PRO_UPGRADE_PATH}/payment`)
  })
})

// Adds one policy priority through the modal so the candidate-profile step's
// policy-priority gate is satisfied. The focus field requires >= 100 plain
// chars (MIN_POLICY_FOCUS_LENGTH); the focus editor is the second Quill
// contenteditable mounted (after the page's bio editor).
const addPolicyPriority = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Add a policy priority' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.locator('#policy-title').fill('Lower property taxes')
  const focusEditor = dialog.locator('.ql-editor')
  await focusEditor.click()
  await focusEditor.fill('z'.repeat(120))

  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Edit Lower property taxes' }),
  ).toBeVisible()
}
