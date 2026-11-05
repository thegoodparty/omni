import { expect, test } from '@playwright/test'
import type {
  ContactUpload,
  ContactUploadColumnMapping,
  PeopleListResponse,
  PresignContactUploadFileResponse,
} from '@goodparty_org/contracts'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import { uniqueToken } from 'src/helpers/testIdentifiers.helper'

// Imports two people no voter file holds through the API path, the way the
// wizard does (presign, PUT to the bucket, confirm, the queue job), then
// undoes the import from its page and checks the people, their emails and
// the import itself are gone from the real people reads and Import history.

const COLUMN_MAPPING: ContactUploadColumnMapping = {
  firstName: 'First',
  lastName: 'Last',
  email: 'Email',
  cellPhone: null,
  landline: null,
  addressLine: null,
  city: null,
  zip: null,
}

test('undoing an import removes its people, their details and its history row', async ({
  page,
}) => {
  test.setTimeout(8 * 60 * 1000)
  await blockSlowScripts(page)
  const { client } = await setupProCampaignUser(page)

  const token = uniqueToken()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  const lastName = `Zzyq${token.replace(/\d/g, (digit) => 'abcdefghij'[Number(digit)] ?? 'a')}`
  const email = `undo-${token}@example.com`
  const importName = `Undo E2E ${token.slice(-6)}`
  const csv = [
    'First,Last,Email',
    `Jordan,${lastName},${email}`,
    `Casey,${lastName},`,
  ].join('\n')

  const { data: presign } = await client.post<PresignContactUploadFileResponse>(
    '/v1/contact-uploads/presign',
    {
      byteSize: Buffer.byteLength(csv),
      fileName: 'undo.csv',
      name: importName,
      consentAffirmed: true,
      columnMapping: COLUMN_MAPPING,
    },
  )
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    body: csv,
    headers: { 'Content-Type': 'text/csv' },
  })
  expect(put.status).toBe(200)
  await client.post(`/v1/contact-uploads/${presign.uploadId}/uploaded`)

  await expect
    .poll(
      async () =>
        (
          await client.get<ContactUpload>(
            `/v1/contact-uploads/${presign.uploadId}`,
          )
        ).data.status,
      { timeout: 4 * 60 * 1000, intervals: [3000] },
    )
    .toBe('complete')
  const { data: imported } = await client.get<ContactUpload>(
    `/v1/contact-uploads/${presign.uploadId}`,
  )
  expect(imported.newCount).toBe(2)

  const peopleFound = async (search: string) =>
    (
      await client.get<PeopleListResponse>('/v1/contacts', {
        params: { search },
      })
    ).data.people.map((person) => person.email ?? person.lastName)

  await expect
    .poll(() => peopleFound(lastName), { timeout: 60 * 1000 })
    .toHaveLength(2)
  expect(await peopleFound(email)).toEqual([email])

  await page.goto(`/dashboard/contacts/uploads/${presign.uploadId}`)
  await page.getByRole('button', { name: 'Undo import' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Undo this import?' })
  await expect(dialog).toContainText(
    "We'll remove the 2 people it added and the details it gave your contacts.",
  )
  await dialog.getByRole('button', { name: 'Undo import' }).click()

  await page.waitForURL(/\/dashboard\/contacts\/uploads$/)
  await expect(page.getByText('No imports yet')).toBeVisible()
  await expect(page.getByText(importName)).toHaveCount(0)

  const gone = await client.get(`/v1/contact-uploads/${presign.uploadId}`, {
    validateStatus: () => true,
  })
  expect(gone.status).toBe(404)
  // Other search terms than before the undo, so no cached answer is reused.
  await expect
    .poll(() => peopleFound(lastName.slice(1)), { timeout: 60 * 1000 })
    .toEqual([])
  expect(await peopleFound(email.toUpperCase())).toEqual([])
})
