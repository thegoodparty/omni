import { test, expect } from '@playwright/test'

const LAYOUTS = ['newsletter', 'reminder', 'call_to_action']
const THEMES = [
  'classic_blue',
  'fresh_green',
  'warm_sunset',
  'bold_red',
  'cream_and_forest',
]

// The gallery exists only under `next dev`; deployed previews render a
// "Not available" notice, so this runs locally.
test.describe('email template gallery', () => {
  test('renders every layout and theme combination', async ({
    page,
  }, testInfo) => {
    await page.goto('/dev/email-templates')
    const gallery = page.getByTestId('email-template-gallery')
    test.skip(
      !(await gallery.isVisible().catch(() => false)),
      'Dev-only gallery is not served here',
    )

    for (const layout of LAYOUTS) {
      for (const theme of THEMES) {
        const card = page.getByTestId(`email-gallery-${layout}-${theme}`)
        await expect(card).toBeVisible()
        await testInfo.attach(`${layout}-${theme}`, {
          body: await card.screenshot(),
          contentType: 'image/png',
        })
      }
    }
  })
})
