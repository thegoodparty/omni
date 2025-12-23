import { test, expect } from '@playwright/test'
import { setE2EBypassCookie } from './helpers/auth'

test.describe('Authentication (mock mode)', () => {
  test.beforeEach(async ({ context }) => {
    await setE2EBypassCookie(context)
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
