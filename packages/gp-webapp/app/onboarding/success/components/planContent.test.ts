import { describe, expect, it } from 'vitest'
import {
  buildPlanData,
  type PlanData,
  type PlanInput,
  type TimelineRow,
} from './planContent'

// Minimum-viable PlanInput fixture. Tests override only the fields under
// test (state, milestones). Election date is fixed at a known Tue in the
// future so date math is stable.
const ELECTION_DATE_ISO = '2026-11-03'

const makeInput = (overrides: Partial<PlanInput> = {}): PlanInput => ({
  candidateName: 'Test Candidate',
  race: 'Test Office',
  district: '',
  city: '',
  state: 'CA',
  partisanType: 'nonpartisan',
  electionDateIso: ELECTION_DATE_ISO,
  filingDateStartIso: '2026-07-01',
  filingDateEndIso: '2026-08-07',
  winNumber: 1000,
  projectedTurnout: 2000,
  voterContactGoal: 5000,
  runningAgainst: [],
  customIssues: [],
  stances: [],
  hubspotIncumbent: null,
  filingFee: null,
  filingRequirementsText: null,
  registeredVoters: null,
  uniqueCellphones: null,
  uniqueLandlines: null,
  raceCandidates: [],
  milestones: null,
  ...overrides,
})

// The timeline is grouped into stages for rendering; flatten it so the
// milestone assertions below don't care which stage a row landed in.
const timelineRows = (plan: PlanData): TimelineRow[] =>
  plan.timelineStages.flatMap((stage) => stage.items)

const REGISTRATION_DEADLINE = 'Last day for people to register to vote'
const ABSENTEE_DEADLINE = 'Last day to request a mail ballot'

describe('buildPlanData voter-registration deadline — no-deadline states', () => {
  const ND_COPY =
    'There is no registration deadline as North Dakota has no voter registration requirement.'
  const SDR_COPY =
    'There is no registration deadline as there is same day voting.'

  it('renders the ND-specific copy (no registration requirement, not same-day registration)', () => {
    const plan = buildPlanData(makeInput({ state: 'ND' }))

    expect(
      timelineRows(plan).some((row) => row.milestone === REGISTRATION_DEADLINE),
    ).toBe(false)
    const regRow = timelineRows(plan).find(
      (row) => row.milestone === 'Voter registration',
    )
    expect(regRow).toBeDefined()
    // ND has no voter registration system — the SDR copy would be a
    // wrong legal basis.
    expect(regRow?.notes).toBe(ND_COPY)
    expect(regRow?.notes).not.toContain('same day voting')

    expect(
      plan.keyDates.some((d) =>
        d.description.startsWith(REGISTRATION_DEADLINE),
      ),
    ).toBe(false)
    expect(plan.keyDates.some((d) => d.description === ND_COPY)).toBe(true)
  })

  it('renders the no-deadline copy for VT (same-day registration through ED) and also suppresses the absentee row (VT is universal VBM)', () => {
    const plan = buildPlanData(makeInput({ state: 'VT' }))

    expect(
      timelineRows(plan).some((row) => row.milestone === REGISTRATION_DEADLINE),
    ).toBe(false)
    const regRow = timelineRows(plan).find(
      (row) => row.milestone === 'Voter registration',
    )
    expect(regRow).toBeDefined()
    // VT's tier note is "Online ED; Mail ED; In-person ED" — redundant
    // with the same-day-voting sentence, so it should NOT be appended.
    expect(regRow?.notes).toBe(SDR_COPY)
    expect(plan.keyDates.some((d) => d.description === SDR_COPY)).toBe(true)

    // VT is the only state that hits BOTH `voterRegHasNoDeadline` and
    // `absenteeOmitted` (universal VBM). Without this assertion a
    // regression on the absentee suppression branch for VT-shaped data
    // would slip through unnoticed.
    expect(
      timelineRows(plan).some((row) => row.milestone === ABSENTEE_DEADLINE),
    ).toBe(false)
    expect(
      plan.keyDates.some((d) => d.description.startsWith(ABSENTEE_DEADLINE)),
    ).toBe(false)
  })

  it('appends the local pre-registration tier note for NH', () => {
    const plan = buildPlanData(makeInput({ state: 'NH' }))

    const regRow = timelineRows(plan).find(
      (row) => row.milestone === 'Voter registration',
    )
    expect(regRow).toBeDefined()
    // NH has a meaningful tier note (locally-set deadlines) — the
    // pre-registration context should be surfaced after the
    // same-day-voting sentence rather than silently dropped.
    expect(regRow?.notes).toContain(SDR_COPY)
    expect(regRow?.notes).toContain('Local pre-registration')
    expect(regRow?.notes).toContain('Set locally')
  })
})

