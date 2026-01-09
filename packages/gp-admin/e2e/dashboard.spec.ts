import { test, expect } from '@playwright/test'
import { signIn } from './helpers/auth'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('authenticated user can view dashboard', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(
      page.getByRole('heading', { name: 'Dashboard Page' })
    ).toBeVisible()
  })

  test('dashboard shows user button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /user/i })).toBeVisible()
  })
})
