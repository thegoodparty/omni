import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OpponentResearchService } from './opponentResearch.service'
import { RaceOpponentService } from './raceOpponent.service'

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
  let raceOpponent: RaceOpponentService
  let electionApi: { getRaceContext: ReturnType<typeof vi.fn> }
  let storyFindUnique: ReturnType<typeof vi.fn>
  let websiteFindUnique: ReturnType<typeof vi.fn>

  // The platform is now sourced entirely from Website.content.about: bio maps
  // to background, and the issues string is fed through a single website issue
  // whose serialized form is that text. There is no `why` on the website.
  const build = (
    platform: {
      background: string | null
      issues: string | null
    } | null,
  ) => {
    websiteFindUnique.mockResolvedValue(
      platform && (platform.background || platform.issues)
        ? {
            content: {
              about: {
                ...(platform.background ? { bio: platform.background } : {}),
                ...(platform.issues
                  ? {
                      issues: [
                        { title: 'Platform', description: platform.issues },
                      ],
                    }
                  : {}),
              },
            },
          }
        : null,
    )
    return service['buildParams'](
      { id: 42, details: { raceId: RACE_ID, city: 'Fayetteville' } } as never,
      OPPONENT,
    )
  }

  beforeEach(() => {
    electionApi = { getRaceContext: vi.fn(async () => raceContext) }
    storyFindUnique = vi.fn()
    websiteFindUnique = vi.fn()
    // The real RaceOpponentService owns buildCandidatePlatform — exercise it
    // (rather than mocking it away) so the test verifies the real Website read.
    raceOpponent = new RaceOpponentService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )
    Object.assign(raceOpponent, {
      _prisma: {
        campaignStory: { findUnique: storyFindUnique },
        website: { findUnique: websiteFindUnique },
      },
      logger: { warn: vi.fn(), error: vi.fn() },
    })
    service = new OpponentResearchService(
      raceOpponent,
      {} as never,
      {} as never,
      electionApi as never,
    )
    // _prisma and logger are property-injected by Nest; stub them for a direct
    // instantiation (Object.assign sidesteps their readonly declarations).
    Object.assign(service, {
      _prisma: {
        campaignStory: { findUnique: storyFindUnique },
        website: { findUnique: websiteFindUnique },
      },
      logger: { warn: vi.fn(), error: vi.fn() },
    })
  })

  it('sources a small platform from the website, not the campaign story', async () => {
    const out = await build({
      background: 'Lifelong resident',
      issues: 'Roads, schools, taxes',
    })

    expect(out.candidate_platform).toEqual({
      background: 'Lifelong resident',
      // serializeWebsiteIssues joins title + description.
      issues: 'Platform\nRoads, schools, taxes',
    })
    expect(websiteFindUnique).toHaveBeenCalledTimes(1)
    expect(storyFindUnique).not.toHaveBeenCalled()
    expect(out.opponent.full_name).toBe(OPPONENT)
    expect(out.opponent.is_incumbent).toBe(true)
    expect(out.race_context.state).toBe('NC')
    expect(out.race_context.office_name).toBe('Fayetteville City Council')
  })

  it('trims an oversized platform so the serialized params fit the cap', async () => {
    const out = await build({
      background: 'b'.repeat(12000),
      issues: 'i'.repeat(12000),
    })

    expect(bytesOf(out)).toBeLessThanOrEqual(PARAMS_CAP)
    // issues is the highest-priority field, so it survives (truncated).
    expect(out.candidate_platform?.issues?.length ?? 0).toBeGreaterThan(0)
    expect(out.candidate_platform?.issues?.length).toBeLessThan(12000)
  })

  it('prioritizes issues over background when only one field fits', async () => {
    // A single maxed field already exceeds the budget, so only issues (the
    // highest-priority field) survives; background is dropped.
    const out = await build({
      background: 'b'.repeat(12000),
      issues: 'i'.repeat(12000),
    })

    expect(bytesOf(out)).toBeLessThanOrEqual(PARAMS_CAP)
    expect(out.candidate_platform?.issues).toBeTruthy()
    expect(out.candidate_platform?.background).toBeUndefined()
  })

  it('keeps params under the cap even when escaping inflates the text', async () => {
    // Quotes and newlines each escape to two bytes; truncating by raw bytes
    // alone could still bust the cap, so the corrective pass must re-measure.
    const out = await build({
      background: null,
      issues: '"\n'.repeat(8000),
    })

    expect(bytesOf(out)).toBeLessThanOrEqual(PARAMS_CAP)
  })

  it('does not split a multibyte character when truncating', async () => {
    const out = await build({
      background: null,
      issues: '🚗'.repeat(4000),
    })

    expect(bytesOf(out)).toBeLessThanOrEqual(PARAMS_CAP)
    // A clean UTF-8 string round-trips byte-for-byte; a split surrogate would
    // re-encode to the replacement char and change the length. The serialized
    // block is the issue's title + newline + the emoji description, so check
    // the description tail (after 'Platform\n') is all intact car emoji.
    const issues = out.candidate_platform?.issues ?? ''
    expect(Buffer.from(issues, 'utf8').toString('utf8')).toBe(issues)
    const emojiTail = issues.replace(/^Platform\n/, '')
    expect(emojiTail.length).toBeGreaterThan(0)
    expect([...emojiTail].every((ch) => ch === '🚗')).toBe(true)
  })

  it('omits the platform when the website has no bio or issues', async () => {
    const out = await build(null)

    expect(out.candidate_platform).toBeNull()
    expect(websiteFindUnique).toHaveBeenCalledTimes(1)
    expect(storyFindUnique).not.toHaveBeenCalled()
    expect(out.opponent.full_name).toBe(OPPONENT)
  })
})
