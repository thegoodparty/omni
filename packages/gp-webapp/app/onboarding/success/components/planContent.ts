import { dateUsHelper } from 'helpers/dateHelper'
import type {
  CommunityEventsData,
  StrategicLandscapeData,
} from 'gpApi/api-endpoints'
import type { RaceCandidate, RaceMilestones } from 'helpers/types'
import {
  computeBudget,
  MAIL_COST_PER_PIECE,
  resolveVoterContactGoal,
  ROBOCALL_COST,
  TEXT_COST,
} from '../../components/budget'
import {
  computeCampaignHours,
  resolveWeeksRemaining,
} from '../../components/volunteerHours'
import { VOTER_DEADLINES_2026 } from '../data/voterDeadlines2026'

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000

const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * ONE_DAY_MS)

const formatDate = (date: Date): string => dateUsHelper(date.toISOString())

// "Tuesday, November 3" — the day-of-week format the ClickUp template uses
// for key dates, the timeline, events, and the contact schedule. Mirrors
// dateUsHelper's +8h PST shift so a date-only ISO string renders as the
// intended calendar day. timeZone: 'UTC' pins the formatter so the shift
// isn't re-interpreted in the server's local zone (which would render the
// day before on hosts west of UTC-8).
const formatDayDate = (date: Date): string => {
  const pstDate = new Date(date.getTime() + 8 * ONE_HOUR_MS)
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(pstDate)
}

