import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('redirects unauthenticated user to sign-in page', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL(/\/auth\/sign-in/)
  })

  test('redirects unauthenticated user from dashboard to sign-in page', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    await expect(page).toHaveURL(/\/auth\/sign-in/)
  })
})
