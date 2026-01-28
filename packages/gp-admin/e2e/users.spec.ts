import { test, expect, Page } from '@playwright/test'
import { signIn, TEST_USERS } from './helpers/auth'

// TODO: Replace stubbed data with real API responses when backend is ready
// TODO: Update stub data assertions when real data is available

const LOCATORS = {
  emailInput: (page: Page) => page.getByPlaceholder('Enter email address...'),
  firstNameInput: (page: Page) => page.getByPlaceholder('Enter first name...'),
  lastNameInput: (page: Page) => page.getByPlaceholder('Enter last name...'),
  searchButton: (page: Page) => page.getByRole('button', { name: 'Search' }),
  clearButton: (page: Page) => page.getByRole('button', { name: 'Clear' }),
  emailModeButton: (page: Page) => page.getByRole('radio', { name: 'Email' }),
  nameModeButton: (page: Page) => page.getByRole('radio', { name: 'Name' }),
  resultsTable: (page: Page) => page.getByRole('table'),
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

  test('search button is disabled without valid input', async ({ page }) => {
    await expect(LOCATORS.searchButton(page)).toBeDisabled()
  })

  test('shows validation error for invalid email', async ({ page }) => {
    await LOCATORS.emailInput(page).fill('invalid-email')

    await expect(
      page.getByText('Please enter a valid email address')
    ).toBeVisible()
    await expect(LOCATORS.searchButton(page)).toBeDisabled()
  })

  test('enables search button with valid email', async ({ page }) => {
    await LOCATORS.emailInput(page).fill('test@example.com')

    await expect(LOCATORS.searchButton(page)).toBeEnabled()
  })

  test('shows validation error for short name', async ({ page }) => {
    await LOCATORS.nameModeButton(page).click()
    await LOCATORS.firstNameInput(page).fill('J')

    await expect(page.getByText('Must be at least 2 characters')).toBeVisible()
  })

  test('enables search button with valid name inputs', async ({ page }) => {
    await LOCATORS.nameModeButton(page).click()
    await LOCATORS.firstNameInput(page).fill('John')
    await LOCATORS.lastNameInput(page).fill('Doe')

    await expect(LOCATORS.searchButton(page)).toBeEnabled()
  })
})

test.describe('Users Search - Email', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TEST_USERS.DEV_ADMIN)
    await page.goto('/dashboard/users')
  })

  test('searching by email updates URL and shows loading', async ({ page }) => {
    await LOCATORS.emailInput(page).fill('john.doe@example.com')
    await LOCATORS.searchButton(page).click()

    await expect(page).toHaveURL(/email=john\.doe%40example\.com/)
    await expect(page.getByText('Searching...')).toBeVisible()
  })

  test('email search displays single result in table', async ({ page }) => {
    await LOCATORS.emailInput(page).fill('john.doe@example.com')
    await LOCATORS.searchButton(page).click()

    await expect(LOCATORS.resultsTable(page)).toBeVisible()
    await expect(page.getByRole('cell', { name: 'John Doe' })).toBeVisible()
    await expect(
      page.getByRole('cell', { name: 'john.doe@example.com' })
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
    await LOCATORS.firstNameInput(page).fill('John')
    await LOCATORS.lastNameInput(page).fill('Doe')
    await LOCATORS.searchButton(page).click()

    await expect(page).toHaveURL(/first_name=John/)
    await expect(page).toHaveURL(/last_name=Doe/)
  })

  test('name search displays results table', async ({ page }) => {
    await LOCATORS.nameModeButton(page).click()
    await LOCATORS.firstNameInput(page).fill('John')
    await LOCATORS.lastNameInput(page).fill('Doe')
    await LOCATORS.searchButton(page).click()

    await expect(LOCATORS.resultsTable(page)).toBeVisible()

    await expect(page.getByRole('columnheader', { name: 'ID' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible()
    await expect(
      page.getByRole('columnheader', { name: 'Email' })
    ).toBeVisible()
    await expect(
      page.getByRole('columnheader', { name: 'Phone' })
    ).toBeVisible()

    // TODO: Update when real data is available
    await expect(page.getByRole('cell', { name: 'John Doe' })).toBeVisible()
    await expect(
      page.getByRole('cell', { name: 'john.doe@example.com' })
    ).toBeVisible()
  })

  test('clicking user name navigates to user detail', async ({ page }) => {
    await LOCATORS.nameModeButton(page).click()
    await LOCATORS.firstNameInput(page).fill('John')
    await LOCATORS.lastNameInput(page).fill('Doe')
    await LOCATORS.searchButton(page).click()

    await expect(LOCATORS.resultsTable(page)).toBeVisible()
    await page.getByRole('link', { name: 'John Doe' }).click()

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
