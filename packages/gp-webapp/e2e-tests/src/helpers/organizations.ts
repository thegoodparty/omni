import { type Page, expect } from '@playwright/test'
import type { AxiosInstance } from 'axios'
import {
  authenticateTestUser,
  type AuthenticatedUser,
  type TestUserOptions,
} from 'tests/utils/api-registration'
import { closeStrayDialog } from 'src/helpers/dashboard'
import { eventually, wait } from 'tests/utils/eventually'

const ORG_SWITCHER_HEADER = '[data-sidebar="header"]'

// Open the org switcher. A stray task modal can be open on the dashboard home;
// while open it aria-hides the page, so the switcher trigger isn't in the
// accessibility tree and the click times out. Retry — closing any open dialog
// each attempt — so a dialog open now or opening late is cleared before the
// click lands. All org-switcher entry points go through this so the guard lives
// in one place.
export const openOrgSwitcher = async (page: Page) => {
  const trigger = page.locator(ORG_SWITCHER_HEADER).getByRole('button').first()
  await expect(async () => {
    await closeStrayDialog(page)
    await trigger.click({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
}

export const closeOrgSwitcher = async (page: Page) => {
  await page.keyboard.press('Escape')
}

// Pick a date in one term-date popover. The fields are popover calendar pickers
// (stable trigger ids `term-start-date` / `term-end-date`, shared with serve
// onboarding), not free-text inputs. Drive it the way a user would: open the
// popover, navigate via the native month/year dropdowns (selected by option
// value so it's locale-independent), then click the ISO day cell. Mirrors
// serve-onboarding.spec.ts#pickTermDate.
const pickTermDate = async (
  page: Page,
  triggerId: string,
  isoDate: string,
): Promise<void> => {
  const [year, month] = isoDate.split('-')
  await page.locator(`#${triggerId}`).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox').nth(1).selectOption(year!)
  await dialog
    .getByRole('combobox')
    .nth(0)
    .selectOption(String(Number(month) - 1))
  await dialog.locator(`td[data-day="${isoDate}"] button`).click()
  await expect(dialog).toBeHidden()
}

// Drive the "I won" flow end to end: confirm the win, then complete the inline
// term-dates step the flow now requires before the elected office is created
// (so the EO is never left term-date-less / in serve-onboarding limbo). Lands on
// briefings once the office is created.
export const winRaceWithTermDates = async (page: Page): Promise<void> => {
  await page.goto('/dashboard/election-result')
  await wait(250)
  await page
    .getByRole('button', { name: 'I won my race' })
    .click({ timeout: 10_000 })
  await pickTermDate(page, 'term-start-date', '2023-01-01')
  await pickTermDate(page, 'term-end-date', '2027-01-01')
  await page.getByRole('button', { name: /^continue$/i }).click()
  await page.waitForURL('**/dashboard/briefings', { timeout: 15_000 })
}

type SetupResult = {
  user: AuthenticatedUser
  client: AxiosInstance
}

export const setupElectedOfficeUser = async (
  page: Page,
  raceOptions?: TestUserOptions['race'],
): Promise<SetupResult> => {
  const race = raceOptions ?? {
    zip: '82001',
    office: 'Cheyenne City Council - Ward 1',
  }

  const { user, client } = await authenticateTestUser(page, {
    isolated: true,
    race,
  })

  await winRaceWithTermDates(page)

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

  return { user, client }
}

type RaceListItem = {
  id: string
  brPositionId: string
  position: { name: string }
  election: { electionDay: string }
}

const REELECTION_RACE = {
  zip: '82001',
  office: 'Cheyenne City Council - Ward 1',
}

// Build a held-office user whose elected office has a DERIVED termEndAt, so a
// same-office follow-on can in turn derive a future electionDate and the office
// holder is re-election-eligible (eligibility.reelectionOfficeSlug populated).
// The shared api-registration helper creates the campaign straight from
// races-by-year and stores race.id — a ZipToPosition id — as details.raceId; EO
// term derivation looks the cadence up by Race.brHashId, so that id never
// resolves and termEndAt stays null. Mirror the real onboarding office picker
// instead: hydrate the race via race-by-position (whose data.id IS the
// BallotReady race hash) and repoint details.raceId at it BEFORE winning, so EO
// creation derives the term.
export const setupReelectionEligibleUser = async (
  page: Page,
  raceOptions?: { zip: string; office: string },
): Promise<AxiosInstance> => {
  const race = raceOptions ?? REELECTION_RACE

  const { client } = await authenticateTestUser(page, {
    isolated: true,
    race,
  })

  const { data: races } = await client.get<RaceListItem[]>(
    '/v1/elections/races-by-year',
    { params: { zipcode: race.zip } },
  )
  const matchedRace = races.find((r) => r.position.name === race.office)
  if (!matchedRace) throw new Error(`Race not found: ${race.office}`)

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

  // Win the race -> create the elected office (term dates entered inline).
  await winRaceWithTermDates(page)

  return client
}

export const switchOrganization = async (
  page: Page,
  orgNameSubstring: string,
) => {
  await openOrgSwitcher(page)

  const item = page.getByRole('menuitem', { name: orgNameSubstring })
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
    const text = await items.nth(i).textContent()
    texts.push((text ?? '').trim())
  }

  await page.keyboard.press('Escape')

  return texts
}
