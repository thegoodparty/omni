import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { Person } from '@goodparty_org/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

// Pages of 1000 fresh people, served off a clock the pages advance by hand.
// The deadline measures Date.now(), and a real clock would make these either
// slow (90s of waiting) or flaky (page latency measured on a busy CI box).
// page1Ms is separate because page 1 carries the parallel COUNT and really is
// the slow one in prod — whether the projection leans on it is the thing under
// test.
const timedPages = ({
  fullPages,
  tailSize = 0,
  totalResults,
  page1Ms,
  pageMs,
}: {
  fullPages: number
  tailSize?: number
  totalResults: number
  page1Ms: number
  pageMs: number
}) => {
  let now = 0
  let pageNumber = 0
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const findContactsForFilter = asFinder(
    vi.fn(async () => {
      pageNumber += 1
      now += pageNumber === 1 ? page1Ms : pageMs
      const size = pageNumber <= fullPages ? 1000 : tailSize
      return {
        people: peopleWithPhones(
          Array.from({ length: size }, (_, i) => `${pageNumber}-${i}`),
        ),
        pagination: { totalResults },
      }
    }),
  )
  return { findContactsForFilter, elapsedMs: () => now }
}

afterEach(() => {
  vi.restoreAllMocks()
})

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
          dataset: 'constituents',
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
      'constituents',
    )
    expect(findContactsForFilter).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ hasCellPhone: true }),
      { resultsPerPage: 2, page: 2, skipCount: true },
      ORGANIZATION,
      new Set(['excluded']),
      'constituents',
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
          dataset: 'constituents',
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
          dataset: 'constituents',
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
          dataset: 'constituents',
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
        dataset: 'constituents',
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
      'constituents',
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
        dataset: 'constituents',
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
            dataset: 'constituents',
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
          dataset: 'constituents',
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
          dataset: 'constituents',
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
      'constituents',
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
            dataset: 'constituents',
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

  it('refuses a filter that cannot be resolved inside the time budget', async () => {
    // INC-101, to scale. 82,000 matched rows is UNDER the 100,000 cap, so
    // every guard here used to wave it through; 82 pages at the ~1.5s/page
    // measured in prod is ~123s, and the gateway hangs up at ~120s. In prod
    // that request died with no status at 120,038ms and the handler carried on
    // to upload a phone list to Peerly 45.9s later — work the browser had
    // already reported as failed.
    //
    // Two pages are enough to know: refuse in ~4.5s, naming the matched count
    // and what the measured page cost says would fit.
    const { findContactsForFilter, elapsedMs } = timedPages({
      fullPages: 82,
      totalResults: 82_000,
      page1Ms: 3000,
      pageMs: 1500,
    })

    await expect(
      countDrain(
        resolveFilterAudience(
          { findContactsForFilter },
          {
            filterInput: {},
            organization: ORGANIZATION,
            dataset: 'constituents',
            excludePersonIds: new Set(),
            timeBudgetMs: 90_000,
            budgetExceededMessage: ({ matchedCount, affordableCount }) =>
              `${matchedCount} is too many, try ${affordableCount}`,
          },
        ),
      ),
    ).rejects.toThrow(new BadRequestException('82000 is too many, try 57000'))

    expect(findContactsForFilter).toHaveBeenCalledTimes(2)
    expect(elapsedMs()).toBe(4500)
  })

  it('names a size on refusal that then resolves on the retry', async () => {
    // The refusal above suggested 57,000. A suggestion that gets refused a
    // second time is worse than no suggestion, so resolve exactly that many at
    // exactly the page cost it was measured from: 3s for the COUNT-carrying
    // first page and 1.5s after, which lands at 88.5s inside the 90s budget.
    const { findContactsForFilter, elapsedMs } = timedPages({
      fullPages: 57,
      totalResults: 57_000,
      page1Ms: 3000,
      pageMs: 1500,
    })

    const { resolved } = await countDrain(
      resolveFilterAudience(
        { findContactsForFilter },
        {
          filterInput: {},
          organization: ORGANIZATION,
          dataset: 'constituents',
          excludePersonIds: new Set(),
          timeBudgetMs: 90_000,
        },
      ),
    )

    expect(resolved).toBe(57_000)
    expect(elapsedMs()).toBeLessThan(90_000)
  })

  it('resolves a list that projects just inside the budget', async () => {
    // The other half of the trade, and the reason the projection does not lean
    // on page 1: 60 pages at 1.4s is 84.6s including a 2s first page — slow,
    // but it lands, so it must not be refused. Projecting 59 more pages from
    // the COUNT-carrying first page would have put this at 120s and 400ed it.
    const { findContactsForFilter } = timedPages({
      fullPages: 60,
      totalResults: 60_000,
      page1Ms: 2000,
      pageMs: 1400,
    })

    const { resolved } = await countDrain(
      resolveFilterAudience(
        { findContactsForFilter },
        {
          filterInput: {},
          organization: ORGANIZATION,
          dataset: 'constituents',
          excludePersonIds: new Set(),
          timeBudgetMs: 90_000,
        },
      ),
    )

    expect(resolved).toBe(60_000)
    // 60 full pages plus the short one that ends the loop.
    expect(findContactsForFilter).toHaveBeenCalledTimes(61)
  })

  it('stops with a 503 when paging slows down past the budget mid-resolution', async () => {
    // The hard stop, which is all that is left when nothing can be projected
    // (no matched count because the pre-flight is off). The projection should
    // normally refuse first, so reaching this means upstream paging got slower
    // after the resolution started — a 503 rather than a 400 because that is
    // ours to fix, not the user's, and the route alerts page on it.
    //
    // What matters either way: it stops while the client is still connected,
    // so the handler cannot go on to create something nobody is waiting for.
    const { findContactsForFilter } = timedPages({
      fullPages: 40,
      totalResults: 40_000,
      page1Ms: 50_000,
      pageMs: 50_000,
    })

    await expect(
      countDrain(
        resolveFilterAudience(
          { findContactsForFilter },
          {
            filterInput: {},
            organization: ORGANIZATION,
            dataset: 'constituents',
            excludePersonIds: new Set(),
            skipPreflightCap: true,
            timeBudgetMs: 90_000,
          },
        ),
      ),
    ).rejects.toThrow(ServiceUnavailableException)

    // Page 1 ends at 50s and page 2 at 100s; page 3 is never asked for.
    expect(findContactsForFilter).toHaveBeenCalledTimes(2)
  })

  it('has no deadline at all when the caller passes no budget', async () => {
    // The SQS delivery path again. Four minutes of paging with nobody waiting
    // is a send that works, and neither deadline guard may touch it.
    const { findContactsForFilter, elapsedMs } = timedPages({
      fullPages: 4,
      tailSize: 500,
      totalResults: 4500,
      page1Ms: 60_000,
      pageMs: 60_000,
    })

    const { resolved } = await countDrain(
      resolveFilterAudience(
        { findContactsForFilter },
        {
          filterInput: {},
          organization: ORGANIZATION,
          dataset: 'constituents',
          excludePersonIds: new Set(),
          skipPreflightCap: true,
        },
      ),
    )

    expect(resolved).toBe(4500)
    expect(elapsedMs()).toBe(300_000)
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
          dataset: 'constituents',
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
            dataset: 'constituents',
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
            dataset: 'constituents',
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
