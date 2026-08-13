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
 * Publishing requires a `user.personId` (the civics-spine link the data platform
 * mints), which a synthetic @test.goodparty.org user is by construction without
 * — so the publish spec below provisions one through the test-only, non-prod,
 * own-record `POST /v1/person-profiles/mine/test-set-person-id`, the same
 * affordance pattern as `test-set-pro` for Pro campaigns. Everything after that
 * is the real flow: the real editor, the real toggle, the real endpoints.
 *
 * What is NOT asserted here is the rendered marketing page. gp-marketing is a
 * separate deployment with no per-PR preview, and `MARKETING_REVALIDATE_URL` is
 * deliberately empty for `preview`, so a PR-preview publish has nowhere to bust.
 * We assert the payload the marketing site consumes instead — the public render
 * gate flipping 404 → 200 → 404. Its rendering is covered on the other side by
 * gp-marketing's peopleProfile.states.test.ts (all 12 profile states) and the
 * revalidation seam by its revalidate-person route test.
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

test('win: publishing from the editor makes the profile public, unpublishing hides it', async ({
  page,
}) => {
  test.setTimeout(180_000)

  const { client } = await authenticateTestUser(page, {
    isolated: true,
    race: { zip: '82001', office: 'Cheyenne City Council - Ward 1' },
  })

  // Stand in for the data platform's mint so the editor unlocks; see the file
  // header. Everything below this line is the production flow.
  const { data: minted } = await client.post<{ personId: string }>(
    '/v1/person-profiles/mine/test-set-person-id',
  )
  expect(minted.personId).toBeTruthy()

  const publicProfile = async (): Promise<number> => {
    const res = await client.get('/v1/public-person-profiles', {
      params: { personId: minted.personId },
      validateStatus: () => true,
    })
    return res.status
  }

  // Nothing published yet, so the marketing render gate must 404 rather than
  // leak a draft.
  expect(await publicProfile()).toBe(404)

  await page.goto(EDITOR_PATH, { waitUntil: 'domcontentloaded' })
  await NavigationHelper.dismissOverlays(page)
  await WaitHelper.waitForPageReady(page)

  await page.getByRole('button', { name: /create my public profile/i }).click()

  const displayName = `E2E Candidate ${minted.personId.slice(0, 8)}`
  await page.getByLabel('Display name').fill(displayName)
  // The editor renders a save button in both the header and the page footer,
  // wired to the same handler, so either satisfies this step.
  await page
    .getByRole('button', { name: /save changes/i })
    .first()
    .click()
  // Publishing races the save otherwise, and the displayName assertion below
  // would then be reading whatever the write had managed to persist.
  await expect(page.getByText('Profile saved.')).toBeVisible()

  // Addressed by testid, not role: the Serve variant of this page also renders a
  // Switch per publishable priority.
  const publishToggle = page.getByTestId('publish-toggle')
  await expect(publishToggle).not.toBeChecked()
  await publishToggle.click()
  await expect(publishToggle).toBeChecked()

  // The gate opened, and it carries what the owner authored — this is the exact
  // payload gp-marketing renders the claimed profile from.
  await expect.poll(publicProfile, { timeout: 30_000 }).toBe(200)
  const { data: live } = await client.get<{
    displayName: string
    publishedAt: string | null
  }>('/v1/public-person-profiles', { params: { personId: minted.personId } })
  expect(live.displayName).toBe(displayName)
  expect(live.publishedAt).not.toBeNull()

  await publishToggle.click()
  await expect(publishToggle).not.toBeChecked()

  // Unpublishing has to close the gate, not merely hide the page in the UI.
  await expect.poll(publicProfile, { timeout: 30_000 }).toBe(404)
})
