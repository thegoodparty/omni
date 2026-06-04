import { test, expect } from '@playwright/test'
import { signIn, TEST_USERS } from './helpers/auth'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TEST_USERS.DEV_ADMIN)
  })

  test('redirects to users page after sign-in', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard\/users/)
    await expect(
      page.getByRole('heading', { name: 'Search Users' })
    ).toBeVisible()
  })

  test('displays user button in header', async ({ page }) => {
    await expect(page.getByRole('button', { name: /user/i })).toBeVisible()
  })

  test('displays organization switcher showing current org', async ({
    page,
  }) => {
    await expect(page.getByText('Development')).toBeVisible()
  })

  test('displays sidebar with navigation', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Members (Internal)' })
    ).toBeVisible()
  })
})
