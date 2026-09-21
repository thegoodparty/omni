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
const asFinder = (fn: () => Promise<{ people: Person[] }>) =>
  fn as unknown as Pick<
    ContactsService,
    'findContactsForFilter'
  >['findContactsForFilter']

const contactsStub = (pages: Person[][]) =>
  asFinder(vi.fn(async () => ({ people: pages.shift() ?? [] })))

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

// The production-shaped cases resolve tens of thousands of people; count
// them rather than keeping them all.
const countDrain = async (
  audience: AsyncGenerator<
    PhoneAudiencePerson,
    AudienceResolutionSummary,
    void
  >,
) => {
  let resolved = 0
  let next = await audience.next()
  while (!next.done) {
    resolved += 1
    next = await audience.next()
  }
  return { resolved, summary: next.value }
}

const peopleWithPhones = (ids: string[], phones = ids) =>
  ids.map((id, i) => person({ id, cellPhone: phones[i] }))

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

  it('throws before ever emitting a recipient past the cap', async () => {
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

    const emitted: PhoneAudiencePerson[] = []
    await expect(async () => {
      let next = await audience.next()
      while (!next.done) {
        emitted.push(next.value)
        next = await audience.next()
      }
    }).rejects.toThrow(new BadRequestException('too many'))

    // The cap is a limit on what the caller receives, not just on what the
    // resolution reports at the end: a caller that writes as it reads must
    // never see the person past it.
    expect(emitted.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('reads past the naive page count for a dedup-heavy list at the cap', async () => {
    // Production sizes and the defaults: 1000 per page, 100k recipients.
    // 10% of each page repeats a number from that same page, so resolving
    // this list needs 111 fetches — more than the ceiling this guard used
    // to carry (ceil(100000 / 1000) + 1 = 101), which 400'd a filter for
    // the sin of having duplicate phone numbers in it.
    let pageNumber = 0
    const findContactsForFilter = asFinder(
      vi.fn(async () => {
        pageNumber += 1
        if (pageNumber > 110) {
          const tailIds = Array.from({ length: 500 }, (_, i) => `tail-${i}`)
          return { people: peopleWithPhones(tailIds) }
        }
        const fresh = Array.from(
          { length: 900 },
          (_, i) => `${pageNumber}-${i}`,
        )
        const repeats = fresh.slice(0, 100)
        return {
          people: [
            ...peopleWithPhones(fresh),
            ...peopleWithPhones(
              repeats.map((phone) => `repeat-${phone}`),
              repeats,
            ),
          ],
        }
      }),
    )

    const { resolved, summary } = await countDrain(
      resolveFilterAudience(
        { findContactsForFilter },
        {
          filterInput: {},
          organization: ORGANIZATION,
          excludePersonIds: new Set(),
        },
      ),
    )

    expect(resolved).toBe(110 * 900 + 500)
    expect(summary.excludedDuplicatePhoneCount).toBe(110 * 100)
    expect(findContactsForFilter).toHaveBeenCalledTimes(111)
  })

  it('keeps going when a whole page fails isEligible', async () => {
    // The Peerly shape of this: a page of 1000 voters who all have cell
    // phones and none of whom has a complete address. Fresh records, all
    // rejected — legitimate filtering, not a stuck resolution.
    let pageNumber = 0
    const findContactsForFilter = asFinder(
      vi.fn(async () => {
        pageNumber += 1
        if (pageNumber > 2) return { people: [] }
        const ids = Array.from({ length: 1000 }, (_, i) => `${pageNumber}-${i}`)
        return {
          people: peopleWithPhones(ids).map((p) =>
            pageNumber === 1 ? { ...p, firstName: null } : p,
          ),
        }
      }),
    )

    const { resolved, summary } = await countDrain(
      resolveFilterAudience(
        { findContactsForFilter },
        {
          filterInput: {},
          organization: ORGANIZATION,
          excludePersonIds: new Set(),
          isEligible: (p) => Boolean(p.firstName),
        },
      ),
    )

    expect(resolved).toBe(1000)
    expect(summary.excludedDuplicatePhoneCount).toBe(0)
    expect(findContactsForFilter).toHaveBeenCalledTimes(3)
  })

  it('aborts when consecutive full pages return no unseen phone number', async () => {
    // people-api handing back the same page forever: paging is advancing,
    // the rows are not.
    const repeated = peopleWithPhones(
      Array.from({ length: 1000 }, (_, i) => `same-${i}`),
    )
    const findContactsForFilter = asFinder(
      vi.fn(async () => ({ people: repeated })),
    )

    await expect(
      countDrain(
        resolveFilterAudience(
          { findContactsForFilter },
          {
            filterInput: {},
            organization: ORGANIZATION,
            excludePersonIds: new Set(),
          },
        ),
      ),
    ).rejects.toThrow(/3 consecutive full pages/)
    // The first page progresses; the three after it do not.
    expect(findContactsForFilter).toHaveBeenCalledTimes(4)
  })

  it('stops scanning once a rejecting filter has read its row budget', async () => {
    // Every page is fresh, so the stall guard never fires, and nothing is
    // ever resolved, so the cap never fires either. Only the scan ceiling
    // stands between this and reading the whole district.
    let pageNumber = 0
    const findContactsForFilter = asFinder(
      vi.fn(async () => {
        pageNumber += 1
        const ids = Array.from({ length: 1000 }, (_, i) => `${pageNumber}-${i}`)
        return { people: peopleWithPhones(ids) }
      }),
    )

    // maxPages = ceil(10000 * 2 / 1000) + 1 = 21.
    await expect(
      countDrain(
        resolveFilterAudience(
          { findContactsForFilter },
          {
            filterInput: {},
            organization: ORGANIZATION,
            excludePersonIds: new Set(),
            maxRecipients: 10_000,
            isEligible: () => false,
          },
        ),
      ),
    ).rejects.toThrow(/Pagination exceeded 21 pages/)
    expect(findContactsForFilter).toHaveBeenCalledTimes(21)
  })
})
