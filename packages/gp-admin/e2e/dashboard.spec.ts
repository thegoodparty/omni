import { test, expect } from '@playwright/test'
import { setE2EBypassCookie } from './helpers/auth'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ context }) => {
    await setE2EBypassCookie(context)
  })

  test('authenticated user can view dashboard', async ({ page }) => {
    await page.goto('/dashboard')

    await expect(page).toHaveURL(/\/dashboard/)
    await expect(
      page.getByRole('heading', { name: 'Dashboard Page' })
    ).toBeVisible()
  })

  test('dashboard shows mock user button in test mode', async ({ page }) => {
    await page.goto('/dashboard')

    await expect(page.getByTestId('mock-user-button')).toBeVisible()
  })
})
