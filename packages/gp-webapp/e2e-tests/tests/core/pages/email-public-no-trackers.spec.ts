import { expect, test } from '@playwright/test'

const TRACKER_HOSTS =
  /googletagmanager|google-analytics|visualwebsiteoptimizer|hs-scripts|hubspot|hsforms|segment\.(com|io)|\/mx\/|amplitude/i

test.describe('Email public pages', () => {
  for (const path of [
    '/email/unsubscribe/not-a-real-token.signature',
    '/email/forward-confirm/not-a-real-token',
  ]) {
    test(`${path} loads no third-party trackers`, async ({ page }) => {
      const requests: string[] = []
      page.on('request', (request) => requests.push(request.url()))

      await page.goto(path)
      await page.waitForLoadState('networkidle')

      await expect(page.locator('#vwoCode')).toHaveCount(0)
      await expect(page.locator('#gtm')).toHaveCount(0)
      await expect(page.locator('#hs-script-loader')).toHaveCount(0)
      const html = await page.content()
      expect(html).not.toMatch(/googletagmanager|vwoCode|hs-scripts/)
      expect(requests.filter((url) => TRACKER_HOSTS.test(url))).toEqual([])
    })
  }
})
