import { expect, test } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from '../../../src/helpers/navigation.helper'

test.describe('Account settings name', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('edits the name in-app and keeps it out of the Clerk profile modal', async ({
    page,
  }) => {
    test.setTimeout(120000)
    const { client } = await authenticateTestUser(page, { isolated: true })

    await page.goto('/dashboard/account')
    await NavigationHelper.dismissOverlays(page)

    await page.getByRole('button', { name: 'Edit details' }).click()
    const dialog = page.getByRole('dialog', { name: "What's your name?" })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('First name').fill('Renamed')
    await dialog.getByLabel('Last name').fill('Person')
    await dialog.getByRole('button', { name: 'Save name' }).click()
    await expect(dialog).toBeHidden()

    await expect(page.getByText('Renamed', { exact: true })).toBeVisible()
    await expect(page.getByTestId('user-menu-name')).toHaveText(
      /Renamed\s+Person/,
    )
    const { data: me } = await client.get<{
      firstName: string
      lastName: string
      name: string
    }>('/v1/users/me')
    expect(me).toMatchObject({
      firstName: 'Renamed',
      lastName: 'Person',
      name: 'Renamed Person',
    })

    await page.getByRole('button', { name: 'Manage sign-in' }).click()
    await expect(
      page.locator('.cl-profileSection__emailAddresses'),
    ).toBeVisible({ timeout: 20000 })
    await expect(page.locator('.cl-profileSection__profile')).toBeHidden()
  })
})