const parseDateIso = (value: string | null | undefined): Date | null => {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

const formatDateMaybe = (value: string | null | undefined): string | null => {
  const d = parseDateIso(value)
  return d ? formatDate(d) : null
}

// Subset of CustomIssue/CandidateStance the plan cares about; we accept loose
// shapes here so the caller can pass campaign.details.customIssues /
// campaign.Stances straight through.
export interface PlanIssueInput {
  title?: string
  position?: string
  order?: number
}

export interface PlanStanceInput {
  issueName?: string
  statement?: string
}

export interface PlanOpponentInput {
  name?: string
  party?: string
  description?: string
}

export interface PlanInput {
  candidateName: string
  race: string
  district: string
  city: string
  state: string
  partisanType: string
  electionDateIso: string | null | undefined
  filingDateStartIso: string | null | undefined
  filingDateEndIso: string | null | undefined
  winNumber: number
  projectedTurnout: number
  voterContactGoal: number
  runningAgainst: PlanOpponentInput[]
  customIssues: PlanIssueInput[]
  stances: PlanStanceInput[]
  hubspotIncumbent: string | null
  filingFee: number | null
  filingRequirementsText: string | null
  // From raceTargetMetrics (election-api campaign-strategy-context). All
  // nullable — null when the BR race hash didn't resolve or upstream data is
  // sparse. When null, fallback heuristics kick in.
  registeredVoters: number | null
  uniqueCellphones: number | null
  uniqueLandlines: number | null
  raceCandidates: RaceCandidate[]
  // Per-category BR milestone windows. Null when election-api couldn't
  // fetch them; individual category nullable when BR has no data for it.
  // Drives Section 6 Campaign Timeline dates; falls back to E-offset
  // approximations when null.
  milestones: RaceMilestones | null
  // Strategic landscape from /campaignStrategy/mine/strategic-landscape.
  // Undefined while polling or on error; when present takes precedence over
  // raceCandidates + the legacy runningAgainst + hubspotIncumbent fallback
  // for opponents and is the only source for opportunities + challenges.
  strategicLandscape?: StrategicLandscapeData
  // Community events from /campaignStrategy/mine/community-events.
  // Undefined while polling or on error; when present overrides the
  // templated `buildCivicEvents` fallback rows. An empty events array is
  // a meaningful "ready, found nothing" state — the section renders an
  // empty state without falling back to templates.
  communityEvents?: CommunityEventsData
  // Press outlets from GET /v1/onboarding/local-news. Same semantics as
  // communityEvents — undefined while polling or on error, real array
  // (possibly empty) when ready. Falls back to `buildPressOutlets`
  // templated rows when undefined.
  pressOutletsFromApi?: ApiPressOutlet[]
  // Top voter issues from GET /v1/onboarding/voter-issues. Already fetched
  // in an earlier onboarding step (TopVoterIssuesSection), so we read it
  // from the React Query cache rather than refetching. Undefined when the
  // cache miss happens (e.g. direct nav to success without going through
  // onboarding) — buildVoterInsights then falls through to candidate
  // customIssues/stances and finally the stub.
  voterIssuesFromApi?: ApiVoterIssue[]
}

// Subset of the GET /v1/onboarding/voter-issues response shape. Matches
// the on-screen TopVoterIssuesSection consumer.
export interface ApiVoterIssue {
  label: string
  score: number
  priority: 'high' | 'medium' | 'low'
}

// Subset of the GET /v1/onboarding/local-news outlet shape we render.
// Kept loose (all contact fields nullable) so callers don't have to
// pre-normalize.
export interface ApiPressOutlet {
  name: string
  type: 'TV' | 'print' | 'radio'
  description: string
  email?: string | null
  phone?: string | null
  address?: string | null
}

export interface KeyDate {
  date: string
  description: string
}

export interface TimelineRow {
  date: string
  milestone: string
  notes: string
}

// Section 6 renders as a visual timeline grouped into three stages: get on
// the ballot, get known, get out the vote.
export interface TimelineStage {
  stage: string
  items: TimelineRow[]
}

export interface MetricRow {
  metric: string
  target: string
  source: string
}

export interface BudgetRow {
  category: string
  whenWorthIt: string
  costEach: string
  amount: string
}

export interface FundraisingRow {
  source: string
  share: string
}

// Title + body pair used by the campaign-math list (Section 1) and the
// opportunities / challenges tables (Section 2).
export interface TitledNote {
  title: string
  body: string
}

export interface CivicEvent {
  event: string
  address: string
  date: string
  whyBullets: string[]
}

export interface PressOutlet {
  outlet: string
  type: string
  angle: string
  contact: string
}

export interface ContactSend {
  date: string
  tactic: string
  purpose: string
}

export interface DataSourceRow {
  metric: string
  source: string
  lastUpdated: string
}

export interface ConfidenceRow {
  estimate: string
  pointValue: string
  range: string
  notes: string
}

export interface GlossaryRow {
  term: string
  definition: string
}

// Mirrors `StrategicLandscapeOpponent` from gp-api. Who is running: name,
// party, incumbency. Narrative profiling (summary, key facts, websites) isn't
// part of this section.
export interface Opponent {
  fullName: string
  partyAffiliation: string
  incumbent: boolean | null
}

export interface VoterInsightIssue {
  title: string
  description: string
}

export type ElectionType = 'partisan' | 'nonpartisan' | 'unknown'

export interface PlanData {
  candidateName: string
  race: string
  location: string
  districtName: string
  hasDistrict: boolean
  electionType: ElectionType
  electionDate: string
  electionDateRaw: Date | null
  planGenerationDate: string

  winNumber: number
  winNumberLow: number
  winNumberHigh: number
  projectedTurnout: number
  projectedTurnoutLow: number
  projectedTurnoutHigh: number
  registeredVoters: number
  registeredVotersLow: number
  registeredVotersHigh: number
  voterContactGoal: number
  // Contacts per voter the plan is built around (voterContactGoal ÷
  // winNumber, normally 10). Derived so the copy stays honest if the
  // race-specific goal from the API uses a different multiplier.
  contactsPerVoter: number
  // Win number as a share of registered voters ("you only need ~X% of
  // them"). Null when registered voters are unknown.
  votesNeededPctOfRegistered: number | null
  // Cellphone / landline coverage from the voter file. Null when the race
  // hash didn't resolve or upstream data is sparse.
  pctVotersWithCellphone: number | null
  cellphoneCount: number | null
  landlineCount: number | null

  opponentCount: number
  volunteerCount: number
  volunteerHoursPerWeek: number
  candidateHoursPerWeek: number
  totalBudget: number
  eventCount: number
  mediaCount: number

  weeksRemaining: number
  filingDateStart: string | null
  filingDateEnd: string | null
  filingDeadline: string | null

  // "Here's your campaign math, in three numbers" (Section 1).
  campaignMath: TitledNote[]
  keyDates: KeyDate[]

  voterInsightsIssues: VoterInsightIssue[]
  voterInsightsSource: 'district' | 'candidate' | 'stub'

  // Section 2 tables — templated from race data per the ClickUp template
  // (not LLM-generated).
  opportunityRows: TitledNote[]
  challengeRows: TitledNote[]
  opponents: Opponent[]
  incumbent: Opponent | null

  metrics: MetricRow[]

  timelineStages: TimelineStage[]
  // "Mail and early ballots start going out" date, used by the Section 2
  // early-vote challenge row. Empty when the election date is unknown.
  ballotsGoOutDate: string

  budgetLineItems: BudgetRow[]
  fundraisingMix: FundraisingRow[]

  civicEvents: CivicEvent[]
  pressOutlets: PressOutlet[]

  contactSchedule: ContactSend[]

  dataSources: DataSourceRow[]
  keyAssumptions: string[]
  confidenceEstimates: ConfidenceRow[]
  planDoesNotDo: string[]

  glossary: GlossaryRow[]

  filingFee: number | null
  filingRequirementsText: string | null
}

const buildTimeline = (
  electionDate: Date | null,
  filingDateStart: Date | null,
  filingDateEnd: Date | null,
  milestones: RaceMilestones | null,
  eventCount: number,
  firstEventDate: Date | null,
  stateCode: string,
): {
  timelineStages: TimelineStage[]
  keyDates: KeyDate[]
  ballotsGoOutDate: string
} => {
  if (!electionDate) {
    return { timelineStages: [], keyDates: [], ballotsGoOutDate: '' }
  }

  // Stage grouping, copy, and source mapping per the ClickUp Campaign Plan
  // rework § 6 ("Your Campaign Timeline"):
  //   Stage 1 / Get on the ballot — filing_end_date
  //   Stage 2 / Get known — REQUEST_BALLOT.OPEN (mail ballots go out),
  //     EARLY_VOTING.OPEN, community events, REGISTRATION.CLOSE
  //   Stage 3 / Get out the vote — REQUEST_BALLOT.CLOSE,
  //     EARLY_VOTING.CLOSE, VOTING.CLOSE (Election Day)
  //
  // Source priority per row: real BR milestone date if present (>90% fill
  // rate per Nigel's screenshot), else E-offset approximation. Notes flag
  // which one is in play so the candidate knows.
  const filing = filingDateEnd ?? filingDateStart ?? addDays(electionDate, -40)
  const filingIsReal = filingDateEnd != null
  const earlyVotingStart =
    parseDateIso(milestones?.early_voting?.start ?? null) ??
    addDays(electionDate, -14)
  const earlyVotingStartIsReal = milestones?.early_voting?.start != null
  const earlyVotingEnd =
    parseDateIso(milestones?.early_voting?.end ?? null) ??
    addDays(electionDate, -2)
  const earlyVotingEndIsReal = milestones?.early_voting?.end != null
  const requestBallotStart =
    parseDateIso(milestones?.request_ballot?.start ?? null) ??
    addDays(electionDate, -45)
  const requestBallotStartIsReal = milestones?.request_ballot?.start != null

  // Voter registration deadline + absentee request deadline pull from a
  // curated SOS-verified table per state (see voterDeadlines2026.ts) rather
  // than BallotReady. BR's data for these two has been wrong on enough
  // states (CA registration showed Nov 2 vs actual Oct 19; CA "absentee
  // request deadline" rendered even though CA is universal vote-by-mail
  // and there is no request). Falls back to BR / E-offset only when the
  // state isn't in the curated table.
  //
  // Year-and-month guard: the curated table covers the Nov 3, 2026
  // general election only. Every `date` in there is in Oct/Nov 2026 (or
  // null for SDR states). A 2026 primary (e.g. CA's June primary) would
  // also have year === 2026 but render the general-election deadlines —
  // off by months and labeled as authoritative SOS data. Restrict to
  // the Oct/Nov 2026 window so primaries fall through to BR / E-offset
  // like every other non-2026-general election.
  //
  // Known limitation: `isUniversalVbm` is a state characteristic, not a
  // year-tied date — for CA/CO/etc. in 2027+ elections this guard makes
  // the curated lookup miss and the absentee-request row reappears. The
  // test in planContent.test.ts documents that behavior; resolving it
  // properly means separating year-agnostic state facts from the dated
  // deadline data, which is a larger refactor.
  const isCuratedWindow =
    electionDate.getFullYear() === 2026 && electionDate.getMonth() >= 9
  const curated = isCuratedWindow
    ? VOTER_DEADLINES_2026[stateCode.toUpperCase()]
    : undefined

  const voterRegDeadline =
    parseDateIso(curated?.registration.date ?? null) ??
    parseDateIso(milestones?.voter_registration?.end ?? null) ??
    addDays(electionDate, -15)
  const voterRegSource: 'curated' | 'ballotReady' | 'approximate' = curated
    ?.registration.date
    ? 'curated'
    : milestones?.voter_registration?.end != null
      ? 'ballotReady'
      : 'approximate'
  const voterRegTierNote = curated?.registration.tierNote ?? null

  // States with no fixed registration cutoff (VT, NH = same-day reg
  // through Election Day; ND = no registration system at all) have
  // `registration.date: null` in the curated table. Render the milestone
  // with an explanatory note keyed to Election Day rather than falling
  // through to the E-offset fallback (which would invent a
  // electionDate-15-days row that doesn't apply).
  const voterRegHasNoDeadline =
    curated != null && curated.registration.date === null
  // The legal basis differs: VT/NH allow same-day registration at the
  // polls; ND has no voter-registration requirement at all (eligible
  // residents just vote). Same outcome — no deadline — but the
  // explanation has to be accurate.
  const NO_DEADLINE_COPY =
    stateCode.toUpperCase() === 'ND'
      ? 'There is no registration deadline as North Dakota has no voter registration requirement.'
      : 'There is no registration deadline as there is same day voting.'
  // NH (and any other no-deadline state with a non-trivial tier note)
  // has locally-set pre-registration windows that supplement the
  // same-day-voting option. Append them so the candidate still sees the
  // pre-registration context; skip when tier note is null (ND) or just
  // restates "Election Day" for all methods (VT). The split-by-"; "
  // check matches the format `tier_note` emits in the generated data.
  const tierNoteAddsInfo =
    voterRegTierNote !== null &&
    !voterRegTierNote
      .split('; ')
      .every((part) => /\bElection Day\b/i.test(part))
  const noDeadlineNotes =
    voterRegHasNoDeadline && tierNoteAddsInfo
      ? `${NO_DEADLINE_COPY} Local pre-registration: ${voterRegTierNote}.`
      : NO_DEADLINE_COPY

  // Universal VBM states (CA, CO, etc.) have no real request deadline —
  // ballots auto-mail to all active voters. Drop the milestone entirely
  // for those rather than render a misleading row.
  const absenteeOmitted = curated?.absentee.isUniversalVbm === true
  const requestBallotEnd =
    parseDateIso(curated?.absentee.date ?? null) ??
    parseDateIso(milestones?.request_ballot?.end ?? null) ??
    addDays(electionDate, -7)
  const requestBallotEndSource: 'curated' | 'ballotReady' | 'approximate' =
    curated?.absentee.date
      ? 'curated'
      : milestones?.request_ballot?.end != null
        ? 'ballotReady'
        : 'approximate'
  const requestBallotTierNote = curated?.absentee.tierNote ?? null

  const sourceNote = (isReal: boolean, baseNote: string): string =>
    (isReal
      ? `Per BallotReady. ${baseNote}`
      : `Approximate. ${baseNote}`
    ).trim()

  // For deadlines pulled from the curated table, attribute to SOS data and
  // append the tier breakdown when methods differ (e.g. ID online vs mail).
  const curatedNote = (
    source: 'curated' | 'ballotReady' | 'approximate',
    tierNote: string | null,
    baseNote: string,
  ): string => {
    if (source === 'curated') {
      const prefix = 'Per state SOS data.'
      const tiers = tierNote ? ` Method differences — ${tierNote}.` : ''
      return `${prefix}${tiers} ${baseNote}`.trim()
    }
    return sourceNote(source === 'ballotReady', baseNote)
  }

  type RawRow = { date: Date; milestone: string; notes: string }

  const stage1Rows: RawRow[] = [
    {
      date: filing,
      milestone: 'File your paperwork to officially get on the ballot',
      notes: filingIsReal
        ? 'Filing deadline per BallotReady.'
        : 'Approximate filing deadline.',
    },
  ]

  const stage2Rows: RawRow[] = [
    {
      date: requestBallotStart,
      milestone: 'Mail and early ballots start going out',
      notes: sourceNote(
        requestBallotStartIsReal,
        'Your first message to voters has to land by now.',
      ),
    },
    {
      date: earlyVotingStart,
      milestone: 'Early voting begins',
      notes: sourceNote(
        earlyVotingStartIsReal,
        'From here on, some people will vote.',
      ),
    },
    // Only show the events row when we have a real event to anchor it.
    // Without a real event date the row would render a fabricated
    // election-minus-20-days date (and "we'll add events" copy that's wrong
    // once generation finishes with none found).
    ...(firstEventDate !== null
      ? [
          {
            date: firstEventDate,
            milestone: 'Community events to attend in person',
            notes: `Starting with the first of ${eventCount} event${
              eventCount === 1 ? '' : 's'
            } we found for you.`,
          },
        ]
      : []),
    voterRegHasNoDeadline
      ? {
          date: electionDate,
          milestone: 'Voter registration',
          notes: noDeadlineNotes,
        }
      : {
          date: voterRegDeadline,
          milestone: 'Last day for people to register to vote',
          notes: curatedNote(voterRegSource, voterRegTierNote, ''),
        },
  ]

  const stage3Rows: RawRow[] = [
    ...(absenteeOmitted
      ? []
      : [
          {
            date: requestBallotEnd,
            milestone: 'Last day to request a mail ballot',
            notes: curatedNote(
              requestBallotEndSource,
              requestBallotTierNote,
              '',
            ),
          },
        ]),
    {
      date: earlyVotingEnd,
      milestone: 'Early voting ends',
      notes: sourceNote(earlyVotingEndIsReal, ''),
    },
    {
      date: electionDate,
      milestone: 'Election Day',
      notes: 'Polls are open. Make your final push to get supporters out.',
    },
  ]

  const toStage = (stage: string, rows: RawRow[]): TimelineStage => ({
    stage,
    items: rows
      .slice()
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((r) => ({
        date: formatDayDate(r.date),
        milestone: r.milestone,
        notes: r.notes,
      })),
  })

  const timelineStages: TimelineStage[] = [
    toStage('Get on the ballot', stage1Rows),
    toStage('Get known', stage2Rows),
    toStage('Get out the vote', stage3Rows),
  ]

  const keyDateRows: Array<{ date: Date; description: string }> = [
    {
      date: filing,
      description: 'Turn in your paperwork to get on the ballot.',
    },
    {
      date: requestBallotStart,
      description:
        'Mail and early ballots start going out. Your first message to voters needs to land before this day.',
    },
    // Mirror the timeline: only anchor the events key date when a real event
    // exists. Without one, firstEventDate is null and the row would render a
    // fabricated election-minus-20-days date as if it were authoritative.
    ...(firstEventDate !== null
      ? [
          {
            date: firstEventDate,
            description: `First of ${eventCount} community event${
              eventCount === 1 ? '' : 's'
            } to show up to in person.`,
          },
        ]
      : []),
    voterRegHasNoDeadline
      ? {
          date: electionDate,
          description: noDeadlineNotes,
        }
      : {
          date: voterRegDeadline,
          description: 'Last day for people to register to vote.',
        },
    ...(absenteeOmitted
      ? []
      : [
          {
            date: requestBallotEnd,
            description: 'Last day to request a mail ballot.',
          },
        ]),
    {
      date: electionDate,
      description: 'Election Day.',
    },
  ]

  const keyDates: KeyDate[] = keyDateRows
    .slice()
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((r) => ({
      date: formatDayDate(r.date),
      description: r.description,
    }))

  return {
    timelineStages,
    keyDates,
    ballotsGoOutDate: formatDayDate(requestBallotStart),
  }
}

const buildContactSchedule = (electionDate: Date | null): ContactSend[] => {
  if (!electionDate) return []
  const sends: { offset: number; data: Omit<ContactSend, 'date'> }[] = [
    {
      offset: -56,
      data: {
        tactic: 'Text',
        purpose: 'Introduce yourself to voters with cellphones.',
      },
    },
    {
      offset: -49,
      data: {
        tactic: 'Robocall',
        purpose: 'Introduce yourself to voters with landlines.',
      },
    },
    {
      offset: -35,
      data: {
        tactic: 'Text',
        purpose: 'Make your case to cellphone voters.',
      },
    },
    {
      offset: -28,
      data: {
        tactic: 'Robocall',
        purpose: 'Make your case to landline voters.',
      },
    },
    {
      offset: -14,
      data: {
        tactic: 'Text',
        purpose: 'Remind cellphone voters to vote early.',
      },
    },
    {
      offset: -1,
      data: {
        tactic: 'Robocall',
        purpose: 'Get out the vote, landline voters.',
      },
    },
    {
      offset: 0,
      data: {
        tactic: 'Text',
        purpose: 'Get out the vote, cellphone voters.',
      },
    },
  ]

  return sends.map(({ offset, data }) => ({
    date: formatDayDate(addDays(electionDate, offset)),
    ...data,
  }))
}

// The template renders "Why it's worth going" as short bullets, not a
// paragraph. The LLM returns a prose description, so split it on sentence
// boundaries into bullet-sized pieces.
const splitIntoBullets = (description: string): string[] =>
  description
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

const buildCivicEvents = (
  communityEvents: CommunityEventsData | undefined,
): CivicEvent[] => {
  // Only renders real LLM-sourced events. If the endpoint hasn't resolved
  // or errored, returns []; the renderer shows an empty/skeleton state
  // rather than templated rows with invented event names and dates.
  // `address` is the venue's physical street address from BR/search,
  // null when the search data had no address.
  if (!communityEvents) return []
  return communityEvents.events.map((e) => {
    const parsed = parseDateIso(e.date)
    return {
      event: e.title,
      address: e.address ?? '',
      date: parsed ? formatDayDate(parsed) : dateUsHelper(e.date),
      whyBullets: splitIntoBullets(e.description),
    }
  })
}

// Earliest event date, used to anchor the "community events" milestone on
// the timeline and in Key Dates. Null while events are still generating.
const earliestEventDate = (
  communityEvents: CommunityEventsData | undefined,
): Date | null => {
  const dates = (communityEvents?.events ?? [])
    .map((e) => parseDateIso(e.date))
    .filter((d): d is Date => d !== null)
  if (dates.length === 0) return null
  return dates.reduce((min, d) => (d < min ? d : min))
}

const OUTLET_TYPE_LABEL: Record<ApiPressOutlet['type'], string> = {
  TV: 'Television',
  print: 'Print',
  radio: 'Radio',
}

const formatOutletContact = (outlet: ApiPressOutlet): string =>
  [outlet.address, outlet.phone, outlet.email]
    .filter(
      (part): part is string => typeof part === 'string' && part.length > 0,
    )
    .join('\n') || 'Contact info not yet available'

// Returns empty when the local-news endpoint hasn't resolved yet — the
// renderer shows a skeleton on the empty + generating combination so the
// user never sees stale templated rows. Mirrors the civicEvents handling.
const buildPressOutlets = (
  outletsFromApi: ApiPressOutlet[] | undefined,
): PressOutlet[] => {
  if (!outletsFromApi) return []
  return outletsFromApi.map((o) => ({
    outlet: o.name,
    type: OUTLET_TYPE_LABEL[o.type],
    // The local-news endpoint returns a one-sentence outlet description
    // ("coverage area and focus"). Use it verbatim as the pitch angle —
    // the candidate can tailor in Campaign Manager.
    angle: o.description,
    contact: formatOutletContact(o),
  }))
}

const formatDollars = (value: number): string =>
  `$${Math.round(value).toLocaleString('en-US')}`

interface BudgetBreakdown {
  totalBudget: number
  lineItems: BudgetRow[]
}

// "Where Your Money Would Go" rows per the ClickUp template — channel,
// when it's worth paying for, unit cost, and the race-sized estimate.
// Filing fees aren't in the template's table, but they're part of the
// computed total, and the rows must keep summing exactly to the total, so
// the row stays.
const buildBudgetBreakdown = (
  contactGoal: number,
  projectedTurnout: number,
  filingFee: number | null,
): BudgetBreakdown => {
  const budget = computeBudget(contactGoal, projectedTurnout, filingFee)

  const lineItems: BudgetRow[] = [
    {
      category: 'Texting',
      whenWorthIt:
        'Almost always. Reaches the most people for the least money, the workhorse for a race your size.',
      costEach: `$${TEXT_COST.toFixed(3)} / text`,
      amount: formatDollars(budget.textCost),
    },
    {
      category: 'Robocalls',
      whenWorthIt:
        'When some voters have no cellphone. Catches landlines that texts miss.',
      costEach: `$${ROBOCALL_COST.toFixed(3)} / call`,
      amount: formatDollars(budget.robocallCost),
    },
    {
      category: 'Mailers',
      whenWorthIt:
        "Optional. A reminder in the mailbox if you've got budget left and your voters are spread out.",
      costEach: `$${MAIL_COST_PER_PIECE.toFixed(2)} / piece`,
      amount: formatDollars(budget.mailCost),
    },
    {
      category: 'Palm cards and literature',
      whenWorthIt: 'Handouts to give voters at the door and at events.',
      costEach: 'flat',
      amount: formatDollars(budget.literatureCost),
    },
    {
      category: 'Yard signs',
      whenWorthIt: 'Name recognition around town, reusable all season.',
      costEach: 'flat',
      amount: formatDollars(budget.yardSignsCost),
    },
    {
      category: 'Events and showing up',
      whenWorthIt:
        'Always. The most persuasive way to win someone over, and free.',
      costEach: 'free',
      amount: '$0',
    },
    {
      category: 'Filing fees',
      whenWorthIt: budget.filingFeeIsDefault
        ? 'Required to get on the ballot. Estimated until BallotReady confirms the fee for your race.'
        : 'Required to get on the ballot, per BallotReady.',
      costEach: 'flat',
      amount: formatDollars(budget.filingFee),
    },
    {
      category: '5% cushion',
      whenWorthIt: 'A small reserve for last-minute surprises.',
      costEach: 'n/a',
      amount: formatDollars(budget.contingency),
    },
    {
      category: 'Total',
      whenWorthIt: 'The full picture if you fund everything.',
      costEach: '',
      amount: formatDollars(budget.totalBudget),
    },
  ]

  return { totalBudget: budget.totalBudget, lineItems }
}

const FUNDRAISING_MIX: FundraisingRow[] = [
  { source: 'Yourself (self-fund or loan)', share: '30%' },
  { source: 'Friends and family', share: '30%' },
  { source: 'Small online donations', share: '25%' },
  { source: 'Events and larger checks', share: '15%' },
]

const KEY_ASSUMPTIONS: string[] = [
  'Turnout behaves like recent comparable off-year municipal elections in your area, roughly 18 to 24 percent of registered voters.',
  'Voter preferences distribute across the field without one opponent dominating. A plurality near 40 percent is often sufficient to win, but we plan to the more conservative 50% + 1 threshold.',
  'You will execute the contact cadence on schedule. Any slippage materially reduces the probability of hitting the contact goal.',
]

const PLAN_DOES_NOT_DO: string[] = [
  'It does not include a persuasion model. We are not scoring individual voters for likelihood of supporting you specifically, which would require survey data we do not have.',
  'It does not forecast a win probability. The race is close by design, and small shifts in turnout can flip the outcome.',
  'It does not replace local political judgment. Your own read of the community should override any single number in this document.',
]

const GLOSSARY: GlossaryRow[] = [
  {
    term: 'Registered Voters',
    definition:
      'The total pool of voters eligible to cast a ballot for a race, pulled from the latest voter file.',
  },
  {
    term: 'Projected Votes Needed to Win',
    definition:
      'The vote total at which a candidate would win the seat with certainty given the modeled voter turnout. Calculated as 50% + 1 of the projected voter turnout.',
  },
  {
    term: 'Projected Voter Turnout',
    definition:
      'The estimated number of registered voters expected to cast a ballot in this specific election, derived from a turnout model applied to recent comparable cycles. Historically our projections have been +/- 1.5% of actual voter turnout.',
  },
  {
    term: 'Targeted Voter Contact Goal',
    definition:
      'The total number of contacts sent to voters that the campaign aims to deliver. Industry rule of thumb is 10× the projected votes needed to win.',
  },
  {
    term: 'Voter Contact',
    definition:
      'A contact attempt that reaches an intended voter via a channel capable of conveying the message (delivered text, answered call, in-person conversation).',
  },
  {
    term: 'Likely Votes',
    definition:
      'The estimated number of votes you are on track to receive based on voter contacts completed to date. Calculated by counting 1 likely vote for every 5 voter contacts made.',
  },
  {
    term: 'Text',
    definition:
      'A one-to-one SMS send from a volunteer-operated dashboard that complies with federal wireless regulations around automated dialing.',
  },
  {
    term: 'Robocall',
    definition:
      'An automated pre-recorded voice call, used here only to landlines to comply with applicable wireless rules.',
  },
  {
    term: 'Match Rate',
    definition:
      'The share of records in a voter file that are successfully appended with a phone number from a commercial data vendor.',
  },
  {
    term: 'Standard Error / 95% CI',
    definition:
      'A range around an estimate such that, under the modeling assumptions, the true value is expected to fall within the range 95% of the time.',
  },
  {
    term: 'GOTV',
    definition:
      '"Get Out The Vote", the concentrated push in the final 72 hours to convert identified supporters into cast ballots.',
  },
]

// "Here's your campaign math, in three numbers" — the three headline numbers
// Section 1 walks through. Same labels every time: votes to win, people to
// reach, money to raise.
const buildCampaignMath = (
  winNumber: number,
  projectedTurnout: number,
  voterContactGoal: number,
  totalBudget: number,
): TitledNote[] => [
  {
    title: 'The votes you need to win.',
    body: `We expect about ${projectedTurnout.toLocaleString(
      'en-US',
    )} people to vote in your race. You need a little more than half of them, which comes out to ${winNumber.toLocaleString(
      'en-US',
    )} votes. That's your finish line.`,
  },
  {
    title: 'The people you need to reach.',
    body: `To earn those votes, you'll aim for about ${voterContactGoal.toLocaleString(
      'en-US',
    )} contacts across the whole race, through texts, calls, mail, and conversations at the door. That's a big number, and it's meant to be. We'll break it into small weekly steps so you're never doing it all at once.`,
  },
  {
    title: "The money you'll raise.",
    body: `Reaching people costs a little, so plan to raise about $${totalBudget.toLocaleString(
      'en-US',
    )} over the course of the race. For most candidates that's 20 to 40 people giving $25 to $100 each, not big checks, and we'll help you plan it.`,
  },
]

// Section 2 "Opportunities Working in Your Favor" — templated from race
// data. Rows that depend on data we don't have yet (cellphone match) drop
// out instead of rendering with blanks.
const buildOpportunityRows = (
  registeredVoters: number,
  winNumber: number,
  votesNeededPctOfRegistered: number | null,
  cellphoneCount: number | null,
  pctVotersWithCellphone: number | null,
  voterContactGoal: number,
  mediaCount: number,
  eventCount: number,
): TitledNote[] => {
  const rows: TitledNote[] = []
  if (registeredVoters > 0 && winNumber > 0) {
    const pctFragment =
      votesNeededPctOfRegistered !== null
        ? `, about ${votesNeededPctOfRegistered}% of them`
        : ''
    rows.push({
      title: "You don't have to win everyone",
      body: `Of the ${registeredVoters.toLocaleString(
        'en-US',
      )} registered voters in your area, you only need the ${winNumber.toLocaleString(
        'en-US',
      )} votes to win${pctFragment}. So reaching the right voters matters far more than trying to reach all of them.`,
    })
  }
  if (
    cellphoneCount !== null &&
    cellphoneCount > 0 &&
    pctVotersWithCellphone !== null
  ) {
    rows.push({
      title: 'Most of your voters have a cellphone',
      body: `About ${pctVotersWithCellphone}% of voters (${cellphoneCount.toLocaleString(
        'en-US',
      )} of them) have a cellphone on file. That means a big share of the ${voterContactGoal.toLocaleString(
        'en-US',
      )} people you need to reach can get a text, which costs far less than mail or ads.`,
    })
  }
  rows.push({
    title: 'There are free ways to get known',
    body:
      mediaCount > 0 && eventCount > 0
        ? `${mediaCount} local news outlet${
            mediaCount === 1 ? ' covers' : 's cover'
          } races like yours, and at least ${eventCount} community event${
            eventCount === 1 ? ' falls' : 's fall'
          } during your race. Press and showing up in person build name recognition without costing much.`
        : 'Local news outlets cover races like yours, and community events happen all season. Press and showing up in person build name recognition without costing much.',
  })
  return rows
}

// Section 2 "Challenges You'll Have to Work Around" — templated from race
// data.
const buildChallengeRows = (
  projectedTurnout: number,
  ballotsGoOutDate: string,
): TitledNote[] => {
  const rows: TitledNote[] = [
    {
      title: "Voters don't know your name yet",
      body: 'With no party label next to your name, people need to see it a few times before it sticks. Your plan repeats contact on a schedule so you feel familiar by Election Day.',
    },
  ]
  if (projectedTurnout > 0) {
    rows.push({
      title: 'Most people skip local elections',
      body: `We expect only about ${projectedTurnout.toLocaleString(
        'en-US',
      )} of registered voters to actually vote. When turnout's that low, who shows up decides the race, so your plan ends with a push to get your supporters to vote.`,
    })
  }
  if (ballotsGoOutDate) {
    rows.push({
      title: 'Some people vote before Election Day',
      body: `Mail and early ballots start going out on ${ballotsGoOutDate}. Once someone's voted you can't change their mind, so we get your outreach to them first.`,
    })
  }
  return rows
}

const buildOpponents = (
  strategicLandscape: StrategicLandscapeData | undefined,
  raceCandidates: RaceCandidate[],
  runningAgainst: PlanOpponentInput[],
  hubspotIncumbentName: string | null,
): Opponent[] => {
  // Source priority:
  //   1. strategicLandscape — the CAP endpoint's opponent roster.
  //   2. raceCandidates — BR/election-api filings via raceTargetMetrics.
  //      Authoritative for who's on the ballot + incumbent flag.
  //   3. runningAgainst — user-entered onboarding answers.
  //   4. hubspotIncumbent — last-ditch incumbent name from HubSpot.
  if (strategicLandscape?.opponents.length) {
    return strategicLandscape.opponents.map((o) => ({
      fullName: o.fullName,
      partyAffiliation: o.partyAffiliation,
      incumbent: o.incumbent,
    }))
  }
  const fromRaceCandidates: Opponent[] = raceCandidates
    .filter((c) => c.fullName.trim() !== '')
    .map((c) => ({
      fullName: c.fullName.trim(),
      partyAffiliation: c.party?.trim() ?? '',
      incumbent: c.isIncumbent,
    }))
  if (fromRaceCandidates.length > 0) return fromRaceCandidates
  const fromRunningAgainst: Opponent[] = runningAgainst
    .filter((o) => (o.name ?? '').trim() !== '')
    .map((o) => ({
      fullName: o.name?.trim() ?? '',
      partyAffiliation: o.party?.trim() ?? '',
      incumbent: false,
    }))
  if (fromRunningAgainst.length > 0) return fromRunningAgainst
  if (hubspotIncumbentName && hubspotIncumbentName.trim() !== '') {
    return [
      {
        fullName: hubspotIncumbentName.trim(),
        partyAffiliation: '',
        incumbent: true,
      },
    ]
  }
  return []
}

const PRIORITY_PHRASE: Record<'high' | 'medium' | 'low', string> = {
  high: 'top-priority',
  medium: 'mid-priority',
  low: 'lower-priority',
}

const describeApiIssue = (issue: ApiVoterIssue): string =>
  `Ranks as a ${
    PRIORITY_PHRASE[issue.priority]
  } concern for voters in this district.`

const buildVoterInsights = (
  customIssues: PlanIssueInput[],
  stances: PlanStanceInput[],
  voterIssuesFromApi: ApiVoterIssue[] | undefined,
): {
  issues: VoterInsightIssue[]
  source: 'district' | 'candidate' | 'stub'
} => {
  // Prefer real district survey data when the cached query resolved. The
  // on-screen TopVoterIssuesSection in onboarding shows the same labels;
  // synthesizing a short description here keeps the PDF's title+body
  // DefinitionList shape intact without forcing the API to add copy.
  if (voterIssuesFromApi && voterIssuesFromApi.length > 0) {
    return {
      issues: voterIssuesFromApi.map((i) => ({
        title: i.label,
        description: describeApiIssue(i),
      })),
      source: 'district',
    }
  }
  const fromCustom = customIssues
    .filter((i) => (i.title ?? '').trim() !== '')
    .map((i) => ({
      title: (i.title ?? '').trim(),
      description: (i.position ?? '').trim(),
    }))
  if (fromCustom.length > 0) {
    return { issues: fromCustom, source: 'candidate' }
  }
  const fromStances = stances
    .filter((s) => (s.issueName ?? '').trim() !== '')
    .map((s) => ({
      title: (s.issueName ?? '').trim(),
      description: (s.statement ?? '').trim(),
    }))
  if (fromStances.length > 0) {
    return { issues: fromStances, source: 'candidate' }
  }
  return {
    issues: [
      {
        title: 'Cost of living and local services',
        description:
          'Survey and voter data point to housing, services, and local tax pressure as the most common top concerns in this district.',
      },
      {
        title: 'Public safety and community trust',
        description:
          'Voters consistently rank safety, response times, and the quality of community-police relationships among their top issues.',
      },
      {
        title: 'Schools and youth programs',
        description:
          'Education funding, after-school programs, and youth services drive turnout among the most reliable voters in races at this level.',
      },
    ],
    source: 'stub',
  }
}

const DATA_SOURCES: DataSourceRow[] = [
  {
    metric: 'Registered voters in your district',
    source: 'L2 Voter Data',
    lastUpdated: 'Refreshed monthly',
  },
  {
    metric: 'Historical turnout',
    source: 'Official Election Results',
    lastUpdated: 'As of last 3 certified elections',
  },
  {
    metric: 'Phone match rates',
    source: 'Match between voter information and commercial data',
    lastUpdated: 'Rolling 90-day refresh',
  },
  {
    metric: 'Candidate-field data (opponents, seats)',
    source: 'BallotReady candidate filings',
    lastUpdated: 'As of filing deadline',
  },
  {
    metric: 'Filing fee & requirements',
    source: 'BallotReady recruitment data, parsed by election-api',
    lastUpdated: 'Rolling',
  },
  {
    metric: 'Press and media outlets',
    source: 'GoodParty.org local-media directory',
    lastUpdated: 'Rolling',
  },
]

const buildConfidenceEstimates = (
  registeredVoters: number,
  registeredVotersLow: number,
  registeredVotersHigh: number,
  projectedTurnout: number,
  projectedTurnoutLow: number,
  projectedTurnoutHigh: number,
  winNumber: number,
  winNumberLow: number,
  winNumberHigh: number,
): ConfidenceRow[] => [
  {
    estimate: 'Registered voters',
    pointValue: registeredVoters.toLocaleString('en-US'),
    range: `${registeredVotersLow.toLocaleString(
      'en-US',
    )}–${registeredVotersHigh.toLocaleString('en-US')}`,
    notes: 'Based on the latest voter file for your district.',
  },
  {
    estimate: 'Projected voter turnout',
    pointValue: projectedTurnout.toLocaleString('en-US'),
    range: `${projectedTurnoutLow.toLocaleString(
      'en-US',
    )}–${projectedTurnoutHigh.toLocaleString('en-US')}`,
    notes: 'Based on 3-cycle turnout average.',
  },
  {
    estimate: 'Projected votes needed to win',
    pointValue: winNumber.toLocaleString('en-US'),
    range: `${winNumberLow.toLocaleString(
      'en-US',
    )}–${winNumberHigh.toLocaleString('en-US')}`,
    notes: 'Moves with the targeted voters.',
  },
]

const resolveElectionType = (partisanType: string): ElectionType => {
  const t = partisanType.trim().toLowerCase()
  if (t === 'partisan') return 'partisan'
  if (t === 'nonpartisan' || t === 'non-partisan') return 'nonpartisan'
  return 'unknown'
}

export const buildPlanData = (input: PlanInput): PlanData => {
  const candidateName = input.candidateName || 'Your campaign'
  const race = input.race || 'Your race'
  const location = [input.city, input.state].filter(Boolean).join(', ')
  const districtName = (input.district ?? '').trim()
  const hasDistrict = districtName !== ''
  const electionType = resolveElectionType(input.partisanType ?? '')

  const electionDateValid = parseDateIso(input.electionDateIso)
  const electionDate = electionDateValid ? formatDate(electionDateValid) : ''
  const filingDateStart = parseDateIso(input.filingDateStartIso)
  const filingDateEnd = parseDateIso(input.filingDateEndIso)

  const planGenerationDate = formatDate(new Date())

  const winNumber = input.winNumber
  const projectedTurnout = input.projectedTurnout
  const voterContactGoal = resolveVoterContactGoal(
    input.voterContactGoal,
    winNumber,
  )
  // Normally 10 (the contact-goal multiplier), but derived from the actual
  // goal so the "reach each voter about N times" copy can't drift from the
  // numbers when the API supplies a race-specific goal.
  const contactsPerVoter =
    winNumber > 0 ? Math.max(1, Math.round(voterContactGoal / winNumber)) : 10

  const winNumberLow = Math.max(0, Math.round(winNumber * 0.9))
  const winNumberHigh = Math.round(winNumber * 1.1)
  const projectedTurnoutLow = Math.max(0, Math.round(projectedTurnout * 0.9))
  const projectedTurnoutHigh = Math.round(projectedTurnout * 1.1)

  // Prefer the real registered-voter count from election-api when present.
  // Falls back to the ~22%-turnout heuristic on projectedTurnout when the
  // race hash didn't resolve or upstream data is sparse.
  const registeredVoters =
    input.registeredVoters && input.registeredVoters > 0
      ? input.registeredVoters
      : projectedTurnout > 0
        ? Math.round(projectedTurnout / 0.22)
        : 0
  const registeredVotersLow = Math.max(0, Math.round(registeredVoters * 0.9))
  const registeredVotersHigh = Math.round(registeredVoters * 1.1)

  const votesNeededPctOfRegistered =
    registeredVoters > 0 && winNumber > 0
      ? Math.max(1, Math.round((winNumber / registeredVoters) * 100))
      : null
  const cellphoneCount =
    input.uniqueCellphones && input.uniqueCellphones > 0
      ? input.uniqueCellphones
      : null
  const landlineCount =
    input.uniqueLandlines && input.uniqueLandlines > 0
      ? input.uniqueLandlines
      : null
  const pctVotersWithCellphone =
    cellphoneCount !== null && registeredVoters > 0
      ? Math.min(
          100,
          Math.max(1, Math.round((cellphoneCount / registeredVoters) * 100)),
        )
      : null

  // Mirror the onboarding step's guard: without a contact goal and projected
  // turnout the plan's resourcing is degenerate (direct mail keys off
  // turnout), so emit empty budget and time tables together rather than
  // silently wrong ones.
  const metricsReady = voterContactGoal > 0 && projectedTurnout > 0
  const emptyBudget: BudgetBreakdown = { totalBudget: 0, lineItems: [] }
  const { totalBudget, lineItems: budgetLineItems } = metricsReady
    ? buildBudgetBreakdown(voterContactGoal, projectedTurnout, input.filingFee)
    : emptyBudget

  const weeksRemaining = resolveWeeksRemaining(electionDateValid)
  const campaignHours = computeCampaignHours(voterContactGoal, weeksRemaining)

  // civicEvents must be computed before buildTimeline so the Section 6
  // events milestone can use the real event count and first event date
  // instead of placeholders. pressOutlets has no such dependency but is
  // grouped here with civicEvents for clarity.
  const civicEvents = buildCivicEvents(input.communityEvents)
  const pressOutlets = buildPressOutlets(input.pressOutletsFromApi)
  const eventCount = civicEvents.length
  const mediaCount = pressOutlets.length

  const { timelineStages, keyDates, ballotsGoOutDate } = buildTimeline(
    electionDateValid,
    filingDateStart,
    filingDateEnd,
    input.milestones,
    eventCount,
    earliestEventDate(input.communityEvents),
    input.state,
  )
  const contactSchedule = buildContactSchedule(electionDateValid)

  const confidenceEstimates = buildConfidenceEstimates(
    registeredVoters,
    registeredVotersLow,
    registeredVotersHigh,
    projectedTurnout,
    projectedTurnoutLow,
    projectedTurnoutHigh,
    winNumber,
    winNumberLow,
    winNumberHigh,
  )
  const campaignMath = buildCampaignMath(
    winNumber,
    projectedTurnout,
    voterContactGoal,
    totalBudget,
  )
  const opportunityRows = buildOpportunityRows(
    registeredVoters,
    winNumber,
    votesNeededPctOfRegistered,
    cellphoneCount,
    pctVotersWithCellphone,
    voterContactGoal,
    mediaCount,
    eventCount,
  )
  const challengeRows = buildChallengeRows(projectedTurnout, ballotsGoOutDate)

  const opponents = buildOpponents(
    input.strategicLandscape,
    input.raceCandidates,
    input.runningAgainst,
    input.hubspotIncumbent,
  )
  const opponentCount = opponents.length
  const incumbent = opponents.find((o) => o.incumbent === true) ?? null

  const { issues: voterInsightsIssues, source: voterInsightsSource } =
    buildVoterInsights(
      input.customIssues,
      input.stances,
      input.voterIssuesFromApi,
    )

  // Section 3 "Your Key Numbers" — Number | Target | How we got it.
  const metrics: MetricRow[] = [
    {
      metric: 'Registered voters',
      target: registeredVoters.toLocaleString('en-US'),
      source:
        "Everyone who's eligible to vote in your race, from the latest voter file (L2 Voter Data).",
    },
    {
      metric: 'People expected to vote',
      target: projectedTurnout.toLocaleString('en-US'),
      source:
        'How many of them we think will actually vote, based on the last three elections in your area and our model.',
    },
    {
      metric: 'Votes you need to win',
      target: winNumber.toLocaleString('en-US'),
      source:
        'A little more than half (50% + 1) of the people expected to vote.',
    },
    {
      metric: 'Times to reach each voter',
      target: `${contactsPerVoter}`,
      source:
        'About how many times winning campaigns reach out to each voter before the name sticks.',
    },
    {
      metric: 'People you need to reach',
      target: voterContactGoal.toLocaleString('en-US'),
      source: `${contactsPerVoter} times the votes you need to win.`,
    },
    {
      metric: 'Volunteer help',
      target: `About ${campaignHours.volunteerCount.toLocaleString(
        'en-US',
      )} volunteer${campaignHours.volunteerCount === 1 ? '' : 's'}, ~${
        campaignHours.volunteerHoursPerWeek
      } hrs/week`,
      source:
        'Enough hands to cover your events, knock doors, and help on Election Day.',
    },
  ]

  return {
    candidateName,
    race,
    location,
    districtName,
    hasDistrict,
    electionType,
    electionDate,
    electionDateRaw: electionDateValid,
    planGenerationDate,
    winNumber,
    winNumberLow,
    winNumberHigh,
    projectedTurnout,
    projectedTurnoutLow,
    projectedTurnoutHigh,
    registeredVoters,
    registeredVotersLow,
    registeredVotersHigh,
    voterContactGoal,
    contactsPerVoter,
    votesNeededPctOfRegistered,
    pctVotersWithCellphone,
    cellphoneCount,
    landlineCount,
    opponentCount,
    volunteerCount: campaignHours.volunteerCount,
    volunteerHoursPerWeek: campaignHours.volunteerHoursPerWeek,
    candidateHoursPerWeek: campaignHours.candidateHoursPerWeek,
    totalBudget,
    eventCount,
    mediaCount,
    weeksRemaining,
    filingDateStart: formatDateMaybe(input.filingDateStartIso),
    filingDateEnd: formatDateMaybe(input.filingDateEndIso),
    filingDeadline: formatDateMaybe(input.filingDateEndIso),
    campaignMath,
    keyDates,
    voterInsightsIssues,
    voterInsightsSource,
    opportunityRows,
    challengeRows,
    opponents,
    incumbent,
    metrics,
    timelineStages,
    ballotsGoOutDate,
    budgetLineItems,
    fundraisingMix: FUNDRAISING_MIX,
    civicEvents,
    pressOutlets,
    contactSchedule,
    dataSources: DATA_SOURCES,
    keyAssumptions: KEY_ASSUMPTIONS,
    confidenceEstimates,
    planDoesNotDo: PLAN_DOES_NOT_DO,
    glossary: GLOSSARY,
    filingFee: input.filingFee,
    filingRequirementsText: input.filingRequirementsText,
  }
}
