import { expect, type Page, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import {
  createServeLeadUser,
  createServeMagicLink,
  mintServeTicket,
  buildServeWelcomeUrl,
  redeemServeTicket,
  seedPrefilledElectedOffice,
} from 'src/helpers/serve.helper'
import { wait } from 'tests/utils/eventually'

/**
 * End-to-end coverage for the elected-official ("serve") magic-link onboarding
 * flow. Both branches the flow supports are exercised:
 *
 *  - **net-new**  — a brand-new lead with no prefill redeems the ticket, then
 *    enters everything fresh: welcome → inOffice → party → office → term-dates →
 *    constituents → pledge.
 *  - **prefill**  — a lead whose `ElectedOffice` is pre-seeded (office + term
 *    dates, no `selfReported` marker) gets the "Does this look right?" Confirm
 *    hub instead of the office picker: welcome → inOffice → party → confirm →
 *    constituents → pledge.
 *
 * The ticket is minted directly with the Clerk test-instance secret (see
 * `src/helpers/serve.helper.ts`) rather than via the admin/M2M magic-link
 * endpoint, which the harness can't authenticate to.
 *
 * Selectors deliberately target step *content* (headings, option cards, the
 * footer Continue/Agree button) — never the serve header/footer chrome or
 * analytics — so they stay green under the sibling chrome/analytics PRs.
 */

// Cheyenne, WY — the zip the WIN onboarding spec uses; reliably returns offices
// from the elections API in every environment.
const OFFICE_ZIP = '82001'

// Shared partisan-block copy (source of truth:
// app/onboarding/shared/partisanParty.tsx MAJOR_PARTY_BLOCK_MESSAGE). Matched as
// a substring so minor wording tweaks don't break the assertion. App modules
// can't be imported into the e2e workspace (see e2e-tests/CLAUDE.md).
const MAJOR_PARTY_BLOCK_SUBSTRING = /only for non-partisan and independent/i

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

const continueButton = (page: Page) =>
  page.getByRole('button', { name: /^continue$/i })

async function clickContinue(page: Page): Promise<void> {
  const button = continueButton(page)
  await expect(button).toBeVisible({ timeout: 15_000 })
  await expect(button).toBeEnabled({ timeout: 15_000 })
  await button.click()
}

async function completeWelcomeStep(page: Page): Promise<void> {
  console.log('Serve step: welcome')
  await expect(
    page.getByRole('heading', { level: 1, name: /chief of staff/i }),
  ).toBeVisible({ timeout: 30_000 })
  await clickContinue(page)
}

async function completeInOfficeStep(page: Page): Promise<void> {
  console.log('Serve step: in office')
  await expect(
    page.getByRole('heading', { level: 1, name: /already in office/i }),
  ).toBeVisible()
  await page.getByRole('button', { name: /i'm an elected official/i }).click()
  await clickContinue(page)
}

/**
 * The party step. When `assertMajorPartyBlock` is set, first verify that picking
 * a major party (Democrat) surfaces the blocking alert and disables Continue
 * (#254 parity), then recover by choosing a non-major party so the flow can
 * proceed.
 */
async function completePartyStep(
  page: Page,
  { assertMajorPartyBlock = false }: { assertMajorPartyBlock?: boolean } = {},
): Promise<void> {
  console.log('Serve step: party')
  await expect(
    page.getByRole('heading', { level: 1, name: /party designation/i }),
  ).toBeVisible()

  if (assertMajorPartyBlock) {
    await page.getByRole('button', { name: /serving as a democrat/i }).click()
    await expect(page.getByText(MAJOR_PARTY_BLOCK_SUBSTRING)).toBeVisible()
    await expect(continueButton(page)).toBeDisabled()
  }

  await page
    .getByRole('button', { name: /independent \/ non-major party/i })
    .click()
  await expect(page.getByText(MAJOR_PARTY_BLOCK_SUBSTRING)).toBeHidden()
  await clickContinue(page)
}

async function completeOfficeStep(page: Page): Promise<void> {
  console.log('Serve step: office (net-new picker)')
  await expect(
    page.getByRole('heading', { level: 1, name: /what office do you/i }),
  ).toBeVisible()

  await page.getByLabel(/zip code/i).fill(OFFICE_ZIP)
  await page.getByRole('button', { name: /^search$/i }).click()

  const officeGroup = page.getByRole('radiogroup', {
    name: /available offices/i,
  })
  await officeGroup
    .getByRole('radio')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
  await officeGroup.getByRole('radio').first().click()

  // Let the selection settle before the save-on-Continue fires.
  await wait(1_000)
  await clickContinue(page)
}

async function completeTermDatesStep(page: Page): Promise<void> {
  console.log('Serve step: term dates')
  await expect(
    page.getByRole('heading', { level: 1, name: /when does your term run/i }),
  ).toBeVisible()

  // Two DateInputCalendar text inputs (start, end); both share the
  // `mm/dd/yyyy` placeholder. Typed MM/dd/yyyy is parsed on change.
  const dateInputs = page.getByPlaceholder('mm/dd/yyyy')
  await dateInputs.first().fill('01/01/2023')
  await dateInputs.nth(1).fill('01/01/2027')

  await clickContinue(page)
}

async function completeConstituentsStep(page: Page): Promise<void> {
  console.log('Serve step: constituents')
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /everything to know about your constituents/i,
    }),
  ).toBeVisible({ timeout: 30_000 })
  await clickContinue(page)
}

