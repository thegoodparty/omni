import { test, expect } from '@playwright/test'
import { signIn, TEST_USERS } from './helpers/auth'

test.describe('Role-Based Access Control', () => {
  test.describe('Admin Role', () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page, TEST_USERS.DEV_ADMIN)
    })

    test('admin sees navigation items', async ({ page }) => {
      await expect(page.getByRole('link', { name: 'Users' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Campaigns' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Members' })).toBeVisible()
    })

    test('admin can access members page', async ({ page }) => {
      await page.goto('/dashboard/members')

      await expect(page).toHaveURL(/\/dashboard\/members/)
    })
  })

  test.describe('Sales Role', () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page, TEST_USERS.DEV_SALES)
    })

    test('sales cannot access members page - redirects to dashboard', async ({ page }) => {
      await page.goto('/dashboard/members')

      await expect(page).toHaveURL(/\/dashboard$/)
    })
  })

  test.describe('Read Only Role', () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page, TEST_USERS.DEV_READONLY)
    })

    test('readonly cannot access members page - redirects to dashboard', async ({ page }) => {
      await page.goto('/dashboard/members')

      await expect(page).toHaveURL(/\/dashboard$/)
    })
  })
})

test.describe('Multi-Organization User', () => {
  test('is signed in to an organization', async ({ page }) => {
    await signIn(page, TEST_USERS.MULTI_ORG)

    await expect(page.getByText(/Development|QA|Production/)).toBeVisible()
  })
})
