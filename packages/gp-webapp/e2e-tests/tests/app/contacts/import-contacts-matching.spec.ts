import { expect, test } from 'src/fixtures/test'
import type {
  ContactUpload,
  ContactUploadColumnMapping,
  ContactUploadRow,
  ListContactUploadRowsResponse,
  PeopleListResponse,
  Person,
  PresignContactUploadFileResponse,
} from '@goodparty_org/contracts'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import { uniqueToken } from 'src/helpers/testIdentifiers.helper'

// Proves Import contacts matching against the real Databricks statement and
// the default office's real voters, which gp-api's unit tests fake. Every
// voter is found through GET /v1/contacts at run time, and each case picks
// one whose last name nobody else in the district shares, so the expected
// outcome does not depend on who else is in the voter file.

// From gp-api's vendored src/contactUploads/data/nicknames.csv.
const NICKNAMES: [string, string][] = [
  ['robert', 'bob'],
  ['william', 'bill'],
  ['james', 'jim'],
  ['michael', 'mike'],
  ['elizabeth', 'liz'],
  ['thomas', 'tom'],
  ['joseph', 'joe'],
  ['charles', 'chuck'],
  ['margaret', 'peggy'],
  ['susan', 'sue'],
]

// Voter first name, then a name the list links to it only through a third
// name they share: Robert and William are both Bill, Betty and Liz are both
// Elizabeth, Ron and Erin are both Aaron. Neither is an alias, prefix or
// typo of the other.
const SHARED_NAME_PAIRS: [string, string][] = [
  ['robert', 'william'],
  ['william', 'robert'],
  ['betty', 'liz'],
  ['ron', 'erin'],
]

const SEARCH_PAGE_SIZE = 2000

const COMMON_FIRST_NAMES = ['robert', 'james', 'john', 'michael', 'william']

const COLUMN_MAPPING: ContactUploadColumnMapping = {
  firstName: 'First',
  lastName: 'Last',
  email: null,
  cellPhone: 'Phone',
  landline: null,
  addressLine: 'Address',
  city: 'City',
  zip: 'Zip',
}

type CsvRow = {
  first: string
  last: string
  phone?: string
  address?: Person['address']
}

type CaseKey =
  | 'exactPhone'
  | 'nicknamePhone'
  | 'prefixAddress'
  | 'typoPhone'
  | 'sharedNamePhone'
  | 'nameOnly'
  | 'inventedSurname'
  | 'phoneAndAddressBeatsNamesake'

const nameKey = (value: string | null) =>
  (value ?? '').toLowerCase().replace(/[^a-z]/g, '')

const capitalize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1)

const isLettersOnly = (value: string | null) => /^[A-Za-z]+$/.test(value ?? '')

const phoneOf = (person: Person) =>
  [person.cellPhone, person.landline].find((phone) =>
    /^\(\d{3}\) \d{3}-\d{4}$/.test(phone ?? ''),
  ) ?? null

const hasStreetAddress = (person: Person) =>
  /^\d+ [A-Za-z]{3,}/.test(person.address.line1 ?? '') &&
  /^\d{5}/.test(person.address.zip ?? '')

const csvField = (value: string | null | undefined) =>
  `"${(value ?? '').replace(/"/g, '""')}"`