async function completePledgeStep(page: Page): Promise<void> {
  console.log('Serve step: pledge')
  await expect(
    page.getByRole('heading', { level: 1, name: /take our pledge/i }),
  ).toBeVisible()
  const submit = page.getByRole('button', { name: /agree & continue/i })
  await expect(submit).toBeEnabled({ timeout: 15_000 })
  await submit.click()
  // Completion pins the EO org and routes through /post-auth-redirect to the
  // serve dashboard.
  await page.waitForURL(/\/dashboard(\/|$)/, { timeout: 60_000 })
}

test('serve onboarding — net-new branch via magic link', async ({ page }) => {
  const { user, welcomeUrl } = await createServeMagicLink()
  console.log(`Net-new serve lead: ${user.email}`)

  await redeemServeTicket(page, welcomeUrl)

  await completeWelcomeStep(page)
  await completeInOfficeStep(page)
  await completePartyStep(page, { assertMajorPartyBlock: true })
  await completeOfficeStep(page)
  await completeTermDatesStep(page)
  await completeConstituentsStep(page)
  await completePledgeStep(page)

  expect(page.url()).toMatch(/\/dashboard(\/|$)/)
  console.log(`Net-new serve onboarding complete: ${page.url()}`)
})

test('serve onboarding — prefilled confirm branch via magic link', async ({
  page,
}) => {
  // Seed the EO BEFORE minting the ticket so the flow resolves branch=prefill.
  // A custom office name + term dates (no `selfReported` marker) is the minimal
  // seed that makes the Confirm step appear and be continuable without a
  // BallotReady lookup (unstable in the ephemeral per-PR preview env).
  const user = await createServeLeadUser()
  console.log(`Prefill serve lead: ${user.email}`)

  await seedPrefilledElectedOffice(user, {
    positionName: 'Governor of Maryland',
    termStartDate: '2023-01-18',
    termEndDate: '2027-01-20',
  })

  const ticket = await mintServeTicket(user.clerkUserId)
  await redeemServeTicket(page, buildServeWelcomeUrl(ticket))

  await completeWelcomeStep(page)
  await completeInOfficeStep(page)
  await completePartyStep(page)

  // The prefilled office name surfaces on the Confirm hub before we confirm it.
  await expect(
    page.getByRole('heading', { level: 1, name: /does this look right/i }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Governor of Maryland')).toBeVisible()
  await clickContinue(page)

  await completeConstituentsStep(page)
  await completePledgeStep(page)

  expect(page.url()).toMatch(/\/dashboard(\/|$)/)
  console.log(`Prefill serve onboarding complete: ${page.url()}`)
})
