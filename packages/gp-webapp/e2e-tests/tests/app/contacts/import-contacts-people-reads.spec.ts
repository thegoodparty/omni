import { expect, test } from 'src/fixtures/test'
import type {
  ContactUpload,
  ContactUploadColumnMapping,
  ListContactUploadRowsResponse,
  PeopleListResponse,
  Person,
  PresignContactUploadFileResponse,
} from '@goodparty_org/contracts'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import { uniqueToken } from 'src/helpers/testIdentifiers.helper'

// Proves an import reaches people reads: Databricks joins the org's imported
// rows to the voter file through a live federated view over dev's Postgres,
// and a PR preview writes its imports to its own database, which Databricks
// cannot reach. So it runs only against dev, where this test's rows are the
// ones the view reads.

const COLUMN_MAPPING: ContactUploadColumnMapping = {
  firstName: 'First',
  lastName: 'Last',
  email: 'Email',
  cellPhone: 'Phone',
  landline: null,
  addressLine: null,
  city: null,
  zip: null,
}

const nameKey = (value: string | null) =>
  (value ?? '').toLowerCase().replace(/[^a-z]/g, '')

const phoneOf = (person: Person) =>
  [person.cellPhone, person.landline].find((phone) =>
    /^\(\d{3}\) \d{3}-\d{4}$/.test(phone ?? ''),
  ) ?? null

test('an import joins people reads and undo takes it back out @dev-only', async ({
  page,
}) => {
  test.setTimeout(8 * 60 * 1000)
  await blockSlowScripts(page)
  const { client } = await setupProCampaignUser(page)

  const search = async (term: string) =>
    (
      await client.get<PeopleListResponse>('/v1/contacts', {
        params: { search: term, resultsPerPage: 100 },
      })
    ).data.people
  const count = async (body: Record<string, unknown>) =>
    (
      await client.post<{ count: number; newContactsCount?: number }>(
        '/v1/contacts/count',
        body,
      )
    ).data
  const findPerson = async (id: string) =>
    (await client.get<Person>(`/v1/contacts/${id}`)).data

  // A voter with a phone whose first and last name nobody else in the
  // district shares, so the row matches them and nobody else.
  const { data: sample } = await client.get<PeopleListResponse>(
    '/v1/contacts',
    { params: { resultsPerPage: 100 } },
  )
  let voter: Person | undefined
  for (const person of sample.people
    .filter((candidate) => phoneOf(candidate))
    .filter((candidate) => /^[A-Za-z]+$/.test(candidate.firstName ?? ''))
    .filter((candidate) => /^[A-Za-z]+$/.test(candidate.lastName ?? ''))
    .slice(0, 10)) {
    const namesakes = (await search(person.lastName ?? '')).filter(
      (other) =>
        nameKey(other.lastName) === nameKey(person.lastName) &&
        nameKey(other.firstName) === nameKey(person.firstName),
    )
    if (namesakes.length === 1) {
      voter = person
      break
    }
  }
  expect(voter, 'a voter with a phone and a name of their own').toBeDefined()
  const voterPhone = phoneOf(voter!) ?? ''

  const token = uniqueToken()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  const lastName = `Zzyq${token.replace(/\d/g, (digit) => 'abcdefghij'[Number(digit)] ?? 'a')}`
  const jordanEmail = `reads-jordan-${token}@example.com`
  const caseyEmail = `reads-casey-${token}@example.com`
  const voterEmail = `reads-voter-${token}@example.com`
  const csv = [
    'First,Last,Email,Phone',
    `Jordan,${lastName},${jordanEmail},`,
    `Casey,${lastName},${caseyEmail},`,
    `${voter!.firstName},${voter!.lastName},${voterEmail},"${voterPhone}"`,
  ].join('\n')

  const { data: presign } = await client.post<PresignContactUploadFileResponse>(
    '/v1/contact-uploads/presign',
    {
      byteSize: Buffer.byteLength(csv),
      fileName: 'reads.csv',
      name: `Reads E2E ${token.slice(-6)}`,
      consentAffirmed: true,
      columnMapping: COLUMN_MAPPING,
    },
  )
  let undone = false
  try {
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
    const { data: upload } = await client.get<ContactUpload>(
      `/v1/contact-uploads/${presign.uploadId}`,
    )
    expect(upload).toMatchObject({ newCount: 2, matchedCount: 1 })

    const { data: processed } = await client.get<ListContactUploadRowsResponse>(
      `/v1/contact-uploads/${presign.uploadId}/rows`,
      { params: { outcome: 'processed' } },
    )
    const matchedRow = processed.rows.find((row) => row.email === voterEmail)
    expect(matchedRow?.personId).toBe(voter!.id)
    const newIds = processed.rows
      .filter((row) => row.isNewPerson)
      .map((row) => row.personId)
    expect(newIds).toHaveLength(2)

    // New people read from the overlay alone: their own name and email, and
    // nothing a voter file would hold.
    const added = await search(lastName)
    expect(added.map((person) => person.email).sort()).toEqual(
      [jordanEmail, caseyEmail].sort(),
    )
    for (const person of added) {
      expect(newIds).toContain(person.id)
      expect(person).toMatchObject({
        lastName,
        isNewContact: true,
        registeredVoter: null,
        politicalParty: null,
        lalVoterId: null,
      })
    }
    expect(
      (await search(jordanEmail.toUpperCase())).map((person) => person.id),
    ).toEqual([added.find((person) => person.email === jordanEmail)?.id])

    // A matched voter keeps their voter file record and gains the email.
    const matched = await findPerson(voter!.id)
    expect(matched).toMatchObject({
      id: voter!.id,
      lalVoterId: voter!.lalVoterId,
      firstName: voter!.firstName,
      lastName: voter!.lastName,
      email: voterEmail,
      isNewContact: false,
    })
    expect(phoneOf(matched)).toBe(voterPhone)
    expect(await findPerson(newIds[0]!)).toMatchObject({
      isNewContact: true,
      lastName,
    })

    // Counts are this org's only: a fresh campaign whose one import added
    // two people and gave a voter an email.
    expect(await count({ source: ['imported'] })).toMatchObject({
      count: 2,
      newContactsCount: 2,
    })
    expect((await count({ hasEmail: true })).count).toBe(3)
    const everyone = await count({})
    expect(everyone.newContactsCount).toBe(2)
    expect((await count({ source: ['voterFile'] })).count).toBe(
      everyone.count - 2,
    )

    await client.delete(`/v1/contact-uploads/${presign.uploadId}`)
    undone = true

    // Other search terms than before the undo, so no cached answer is reused.
    await expect
      .poll(async () => (await search(lastName.slice(1))).length, {
        timeout: 60 * 1000,
      })
      .toBe(0)
    expect(await search(caseyEmail.toUpperCase())).toEqual([])
    expect((await findPerson(voter!.id)).email).toBeNull()
    expect((await count({ source: ['imported'] })).count).toBe(0)
    expect((await count({ hasEmail: true })).count).toBe(0)
  } finally {
    // A failure before the undo still removes the upload and its file, unless
    // the job is still running, when gp-api answers 409.
    if (!undone) {
      await client.delete(`/v1/contact-uploads/${presign.uploadId}`, {
        validateStatus: () => true,
      })
    }
  }
})
