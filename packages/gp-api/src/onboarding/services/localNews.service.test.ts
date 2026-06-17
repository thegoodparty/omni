import { createMockLogger } from 'src/shared/test-utils/mockLogger.util'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingLocalNewsService } from './localNews.service'

const PENDING_TTL_MS = 5 * 60 * 1000
const OFFICE = 'Denver City Council - District 9'
const STATE = 'CO'
const USER_ID = 42
// city is intentionally absent on most onboarding callers; the table stores
// it as "" so the (office, city, state) compound unique still behaves as a key.
const CITY = ''

const cacheKey = (
  overrides: Partial<{
    office: string
    city: string
    state: string
  }> = {},
) => ({
  office: OFFICE,
  city: CITY,
  state: STATE,
  ...overrides,
})

function makeService() {
  const gemini = {
    generateWithSearch: vi.fn().mockResolvedValue({
      text: 'mock search results',
      searchQueries: [],
      sources: [],
    }),
    generateStructured: vi.fn(),
  }
  // Pass-through tracedNested: invoke the wrapped fn unchanged so the test
  // observes the underlying gemini call without caring about the span shape.
  const braintrust = {
    tracedNested: vi.fn(
      <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
    ),
  }
  const model = {
    upsert: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  }
  // markPending claims the slot with a single atomic INSERT ... ON CONFLICT
  // run through client.$queryRaw. It returns a row (truthy claim) by default;
  // tests that exercise the "already claimed by another caller" path override
  // it to resolve []. The raw SQL itself is exercised by integration coverage.
  const client = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'claim-id' }]),
  }
  const cache = {
    findByJurisdiction: vi.fn(),
    model,
    client,
  }
  const analytics = { track: vi.fn().mockResolvedValue(undefined) }
  const service = new OnboardingLocalNewsService(
    gemini as never,
    braintrust as never,
    cache as never,
    analytics as never,
    createMockLogger(),
  )
  return { service, gemini, braintrust, cache, model, client, analytics }
}

function readyOutlets(extra: { name: string }[] = []) {
  return [
    {
      name: 'KMGH Denver7',
      type: 'TV',
      description: 'd',
      email: null,
      phone: null,
      address: null,
    },
    ...extra.map((e) => ({
      name: e.name,
      type: 'TV' as const,
      description: 'd',
      email: null,
      phone: null,
      address: null,
    })),
  ]
}

