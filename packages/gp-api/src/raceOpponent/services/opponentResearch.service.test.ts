import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OpponentResearchService } from './opponentResearch.service'

const RACE_ID = 'br-race-1'
const OPPONENT = 'Jane Doe'

const raceContext = {
  state: 'NC',
  candidateOffice: 'City Council',
  officialOfficeName: 'Fayetteville City Council',
  officeLevel: null,
  officeType: null,
  primaryElectionDate: null,
  generalElectionDate: '2026-11-03',
  relevantElectionDate: null,
  numberOfSeats: 1,
  projectedTurnout: null,
  civicsWinNumber: null,
  winNumberEstimate: null,
  winNumberEffective: null,
  contactsNeededEstimate: null,
  candidateCount: 1,
  candidates: [
    {
      gpCandidateId: null,
      firstName: 'Jane',
      lastName: 'Doe',
      fullName: 'Jane Doe',
      email: null,
      websiteUrl: 'https://jane.example.com',
      party: 'Independent',
      isIncumbent: true,
    },
  ],
}

const bytesOf = (out: unknown) => Buffer.byteLength(JSON.stringify(out))

describe('OpponentResearchService.buildParams', () => {
  // The service's internal compact-bytes invariant. It budgets below the PMF
  // Engine's raw 6000-byte cap so the agent's spaced (json.dumps) serialization
  // still fits; asserting against the raw 6000 would be tautological.
  const PARAMS_CAP = 5000

  let service: OpponentResearchService
  let electionApi: { getRaceContext: ReturnType<typeof vi.fn> }
  let findUnique: ReturnType<typeof vi.fn>

  const build = (story: unknown) => {
    findUnique.mockResolvedValue(story)
    return service['buildParams'](
      { id: 42, details: { raceId: RACE_ID, city: 'Fayetteville' } } as never,
      OPPONENT,
    )
  }

  beforeEach(() => {
    electionApi = { getRaceContext: vi.fn(async () => raceContext) }
    findUnique = vi.fn()
    service = new OpponentResearchService(
      {} as never,
      {} as never,
      {} as never,
      electionApi as never,
    )
    // _prisma and logger are property-injected by Nest; stub them for a direct
    // instantiation (Object.assign sidesteps their readonly declarations).
    Object.assign(service, {
      _prisma: { campaignStory: { findUnique } },
      logger: { warn: vi.fn(), error: vi.fn() },
    })
  })

  it('passes a small platform through untouched', async () => {
    const story = {
      why: 'To fix the roads',
      background: 'Lifelong resident',
      issues: 'Roads, schools, taxes',
    }

    const out = await build(story)

    expect(out.candidate_platform).toEqual(story)
    expect(out.opponent.full_name).toBe(OPPONENT)
    expect(out.opponent.is_incumbent).toBe(true)
    expect(out.race_context.state).toBe('NC')
    expect(out.race_context.office_name).toBe('Fayetteville City Council')
  })

  it('trims an oversized platform so the serialized params fit the cap', async () => {
    const out = await build({
      why: 'w'.repeat(12000),
      background: 'b'.repeat(12000),
      issues: 'i'.repeat(12000),
    })

    expect(bytesOf(out)).toBeLessThanOrEqual(PARAMS_CAP)
    // issues is the highest-priority field, so it survives (truncated).
    expect(out.candidate_platform?.issues?.length ?? 0).toBeGreaterThan(0)
    expect(out.candidate_platform?.issues?.length).toBeLessThan(12000)
  })

  it('prioritizes issues over why/background when only one field fits', async () => {
    // A single maxed field already exceeds the budget, so only issues (the
    // highest-priority field) survives; why and background are dropped.
    const out = await build({
      why: 'w'.repeat(12000),
      background: 'b'.repeat(12000),
      issues: 'i'.repeat(12000),
    })

    expect(bytesOf(out)).toBeLessThanOrEqual(PARAMS_CAP)
    expect(out.candidate_platform?.issues).toBeTruthy()
    expect(out.candidate_platform?.why).toBeUndefined()
    expect(out.candidate_platform?.background).toBeUndefined()
  })

  it('keeps params under the cap even when escaping inflates the text', async () => {
    // Quotes and newlines each escape to two bytes; truncating by raw bytes
    // alone could still bust the cap, so the corrective pass must re-measure.
    const out = await build({
      why: null,
      background: null,
      issues: '"\n'.repeat(8000),
    })

    expect(bytesOf(out)).toBeLessThanOrEqual(PARAMS_CAP)
  })

  it('does not split a multibyte character when truncating', async () => {
    const out = await build({
      why: null,
      background: null,
      issues: '🚗'.repeat(4000),
    })

    expect(bytesOf(out)).toBeLessThanOrEqual(PARAMS_CAP)
    // A clean UTF-8 string round-trips byte-for-byte; a split surrogate would
    // re-encode to the replacement char and change the length.
    const issues = out.candidate_platform?.issues ?? ''
    expect(Buffer.from(issues, 'utf8').toString('utf8')).toBe(issues)
    expect([...issues].every((ch) => ch === '🚗')).toBe(true)
  })

  it('passes a null platform through when there is no campaign story', async () => {
    const out = await build(null)

    expect(out.candidate_platform).toBeNull()
    expect(out.opponent.full_name).toBe(OPPONENT)
  })
})
