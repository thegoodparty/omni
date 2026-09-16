import { describe, expect, it, vi } from 'vitest'
import { AffectedResidentsService } from './services/affectedResidents.service'
import { AffectedResidentsListSchema } from './schemas/affectedResidents.schema'

// Synthetic throughout. Real lists are individual-level L2 records and live in
// S3, never in this repo, so every name, address and number below is invented
// and every phone is in the 555 reserved range.
const ISSUE_ID = '01a099cd-0000-0000-0000-000000000001'
const ORG = 'eo-00000000-0000-0000-0000-000000000002'

const makeResident = (overrides: Record<string, unknown> = {}) => ({
  rank: 1,
  name: 'Test Resident',
  address: '100 Example St Apt 1',
  city: 'Testville',
  zip: '00000',
  phone: '(555) 010-0001',
  phoneType: 'cell' as const,
  lat: 44.75,
  lon: -85.6,
  affectednessScore: 1,
  rankingScore: 1,
  factorScores: { unit: 1, dwelling: 1, size: 1 },
  confidence: { score: 1, note: '100 m inside the published boundary.' },
  age: { years: 30, basis: 'exact' as const },
  attributes: [{ label: 'Neighbourhood', value: 'Example Heights' }],
  why: 'Unit-numbered address in a building recorded multi-family.',
  ...overrides,
})

const makeList = (overrides: Record<string, unknown> = {}) => ({
  issue: {
    communityIssueId: ISSUE_ID,
    organizationSlug: ORG,
    title: 'Example tax-break district',
    jurisdiction: 'Testville, MI',
    runDate: '2026-09-15',
    sourceList: 'EXAMPLE.csv',
    summary: 'An example issue for tests.',
    affectednessRead: 'Who this reaches and why.',
    gates: [{ label: 'Representation', detail: 'At-large seat.' }],
    useCase: 'Test fixture.',
    scoringRule: 'Weighted average over the factors present.',
    factors: [
      {
        key: 'unit',
        label: 'Unit-numbered address',
        weight: 1,
        rule: '1 or 0.',
      },
      {
        key: 'dwelling',
        label: 'Dwelling type',
        weight: 0.8,
        rule: '1, 0 or null.',
      },
      { key: 'size', label: 'Voters at address', weight: 0.5, rule: 'Banded.' },
    ],
    rankingNote: 'Ordered by the saved ranking score.',
    caveats: ['A null factor is skipped, not penalized.'],
    ...overrides,
  },
  residents: [makeResident()],
})

describe('AffectedResidentsListSchema', () => {
  it('accepts a well-formed list', () => {
    expect(AffectedResidentsListSchema.safeParse(makeList()).success).toBe(true)
  })

  it('keeps a null factor score distinct from a zero', () => {
    const list = makeList()
    list.residents = [
      makeResident({
        factorScores: { unit: 1, dwelling: null, size: 0.35 },
        affectednessScore: 0.783,
      }),
    ]
    const parsed = AffectedResidentsListSchema.safeParse(list)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.residents[0]?.factorScores.dwelling).toBeNull()
    }
  })

  it('rejects a list with no caveats', () => {
    // The runbook's rule: a score never ships without the coverage caveats that
    // qualify it, so an empty array is a bug rather than a list without limits.
    expect(
      AffectedResidentsListSchema.safeParse(makeList({ caveats: [] })).success,
    ).toBe(false)
  })

  it('rejects a resident scored on a factor the issue never declared', () => {
    const list = makeList()
    list.residents = [
      makeResident({
        factorScores: { unit: 1, dwelling: 1, size: 1, proximity: 0.9 },
      }),
    ]
    const parsed = AffectedResidentsListSchema.safeParse(list)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) => i.message.includes('proximity')),
      ).toBe(true)
    }
  })

  it('rejects a resident missing a declared factor, which is not the same as a null one', () => {
    const list = makeList()
    list.residents = [makeResident({ factorScores: { unit: 1, size: 1 } })]
    const parsed = AffectedResidentsListSchema.safeParse(list)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) =>
          i.message.includes('missing declared factor'),
        ),
      ).toBe(true)
    }
  })

  it('rejects duplicate factor keys', () => {
    const list = makeList({
      factors: [
        { key: 'unit', label: 'A', weight: 1, rule: 'x' },
        { key: 'unit', label: 'B', weight: 1, rule: 'y' },
      ],
    })
    expect(AffectedResidentsListSchema.safeParse(list).success).toBe(false)
  })

  it('rejects non-contiguous ranks, because the order is the frozen list', () => {
    const list = makeList()
    list.residents = [makeResident({ rank: 1 }), makeResident({ rank: 3 })]
    const parsed = AffectedResidentsListSchema.safeParse(list)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) => i.message.includes('contiguous')),
      ).toBe(true)
    }
  })

  it('carries the age basis so a year-only age is not shown as exact', () => {
    const list = makeList()
    list.residents = [
      makeResident({ age: { years: 25, basis: 'year-only' as const } }),
    ]
    const parsed = AffectedResidentsListSchema.safeParse(list)
    expect(parsed.success).toBe(true)
    if (parsed.success)
      expect(parsed.data.residents[0]?.age?.basis).toBe('year-only')
  })
})

