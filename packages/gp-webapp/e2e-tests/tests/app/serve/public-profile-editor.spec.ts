import { expect, test } from '@playwright/test'
import { setupElectedOfficeUser } from 'src/helpers/organizations'
import { authenticateTestUser } from 'tests/utils/api-registration'
import { NavigationHelper } from 'src/helpers/navigation.helper'
import { WaitHelper } from 'src/helpers/wait.helper'

/**
 * Live-stack coverage for the /dashboard/public-profile owner editor.
 *
 * What only a browser test can prove here is the *gate + SSR render chain*:
 * a real Clerk session → `publicProfileAccess()` resolving the caller's product
 * (serve vs win) from live gp-api (`elected-office.current` / `campaign.status`)
 * → the page's server-side `GET /v1/person-profiles/mine` fetch → the editor
 * shell rendering (never a bounce to /dashboard). We assert exactly that.
 *
 * We deliberately do NOT drive create/edit/publish here: publishing requires a
 * data-team-minted `user.personId` (the civics-spine link), which the ephemeral
 * per-PR preview never has — so a fresh user always lands in the pre-mint
 * "still setting up" state. The mutation flows are covered end-to-end where they
 * can be exercised deterministically: the write endpoints in the gp-api real-DB
 * e2e (person-profiles.controller*.test.ts) and the serve/win form logic in the
 * component test (PublicProfileEditor.test.tsx).
 */

const EDITOR_PATH = '/dashboard/public-profile'

test('serve: an elected official reaches their public-profile editor (not bounced)', async ({
  page,
}) => {
  test.setTimeout(180_000)

  const { client } = await setupElectedOfficeUser(page)

  await page.goto(EDITOR_PATH, { waitUntil: 'domcontentloaded' })
  await NavigationHelper.dismissOverlays(page)
  await WaitHelper.waitForPageReady(page)

  // Gate passed: publicProfileAccess resolved 'serve' and did not redirect home.
  await expect(page).toHaveURL(/\/dashboard\/public-profile(\/|\?|$)/)

  // The editor shell rendered (h1 is "Your public profile" pre-mint, or
  // "Public profile" once a profile exists — either proves the SSR fetch ran).
  await expect(
    page.getByRole('heading', { level: 1, name: /public profile/i }),
  ).toBeVisible()

  // Same-session API assertion: the page's data source is reachable and returns
  // the owner-scoped shape (canCreate is the publish-eligibility flag).
  const { data } = await client.get<{ canCreate: boolean }>(
    '/v1/person-profiles/mine',
  )
  expect(data).toHaveProperty('canCreate')
  expect(typeof data.canCreate).toBe('boolean')
})

test('win: a candidate reaches their public-profile editor (not bounced)', async ({
  page,
}) => {
  test.setTimeout(180_000)

  // A candidate with a campaign but no elected office resolves to the 'win'
  // product. authenticateTestUser onboards them onto the dashboard.
  await authenticateTestUser(page, {
    isolated: true,
    race: { zip: '82001', office: 'Cheyenne City Council - Ward 1' },
  })

  await page.goto(EDITOR_PATH, { waitUntil: 'domcontentloaded' })
  await NavigationHelper.dismissOverlays(page)
  await WaitHelper.waitForPageReady(page)

  await expect(page).toHaveURL(/\/dashboard\/public-profile(\/|\?|$)/)
  await expect(
    page.getByRole('heading', { level: 1, name: /public profile/i }),
  ).toBeVisible()
})
