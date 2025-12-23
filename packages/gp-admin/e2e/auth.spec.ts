import { test, expect } from '@playwright/test'

test.describe('Authentication (mock mode)', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      {
        name: '__e2e_bypass',
        value: 'true',
        domain: 'localhost',
        path: '/',
      },
    ])
  })

  test('root redirects to dashboard in test mode', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('dashboard is accessible in test mode', async ({ page }) => {
    await page.goto('/dashboard')

    await expect(page).toHaveURL(/\/dashboard/)
  })
})