describe('buildPlanData absentee-request deadline omission', () => {
  it('omits the absentee request deadline for universal-VBM states (CA)', () => {
    const plan = buildPlanData(makeInput({ state: 'CA' }))

    expect(
      timelineRows(plan).some((row) => row.milestone === ABSENTEE_DEADLINE),
    ).toBe(false)
    expect(
      plan.keyDates.some((d) => d.description.startsWith(ABSENTEE_DEADLINE)),
    ).toBe(false)
  })

  it('uses the curated CA voter registration date (Oct 19) and ignores a conflicting BR milestone (Nov 2)', () => {
    // The real-world regression this guards: BR returned Nov 2 for CA
    // registration; the curated table has the correct Oct 19. Passing
    // the wrong BR value here proves the curated lookup wins — without
    // the conflicting BR value the E-offset fallback (electionDate-15 =
    // Oct 19) would produce the same date and the test would be
    // tautological.
    const plan = buildPlanData(
      makeInput({
        state: 'CA',
        milestones: {
          voter_registration: { start: null, end: '2026-11-02' },
          early_voting: null,
          request_ballot: null,
        },
      }),
    )

    const regRow = timelineRows(plan).find(
      (row) => row.milestone === REGISTRATION_DEADLINE,
    )
    expect(regRow).toBeDefined()
    // Timeline dates render in the template's day-of-week format.
    expect(regRow?.date).toBe('Monday, October 19')
    expect(regRow?.date).not.toContain('November 2')
    expect(regRow?.notes).toContain('Per state SOS data')
  })
})

describe('buildPlanData tier-note rendering', () => {
  it('renders the curated tier-note in the absentee row notes for AK', () => {
    const plan = buildPlanData(makeInput({ state: 'AK' }))

    const absenteeRow = timelineRows(plan).find(
      (row) => row.milestone === ABSENTEE_DEADLINE,
    )
    expect(absenteeRow).toBeDefined()
    expect(absenteeRow?.notes).toContain('Per state SOS data')
    expect(absenteeRow?.notes).toContain(
      'Method differences — Online Oct 19; Mail Oct 24',
    )
  })
})

describe('buildPlanData fallback for unknown state', () => {
  it('renders both deadline rows using the E-offset fallback when the state is not in the curated table', () => {
    // 'XX' is intentionally not in VOTER_DEADLINES_2026. The curated
    // lookup should miss and both rows should fall back to the
    // BR/E-offset path that previously drove everything.
    const plan = buildPlanData(makeInput({ state: 'XX' }))

    const regRow = timelineRows(plan).find(
      (row) => row.milestone === REGISTRATION_DEADLINE,
    )
    const absenteeRow = timelineRows(plan).find(
      (row) => row.milestone === ABSENTEE_DEADLINE,
    )

    expect(regRow).toBeDefined()
    expect(absenteeRow).toBeDefined()
    // E-offset fallback notes start with "Approximate." (no BR milestone
    // data passed in this test). The point is just that neither row is
    // suppressed and neither claims SOS data attribution.
    expect(regRow?.notes).not.toContain('Per state SOS data')
    expect(absenteeRow?.notes).not.toContain('Per state SOS data')
  })

  it('documents that universal-VBM absentee suppression is year-tied: CA in 2027 shows the absentee row', () => {
    // `isUniversalVbm` is logically a state characteristic, but the
    // year guard makes the curated lookup miss for non-2026-general
    // elections — so the absentee row reappears for CA/CO/HI/etc. in
    // 2027+ even though they are still universal-VBM states. The fix
    // is to separate year-agnostic state facts from the dated deadline
    // data; until then this test pins the current behavior so a
    // regression elsewhere doesn't quietly change it.
    const plan = buildPlanData(
      makeInput({ state: 'CA', electionDateIso: '2027-11-02' }),
    )

    const absenteeRow = timelineRows(plan).find(
      (row) => row.milestone === ABSENTEE_DEADLINE,
    )
    expect(absenteeRow).toBeDefined()
    expect(absenteeRow?.notes).not.toContain('Per state SOS data')
  })

  it('does not claim SOS authority for a 2026 primary (curated table covers the Nov general only)', () => {
    // A CA June primary has year=2026 but doesn't share the November
    // deadlines. The month gate keeps it on the BR / E-offset path so
    // the wrong dates aren't labeled as SOS-verified.
    const plan = buildPlanData(
      makeInput({ state: 'CA', electionDateIso: '2026-06-02' }),
    )

    const regRow = timelineRows(plan).find(
      (row) => row.milestone === REGISTRATION_DEADLINE,
    )
    expect(regRow).toBeDefined()
    expect(regRow?.notes).not.toContain('Per state SOS data')
    // And the absentee row is back in play for the same reason —
    // universal-VBM suppression depends on the curated lookup, which
    // is gated to the Nov 2026 general.
    const absenteeRow = timelineRows(plan).find(
      (row) => row.milestone === ABSENTEE_DEADLINE,
    )
    expect(absenteeRow).toBeDefined()
  })
})

