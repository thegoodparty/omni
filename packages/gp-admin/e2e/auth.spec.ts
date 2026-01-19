import { test, expect } from '@playwright/test'
import { signIn, TEST_USERS } from './helpers/auth'

test.describe('Authentication', () => {
  test('unauthenticated user visiting root is redirected to sign-in', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL(/\/auth\/sign-in/)
  })

  test('unauthenticated user visiting dashboard is redirected to sign-in', async ({ page }) => {
    await page.goto('/dashboard')

    await expect(page).toHaveURL(/\/auth\/sign-in/)
  })

  test('unauthenticated user visiting protected route is redirected to sign-in', async ({
    page,
  }) => {
    await page.goto('/dashboard/members')

    await expect(page).toHaveURL(/\/auth\/sign-in/)
  })

  test('authenticated user can sign in and access dashboard', async ({ page }) => {
    await signIn(page, TEST_USERS.DEV_ADMIN)

    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByRole('heading', { name: 'Dashboard Page' })).toBeVisible()
  })

  test('sign-in page is accessible without authentication', async ({ page }) => {
    await page.goto('/auth/sign-in')

    await expect(page).toHaveURL(/\/auth\/sign-in/)
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible()
  })
})