test.describe.serial('Import contacts matching', () => {
  const rows = new Map<CaseKey, ContactUploadRow>()
  const voters = new Map<CaseKey, Person>()
  let namesake: Person | undefined

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(8 * 60 * 1000)
    const page = await browser.newPage()
    await blockSlowScripts(page)
    const { client } = await setupProCampaignUser(page)
    await page.close()

    const searches = new Map<string, Person[]>()
    const searchPeople = async (search: string) => {
      const cached = searches.get(search)
      if (cached) return cached
      const { data } = await client.get<PeopleListResponse>('/v1/contacts', {
        params: { search, resultsPerPage: SEARCH_PAGE_SIZE },
      })
      searches.set(search, data.people)
      return data.people
    }
    const usedLastKeys = new Set<string>()
    const pickUnique = async (
      candidates: Person[],
    ): Promise<Person | undefined> => {
      let checked = 0
      for (const person of candidates) {
        const lastKey = nameKey(person.lastName)
        if (usedLastKeys.has(lastKey) || !isLettersOnly(person.lastName)) {
          continue
        }
        if (checked >= 15) return undefined
        checked += 1
        const found = await searchPeople(person.lastName ?? '')
        const sharing = found.filter(
          (other) => nameKey(other.lastName) === lastKey,
        )
        if (found.length < SEARCH_PAGE_SIZE && sharing.length === 1) {
          usedLastKeys.add(lastKey)
          return person
        }
      }
      return undefined
    }

    const { data: sampleData } = await client.get<PeopleListResponse>(
      '/v1/contacts',
      { params: { resultsPerPage: 300 } },
    )
    const sample = sampleData.people.filter((person) =>
      isLettersOnly(person.firstName),
    )
    const csvRows = new Map<CaseKey, CsvRow>()

    const exactPhone = await pickUnique(
      sample.filter((person) => phoneOf(person)),
    )
    if (exactPhone) {
      voters.set('exactPhone', exactPhone)
      csvRows.set('exactPhone', {
        first: exactPhone.firstName ?? '',
        last: exactPhone.lastName ?? '',
        phone: phoneOf(exactPhone) ?? '',
      })
    }

    for (const [canonical, nickname] of NICKNAMES) {
      const voter = await pickUnique(
        (await searchPeople(canonical)).filter(
          (person) =>
            nameKey(person.firstName) === canonical && phoneOf(person),
        ),
      )
      if (!voter) continue
      voters.set('nicknamePhone', voter)
      csvRows.set('nicknamePhone', {
        first: capitalize(nickname),
        last: voter.lastName ?? '',
        phone: phoneOf(voter) ?? '',
      })
      break
    }

    const prefixAddress = await pickUnique(
      sample.filter(
        (person) =>
          nameKey(person.firstName).length >= 5 && hasStreetAddress(person),
      ),
    )
    if (prefixAddress) {
      const firstKey = nameKey(prefixAddress.firstName)
      voters.set('prefixAddress', prefixAddress)
      csvRows.set('prefixAddress', {
        first: capitalize(firstKey.slice(0, Math.max(3, firstKey.length - 2))),
        last: prefixAddress.lastName ?? '',
        address: prefixAddress.address,
      })
    }

    const typoPhone = await pickUnique(
      sample.filter(
        (person) => nameKey(person.firstName).length >= 5 && phoneOf(person),
      ),
    )
    if (typoPhone) {
      const firstKey = nameKey(typoPhone.firstName)
      voters.set('typoPhone', typoPhone)
      csvRows.set('typoPhone', {
        first: capitalize(
          `${firstKey.slice(0, 2)}${firstKey[2] === 'x' ? 'z' : 'x'}${firstKey.slice(3)}`,
        ),
        last: typoPhone.lastName ?? '',
        phone: phoneOf(typoPhone) ?? '',
      })
    }

    for (const [voterFirst, rowFirst] of SHARED_NAME_PAIRS) {
      const voter = await pickUnique(
        (await searchPeople(voterFirst)).filter(
          (person) =>
            nameKey(person.firstName) === voterFirst && phoneOf(person),
        ),
      )
      if (!voter) continue
      voters.set('sharedNamePhone', voter)
      csvRows.set('sharedNamePhone', {
        first: capitalize(rowFirst),
        last: voter.lastName ?? '',
        phone: phoneOf(voter) ?? '',
      })
      break
    }

    const nameOnly = await pickUnique(sample)
    if (nameOnly) {
      voters.set('nameOnly', nameOnly)
      csvRows.set('nameOnly', {
        first: nameOnly.firstName ?? '',
        last: nameOnly.lastName ?? '',
      })
    }

    csvRows.set('inventedSurname', {
      first: 'Jordan',
      last: `Zzyq${uniqueToken().replace(/\d/g, (digit) => 'abcdefghij'[Number(digit)] ?? 'a')}`,
    })

    // Two people with the same first and last name. Only someone else with
    // that exact name, the phone and the address could tie the row's 70
    // points, so the voter's phone must be theirs alone in the group.
    for (const first of COMMON_FIRST_NAMES) {
      const byLastKey = new Map<string, Person[]>()
      for (const person of await searchPeople(first)) {
        const lastKey = nameKey(person.lastName)
        if (
          nameKey(person.firstName) !== first ||
          !isLettersOnly(person.lastName) ||
          usedLastKeys.has(lastKey)
        ) {
          continue
        }
        byLastKey.set(lastKey, [...(byLastKey.get(lastKey) ?? []), person])
      }
      const pair = [...byLastKey.values()]
        .filter((group) => group.length >= 2)
        .flatMap((group) =>
          group
            .filter((person) => phoneOf(person) && hasStreetAddress(person))
            .filter((person) =>
              group.every(
                (other) =>
                  other.id === person.id ||
                  (other.cellPhone !== phoneOf(person) &&
                    other.landline !== phoneOf(person)),
              ),
            )
            .map((person) => ({
              voter: person,
              other: group.find((other) => other.id !== person.id),
            })),
        )[0]
      if (!pair) continue
      usedLastKeys.add(nameKey(pair.voter.lastName))
      voters.set('phoneAndAddressBeatsNamesake', pair.voter)
      namesake = pair.other
      csvRows.set('phoneAndAddressBeatsNamesake', {
        first: pair.voter.firstName ?? '',
        last: pair.voter.lastName ?? '',
        phone: phoneOf(pair.voter) ?? '',
        address: pair.voter.address,
      })
      break
    }

    const cases = [...csvRows.entries()]
    const csv = [
      'First,Last,Phone,Address,City,Zip',
      ...cases.map(([, row]) =>
        [
          row.first,
          row.last,
          row.phone,
          row.address?.line1,
          row.address?.city,
          row.address?.zip,
        ]
          .map(csvField)
          .join(','),
      ),
    ].join('\n')

    const { data: presign } =
      await client.post<PresignContactUploadFileResponse>(
        '/v1/contact-uploads/presign',
        {
          byteSize: Buffer.byteLength(csv),
          fileName: 'matching.csv',
          name: 'Matching E2E',
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
      .toMatch(/^(complete|needs_input|failed)$/)

    const { data: upload } = await client.get<ContactUpload>(
      `/v1/contact-uploads/${presign.uploadId}`,
    )
    expect(upload.failureReason).toBeNull()
    expect(upload.rowCount).toBe(cases.length)

    const listRows = async (outcome: string) =>
      (
        await client.get<ListContactUploadRowsResponse>(
          `/v1/contact-uploads/${presign.uploadId}/rows`,
          { params: { outcome, take: 100 } },
        )
      ).data.rows
    const uploaded = [
      ...(await listRows('processed')),
      ...(await listRows('needs_input')),
    ]
    cases.forEach(([key], rowIndex) => {
      const row = uploaded.find((candidate) => candidate.rowIndex === rowIndex)
      if (row) rows.set(key, row)
    })
  })

  const skipWithout = (key: CaseKey, reason: string) => {
    test.skip(!voters.has(key), reason)
    return { voter: voters.get(key)!, row: rows.get(key)! }
  }

  test('exact first and last name with the phone matches the voter', () => {
    const { voter, row } = skipWithout(
      'exactPhone',
      'No sampled voter with a phone and a last name of their own',
    )
    expect(row.outcome).toBe('matched')
    expect(row.personId).toBe(voter.id)
  })

  test('a nickname of the first name with the phone matches the voter', () => {
    const { voter, row } = skipWithout(
      'nicknamePhone',
      'No voter with a listed full name, a phone and a last name of their own',
    )
    expect(row.outcome).toBe('matched')
    expect(row.personId).toBe(voter.id)
  })

  test('a prefix of the first name with the address matches the voter', () => {
    const { voter, row } = skipWithout(
      'prefixAddress',
      'No sampled voter with a long first name, a street address and a last name of their own',
    )
    expect(row.outcome).toBe('matched')
    expect(row.personId).toBe(voter.id)
  })

  test('a one-letter typo of the first name needs input instead of matching', () => {
    const { voter, row } = skipWithout(
      'typoPhone',
      'No sampled voter with a long first name, a phone and a last name of their own',
    )
    expect(row.outcome).toBe('needs_input')
    expect(row.personId).toBeNull()
    expect(row.candidates.map((candidate) => candidate.personId)).toContain(
      voter.id,
    )
    expect(row.suggestedPersonId).toBeNull()
  })

  test('a first name linked only through a shared name is a new person', () => {
    const { voter, row } = skipWithout(
      'sharedNamePhone',
      'No voter named Robert, William, Betty or Ron with a phone and a last name of their own',
    )
    expect(row.outcome).toBe('new')
    expect(row.personId).not.toBe(voter.id)
    expect(row.isNewPerson).toBe(true)
  })

  test('an exact name alone suggests the voter but does not match', () => {
    const { voter, row } = skipWithout(
      'nameOnly',
      'No sampled voter with a last name of their own',
    )
    expect(row.outcome).toBe('needs_input')
    expect(row.suggestedPersonId).toBe(voter.id)
  })

  test('an invented surname is a new person', () => {
    const row = rows.get('inventedSurname')!
    expect(row.outcome).toBe('new')
    expect(row.isNewPerson).toBe(true)
  })

  test('agreeing on phone and address beats a namesake', () => {
    // Scoring order is covered by contactUploadMatching.util.test.ts; this
    // only runs when the district has two people with one name.
    const { voter, row } = skipWithout(
      'phoneAndAddressBeatsNamesake',
      'No two voters in the district share a first and last name',
    )
    expect(row.outcome).toBe('matched')
    expect(row.personId).toBe(voter.id)
    expect(row.personId).not.toBe(namesake?.id)
  })
})
