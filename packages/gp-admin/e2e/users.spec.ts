import { test, expect, Page } from '@playwright/test'
import { signIn, TEST_USERS } from './helpers/auth'

const LOCATORS = {
  emailInput: (page: Page) => page.getByPlaceholder('Enter email address...'),
  firstNameInput: (page: Page) => page.getByPlaceholder('Enter first name...'),
  lastNameInput: (page: Page) => page.getByPlaceholder('Enter last name...'),
  clearButton: (page: Page) => page.getByRole('button', { name: 'Clear' }),
  emailModeButton: (page: Page) => page.getByRole('radio', { name: 'Email' }),
  nameModeButton: (page: Page) => page.getByRole('radio', { name: 'Name' }),
  resultsTable: (page: Page) => page.getByRole('table'),
  proAllButton: (page: Page) => page.getByRole('radio', { name: 'All' }),
  proYesButton: (page: Page) =>
    page.getByRole('radio', { name: 'Pro', exact: true }),
  proNoButton: (page: Page) => page.getByRole('radio', { name: 'Not Pro' }),
}

test.describe('Users Page', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TEST_USERS.DEV_ADMIN)
    await page.goto('/dashboard/users')
  })

  test('displays users page with search form', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Search Users' })
    ).toBeVisible()
    await expect(page.getByText('Search by')).toBeVisible()
    await expect(LOCATORS.emailModeButton(page)).toBeVisible()
    await expect(LOCATORS.nameModeButton(page)).toBeVisible()
  })

  test('shows email input by default', async ({ page }) => {
    await expect(LOCATORS.emailInput(page)).toBeVisible()
  })

  test('switches to name search mode', async ({ page }) => {
    await LOCATORS.nameModeButton(page).click()

    await expect(LOCATORS.firstNameInput(page)).toBeVisible()
    await expect(LOCATORS.lastNameInput(page)).toBeVisible()
  })

  test('auto-searches after typing in name fields', async ({ page }) => {
    await LOCATORS.nameModeButton(page).click()
    await LOCATORS.firstNameInput(page).fill('John')

    await expect(page).toHaveURL(/first_name=John/)
  })
})

test.describe('Users Search - Email', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TEST_USERS.DEV_ADMIN)
    await page.goto('/dashboard/users')
  })

  test('searching by email updates URL and shows loading', async ({ page }) => {
    await LOCATORS.emailInput(page).fill('tomer@goodparty.org')

    await expect(page).toHaveURL(/email=tomer%40goodparty\.org/)
    await expect(page.getByText('Searching...')).toBeVisible()
  })

  test('email search displays result in table', async ({ page }) => {
    await LOCATORS.emailInput(page).fill('tomer@goodparty.org')

    await expect(page).toHaveURL(/email=tomer%40goodparty\.org/)
    await expect(LOCATORS.resultsTable(page)).toBeVisible({ timeout: 15000 })
    await expect(
      page.getByRole('cell', { name: 'Tomer Almog' }).first()
    ).toBeVisible()
    await expect(
      page.getByRole('cell', { name: 'tomer@goodparty.org' }).first()
    ).toBeVisible()
  })
})

