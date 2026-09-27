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

// The helper reads `people` and `pagination.totalResults` off the response;
// the rest of PeopleListResponse is irrelevant to paging here.
const asFinder = (
  fn: () => Promise<{ people: Person[]; pagination: { totalResults: number } }>,
) =>
  fn as unknown as Pick<
    ContactsService,
    'findContactsForFilter'
  >['findContactsForFilter']

// `totalResults` defaults to the whole candidate pool these pages describe,
// which is what people-api would report for the filter that produced them.
// Pass an explicit value to exercise the pre-flight cap.
const contactsStub = (pages: Person[][], totalResults?: number) => {
  const total = totalResults ?? pages.reduce((n, p) => n + p.length, 0)
  return asFinder(
    vi.fn(async () => ({
      people: pages.shift() ?? [],
      pagination: { totalResults: total },
    })),
  )
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
  it('forces hasCellPhone, counts once on page 1, then pages with skipCount until a short page', async () => {
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
      { resultsPerPage: 2, page: 1, skipCount: false },
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

  it('refuses an over-cap filter on page 1, before resolving anything', async () => {
    // The incident shape, in miniature: the matched count is already past
    // the cap, so the resolution cannot finish inside the caller's deadline
    // whatever the later skips do. One fetch, no recipients emitted, and the
    // caller's own message.
    const findContactsForFilter = contactsStub(
      [
        [
          person({ id: 'a', cellPhone: '1' }),
          person({ id: 'b', cellPhone: '2' }),
        ],
      ],
      150_000,
    )

    const emitted: PhoneAudiencePerson[] = []
    const audience = resolveFilterAudience(
      { findContactsForFilter },
      {
        filterInput: {},
        organization: ORGANIZATION,
        excludePersonIds: new Set(),
        limitExceededMessage: 'narrow it',
      },
    )

    await expect(async () => {
      let next = await audience.next()
      while (!next.done) {
        emitted.push(next.value)
        next = await audience.next()
      }
    }).rejects.toThrow(new BadRequestException('narrow it'))

    expect(emitted).toEqual([])
    expect(findContactsForFilter).toHaveBeenCalledTimes(1)
    // The count has to be asked for, or there is nothing to pre-flight on.
    expect(findContactsForFilter).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ hasCellPhone: true }),
      expect.objectContaining({ page: 1, skipCount: false }),
      ORGANIZATION,
      new Set(),
    )
  })

  it('throws before ever emitting a recipient past the cap', async () => {
    // The matched count under-reports (2 against 4 rows), so the pre-flight
    // passes and the in-loop cap is the guard under test here. Both matter:
    // the pre-flight catches the common case cheaply, this one is what still
    // holds when the count cannot be trusted.
    const findContactsForFilter = contactsStub(
      [
        [
          person({ id: 'a', cellPhone: '1' }),
          person({ id: 'b', cellPhone: '2' }),
        ],
        [
          person({ id: 'c', cellPhone: '3' }),
          person({ id: 'd', cellPhone: '4' }),
        ],
      ],
      2,
    )

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

  it('refuses a dedup-heavy list whose matched count is over the cap', async () => {
    // Production sizes and the defaults: 1000 per page, 100k recipients.
    // 10% of each page repeats a number from that same page, so this list
    // resolves 99,500 recipients — UNDER the cap — out of 110,500 matched
    // rows, and the scan ceiling was widened (SCAN_ALLOWANCE) specifically so
    // that a list would not 400 for the sin of having duplicate phone
    // numbers in it.
    //
    // THE PRE-FLIGHT NARROWS THAT, KNOWINGLY. It reads the matched count, not
    // the resolved one, so it cannot tell this list from one that really is
    // over the cap. What makes the trade acceptable is that this list cannot
    // be served today either: 111 pages at the ~2.17s/page measured in prod
    // is ~241s against a ~120s gateway timeout, so before this guard the
    // caller got a two-minute hang and a `statusCode: null`. A fast, slightly
    // over-eager refusal is the better failure, and the honest fix for the
    // band between "resolves under the cap" and "cannot resolve in 120s" is
    // to take this work off the request path entirely.
    let pageNumber = 0
    const findContactsForFilter = asFinder(
      vi.fn(async () => {
        pageNumber += 1
        if (pageNumber > 110) {
          const tailIds = Array.from({ length: 500 }, (_, i) => `tail-${i}`)
          return {
            people: peopleWithPhones(tailIds),
            pagination: { totalResults: 110_500 },
          }
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
          pagination: { totalResults: 110_500 },
        }
      }),
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
    ).rejects.toThrow(/matches over the 100000 recipient limit/)
    // One fetch, not 111: the refusal costs a single page.
    expect(findContactsForFilter).toHaveBeenCalledTimes(1)
  })

  it('still reads past the naive page count when the list fits the cap', async () => {
    // The dedupe headroom SCAN_ALLOWANCE exists for, kept alive within what
    // the pre-flight admits: 60,500 matched rows resolving 54,500 recipients
    // over 61 pages — more than the naive ceil(54500/1000) the old page
    // ceiling would have allowed, and comfortably inside the cap.
    let pageNumber = 0
    const findContactsForFilter = asFinder(
      vi.fn(async () => {
        pageNumber += 1
        if (pageNumber > 60) {
          const tailIds = Array.from({ length: 500 }, (_, i) => `tail-${i}`)
          return {
            people: peopleWithPhones(tailIds),
            pagination: { totalResults: 60_500 },
          }
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
          pagination: { totalResults: 60_500 },
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

    expect(resolved).toBe(60 * 900 + 500)
    expect(summary.excludedDuplicatePhoneCount).toBe(60 * 100)
    expect(findContactsForFilter).toHaveBeenCalledTimes(61)
  })

  it('resolves an over-cap-count list anyway when the caller has no deadline', async () => {
    // The SQS delivery path. 105,000 matched rows resolving 85,000 recipients
    // — the exact band the pre-flight is over-eager about. There is no gateway
    // waiting on a queue consumer, so the resolution genuinely finishes, and
    // refusing it would mark a PAID outreach permanently `failed`. The in-loop
    // cap is the only guard that should speak here, and 85,000 is under it.
    let pageNumber = 0
    const findContactsForFilter = asFinder(
      vi.fn(async () => {
        pageNumber += 1
        // 85 full pages of recipients, then a short page to end the loop.
        if (pageNumber > 85)
          return { people: [], pagination: { totalResults: 105_000 } }
        const ids = Array.from({ length: 1000 }, (_, i) => `${pageNumber}-${i}`)
        return {
          people: peopleWithPhones(ids),
          pagination: { totalResults: 105_000 },
        }
      }),
    )

    const { resolved } = await countDrain(
      resolveFilterAudience(
        { findContactsForFilter },
        {
          filterInput: {},
          organization: ORGANIZATION,
          excludePersonIds: new Set(),
          skipPreflightCap: true,
        },
      ),
    )

    expect(resolved).toBe(85_000)
    // And it never asked for the count it would not have read.
    expect(findContactsForFilter).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ hasCellPhone: true }),
      expect.objectContaining({ page: 1, skipCount: true }),
      ORGANIZATION,
      new Set(),
    )
  })

  it('still enforces the in-loop cap when the pre-flight is off', async () => {
    // skipPreflightCap turns off the deadline guard, not the audience-shape
    // one: a resolution that really does exceed the cap must still refuse,
    // however patient its caller is.
    const findContactsForFilter = contactsStub(
      [
        [
          person({ id: 'a', cellPhone: '1' }),
          person({ id: 'b', cellPhone: '2' }),
        ],
        [
          person({ id: 'c', cellPhone: '3' }),
          person({ id: 'd', cellPhone: '4' }),
        ],
      ],
      150_000,
    )

    await expect(
      countDrain(
        resolveFilterAudience(
          { findContactsForFilter },
          {
            filterInput: {},
            organization: ORGANIZATION,
            excludePersonIds: new Set(),
            pageSize: 2,
            maxRecipients: 2,
            skipPreflightCap: true,
            limitExceededMessage: 'too many',
          },
        ),
      ),
    ).rejects.toThrow(new BadRequestException('too many'))
  })

  it('keeps going when a whole page fails isEligible', async () => {
    // The Peerly shape of this: a page of 1000 voters who all have cell
    // phones and none of whom has a complete address. Fresh records, all
    // rejected — legitimate filtering, not a stuck resolution.
    let pageNumber = 0
    const findContactsForFilter = asFinder(
      vi.fn(async () => {
        pageNumber += 1
        if (pageNumber > 2)
          return { people: [], pagination: { totalResults: 2000 } }
        const ids = Array.from({ length: 1000 }, (_, i) => `${pageNumber}-${i}`)
        return {
          people: peopleWithPhones(ids).map((p) =>
            pageNumber === 1 ? { ...p, firstName: null } : p,
          ),
          pagination: { totalResults: 2000 },
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
      vi.fn(async () => ({
        people: repeated,
        pagination: { totalResults: 1000 },
      })),
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
    //
    // The matched count UNDER-reports here (1,000 against 21 pages of rows),
    // which is what keeps the ceiling reachable: with an accurate count the
    // pre-flight would refuse this on page 1, since reading past maxPages
    // requires more than maxRecipients rows to exist. That makes the ceiling
    // defense-in-depth against people-api's count and its rows disagreeing,
    // rather than a guard that fires on a well-behaved response — and it is
    // still worth keeping for exactly that case.
    let pageNumber = 0
    const findContactsForFilter = asFinder(
      vi.fn(async () => {
        pageNumber += 1
        const ids = Array.from({ length: 1000 }, (_, i) => `${pageNumber}-${i}`)
        return {
          people: peopleWithPhones(ids),
          pagination: { totalResults: 1000 },
        }
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
