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
  const cache = {
    findByJurisdiction: vi.fn(),
    model,
  }
  const analytics = { track: vi.fn().mockResolvedValue(undefined) }
  const service = new OnboardingLocalNewsService(
    gemini as never,
    braintrust as never,
    cache as never,
    analytics as never,
    createMockLogger(),
  )
  return { service, gemini, braintrust, cache, model, analytics }
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
      const { service, cache, gemini, model } = makeService()
      cache.findByJurisdiction.mockResolvedValue(null)
      gemini.generateStructured.mockResolvedValue({ outlets: readyOutlets() })

      const result = await service.getLocalNews({
        state: STATE,
        city: 'Boulder',
        office: OFFICE,
        userId: USER_ID,
      })

      expect(result).toEqual({ status: 'pending' })
      const claimWrite = model.upsert.mock.calls[0]?.[0]
      expect(claimWrite?.where).toEqual({
        jurisdiction: { office: OFFICE, city: 'Boulder', state: STATE },
      })
      expect(claimWrite?.create).toMatchObject({
        office: OFFICE,
        city: 'Boulder',
        state: STATE,
        status: 'pending',
      })
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

    it('falls through a TTL-expired pending row into markPending', async () => {
      const { service, cache, gemini, model } = makeService()
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
      const claimWrite = model.upsert.mock.calls[0]?.[0]
      expect(claimWrite?.where).toEqual({
        jurisdiction: { office: OFFICE, city: CITY, state: STATE },
      })
      expect(claimWrite?.update).toMatchObject({ status: 'pending' })
      const claimStartedAt = claimWrite?.update.startedAt
      expect(typeof claimStartedAt).toBe('bigint')
      expect(claimStartedAt).toBeGreaterThan(0n)
      // The pending claim clears any stale outlets from a prior ready write.
      expect(claimWrite?.update.outlets).toBeDefined()
    })

    it("doesn't claim the slot when re-read shows a fresh pending row from another caller", async () => {
      const { service, cache, model } = makeService()
      cache.findByJurisdiction
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
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
      expect(cache.findByJurisdiction).toHaveBeenCalledTimes(2)
      expect(model.upsert).not.toHaveBeenCalled()
    })

    it('expires the pending marker (startedAt: 0) when the background fetch fails', async () => {
      const { service, cache, gemini, model } = makeService()
      cache.findByJurisdiction
        // getLocalNews lookup (miss) then markPending re-read (miss)
        .mockResolvedValueOnce(null)
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
