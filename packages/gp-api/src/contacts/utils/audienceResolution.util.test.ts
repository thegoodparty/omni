import { BadRequestException } from '@nestjs/common'
import type { Person } from '@goodparty_org/contracts'
import { describe, expect, it, vi } from 'vitest'
import { Organization } from '../../generated/prisma'
import { ContactsService } from '../services/contacts.service'
import {
  AudienceResolutionSummary,
  PhoneAudiencePerson,
  resolveFilterAudience,
} from './audienceResolution.util'

const ORGANIZATION = { slug: 'campaign-audience' } as Organization

const person = (overrides: Partial<Person> = {}) =>
  ({
    id: 'person-1',
    firstName: 'Jane',
    lastName: 'Doe',
    cellPhone: '5551234567',
    address: { city: 'Springfield', state: 'CA', zip: '90210' },
    ...overrides,
  }) as Person

// The helper only reads `people` off the response; the rest of
// PeopleListResponse is irrelevant to paging here.
const contactsStub = (pages: Person[][]) => {
  const findContactsForFilter = vi.fn(async () => ({
    people: pages.shift() ?? [],
  }))
  return findContactsForFilter as unknown as Pick<
    ContactsService,
    'findContactsForFilter'
  >['findContactsForFilter']
}

const drain = async (
  audience: AsyncGenerator<
    PhoneAudiencePerson,
    AudienceResolutionSummary,
    void
  >,
) => {
  const people: PhoneAudiencePerson[] = []
  let next = await audience.next()
  while (!next.done) {
    people.push(next.value)
    next = await audience.next()
  }
  return { people, summary: next.value }
}

describe('resolveFilterAudience', () => {
  it('forces hasCellPhone and pages with skipCount until a short page', async () => {
    const findContactsForFilter = contactsStub([
      [
        person({ id: 'a', cellPhone: '1' }),
        person({ id: 'b', cellPhone: '2' }),
      ],
      [person({ id: 'c', cellPhone: '3' })],
    ])

    const { people, summary } = await drain(
      resolveFilterAudience(
        { findContactsForFilter },
        {
          filterInput: { hasCellPhone: false, search: 'jane' },
          organization: ORGANIZATION,
          excludePersonIds: new Set(['excluded']),
          pageSize: 2,
        },
      ),
    )

    expect(people.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(summary.excludedDuplicatePhoneCount).toBe(0)
    expect(findContactsForFilter).toHaveBeenCalledTimes(2)
    expect(findContactsForFilter).toHaveBeenNthCalledWith(
      1,
      { hasCellPhone: true, search: 'jane' },
      { resultsPerPage: 2, page: 1, skipCount: true },
      ORGANIZATION,
      new Set(['excluded']),
    )
    expect(findContactsForFilter).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ hasCellPhone: true }),
      { resultsPerPage: 2, page: 2, skipCount: true },
      ORGANIZATION,
      new Set(['excluded']),
    )
  })

  it('dedupes by phone across pages and counts the duplicates', async () => {
    const findContactsForFilter = contactsStub([
      [
        person({ id: 'a', cellPhone: '1' }),
        person({ id: 'b', cellPhone: '2' }),
      ],
      [person({ id: 'c', cellPhone: '1' })],
    ])

    const { people, summary } = await drain(
      resolveFilterAudience(
        { findContactsForFilter },
        {
          filterInput: {},
          organization: ORGANIZATION,
          excludePersonIds: new Set(),
          pageSize: 2,
        },
      ),
    )

    expect(people.map((p) => p.id)).toEqual(['a', 'b'])
    expect(summary.excludedDuplicatePhoneCount).toBe(1)
  })

  it('skips people people-api cannot give a phone for', async () => {
    const findContactsForFilter = contactsStub([
      [
        person({ id: 'a', cellPhone: null }),
        person({ id: 'b', cellPhone: '2' }),
      ],
    ])

    const { people, summary } = await drain(
      resolveFilterAudience(
        { findContactsForFilter },
        {
          filterInput: {},
          organization: ORGANIZATION,
          excludePersonIds: new Set(),
          pageSize: 10,
        },
      ),
    )

    expect(people.map((p) => p.id)).toEqual(['b'])
    expect(summary.excludedDuplicatePhoneCount).toBe(0)
  })

  it('applies isEligible before dedupe, so an ineligible person never claims a phone', async () => {
    const findContactsForFilter = contactsStub([
      [
        person({ id: 'a', cellPhone: '1', firstName: null }),
        person({ id: 'b', cellPhone: '1', firstName: 'Jane' }),
      ],
    ])

    const { people, summary } = await drain(
      resolveFilterAudience(
        { findContactsForFilter },
        {
          filterInput: {},
          organization: ORGANIZATION,
          excludePersonIds: new Set(),
          pageSize: 10,
          isEligible: (p) => Boolean(p.firstName),
        },
      ),
    )

    expect(people.map((p) => p.id)).toEqual(['b'])
    expect(summary.excludedDuplicatePhoneCount).toBe(0)
  })

  it('throws once resolved recipients exceed the cap', async () => {
    const findContactsForFilter = contactsStub([
      [
        person({ id: 'a', cellPhone: '1' }),
        person({ id: 'b', cellPhone: '2' }),
      ],
      [
        person({ id: 'c', cellPhone: '3' }),
        person({ id: 'd', cellPhone: '4' }),
      ],
    ])

    const audience = resolveFilterAudience(
      { findContactsForFilter },
      {
        filterInput: {},
        organization: ORGANIZATION,
        excludePersonIds: new Set(),
        pageSize: 2,
        maxRecipients: 2,
        limitExceededMessage: 'too many',
      },
    )

    await expect(drain(audience)).rejects.toThrow(
      new BadRequestException('too many'),
    )
  })

  it('aborts rather than paging forever when no page adds a recipient', async () => {
    const duplicatePage = () => [
      person({ id: 'a', cellPhone: '1' }),
      person({ id: 'b', cellPhone: '2' }),
    ]
    const findContactsForFilter = vi.fn(async () => ({
      people: duplicatePage(),
    })) as unknown as Pick<
      ContactsService,
      'findContactsForFilter'
    >['findContactsForFilter']

    const audience = resolveFilterAudience(
      { findContactsForFilter },
      {
        filterInput: {},
        organization: ORGANIZATION,
        excludePersonIds: new Set(),
        pageSize: 2,
        maxRecipients: 2,
      },
    )

    await expect(drain(audience)).rejects.toThrow(/Pagination exceeded 2 pages/)
  })
})