describe('AffectedResidentsService', () => {
  const build = (
    s3Body: string | undefined,
    issueRow: { id: string } | null = { id: ISSUE_ID },
  ) => {
    const s3 = { getFile: vi.fn().mockResolvedValue(s3Body) }
    const service = new AffectedResidentsService(
      s3 as unknown as ConstructorParameters<
        typeof AffectedResidentsService
      >[0],
    )
    // The Prisma base resolves `model` at call time; stub the one read used.
    Object.defineProperty(service, 'model', {
      value: { findFirst: vi.fn().mockResolvedValue(issueRow) },
      configurable: true,
    })
    Object.defineProperty(service, 'logger', {
      value: { warn: vi.fn(), error: vi.fn() },
      configurable: true,
    })
    return { service, s3 }
  }

  it('returns null for an issue that is not this office’s, without reading S3', async () => {
    const { service, s3 } = build(JSON.stringify(makeList()), null)
    await expect(service.getForIssue(ISSUE_ID, ORG)).resolves.toBeNull()
    expect(s3.getFile).not.toHaveBeenCalled()
  })

  it('returns null when the bucket holds nothing for the issue', async () => {
    const { service } = build(undefined)
    await expect(service.getForIssue(ISSUE_ID, ORG)).resolves.toBeNull()
  })

  it('refuses a payload keyed under a different issue', async () => {
    const body = JSON.stringify(
      makeList({ communityIssueId: 'some-other-issue' }),
    )
    const { service } = build(body)
    await expect(service.getForIssue(ISSUE_ID, ORG)).resolves.toBeNull()
  })

  it('refuses a payload belonging to a different office', async () => {
    const body = JSON.stringify(
      makeList({ organizationSlug: 'eo-someone-else' }),
    )
    const { service } = build(body)
    await expect(service.getForIssue(ISSUE_ID, ORG)).resolves.toBeNull()
  })

  it('refuses a list that fails validation rather than serving what parsed', async () => {
    const body = JSON.stringify(makeList({ caveats: [] }))
    const { service } = build(body)
    await expect(service.getForIssue(ISSUE_ID, ORG)).resolves.toBeNull()
  })

  it('returns null rather than throwing when the bucket read fails', async () => {
    const s3 = { getFile: vi.fn().mockRejectedValue(new Error('boom')) }
    const service = new AffectedResidentsService(
      s3 as unknown as ConstructorParameters<
        typeof AffectedResidentsService
      >[0],
    )
    Object.defineProperty(service, 'model', {
      value: { findFirst: vi.fn().mockResolvedValue({ id: ISSUE_ID }) },
      configurable: true,
    })
    Object.defineProperty(service, 'logger', {
      value: { warn: vi.fn(), error: vi.fn() },
      configurable: true,
    })
    await expect(service.getForIssue(ISSUE_ID, ORG)).resolves.toBeNull()
  })

  it('serves a matching list and caches it, so a second read does not refetch', async () => {
    const { service, s3 } = build(JSON.stringify(makeList()))
    const first = await service.getForIssue(ISSUE_ID, ORG)
    expect(first?.issue.communityIssueId).toBe(ISSUE_ID)
    await service.getForIssue(ISSUE_ID, ORG)
    expect(s3.getFile).toHaveBeenCalledTimes(1)
  })
})
