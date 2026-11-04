import { test, expect } from '@playwright/test'

const LAYOUTS = ['short_cta', 'long_update', 'personal_letter']
const MODES = ['win', 'serve']

// The gallery exists only under `next dev`; deployed previews render a
// "Not available" notice, so this runs locally.
test.describe('email template gallery', () => {
  test('renders the Win and Serve example for every layout', async ({
    page,
  }, testInfo) => {
    await page.goto('/dev/email-templates')
    const gallery = page.getByTestId('email-template-gallery')
    test.skip(
      !(await gallery.isVisible().catch(() => false)),
      'Dev-only gallery is not served here',
    )

    for (const layout of LAYOUTS) {
      for (const mode of MODES) {
        const card = page.getByTestId(`email-gallery-${layout}-${mode}`)
        await expect(card).toBeVisible()
        await expect(card.locator('iframe')).toBeVisible()
        await testInfo.attach(`${layout}-${mode}`, {
          body: await card.screenshot(),
          contentType: 'image/png',
        })
      }
    }
  })
})