test.describe('Users Search - Name', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TEST_USERS.DEV_ADMIN)
    await page.goto('/dashboard/users')
  })

  test('searching by name updates URL with query params', async ({ page }) => {
    await LOCATORS.nameModeButton(page).click()
    await LOCATORS.firstNameInput(page).fill('Tomer')
    await LOCATORS.lastNameInput(page).fill('Almog')

    await expect(page).toHaveURL(/first_name=Tomer/)
    await expect(page).toHaveURL(/last_name=Almog/)
  })

  test('name search displays results table', async ({ page }) => {
    await LOCATORS.nameModeButton(page).click()
    await LOCATORS.firstNameInput(page).fill('Tomer')
    await LOCATORS.lastNameInput(page).fill('Almog')

    await expect(page).toHaveURL(/first_name=Tomer/)
    await expect(page).toHaveURL(/last_name=Almog/)
    await expect(LOCATORS.resultsTable(page)).toBeVisible({ timeout: 15000 })

    await expect(page.getByRole('columnheader', { name: 'ID' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible()
    await expect(
      page.getByRole('columnheader', { name: 'Email' })
    ).toBeVisible()
    await expect(
      page.getByRole('columnheader', { name: 'Phone' })
    ).toBeVisible()

    const tomerRow = page
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: 'Tomer Almog' }) })
      .first()
    await expect(tomerRow).toBeVisible()
    await expect(tomerRow.getByRole('cell').nth(2)).toContainText(/@/)
  })

  test('clicking user name navigates to user detail', async ({ page }) => {
    await LOCATORS.nameModeButton(page).click()
    await LOCATORS.firstNameInput(page).fill('Tomer')
    await LOCATORS.lastNameInput(page).fill('Almog')

    await expect(page).toHaveURL(/first_name=Tomer/)
    await expect(page).toHaveURL(/last_name=Almog/)
    await expect(LOCATORS.resultsTable(page)).toBeVisible({ timeout: 15000 })
    await page.getByRole('link', { name: 'Tomer Almog' }).first().click()

    await expect(page).toHaveURL(/\/dashboard\/users\/\d+/)
  })
})

test.describe('Users Search - Clear', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TEST_USERS.DEV_ADMIN)
    await page.goto('/dashboard/users')
  })

  test('clear button appears when form has input', async ({ page }) => {
    await expect(LOCATORS.clearButton(page)).not.toBeVisible()

    await LOCATORS.emailInput(page).fill('test@example.com')

    await expect(LOCATORS.clearButton(page)).toBeVisible()
  })

  test('clear button resets form and URL', async ({ page }) => {
    await page.goto('/dashboard/users?email=test@example.com')

    await LOCATORS.clearButton(page).click()

    await expect(page).toHaveURL('/dashboard/users')
    await expect(LOCATORS.emailInput(page)).toHaveValue('')
  })
})

test.describe('Users Search - Pro filter', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TEST_USERS.DEV_ADMIN)
    await page.goto('/dashboard/users')
  })

  test('renders Pro status segmented control with All/Pro/Not Pro', async ({
    page,
  }) => {
    await expect(page.getByText('Pro status')).toBeVisible()
    await expect(LOCATORS.proAllButton(page)).toBeVisible()
    await expect(LOCATORS.proYesButton(page)).toBeVisible()
    await expect(LOCATORS.proNoButton(page)).toBeVisible()
  })

  test('selecting Pro sets is_pro=true in URL', async ({ page }) => {
    await LOCATORS.proYesButton(page).click()
    await expect(page).toHaveURL(/is_pro=true/)
  })

  test('selecting Not Pro sets is_pro=false in URL', async ({ page }) => {
    await LOCATORS.proNoButton(page).click()
    await expect(page).toHaveURL(/is_pro=false/)
  })

  test('selecting All removes the is_pro param', async ({ page }) => {
    await LOCATORS.proYesButton(page).click()
    await expect(page).toHaveURL(/is_pro=true/)
    await LOCATORS.proAllButton(page).click()
    await expect(page).not.toHaveURL(/is_pro=/)
  })

  test('Pro filter combines with email filter in URL', async ({ page }) => {
    await LOCATORS.emailInput(page).fill('tomer@goodparty.org')
    await LOCATORS.proYesButton(page).click()
    await expect(page).toHaveURL(/email=tomer%40goodparty\.org/)
    await expect(page).toHaveURL(/is_pro=true/)
  })

  test('Clear resets Pro filter back to All', async ({ page }) => {
    await page.goto('/dashboard/users?is_pro=true')
    await LOCATORS.clearButton(page).click()
    await expect(page).toHaveURL('/dashboard/users')
    await expect(LOCATORS.proAllButton(page)).toBeChecked()
  })
})