describe('OnboardingLocalNewsService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getLocalNews', () => {
    it('returns the cached outlets when the (office, city, state) row is ready', async () => {
      const { service, cache, gemini } = makeService()
      const outlets = readyOutlets()
      cache.findByJurisdiction.mockResolvedValue({
        ...cacheKey(),
        status: 'ready',
        startedAt: null,
        outlets,
      })

      const result = await service.getLocalNews({
        state: STATE,
        office: OFFICE,
        userId: USER_ID,
      })

      expect(result).toEqual({ status: 'ready', outlets })
      expect(cache.findByJurisdiction).toHaveBeenCalledWith(cacheKey())
      expect(gemini.generateStructured).not.toHaveBeenCalled()
    })

    it('does not serve a different jurisdiction — a Boulder fetch claims its own pending slot', async () => {
      // The bug this guards against: Denver City Council cache hit served to a
      // Boulder City Council fetch. With a jurisdiction-keyed table the Boulder
      // lookup simply misses (Denver is a separate row) and claims pending.
      const { service, cache, gemini, client } = makeService()
      cache.findByJurisdiction.mockResolvedValue(null)
      gemini.generateStructured.mockResolvedValue({ outlets: readyOutlets() })

      const result = await service.getLocalNews({
        state: STATE,
        city: 'Boulder',
        office: OFFICE,
        userId: USER_ID,
      })

      expect(result).toEqual({ status: 'pending' })
      // The atomic claim ran for Boulder's own (office, city, state) — not the
      // Denver row — so the interpolated values carry Boulder's jurisdiction.
      expect(client.$queryRaw).toHaveBeenCalledTimes(1)
      const claimValues = client.$queryRaw.mock.calls[0] ?? []
      expect(claimValues).toContain(OFFICE)
      expect(claimValues).toContain('Boulder')
      expect(claimValues).toContain(STATE)
    })

    it('returns pending without claiming when a fresh pending row exists', async () => {
      const { service, cache, gemini, model } = makeService()
      cache.findByJurisdiction.mockResolvedValue({
        ...cacheKey(),
        status: 'pending',
        startedAt: BigInt(Date.now() - 1000),
        outlets: null,
      })

      const result = await service.getLocalNews({
        state: STATE,
        office: OFFICE,
        userId: USER_ID,
      })

      expect(result).toEqual({ status: 'pending' })
      // Single read in getLocalNews; markPending is never reached.
      expect(cache.findByJurisdiction).toHaveBeenCalledTimes(1)
      expect(model.upsert).not.toHaveBeenCalled()
      expect(gemini.generateStructured).not.toHaveBeenCalled()
    })

    it('falls through a TTL-expired pending row into the atomic claim', async () => {
      const { service, cache, gemini, client } = makeService()
      const expired = {
        ...cacheKey(),
        status: 'pending' as const,
        startedAt: BigInt(Date.now() - PENDING_TTL_MS - 1000),
        outlets: null,
      }
      cache.findByJurisdiction.mockResolvedValue(expired)
      gemini.generateStructured.mockResolvedValue({ outlets: readyOutlets() })

      const result = await service.getLocalNews({
        state: STATE,
        office: OFFICE,
        userId: USER_ID,
      })

      expect(result).toEqual({ status: 'pending' })
      // A stale/expired pending row falls through to the atomic claim, which
      // re-takes the slot (its WHERE clause matches the stale startedAt).
      expect(client.$queryRaw).toHaveBeenCalledTimes(1)
      const claimValues = client.$queryRaw.mock.calls[0] ?? []
      expect(claimValues).toContain(OFFICE)
      expect(claimValues).toContain(STATE)
    })

    it("doesn't run the fetch when the atomic claim is lost to a concurrent caller", async () => {
      const { service, cache, client, gemini } = makeService()
      cache.findByJurisdiction.mockResolvedValue(null)
      // Another caller already holds a fresh pending marker, so the ON CONFLICT
      // WHERE clause matches nothing and the claim returns no row.
      client.$queryRaw.mockResolvedValue([])

      const result = await service.getLocalNews({
        state: STATE,
        office: OFFICE,
        userId: USER_ID,
      })

      expect(result).toEqual({ status: 'pending' })
      expect(client.$queryRaw).toHaveBeenCalledTimes(1)
      expect(gemini.generateStructured).not.toHaveBeenCalled()
    })

    it('expires the pending marker (startedAt: 0) when the background fetch fails', async () => {
      const { service, cache, gemini, model } = makeService()
      cache.findByJurisdiction
        // getLocalNews lookup (miss); the atomic claim then wins the slot
        .mockResolvedValueOnce(null)
        // expirePending re-read sees the pending marker this caller wrote
        .mockResolvedValue({
          ...cacheKey(),
          status: 'pending',
          startedAt: BigInt(12345),
          outlets: null,
        })
      gemini.generateStructured.mockRejectedValue(new Error('Gemini exploded'))

      await service.getLocalNews({
        state: STATE,
        office: OFFICE,
        userId: USER_ID,
      })

      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))

      const expireWrite = model.update.mock.calls[0]?.[0]
      expect(expireWrite).toBeDefined()
      expect(expireWrite?.where).toEqual({
        jurisdiction: { office: OFFICE, city: CITY, state: STATE },
      })
      expect(expireWrite?.data).toEqual({ status: 'pending', startedAt: 0n })
    })

    it('persists outlets from gemini.generateStructured on a successful fetch', async () => {
      const { service, cache, gemini, model, analytics } = makeService()
      const aiOutlets = readyOutlets([{ name: 'Denver Post' }])
      cache.findByJurisdiction.mockResolvedValue(null)
      gemini.generateStructured.mockResolvedValue({ outlets: aiOutlets })

      await service.getLocalNews({
        state: STATE,
        office: OFFICE,
        userId: USER_ID,
      })

      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))

      const readyWrite = model.upsert.mock.calls.find(
        (call) => call[0]?.update.status === 'ready',
      )?.[0]
      expect(readyWrite?.where).toEqual({
        jurisdiction: { office: OFFICE, city: CITY, state: STATE },
      })
      expect(readyWrite?.update).toEqual({
        status: 'ready',
        startedAt: null,
        outlets: aiOutlets,
      })

      // Analytics is keyed on the resolved userId (campaign-less EOs have no
      // campaignId, so it must not appear in the payload).
      const startedCall = analytics.track.mock.calls[0]
      expect(startedCall?.[0]).toBe(USER_ID)
      expect(startedCall?.[2]).not.toHaveProperty('campaignId')

      // The search stage must run with jurisdiction + office embedded in the
      // prompt (the XML-wrapped prompt-injection defense lives in
      // buildSearchPrompt), and its text must flow into the structured stage.
      expect(gemini.generateWithSearch).toHaveBeenCalledTimes(1)
      const searchPrompt = gemini.generateWithSearch.mock.calls[0]?.[0] as
        | string
        | undefined
      expect(searchPrompt).toContain(STATE)
      expect(searchPrompt).toContain(OFFICE)
      const structuredPrompt = gemini.generateStructured.mock.calls[0]?.[0] as
        | string
        | undefined
      expect(structuredPrompt).toContain('mock search results')
    })
  })
})
