import { describe, expect, it } from 'vitest'
import { VOTER_CONTACT_SCHEDULE } from '@goodparty_org/contracts'
import { buildPlanData, type PlanInput } from './planContent'

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
  projectedTurnoutLower: null,
  projectedTurnoutUpper: null,
  winNumberLower: null,
  winNumberUpper: null,
  raceCandidates: [],
  milestones: null,
  ...overrides,
})

describe('buildPlanData voter-registration deadline — no-deadline states', () => {
  const ND_COPY =
    'There is no registration deadline as North Dakota has no voter registration requirement.'
  const SDR_COPY =
    'There is no registration deadline as there is same day voting.'

  it('renders the ND-specific copy (no registration requirement, not same-day registration)', () => {
    const plan = buildPlanData(makeInput({ state: 'ND' }))

    expect(
      plan.timeline.some(
        (row) => row.milestone === 'Voter registration deadline',
      ),
    ).toBe(false)
    const regRow = plan.timeline.find(
      (row) => row.milestone === 'Voter registration',
    )
    expect(regRow).toBeDefined()
    // ND has no voter registration system — the SDR copy would be a
    // wrong legal basis.
    expect(regRow?.notes).toBe(ND_COPY)
    expect(regRow?.notes).not.toContain('same day voting')

    expect(
      plan.keyDates.some((d) =>
        d.description.startsWith('Voter registration deadline'),
      ),
    ).toBe(false)
    expect(plan.keyDates.some((d) => d.description === ND_COPY)).toBe(true)
  })

  it('renders the no-deadline copy for VT (same-day registration through ED) and also suppresses the absentee row (VT is universal VBM)', () => {
    const plan = buildPlanData(makeInput({ state: 'VT' }))

    expect(
      plan.timeline.some(
        (row) => row.milestone === 'Voter registration deadline',
      ),
    ).toBe(false)
    const regRow = plan.timeline.find(
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
      plan.timeline.some(
        (row) => row.milestone === 'Absentee ballot request deadline',
      ),
    ).toBe(false)
    expect(
      plan.keyDates.some((d) =>
        d.description.startsWith('Absentee ballot request deadline'),
      ),
    ).toBe(false)
  })

  it('appends the local pre-registration tier note for NH', () => {
    const plan = buildPlanData(makeInput({ state: 'NH' }))

    const regRow = plan.timeline.find(
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
      plan.timeline.some(
        (row) => row.milestone === 'Absentee ballot request deadline',
      ),
    ).toBe(false)
    expect(
      plan.keyDates.some((d) =>
        d.description.startsWith('Absentee ballot request deadline'),
      ),
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

    const regRow = plan.timeline.find(
      (row) => row.milestone === 'Voter registration deadline',
    )
    expect(regRow).toBeDefined()
    expect(regRow?.date).toContain('Oct 19, 2026')
    expect(regRow?.date).not.toContain('Nov 2, 2026')
    expect(regRow?.notes).toContain('Per state SOS data')
  })
})

describe('buildPlanData tier-note rendering', () => {
  it('renders the curated tier-note in the absentee row notes for AK', () => {
    const plan = buildPlanData(makeInput({ state: 'AK' }))

    const absenteeRow = plan.timeline.find(
      (row) => row.milestone === 'Absentee ballot request deadline',
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

    const regRow = plan.timeline.find(
      (row) => row.milestone === 'Voter registration deadline',
    )
    const absenteeRow = plan.timeline.find(
      (row) => row.milestone === 'Absentee ballot request deadline',
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

    const absenteeRow = plan.timeline.find(
      (row) => row.milestone === 'Absentee ballot request deadline',
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

    const regRow = plan.timeline.find(
      (row) => row.milestone === 'Voter registration deadline',
    )
    expect(regRow).toBeDefined()
    expect(regRow?.notes).not.toContain('Per state SOS data')
    // And the absentee row is back in play for the same reason —
    // universal-VBM suppression depends on the curated lookup, which
    // is gated to the Nov 2026 general.
    const absenteeRow = plan.timeline.find(
      (row) => row.milestone === 'Absentee ballot request deadline',
    )
    expect(absenteeRow).toBeDefined()
  })
})

describe('buildPlanData voter insights source precedence', () => {
  it('uses district API issues with priority-phrased descriptions when present', () => {
    const plan = buildPlanData(
      makeInput({
        voterIssuesFromApi: [
          { label: 'Housing', score: 80, priority: 'high' },
          { label: 'Transit', score: 50, priority: 'medium' },
        ],
        // Present but lower-precedence: API data must win.
        customIssues: [{ title: 'Ignored', position: 'Ignored' }],
      }),
    )

    expect(plan.voterInsightsIssues).toEqual([
      {
        title: 'Housing',
        description:
          'Ranks as a top-priority concern for voters in this district.',
      },
      {
        title: 'Transit',
        description:
          'Ranks as a mid-priority concern for voters in this district.',
      },
    ])
  })

  it('falls back to candidate custom issues when there is no API data', () => {
    const plan = buildPlanData(
      makeInput({
        customIssues: [
          { title: '  Parks  ', position: '  Fund them  ' },
          { title: '', position: 'dropped — blank title' },
        ],
        stances: [{ issueName: 'Ignored', statement: 'Ignored' }],
      }),
    )

    expect(plan.voterInsightsIssues).toEqual([
      { title: 'Parks', description: 'Fund them' },
    ])
  })

  it('falls back to candidate stances when there is no API data or custom issues', () => {
    const plan = buildPlanData(
      makeInput({
        stances: [{ issueName: 'Safety', statement: 'More patrols' }],
      }),
    )

    expect(plan.voterInsightsIssues).toEqual([
      { title: 'Safety', description: 'More patrols' },
    ])
  })

  it('falls back to the generic stub issues when no source provides any', () => {
    const plan = buildPlanData(makeInput())

    expect(plan.voterInsightsIssues.map((i) => i.title)).toEqual([
      'Cost of living and local services',
      'Public safety and community trust',
      'Schools and youth programs',
    ])
  })
})

describe('buildPlanData contact schedule', () => {
  it('derives the 7 sends from the canonical schedule off the election date', () => {
    const plan = buildPlanData(makeInput())

    expect(plan.contactSchedule.map((s) => s.tactic)).toEqual(
      VOTER_CONTACT_SCHEDULE.map((s) => s.tactic),
    )
    expect(plan.contactSchedule.map((s) => s.purpose)).toEqual(
      VOTER_CONTACT_SCHEDULE.map((s) => s.purpose),
    )
    // 2026-11-03 election minus 56/49/35/28/14/1/0 days
    expect(plan.contactSchedule.map((s) => s.date)).toEqual([
      'Sep 8, 2026',
      'Sep 15, 2026',
      'Sep 29, 2026',
      'Oct 6, 2026',
      'Oct 20, 2026',
      'Nov 2, 2026',
      'Nov 3, 2026',
    ])
  })

  it('is empty when there is no valid election date', () => {
    const plan = buildPlanData(makeInput({ electionDateIso: null }))
    expect(plan.contactSchedule).toEqual([])
  })
})

describe('buildPlanData registered voters', () => {
  const rowFor = (estimate: string, plan: ReturnType<typeof buildPlanData>) =>
    plan.confidenceEstimates.find((c) => c.estimate === estimate)

  it('shows no figure when the voter file supplied none', () => {
    const plan = buildPlanData(makeInput({ registeredVoters: null }))

    expect(plan.registeredVoters).toBeNull()
    expect(rowFor('Registered voters', plan)?.pointValue).toBe('')
  })

  it('never derives a registered-voter count from projected turnout', () => {
    // The old fallback divided turnout by an assumed 22% rate, which put a
    // fabricated electorate size in front of the candidate.
    const plan = buildPlanData(
      makeInput({ registeredVoters: null, projectedTurnout: 22_000 }),
    )

    expect(JSON.stringify(plan)).not.toContain('100,000')
  })

  it('claims no voter-file provenance when the figure is absent', () => {
    const plan = buildPlanData(makeInput({ registeredVoters: null }))

    expect(rowFor('Registered voters', plan)?.notes).not.toMatch(/voter file/i)
  })

  it('still reports a served count, with its provenance', () => {
    const plan = buildPlanData(makeInput({ registeredVoters: 41_230 }))

    expect(plan.registeredVoters).toBe(41_230)
    expect(rowFor('Registered voters', plan)?.pointValue).toBe('41,230')
    expect(rowFor('Registered voters', plan)?.notes).toMatch(/voter file/i)
  })

  it("makes no turnout-rate assumption on the candidate's behalf", () => {
    // The 18-24% off-year municipal band was the deleted heuristic's rationale,
    // asserted for every race including state and federal.
    const plan = buildPlanData(makeInput({ registeredVoters: null }))

    expect(plan.keyAssumptions.join(' ')).not.toMatch(/18 to 24 percent/)
  })

  it('cites no voter-file source when there is no count to source', () => {
    const plan = buildPlanData(makeInput({ registeredVoters: null }))

    expect(
      plan.dataSources.some(
        (d) => d.metric === 'Registered voters in your district',
      ),
    ).toBe(false)
  })

  it('cites the voter-file source when there is a count', () => {
    const plan = buildPlanData(makeInput({ registeredVoters: 41_230 }))

    expect(
      plan.dataSources.some(
        (d) => d.metric === 'Registered voters in your district',
      ),
    ).toBe(true)
  })

  it('drops the registered-voter metric row when there is no count', () => {
    const plan = buildPlanData(makeInput({ registeredVoters: null }))

    const row = plan.metrics.find((m) => m.metric === 'Registered Voters')
    expect(row).toBeUndefined()
  })

  it('keeps the registered-voter metric row when there is a count', () => {
    const plan = buildPlanData(makeInput({ registeredVoters: 41_230 }))

    const row = plan.metrics.find((m) => m.metric === 'Registered Voters')
    expect(row?.target).toBe('41,230 registered voters')
  })
})

describe('buildPlanData prediction intervals', () => {
  const rangeFor = (estimate: string, plan: ReturnType<typeof buildPlanData>) =>
    plan.confidenceEstimates.find((c) => c.estimate === estimate)?.range

  it('renders the served interval for turnout and votes needed', () => {
    const plan = buildPlanData(
      makeInput({
        projectedTurnout: 2000,
        projectedTurnoutLower: 1600,
        projectedTurnoutUpper: 2600,
        winNumber: 1000,
        winNumberLower: 801,
        winNumberUpper: 1301,
      }),
    )

    expect(rangeFor('Projected voter turnout', plan)).toBe('1,600–2,600')
    expect(rangeFor('Projected votes needed to win', plan)).toBe('801–1,301')
  })

  it('shows no interval where the model supplies none', () => {
    const plan = buildPlanData(makeInput())

    expect(plan.confidenceEstimates.every((c) => c.range === '')).toBe(true)
  })

  it('never puts an interval on registered voters', () => {
    const plan = buildPlanData(
      makeInput({
        registeredVoters: 9000,
        projectedTurnoutLower: 1600,
        projectedTurnoutUpper: 2600,
      }),
    )

    expect(rangeFor('Registered voters', plan)).toBe('')
  })
})