describe('buildPlanData derived key numbers', () => {
  it('derives contacts per voter from the goal and win number', () => {
    const plan = buildPlanData(makeInput())
    expect(plan.contactsPerVoter).toBe(5)
  })

  it('computes the votes-needed share of registered voters', () => {
    const plan = buildPlanData(
      makeInput({ registeredVoters: 20000, winNumber: 1000 }),
    )
    expect(plan.votesNeededPctOfRegistered).toBe(5)
  })

  it('computes cellphone coverage and surfaces the cellphone opportunity row', () => {
    const plan = buildPlanData(
      makeInput({ registeredVoters: 20000, uniqueCellphones: 15000 }),
    )
    expect(plan.pctVotersWithCellphone).toBe(75)
    expect(
      plan.opportunityRows.some(
        (row) => row.title === 'Most of your voters have a cellphone',
      ),
    ).toBe(true)
  })

  it('drops the cellphone opportunity row when phone-match data is missing', () => {
    const plan = buildPlanData(makeInput({ uniqueCellphones: null }))
    expect(
      plan.opportunityRows.some(
        (row) => row.title === 'Most of your voters have a cellphone',
      ),
    ).toBe(false)
  })

  it('groups the timeline into the three template stages', () => {
    const plan = buildPlanData(makeInput())
    expect(plan.timelineStages.map((s) => s.stage)).toEqual([
      'Get on the ballot',
      'Get known',
      'Get out the vote',
    ])
  })

  it('omits the community-events timeline row when there are no events', () => {
    // No communityEvents (still generating, or none found). The row would
    // otherwise render a fabricated election-minus-20-days date.
    const plan = buildPlanData(makeInput())
    expect(
      timelineRows(plan).some(
        (row) => row.milestone === 'Community events to attend in person',
      ),
    ).toBe(false)
  })

  it('omits the community-events key date when there are no events', () => {
    // Key Dates must drop the events row too — without a real event it would
    // otherwise present a fabricated election-minus-20-days date as a key date.
    const plan = buildPlanData(makeInput())
    expect(
      plan.keyDates.some((d) => /community event/i.test(d.description)),
    ).toBe(false)
  })

  it('anchors the community-events row on the first real event date', () => {
    const plan = buildPlanData(
      makeInput({
        communityEvents: {
          events: [
            {
              title: 'Town hall',
              description: 'Meet voters.',
              date: '2026-10-15',
              address: null,
              url: null,
            },
            {
              title: 'Street fair',
              description: 'Shake hands.',
              date: '2026-09-20',
              address: null,
              url: null,
            },
          ],
        },
      }),
    )
    const eventRow = timelineRows(plan).find(
      (row) => row.milestone === 'Community events to attend in person',
    )
    expect(eventRow).toBeDefined()
    // Earliest of the two events (Sep 20), in the template's day format.
    expect(eventRow?.date).toBe('Sunday, September 20')
    // Key Dates anchors the same events row on that first real event date.
    const eventKeyDate = plan.keyDates.find((d) =>
      /community event/i.test(d.description),
    )
    expect(eventKeyDate?.date).toBe('Sunday, September 20')
  })

  it('flags the ballots-go-out date as approximate when it is the E-45 fallback', () => {
    // No milestones, so requestBallotStart is the fabricated election-minus-45
    // fallback. Section 2 embeds the date in prose, so it must be qualified.
    const plan = buildPlanData(makeInput())
    expect(plan.ballotsGoOutDate).toContain('(approximate)')
  })

  it('does not flag the ballots-go-out date when a real BR date exists', () => {
    const plan = buildPlanData(
      makeInput({
        milestones: {
          voter_registration: null,
          early_voting: null,
          request_ballot: { start: '2026-09-22', end: null },
        },
      }),
    )
    expect(plan.ballotsGoOutDate).toBe('Tuesday, September 22')
  })
})
