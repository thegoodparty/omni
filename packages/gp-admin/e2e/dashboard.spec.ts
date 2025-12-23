import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
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
