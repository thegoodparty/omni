import { expect, test } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  setupReelectionEligibleUser,
  openOrgSwitcher,
  closeOrgSwitcher,
} from 'src/helpers/organizations'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { eventually } from 'tests/utils/eventually'

// Locks down the org switcher's eligibility-gated states (ENG-10389 task 10):
// the "run for" actions are gated on eligibility.canStartCampaign, "Run for
// re-election" additionally on reelectionOfficeSlug, and concluded orgs render
// with a "Past" label. org-switcher.spec.ts only covers the two-org happy path;
// this spec asserts the gated rendering and the action routing params directly,
// without driving a full follow-on.

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

test('active-campaign user sees no run-for actions in the switcher', async ({
  page,
}) => {
  // authenticateTestUser creates and launches a campaign for a future race, so
  // the user has an active campaign and canStartCampaign is false.
  await authenticateTestUser(page)

  // OrganizationPicker fetches eligibility in a separate query with no SSR
  // initialData, so the gated actions are absent until that request settles.
  // Asserting their absence before then would pass vacuously (they simply
  // haven't rendered yet). Wait for the eligibility response so the absence
  // assertions reflect the resolved canStartCampaign:false state and a
  // regression flipping it to true would actually surface.
  const eligibilitySettled = page.waitForResponse(
    (r) => r.url().includes('/v1/eligibility') && r.ok(),
  )
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  await eligibilitySettled
  await NavigationHelper.dismissOverlays(page)
  await openOrgSwitcher(page)

  const orgItems = page.getByRole('menuitem')
  await expect(orgItems.first()).toBeVisible({ timeout: 15_000 })

  // the active campaign org shows normally — no "Past" label.
  await expect(
    page.getByRole('menuitem').filter({ hasText: 'Past' }),
  ).toHaveCount(0)

  // eligibility has resolved, so the dropdown reflects canStartCampaign:false —
  // neither gated action renders.
  await expect(
    page.getByRole('menuitem', { name: 'Run for re-election' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('menuitem', { name: 'Run for a new office' }),
  ).toHaveCount(0)
  await closeOrgSwitcher(page)
})

// setupReelectionEligibleUser reads BallotReady election data (the shared dev
// election-api, reachable from a preview) and creates the elected office via
// gp-api API calls (no inbound infra), so a preview runs it. It never touches
// the next-election path, so the unpopulated-placeId gap that breaks follow-on
// doesn't affect this eligibility + action-routing assertion.
test('held-office user sees Past label and both run-for actions', async ({
  page,
}) => {
  test.setTimeout(180_000)

  const client = await setupReelectionEligibleUser(page)

  const { eoOrg, wonCampaignOrg } = await eventually(
    { that: 'the elected office and won campaign orgs exist' },
    async () => {
      const { data } = await client.get<{
        organizations: { slug: string; name: string }[]
      }>('/v1/organizations')
      const eoOrg = data.organizations.find((o) => o.slug.startsWith('eo-'))
      const wonCampaignOrg = data.organizations.find((o) =>
        o.slug.startsWith('campaign-'),
      )
      if (!eoOrg) throw new Error('No elected office org after setup')
      if (!wonCampaignOrg) throw new Error('No won campaign org after setup')
      return { eoOrg, wonCampaignOrg }
    },
  )

  // "I won my race" launches the won campaign with a still-future electionDate,
  // so it reads "active" and canStartCampaign stays false (actions hidden).
  // Backdate it (the production state once the election has happened) so the won
  // campaign reads "Past" and eligibility opens. PUT /v1/campaigns/mine merges
  // details and resolves the campaign from x-organization-slug.
  client.defaults.headers['x-organization-slug'] = wonCampaignOrg.slug
  await client.put('/v1/campaigns/mine', {
    details: { electionDate: '2020-11-03' },
  })

  // produced state: the won campaign reads "past", the held office reads
  // "active". eventually() because the backdate write settles asynchronously.
  await eventually(
    { that: 'the won campaign reads past and the office reads active' },
    async () => {
      const { data } = await client.get<{
        organizations: { slug: string; status: string }[]
      }>('/v1/organizations')
      const won = data.organizations.find((o) => o.slug === wonCampaignOrg.slug)
      const eo = data.organizations.find((o) => o.slug === eoOrg.slug)
      if (won?.status !== 'past') {
        throw new Error(`won campaign status is ${won?.status}, not past`)
      }
      if (eo?.status !== 'active') {
        throw new Error(`elected office status is ${eo?.status}, not active`)
      }
    },
  )

  // reload so the picker's org-list and eligibility queries refetch.
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  await NavigationHelper.dismissOverlays(page)
  await openOrgSwitcher(page)

  // exactly one org is labeled "Past" (the won campaign); the held office is the
  // only other org and is not labeled. toHaveCount polls because the switcher
  // refetches the org list independently of the API calls above.
  await expect(
    page.getByRole('menuitem').filter({ hasText: 'Past' }),
  ).toHaveCount(1, { timeout: 15_000 })
  await expect(
    page.getByRole('menuitem').filter({ hasText: eoOrg.name }),
  ).toBeVisible()

  // both gated actions render for a re-election-eligible office holder.
  const reelectionAction = page.getByRole('menuitem', {
    name: 'Run for re-election',
  })
  await expect(reelectionAction).toBeVisible()
  await expect(
    page.getByRole('menuitem', { name: 'Run for a new office' }),
  ).toBeVisible()

  // re-election routes to office-selection with same-office intent and the held
  // office's slug as `from`.
  await reelectionAction.click()
  await expect(page).toHaveURL(
    new RegExp(
      `/onboarding/office-selection\\?intent=same-office&from=${eoOrg.slug}$`,
    ),
    { timeout: 15_000 },
  )

  // new-office routes with new-office intent and no `from`.
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  await NavigationHelper.dismissOverlays(page)
  await openOrgSwitcher(page)
  await page.getByRole('menuitem', { name: 'Run for a new office' }).click()
  await expect(page).toHaveURL(
    /\/onboarding\/office-selection\?intent=new-office$/,
    { timeout: 15_000 },
  )
})
