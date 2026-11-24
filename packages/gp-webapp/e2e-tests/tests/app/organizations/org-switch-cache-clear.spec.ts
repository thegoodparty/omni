import { expect, test } from 'src/fixtures/test'
import {
  setupElectedOfficeUser,
  switchOrganization,
  getSelectedOrgName,
  getOrgPickerOptions,
} from 'src/helpers/organizations'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'

// ENG-11670: switching orgs used to invalidate the React Query cache behind a
// predicate that kept four key families, so an org-agnostic entry (Campaign
// Manager's ['campaign-manager', 'chat-history'] among them) was never even
// marked stale and kept serving the previous org. The client now clears the
// cache instead.
//
// A switch taken from a shared path does not reload the page, so the org-scoped
// data a browser already holds has to be re-read in place. This pins that: with
// the same document throughout, a per-org read re-issues under the new org.
test.describe('Organization switch clears the client cache', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('re-reads org data under the new header without a reload', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await setupElectedOfficeUser(page)

    // A shared path: the switcher deliberately does not router.push away from
    // it, so the page, the nav and every provider stay mounted across the
    // switch — the window the old code leaked in.
    await page.goto('/dashboard/profile', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)
    await expect(page).toHaveURL(/\/dashboard\/profile/)

    const eoOrgName = await getSelectedOrgName(page)
    const allOrgs = await getOrgPickerOptions(page)
    const campaignOrgName = allOrgs.find((name) => name !== eoOrgName)
    expect(campaignOrgName).toBeTruthy()

    const readCookie = () =>
      page.evaluate(
        () =>
          document.cookie
            .split('; ')
            .find((cookie) => cookie.startsWith('organization-slug='))
            ?.split('=')[1],
      )
    const slugBefore = await readCookie()
    expect(slugBefore).toBeTruthy()

    // `GET /v1/campaigns/mine` answers for the org the header names, and the
    // campaign context is seeded from the server. It is the read that must
    // follow the switch.
    const campaignReads: (string | undefined)[] = []
    page.on('request', (request) => {
      if (!request.url().includes('/v1/campaigns/mine')) return
      campaignReads.push(request.headers()['x-organization-slug'])
    })

    // A reload replaces `window`. A marker that survives proves the switch was
    // handled entirely by client state, so the assertions below cannot pass by
    // virtue of a fresh document.
    await page.evaluate(() => {
      ;(window as never as { e2eNoReload?: boolean }).e2eNoReload = true
    })

    await switchOrganization(page, campaignOrgName!)

    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as never as { e2eNoReload?: boolean }).e2eNoReload,
          ),
        { timeout: 15_000 },
      )
      .toBe(true)

    const slugCookie = await readCookie()
    expect(slugCookie).toBeTruthy()
    // A real switch: the cookie names a different org than before, and the
    // re-read went out under exactly that one.
    expect(slugCookie).not.toBe(slugBefore)

    await expect
      .poll(() => campaignReads, { timeout: 15_000 })
      .toContain(slugCookie)
  })
})
