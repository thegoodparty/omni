import { AnalyticsService } from '@/analytics/analytics.service'
import { useTestService } from '@/test-service'
import { GeminiService } from '@/vendors/google/services/gemini.service'
import { describe, expect, it, vi } from 'vitest'
import { OnboardingLocalNewsService } from './localNews.service'
import { LocalNewsCacheService } from './localNewsCache.service'

const service = useTestService()

const PENDING_TTL_MS = 5 * 60 * 1000
const OFFICE = 'Denver City Council - District 9'
const STATE = 'CO'
const USER_ID = 42
// city is intentionally absent on most onboarding callers; the table stores
// it as "" so the (office, city, state) compound unique still behaves as a key.
const CITY = ''

const readyOutlets = (extra: { name: string }[] = []) => [
  {
    name: 'KMGH Denver7',
    type: 'TV' as const,
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

const setup = () => {
  const gemini = service.app.get(GeminiService)
  const generateWithSearch = vi
    .spyOn(gemini, 'generateWithSearch')
    .mockResolvedValue({
      text: 'mock search results',
      searchQueries: [],
      sources: [],
    })
  const generateStructured = vi.spyOn(gemini, 'generateStructured')
  const track = vi
    .spyOn(service.app.get(AnalyticsService), 'track')
    .mockResolvedValue(undefined)
  return {
    localNews: service.app.get(OnboardingLocalNewsService),
    generateWithSearch,
    generateStructured,
    track,
  }
}

const seedRow = (data: {
  city?: string
  status: 'pending' | 'ready'
  startedAt: bigint | null
  outlets?: ReturnType<typeof readyOutlets>
}) =>
  service.prisma.localNewsCache.create({
    data: { office: OFFICE, state: STATE, city: CITY, ...data },
  })

const readRow = (city = CITY) =>
  service.prisma.localNewsCache.findUniqueOrThrow({
    where: { jurisdiction: { office: OFFICE, city, state: STATE } },
  })

describe('OnboardingLocalNewsService.getLocalNews', () => {
  it('returns the cached outlets when the (office, city, state) row is ready', async () => {
    const { localNews, generateWithSearch } = setup()
    const outlets = readyOutlets()
    await seedRow({ status: 'ready', startedAt: null, outlets })

    const result = await localNews.getLocalNews({
      state: STATE,
      office: OFFICE,
      userId: USER_ID,
    })

    expect(result).toEqual({ status: 'ready', outlets })
    expect(generateWithSearch).not.toHaveBeenCalled()
  })

  it('does not serve a different jurisdiction — a Boulder fetch claims its own pending slot', async () => {
    // The bug this guards against: Denver City Council cache hit served to a
    // Boulder City Council fetch.
    const { localNews, generateStructured } = setup()
    generateStructured.mockResolvedValue({ outlets: readyOutlets() })
    const denverOutlets = readyOutlets([{ name: 'Denver Post' }])
    await seedRow({ status: 'ready', startedAt: null, outlets: denverOutlets })

    const result = await localNews.getLocalNews({
      state: STATE,
      city: 'Boulder',
      office: OFFICE,
      userId: USER_ID,
    })

    expect(result).toEqual({ status: 'pending' })
    await vi.waitFor(async () => {
      expect((await readRow('Boulder')).status).toBe('ready')
    })
    expect((await readRow()).outlets).toEqual(denverOutlets)
  })

  // writeReady sets started_at = NULL on ready rows, so a claim that reached
  // the database after a concurrent fetch finished must leave that row alone
  // rather than reset it to pending and null its outlets.
  it('never clobbers a ready row that landed after the cache read', async () => {
    const { localNews, generateWithSearch } = setup()
    const outlets = readyOutlets()
    await seedRow({ status: 'ready', startedAt: null, outlets })
    vi.spyOn(
      service.app.get(LocalNewsCacheService),
      'findByJurisdiction',
    ).mockResolvedValue(null)

    const result = await localNews.getLocalNews({
      state: STATE,
      office: OFFICE,
      userId: USER_ID,
    })

    expect(result).toEqual({ status: 'pending' })
    const row = await readRow()
    expect(row.status).toBe('ready')
    expect(row.outlets).toEqual(outlets)
    expect(generateWithSearch).not.toHaveBeenCalled()
  })

  it('returns pending without claiming when a fresh pending row exists', async () => {
    const { localNews, generateWithSearch } = setup()
    const startedAt = BigInt(Date.now() - 1000)
    await seedRow({ status: 'pending', startedAt })

    const result = await localNews.getLocalNews({
      state: STATE,
      office: OFFICE,
      userId: USER_ID,
    })

    expect(result).toEqual({ status: 'pending' })
    expect((await readRow()).startedAt).toBe(startedAt)
    expect(generateWithSearch).not.toHaveBeenCalled()
  })

  it('re-claims a TTL-expired pending row and runs the fetch', async () => {
    const { localNews, generateWithSearch, generateStructured } = setup()
    generateStructured.mockResolvedValue({ outlets: readyOutlets() })
    await seedRow({
      status: 'pending',
      startedAt: BigInt(Date.now() - PENDING_TTL_MS - 1000),
    })

    const result = await localNews.getLocalNews({
      state: STATE,
      office: OFFICE,
      userId: USER_ID,
    })

    expect(result).toEqual({ status: 'pending' })
    await vi.waitFor(async () => {
      expect((await readRow()).status).toBe('ready')
    })
    expect(generateWithSearch).toHaveBeenCalledTimes(1)
  })

  // React Strict-Mode double mounts and multiple tabs send the same request
  // at once. The single-statement claim is what keeps that to one Gemini run.
  it('runs one fetch for concurrent callers on the same jurisdiction', async () => {
    const { localNews, generateWithSearch, generateStructured } = setup()
    generateStructured.mockResolvedValue({ outlets: readyOutlets() })

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        localNews.getLocalNews({
          state: STATE,
          office: OFFICE,
          userId: USER_ID,
        }),
      ),
    )

    expect(results).toEqual([
      { status: 'pending' },
      { status: 'pending' },
      { status: 'pending' },
    ])
    await vi.waitFor(async () => {
      expect((await readRow()).status).toBe('ready')
    })
    expect(generateWithSearch).toHaveBeenCalledTimes(1)
  })

  it('expires the pending marker when the background fetch fails', async () => {
    const { localNews, generateStructured } = setup()
    generateStructured.mockRejectedValue(new Error('Gemini exploded'))

    await localNews.getLocalNews({
      state: STATE,
      office: OFFICE,
      userId: USER_ID,
    })

    await vi.waitFor(async () => {
      expect((await readRow()).startedAt).toBe(0n)
    })
    const row = await readRow()
    expect(row.status).toBe('pending')
    expect(row.outlets).toBeNull()
  })

  it('persists outlets from gemini.generateStructured on a successful fetch', async () => {
    const { localNews, generateWithSearch, generateStructured, track } = setup()
    const aiOutlets = readyOutlets([{ name: 'Denver Post' }])
    generateStructured.mockResolvedValue({ outlets: aiOutlets })

    await localNews.getLocalNews({
      state: STATE,
      office: OFFICE,
      userId: USER_ID,
    })

    await vi.waitFor(async () => {
      expect((await readRow()).status).toBe('ready')
    })
    const row = await readRow()
    expect(row.outlets).toEqual(aiOutlets)
    expect(row.startedAt).toBeNull()

    // Analytics is keyed on the resolved userId (campaign-less EOs have no
    // campaignId, so it must not appear in the payload).
    const startedCall = track.mock.calls[0]
    expect(startedCall?.[0]).toBe(USER_ID)
    expect(startedCall?.[2]).not.toHaveProperty('campaignId')

    // The search stage must run with jurisdiction + office embedded in the
    // prompt, and its text must flow into the structured stage.
    expect(generateWithSearch).toHaveBeenCalledTimes(1)
    const searchPrompt = generateWithSearch.mock.calls[0]?.[0]
    expect(searchPrompt).toContain(STATE)
    expect(searchPrompt).toContain(OFFICE)
    expect(generateStructured.mock.calls[0]?.[0]).toContain(
      'mock search results',
    )
  })
})
