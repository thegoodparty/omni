import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'

test.describe('Authentication', () => {
  test('can sign in and access dashboard', async ({ page }) => {
    await signIn(page)

    await expect(page).toHaveURL(/\/dashboard/)
    await expect(
      page.getByRole('heading', { name: 'Dashboard Page' })
    ).toBeVisible()
  })

  test('unauthenticated user is redirected to sign-in', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL(/\/auth\/sign-in/)
  })
})
