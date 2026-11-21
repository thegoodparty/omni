import { expect, test } from 'src/fixtures/test'
import type { PresignContactUploadFileResponse } from '@goodparty_org/contracts'
import { captureAnalyticsEvents } from 'src/helpers/analyticsEvents.helper'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import { uniqueToken } from 'src/helpers/testIdentifiers.helper'

// Imports three people no voter file holds through the Import contacts wizard
// in the browser, so the browser's own PUT to the bucket (its CORS rules),
// the column step and the consent step run as a user drives them, then waits
// on the import's page for the background job to finish. The test user, its
// upload and the file go with gp-api's hourly test-user sweep.

test('importing a CSV through the wizard finishes and lists its people', async ({
  page,
}) => {
  test.setTimeout(8 * 60 * 1000)
  const analytics = await captureAnalyticsEvents(page)
  await blockSlowScripts(page)
  await setupProCampaignUser(page)

  const token = uniqueToken()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  const lastName = `Zzyq${token.replace(/\d/g, (digit) => 'abcdefghij'[Number(digit)] ?? 'a')}`
  const importName = `Wizard E2E ${token.slice(-6)}`
  const firstNames = ['Jordan', 'Casey', 'Riley']
  // Headers no alias prefills, so every column is mapped by hand.
  const csv = [
    'Given,Family,Contact',
    ...firstNames.map(
      (first) =>
        `${first},${lastName},wizard-${first.toLowerCase()}-${token}@example.com`,
    ),
  ].join('\n')

  await page.goto('/dashboard/contacts')
  await page.getByRole('button', { name: 'Import contacts' }).click()
  const wizard = page.getByRole('dialog', { name: 'Import contacts' })
  await expect(
    wizard.getByRole('heading', { name: 'Which file has your people?' }),
  ).toBeVisible()

  await wizard.locator('input[type="file"]').setInputFiles({
    name: 'wizard.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })
  await expect(wizard.getByText('3 people found')).toBeVisible()
  await analytics.expectEvent('Contacts - Import Started', {
    sourceType: 'csv',
    rowCount: 3,
    product: 'win',
  })
  await wizard.getByRole('button', { name: 'Continue' }).click()

  await expect(
    wizard.getByText('Is each column matched correctly?'),
  ).toBeVisible()
  const continueButton = wizard.getByRole('button', { name: 'Continue' })
  await expect(continueButton).toBeDisabled()
  for (const [header, field] of [
    ['Given', 'First name'],
    ['Family', 'Last name'],
    ['Contact', 'Email'],
  ] as const) {
    await wizard.getByRole('combobox', { name: header }).click()
    await page.getByRole('option', { name: field, exact: true }).click()
    await expect(wizard.getByRole('combobox', { name: header })).toHaveText(
      field,
    )
  }
  await expect(
    wizard.getByText(
      'First and last name are required: all 3 people have both.',
    ),
  ).toBeVisible()
  await continueButton.click()

  await expect(
    wizard.getByText('What do you want to call this import?'),
  ).toBeVisible()
  await wizard.getByLabel('Import name').fill(importName)
  const importButton = wizard.getByRole('button', {
    name: 'Import 3 people',
  })
  await expect(importButton).toBeDisabled()
  await wizard
    .getByRole('checkbox', {
      name: 'These people agreed to hear from me, including by email. I am responsible for that.',
    })
    .check()

  const presignResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/v1\/contact-uploads\/presign$/.test(new URL(response.url()).pathname),
  )
  await importButton.click()
  const presign = (await (
    await presignResponse
  ).json()) as PresignContactUploadFileResponse
  const uploadId = presign.uploadId

  await expect(
    wizard.getByRole('heading', { name: 'Your file is uploaded' }),
  ).toBeVisible({ timeout: 60 * 1000 })
  await analytics.expectEvent('Contacts - Import Consent Affirmed', {
    rowCount: 3,
    product: 'win',
  })
  await wizard.getByRole('button', { name: 'See your import' }).click()
  await page.waitForURL(`**/dashboard/contacts/uploads/${uploadId}`)

  // The page polls the upload while the job runs and shows its counts once
  // it leaves processing.
  await expect(page.getByText('Complete', { exact: true })).toBeVisible({
    timeout: 4 * 60 * 1000,
  })
  await expect(page.getByText(/^wizard\.csv · .* · 3 people$/)).toBeVisible()
  // A processed row that opens its person is a button, not a row.
  const newRows = page
    .getByRole('button')
    .filter({ hasText: 'New person. Added.' })
  await expect(newRows).toHaveCount(3)
  for (const first of firstNames) {
    await expect(
      newRows.filter({ hasText: `${first} ${lastName}` }),
    ).toHaveCount(1)
  }
})
