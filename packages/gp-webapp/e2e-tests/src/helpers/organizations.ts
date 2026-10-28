import { type Page, expect } from '@playwright/test'
import type { AxiosInstance } from 'axios'
import {
  authenticateTestUser,
  type AuthenticatedUser,
  type TestUserOptions,
} from 'tests/utils/api-registration'
import {
  DEFAULT_TEST_RACE,
  resolveTestRace,
  type TestRace,
  withGatewayRetry,
} from 'tests/utils/headless-user'
import { closeStrayDialog } from 'src/helpers/dashboard'
import { eventually, wait } from 'tests/utils/eventually'

const ORG_SWITCHER_HEADER = '[data-sidebar="header"]'

// Open the org switcher. A stray task modal can be open on the dashboard home;
// while open it aria-hides the page, so the switcher trigger isn't in the
// accessibility tree and the click times out. Retry — closing any open dialog
// each attempt — so a dialog open now or opening late is cleared before the
// click lands. All org-switcher entry points go through this so the guard lives
// in one place.
//
// Each attempt checks for the open menu first. Radix opens it on pointerdown, so
// a click that times out after pressing can still have opened it, and once open
// the menu aria-hides the header: a role-based trigger locator stops resolving
// and every retry would click nothing until the loop gives up. A menu still
// animating out after Escape is visible but data-state="closed", so key on the
// open state rather than visibility.
export const openOrgSwitcher = async (page: Page) => {
  const trigger = page
    .locator(ORG_SWITCHER_HEADER)
    .locator('[aria-haspopup="menu"]')
    .first()
  const menu = page.locator('[role="menu"][data-state="open"]')
  await expect(async () => {
    if (await menu.isVisible()) return
    await closeStrayDialog(page)
    await trigger.click({ timeout: 5_000 })
    await expect(menu).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
}

export const closeOrgSwitcher = async (page: Page) => {
  await page.keyboard.press('Escape')
}

// Drive the "I won" answer for a Pro candidate: the congratulations screen's
// button creates the office unfinished and hands the winner to Serve
// onboarding.
export const winRaceAsPro = async (page: Page): Promise<void> => {
  await page.goto('/dashboard/election-result')
  await wait(250)
  await page
    .getByRole('button', { name: 'I won my race' })
    .click({ timeout: 10_000 })
  await page
    .getByRole('button', { name: 'Start preparing to serve' })
    .click({ timeout: 10_000 })
  await page.waitForURL('**/serve/onboarding', { timeout: 15_000 })
}

type SetupResult = {
  user: AuthenticatedUser
  client: AxiosInstance
}

export const setupElectedOfficeUser = async (
  page: Page,
  raceOptions?: TestUserOptions['race'],
): Promise<SetupResult> => {
  const { user, client } = await authenticateTestUser(page, {
    isolated: true,
    race: raceOptions ?? DEFAULT_TEST_RACE,
  })

  // The "I won" UI is covered by election-result-flow.spec.ts. Everyone else
  // needs only its end state, so make the calls ElectionResultPage makes: the
  // office (pinned to the campaign org by the client's default header), then
  // the won flag. Driving the page and its two calendar dialogs cost ~10s a
  // test across ~45 tests.
  await withGatewayRetry('POST /v1/elected-office', () =>
    client.post('/v1/elected-office', {
      termStartDate: '2023-01-01',
      termEndDate: '2027-01-01',
      onboardingCompletedAt: new Date().toISOString(),
    }),
  )
  await withGatewayRetry('PUT /v1/campaigns/mine', () =>
    client.put('/v1/campaigns/mine', { details: { wonGeneral: true } }),
  )

  const electedOfficeOrgSlug = await eventually(
    { that: 'an elected office organization is created' },
    async () => {
      const { data } = await client.get<{ organizations: { slug: string }[] }>(
        '/v1/organizations',
      )

      const electedOfficeOrg = data.organizations.find((org) =>
        org.slug.startsWith('eo-'),
      )

      if (!electedOfficeOrg) {
        throw new Error('No elected office organization found')
      }

      return electedOfficeOrg.slug
    },
  )
  client.defaults.headers['x-organization-slug'] = electedOfficeOrgSlug

  // The page selects the new org by this cookie, then lands on Chief of Staff.
  await page.context().addCookies([
    {
      name: 'organization-slug',
      value: electedOfficeOrgSlug,
      domain: new URL(page.url()).hostname,
      path: '/',
      sameSite: 'Lax',
    },
  ])
  await page.goto('/dashboard/chief-of-staff')

  return { user, client }
}

// Provision an isolated Win candidate whose campaign is Pro, without the Stripe
// upgrade webhook (which can't reach an ephemeral per-PR preview). Hits the
// test-only POST /v1/campaigns/mine/test-set-pro endpoint (refused on prod /
// non-@test.goodparty.org users). The Contacts pro-gated flows only need a pro
// campaign org, so this replaces the old setupElectedOfficeUser dance — which
// created an elected office under the false belief that winning grants Pro
// (isPro is set only by the Stripe webhook) — and lets those specs run on PR
// previews instead of being stranded @dev-only.
export const setupProCampaignUser = async (
  page: Page,
  raceOptions?: TestUserOptions['race'],
): Promise<SetupResult> => {
  // Default to the same office setupElectedOfficeUser pins: a district with
  // real L2 voter data, so the Contacts surface has rows to exercise.
  const { user, client } = await authenticateTestUser(page, {
    isolated: true,
    race: raceOptions ?? DEFAULT_TEST_RACE,
  })

  await withGatewayRetry('POST /v1/campaigns/mine/test-set-pro', () =>
    client.post('/v1/campaigns/mine/test-set-pro', {}),
  )

  return { user, client }
}

// Build a held-office user whose elected office has a DERIVED termEndAt, so a
// same-office follow-on can in turn derive a future electionDate and the office
// holder is re-election-eligible (eligibility.reelectionOfficeSlug populated).
// The shared api-registration helper creates the campaign from the resolved
// race and stores race.id — a ZipToPosition id — as details.raceId; EO
// term derivation looks the cadence up by Race.brHashId, so that id never
// resolves and termEndAt stays null. Mirror the real onboarding office picker
// instead: hydrate the race via race-by-position (whose data.id IS the
// BallotReady race hash) and repoint details.raceId at it BEFORE winning, so EO
// creation derives the term.
export const setupReelectionEligibleUser = async (
  page: Page,
  raceOptions?: TestRace,
): Promise<AxiosInstance> => {
  const race = raceOptions ?? DEFAULT_TEST_RACE

  const { client } = await authenticateTestUser(page, {
    isolated: true,
    race,
  })

  // The resolved race may already be past; race-by-position hydrates a past
  // date just as well, and only its BallotReady hash is kept.
  const matchedRace = await resolveTestRace(client, race)

  const { data: hydrated } = await client.get<{ id: string }>(
    '/v1/elections/race-by-position',
    {
      params: {
        brPositionId: matchedRace.brPositionId,
        zip: race.zip,
        electionDate: matchedRace.election.electionDay,
      },
    },
  )
  // client header is campaign-<id> after authenticateTestUser, so this repoints
  // the just-created campaign's raceId at the BallotReady race hash.
  await client.put('/v1/campaigns/mine', { details: { raceId: hydrated.id } })

  // A winner who already finished Serve onboarding, made with the calls
  // setupElectedOfficeUser uses: a dated, finished office linked to the
  // campaign, then the won flag. Lands on the Chief of Staff in that office.
  await withGatewayRetry('POST /v1/elected-office', () =>
    client.post('/v1/elected-office', {
      termStartDate: '2023-01-01',
      termEndDate: '2027-01-01',
      onboardingCompletedAt: new Date().toISOString(),
    }),
  )
  await withGatewayRetry('PUT /v1/campaigns/mine', () =>
    client.put('/v1/campaigns/mine', { details: { wonGeneral: true } }),
  )
  await page.goto('/post-auth-redirect?next=/dashboard/chief-of-staff')
  await page.waitForURL('**/dashboard/chief-of-staff', { timeout: 15_000 })

  return client
}

export const switchOrganization = async (
  page: Page,
  orgNameSubstring: string,
) => {
  await openOrgSwitcher(page)

  // Scope to the name span so the secondary "owner · office" line
  // (ENG-11041) can't widen the match — callers pass office-flavored
  // substrings (polls-onboarding passes district.office) that now also
  // appear in other entries' secondary lines. The click bubbles to the
  // menuitem.
  const item = page
    .getByTestId('org-picker-item-name')
    .filter({ hasText: orgNameSubstring })
  await item.click()

  await page.waitForLoadState('domcontentloaded')
}

export const getSelectedOrgName = async (page: Page): Promise<string> => {
  const name = page
    .locator('[data-sidebar="header"]')
    .locator('.font-semibold')
    .first()
  return ((await name.textContent()) ?? '').trim()
}

export const getOrgPickerOptions = async (page: Page): Promise<string[]> => {
  await openOrgSwitcher(page)

  const items = page.getByRole('menuitem')
  await expect(items.first()).toBeVisible()
  const texts: string[] = []
  const count = await items.count()
  for (let i = 0; i < count; i++) {
    // Org entries carry a secondary "owner · office" line (ENG-11041);
    // textContent() would concatenate it onto the name with no separator,
    // producing a string that never matches the item's accessible name.
    // Read just the name span on org entries; other menuitems (the run-for
    // actions) have no such span and keep their full text.
    const nameSpan = items.nth(i).getByTestId('org-picker-item-name')
    const text =
      (await nameSpan.count()) > 0
        ? await nameSpan.textContent()
        : await items.nth(i).textContent()
    texts.push((text ?? '').trim())
  }

  await page.keyboard.press('Escape')

  return texts
}
