import { describe, expect, it, vi } from 'vitest'
import { SOCIAL_PURPOSE_VALUES } from '@goodparty_org/contracts'
import { StrategicLandscapeFailedReasonSchema } from '@/campaignStrategy/schemas/strategicLandscape.schema'
import {
  buildCampaignManagerSystemPrompt,
  CampaignManagerContext,
  LEGAL_LINE,
  type LiveRaceData,
} from './campaignManagerPrompt'
import { legalAdviceBackstop } from '../services/guardrailBackstops'
import { guardrailLine } from '../services/guardrailLines'
import {
  GUARDRAIL_DECLINE,
  HONEST_REPORTING_BLOCK,
} from '../services/assistantRules.prompt'
import type { Organization } from '../../../generated/prisma'

const ctx = (
  over: Partial<CampaignManagerContext> = {},
): CampaignManagerContext => ({
  candidateFirstName: 'Renee',
  candidateName: 'Renee Diaz',
  campaignId: 1,
  officeName: 'City Council',
  district: null,
  officeLevel: null,
  location: 'Springfield, IL',
  electionDate: '2026-11-03',
  primaryElectionDate: null,
  primaryResult: null,
  didWin: null,
  smsCompliance: null,
  smsCutoffDate: null,
  liveRace: { status: 'none', reason: 'no-race' },
  ballotStatus: null,
  filingPeriodStart: null,
  filingPeriodEnd: null,
  topTasks: [
    {
      title: 'Knock 50 doors in Ward 3',
      date: new Date('2026-07-06T00:00:00Z'),
    },
    {
      title: 'Call your top 20 donors',
      date: new Date('2026-07-08T00:00:00Z'),
    },
  ],
  districtFilters: null,
  constituentToolEnabled: false,
  organization: null,
  crmToolsEnabled: false,
  savedFilterToolsEnabled: false,
  raceId: null,
  webSearchEnabled: true,
  helpCenterToolEnabled: false,
  isPro: null,
  story: null,
  plan: null,
  publicProfile: { status: 'not-live' },
  ...over,
})

// Noon Central on the given day: the same calendar day in every US zone, so
// the counts and the date line agree whatever the test machine's zone is.
const at = (day: string): Date => new Date(`${day}T17:00:00.000Z`)

describe('buildCampaignManagerSystemPrompt', () => {
  it("tells the manager what day it is, in the campaign state's zone", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'))
    try {
      const prompt = buildCampaignManagerSystemPrompt(ctx({ state: 'IL' }))
      expect(prompt).toContain(
        'Today is Monday, October 5, 2026 (Central Time).',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('makes every drafted text name the candidate and their office', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).toContain('"this is Renee Diaz, running for City Council"')
  })

  // The texting flow introduces the candidate by full name; a drafted text
  // that names them already is carried in as written, so the manager needs
  // the full name in front of it to write the same intro.
  it('gives the manager the full name a text introduces the candidate by', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).toContain(
      'Candidate: Renee\nCandidate full name: Renee Diaz',
    )
  })

  it('omits the full-name line when it adds nothing to the first name', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ candidateName: 'Renee' }),
    )
    expect(prompt).not.toContain('Candidate full name:')
  })

  // The product map's status line is the only place the prompt says whether
  // this campaign has Pro; the generic access rule reads it from there.
  it('tells the manager when the campaign is locked out of Pro areas', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx({ isPro: false }))
    expect(prompt).toContain('Pro status: this campaign does not have Pro')
  })

  it('declines unrelated asks with its own line, not the Chief of Staff one', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).toContain(GUARDRAIL_DECLINE.win)
    expect(prompt).not.toContain(GUARDRAIL_DECLINE.serve)
  })

  // A candidate has no office resources to keep apart from the campaign.
  it('leaves out the office/campaign boundary', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).not.toContain('office/campaign boundary')
  })

  // Win keeps ethnicity as a filter on purpose; only Serve dropped it.
  it('does not refuse outreach planned by ethnicity', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).not.toContain('on the basis of ethnicity')
  })

  it('calls imported people not in the voter file new contacts added, apart from voters', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        peopleDataset: {
          base: 'voters',
          overlayOrgSlug: 'campaign-springfield',
          overlayDistrictId: 'district-1',
        },
      }),
    )
    expect(prompt).toContain('are "new contacts added", never voters')
    expect(prompt).toContain(
      'give voters and new contacts added as two separate numbers',
    )
  })

  it('says nothing about new contacts without imported contacts', () => {
    expect(buildCampaignManagerSystemPrompt(ctx())).not.toContain(
      'new contacts added',
    )
    expect(
      buildCampaignManagerSystemPrompt(
        ctx({ peopleDataset: { base: 'voters' } }),
      ),
    ).not.toContain('new contacts added')
  })

  it('always includes the honest reporting rules', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).toContain(HONEST_REPORTING_BLOCK)
  })

  it('tells the manager when the campaign has Pro', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx({ isPro: true }))
    expect(prompt).toContain('Pro status: this campaign has Pro.')
    expect(prompt).not.toContain('does not have Pro')
  })

  it('injects the office, location, and the election date with its count', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ state: 'IL', now: at('2026-09-15') }),
    )
    expect(prompt).toContain('City Council')
    expect(prompt).toContain('Springfield, IL')
    expect(prompt).toContain(
      'Election date on record: Tuesday, November 3, 2026 (in 49 days)',
    )
    expect(prompt).toContain('Weeks to election: 7')
    expect(prompt).toContain('Primary date on record: none')
    expect(prompt).toContain('Filing period on record: none')
  })

  describe('calendar', () => {
    it('states the election day from the record with its status and days remaining', () => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({ state: 'IL', now: at('2026-09-15') }),
      )
      expect(prompt).toContain(
        "CALENDAR (as of the candidate's local day)\n" +
          'Take dates, weekdays and statuses from this calendar; do not derive them.',
      )
      expect(prompt).toContain(
        'ELECTION DAY (campaign record)\n' +
          'Tuesday, November 3, 2026\n' +
          'Status: UPCOMING\n' +
          'Days remaining: 49\n' +
          'Approved description: "Election Day is Tuesday, November 3."\n' +
          'Do not describe Election Day as past.',
      )
    })

    it('sits after the live block and before the ballot status', () => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({
          state: 'IL',
          now: at('2026-09-15'),
          ballotStatus: 'on-ballot',
          liveRace: { status: 'unavailable' },
        }),
      )
      const live = prompt.indexOf('Current race data was not available today.')
      const calendar = prompt.indexOf('CALENDAR (as of')
      const status = prompt.indexOf('When the candidate signed up')
      expect(live).toBeGreaterThan(-1)
      expect(calendar).toBeGreaterThan(live)
      expect(status).toBeGreaterThan(calendar)
    })

    it('marks a record-versus-live conflict unknown with both dates, beside the disagreement line', () => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({
          state: 'IL',
          now: at('2026-10-05'),
          electionDate: '2027-04-06',
          liveRace: {
            status: 'ok',
            data: {
              generalElectionDate: '2027-02-23',
              primaryElectionDate: null,
              milestones: null,
              winNumber: 0,
              voterContactGoal: 0,
            },
          },
        }),
      )
      expect(prompt).toContain(
        'ELECTION DAY\n' +
          'Status: UNKNOWN\n' +
          'Reason: conflicting_sources\n' +
          'Campaign record: Tuesday, April 6, 2027\n' +
          'Election data: Tuesday, February 23, 2027',
      )
      expect(prompt).toContain('disagree on the election date')
    })

    it('leaves the filing period to the record line, so it renders once', () => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({
          state: 'IL',
          now: at('2026-10-05'),
          filingPeriodStart: '2026-11-16',
          filingPeriodEnd: '2026-11-23',
        }),
      )
      expect(prompt).toContain(
        'Filing period on record: opens Monday, November 16, 2026 (in 42 days)',
      )
      expect(prompt).not.toContain('FILING PERIOD')
    })

    it('keeps a malformed feed window visible as "no window on file"', () => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({
          state: 'IL',
          now: at('2026-10-05'),
          liveRace: {
            status: 'ok',
            data: {
              generalElectionDate: '2026-11-03',
              primaryElectionDate: null,
              milestones: {
                voterRegistration: null,
                earlyVoting: { start: '2026-13-45', end: null },
                ballotRequest: null,
              },
              winNumber: 0,
              voterContactGoal: 0,
            },
          },
        }),
      )
      expect(prompt).toContain('Early voting: no window on file (BallotReady)')
      expect(prompt).not.toContain('EARLY VOTING')
    })

    it('drops the cautions when the context says so', () => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({ state: 'IL', now: at('2026-09-15'), calendarCautions: false }),
      )
      expect(prompt).toContain('Status: UPCOMING')
      expect(prompt).not.toContain('Do not describe Election Day')
    })

    it('renders no calendar when nothing is on file', () => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({ electionDate: null, primaryElectionDate: null }),
      )
      expect(prompt).not.toContain('CALENDAR (as of')
    })
  })

  describe('race dates on record', () => {
    it('renders both dates with counts when the record holds a primary too', () => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({
          state: 'IL',
          now: at('2026-10-02'),
          electionDate: '2027-04-06',
          primaryElectionDate: '2027-02-23',
        }),
      )
      expect(prompt).toContain(
        'Election date on record: Tuesday, April 6, 2027 (in 186 days)',
      )
      expect(prompt).toContain('Weeks to election: 26')
      expect(prompt).toContain(
        'Primary date on record: Tuesday, February 23, 2027 (in 144 days)',
      )
    })

    it('counts a past election in days ago and drops the weeks line', () => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({ state: 'FL', now: at('2026-11-10') }),
      )
      expect(prompt).toContain(
        'Election date on record: Tuesday, November 3, 2026 (7 days ago)',
      )
      expect(prompt).not.toContain('Weeks to election')
    })

    it('labels a primary-only record as a primary, with no weeks line', () => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({
          state: 'KY',
          now: at('2026-04-09'),
          electionDate: null,
          primaryElectionDate: '2026-05-19',
        }),
      )
      expect(prompt).toContain('Election date on record: none')
      expect(prompt).toContain(
        'Primary date on record: Tuesday, May 19, 2026 (in 40 days)',
      )
      expect(prompt).not.toContain('Weeks to election')
    })

    it('says the record has no dates when it has none', () => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({ electionDate: null, primaryElectionDate: null }),
      )
      expect(prompt).toContain('Election date on record: none')
      expect(prompt).toContain('Primary date on record: none')
      expect(prompt).toContain('Filing period on record: none')
      expect(prompt).not.toContain('NaN')
    })

    it('reads a malformed stored date as none, never as NaN', () => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({
          electionDate: '2025-Q1',
          primaryElectionDate: '',
          filingPeriodEnd: 'not a date',
        }),
      )
      expect(prompt).toContain('Election date on record: none')
      expect(prompt).toContain('Primary date on record: none')
      expect(prompt).toContain('Filing period on record: none')
      expect(prompt).not.toContain('NaN')
      expect(prompt).not.toContain('Invalid Date')
    })

    it('renders the primary result and the did-win flag when set', () => {
      const none = buildCampaignManagerSystemPrompt(
        ctx({ state: 'IL', now: at('2026-10-02') }),
      )
      expect(none).not.toContain('Primary result on record')
      expect(none).not.toContain('Result on record')
      const lost = buildCampaignManagerSystemPrompt(
        ctx({ primaryElectionDate: '2026-05-19', primaryResult: 'lost' }),
      )
      expect(lost).toContain('Primary result on record: lost')
      const won = buildCampaignManagerSystemPrompt(ctx({ didWin: true }))
      expect(won).toContain('Result on record: won')
      const lostRace = buildCampaignManagerSystemPrompt(ctx({ didWin: false }))
      expect(lostRace).toContain('Result on record: lost')
    })

    // A primary behind the candidate with nothing on record used to read as a
    // round they advanced from. The missing result is now a fact on the page.
    it('says the result is none once a date has passed with nothing on record', () => {
      const primaryPassed = buildCampaignManagerSystemPrompt(
        ctx({
          state: 'KY',
          now: at('2026-06-01'),
          electionDate: '2026-11-03',
          primaryElectionDate: '2026-05-19',
        }),
      )
      expect(primaryPassed).toContain('Primary result on record: none')
      expect(primaryPassed).not.toContain('Result on record: none')
      const bothPassed = buildCampaignManagerSystemPrompt(
        ctx({
          state: 'FL',
          now: at('2026-11-10'),
          primaryElectionDate: '2026-08-18',
        }),
      )
      expect(bothPassed).toContain('Primary result on record: none')
      expect(bothPassed).toContain('Result on record: none')
    })

    it('keeps the primary result line off on primary day itself', () => {
      const primaryDay = buildCampaignManagerSystemPrompt(
        ctx({
          state: 'KY',
          now: at('2026-05-19'),
          electionDate: '2026-11-03',
          primaryElectionDate: '2026-05-19',
        }),
      )
      expect(primaryDay).toContain(
        'Primary date on record: Tuesday, May 19, 2026 (today)',
      )
      expect(primaryDay).not.toContain('Primary result on record')
    })

    it('keeps the result line off on election day itself', () => {
      const electionDay = buildCampaignManagerSystemPrompt(
        ctx({ state: 'IL', now: at('2026-11-03') }),
      )
      expect(electionDay).toContain(
        'Election date on record: Tuesday, November 3, 2026 (today)',
      )
      expect(electionDay).not.toContain('Result on record')
    })

    // The proposal's worked example: a candidate whose record and the live
    // sources agree, on 2026-10-05, with a registration window already closed.
    const LIVE: LiveRaceData = {
      generalElectionDate: '2026-11-03',
      primaryElectionDate: null,
      milestones: {
        voterRegistration: { start: null, end: '2026-10-02' },
        earlyVoting: { start: '2026-10-24', end: '2026-11-01' },
        ballotRequest: { start: null, end: '2026-10-24' },
      },
      winNumber: 1234,
      voterContactGoal: 4936,
    }
    const liveCtx = (
      data: Partial<LiveRaceData> = {},
      over: Partial<CampaignManagerContext> = {},
    ): CampaignManagerContext =>
      ctx({
        state: 'IL',
        now: at('2026-10-05'),
        liveRace: { status: 'ok', data: { ...LIVE, ...data } },
        ...over,
      })

    describe('current race data', () => {
      it('renders each live fact under its own source tag', () => {
        const prompt = buildCampaignManagerSystemPrompt(liveCtx())
        expect(prompt).toContain(
          'Current race data, fetched today:\n' +
            'General election date: Tuesday, November 3, 2026 (in 29 days) (election data)\n' +
            'Primary election date: no date on file (election data)\n' +
            'Votes needed to win: about 1,234 (model estimate). Voter contact goal: about 4,936 (model estimate).',
        )
        expect(prompt).not.toContain('disagree')
      })

      it('restates each live window in the calendar with its status for the day', () => {
        const prompt = buildCampaignManagerSystemPrompt(liveCtx())
        expect(prompt).toContain(
          'VOTER REGISTRATION (BallotReady)\n' +
            'Opens: not on file\n' +
            'Closes: Friday, October 2, 2026\n' +
            'Status: CLOSED\n' +
            'Days since it closed: 3\n' +
            'Approved description: "Voter registration closed October 2."\n' +
            'Do not describe voter registration as open.',
        )
        expect(prompt).toContain(
          'EARLY VOTING (BallotReady)\n' +
            'Opens: Saturday, October 24, 2026\n' +
            'Closes: Sunday, November 1, 2026\n' +
            'Status: NOT YET OPEN\n' +
            'Days until it opens: 19\n' +
            'Approved description: "Early voting opens October 24."\n' +
            'Do not describe early voting as currently open.',
        )
        expect(prompt).toContain(
          'MAIL BALLOT REQUESTS (BallotReady)\n' +
            'Opens: not on file\n' +
            'Closes: Saturday, October 24, 2026\n' +
            'Status: UNKNOWN\n' +
            'Reason: opening_date_unknown\n' +
            'Days until it closes: 19\n' +
            'Approved description: "Mail ballot requests close October 24."',
        )
      })

      it('places the live block after the record and before the ballot status', () => {
        const prompt = buildCampaignManagerSystemPrompt(
          liveCtx({}, { ballotStatus: 'on-ballot' }),
        )
        const record = prompt.indexOf('Election date on record')
        const live = prompt.indexOf('Current race data, fetched today:')
        const status = prompt.indexOf('When the candidate signed up')
        expect(record).toBeGreaterThan(-1)
        expect(live).toBeGreaterThan(record)
        expect(status).toBeGreaterThan(live)
      })

      it('states both dates and the consequence when the record and the live election date disagree', () => {
        const prompt = buildCampaignManagerSystemPrompt(
          liveCtx(
            { generalElectionDate: '2027-02-23', primaryElectionDate: null },
            { electionDate: '2027-04-06' },
          ),
        )
        expect(prompt).toContain(
          'The campaign record, captured when the candidate set up the race, ' +
            'and the election data fetched today disagree on the election ' +
            'date: the record says Tuesday, April 6, 2027; the election data ' +
            'says Tuesday, February 23, 2027. Do not resolve this by ' +
            'assumption. If the correct date would change your guidance, ask ' +
            'the candidate to clarify or verify it before planning around ' +
            'either date.',
        )
      })

      it('does the same for the primary date', () => {
        const prompt = buildCampaignManagerSystemPrompt(
          liveCtx(
            { primaryElectionDate: '2026-05-19' },
            { primaryElectionDate: '2026-03-17' },
          ),
        )
        expect(prompt).toContain(
          'disagree on the primary date: the record says Tuesday, March 17, ' +
            '2026; the election data says Tuesday, May 19, 2026.',
        )
        expect(prompt).not.toContain('disagree on the election date')
      })

      it('states a live primary the record lacks as a fact, not a disagreement', () => {
        const prompt = buildCampaignManagerSystemPrompt(
          liveCtx({ primaryElectionDate: '2026-05-19' }),
        )
        expect(prompt).toContain(
          'Primary election date: Tuesday, May 19, 2026 (139 days ago) (election data)',
        )
        expect(prompt).toContain('Primary date on record: none')
        expect(prompt).not.toContain('disagree')
      })

      it('says when the feed has no window of a kind, and when no windows came back', () => {
        const noEarlyVoting = buildCampaignManagerSystemPrompt(
          liveCtx({
            milestones: {
              voterRegistration: { start: '2026-09-01', end: '2026-10-19' },
              earlyVoting: null,
              ballotRequest: null,
            },
          }),
        )
        expect(noEarlyVoting).toContain(
          'VOTER REGISTRATION (BallotReady)\n' +
            'Opens: Tuesday, September 1, 2026\n' +
            'Closes: Monday, October 19, 2026\n' +
            'Status: OPEN\n' +
            'Days until it closes: 14\n' +
            'Approved description: "Voter registration is open through October 19."',
        )
        expect(noEarlyVoting).toContain(
          'Early voting: no window on file (BallotReady)',
        )
        const none = buildCampaignManagerSystemPrompt(
          liveCtx({ milestones: null }),
        )
        expect(none).toContain(
          'Voter registration, early voting, mail ballot windows: not available today (BallotReady)',
        )
        expect(none).not.toContain('Early voting:')
      })

      // The service's position-based fallback returns windows and a win
      // number with no dates at all. That is not the live source saying the
      // race has no election, so the date lines say the feed holds no date.
      it('says no date on file, not none, when the live data carries no dates', () => {
        const prompt = buildCampaignManagerSystemPrompt(
          liveCtx({ generalElectionDate: null, primaryElectionDate: null }),
        )
        expect(prompt).toContain(
          'General election date: no date on file (election data)',
        )
        expect(prompt).toContain(
          'Primary election date: no date on file (election data)',
        )
        expect(prompt).not.toContain('election date: none')
        expect(prompt).toContain('Opens: Saturday, October 24, 2026')
        expect(prompt).toContain('Votes needed to win: about 1,234')
        expect(prompt).not.toContain('disagree')
      })

      it('drops the estimates when the model has none', () => {
        const prompt = buildCampaignManagerSystemPrompt(
          liveCtx({ winNumber: 0, voterContactGoal: 0 }),
        )
        expect(prompt).not.toContain('Votes needed to win')
        expect(prompt).not.toContain('Voter contact goal')
        expect(prompt).not.toContain('model estimate')
      })

      it('names the field the lookup needed when there was none to make', () => {
        const noDate = buildCampaignManagerSystemPrompt(
          ctx({ liveRace: { status: 'none', reason: 'no-election-date' } }),
        )
        expect(noDate).toContain(
          'No current race data: the campaign record has no election date to look the race up by.',
        )
        const noRace = buildCampaignManagerSystemPrompt(
          ctx({ liveRace: { status: 'none', reason: 'no-race' } }),
        )
        expect(noRace).toContain(
          'No current race data: no BallotReady race is linked to this campaign.',
        )
        const unavailable = buildCampaignManagerSystemPrompt(
          ctx({ liveRace: { status: 'unavailable' } }),
        )
        expect(unavailable).toContain(
          'Current race data was not available today.',
        )
        for (const prompt of [noDate, noRace, unavailable]) {
          expect(prompt).not.toContain('fetched today')
        }
      })
    })

    it('shows the filing window for a candidate already on the ballot', () => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({
          state: 'CA',
          now: at('2026-10-02'),
          ballotStatus: 'on-ballot',
          filingPeriodStart: '2026-07-13',
          filingPeriodEnd: '2026-08-07',
        }),
      )
      expect(prompt).toContain(
        'Filing period on record: opened Monday, July 13, 2026 (81 days ago), ' +
          'closed Friday, August 7, 2026 (56 days ago)',
      )
      // The playbook stays reserved for candidates who have not filed.
      expect(prompt).not.toContain('Getting on the ballot is the single most')
    })

    it('renders a half-known filing window and the day itself', () => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({
          state: 'IL',
          now: at('2026-11-16'),
          filingPeriodStart: '2026-11-16',
          filingPeriodEnd: null,
        }),
      )
      expect(prompt).toContain(
        'Filing period on record: opens Monday, November 16, 2026 (today)',
      )
    })

    it("takes the day from the campaign's zone, not the server's", () => {
      // 11:30pm on the 2nd in Chicago is already the 3rd in UTC.
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({ state: 'IL', now: new Date('2026-10-03T04:30:00.000Z') }),
      )
      expect(prompt).toContain(
        'Today is Friday, October 2, 2026 (Central Time).',
      )
      expect(prompt).toContain(
        'Election date on record: Tuesday, November 3, 2026 (in 32 days)',
      )
    })
  })

  it('lists the top tasks by title', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).toContain('Knock 50 doors in Ward 3')
    expect(prompt).toContain('Call your top 20 donors')
  })

  it('grounds the manager in the plan landscape when it exists', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        plan: {
          opportunities: ['Strong ward-level volunteer base'],
          challenges: ['Low name recognition'],
          opponents: [
            {
              fullName: 'Pat Smith',
              partyAffiliation: 'Republican',
              incumbent: true,
            },
          ],
        },
      }),
    )
    expect(prompt).toContain('Strong ward-level volunteer base')
    expect(prompt).toContain('Low name recognition')
    expect(prompt).toContain('Pat Smith (Republican, incumbent)')
    expect(prompt).not.toContain('has not been generated yet')
  })

  it('says the plan is not generated yet when it is missing', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx({ plan: null }))
    expect(prompt).toContain('has not been generated yet')
  })

  it('advertises the constituent-data tool only when it is enabled', () => {
    const off = buildCampaignManagerSystemPrompt(ctx())
    expect(off).not.toContain('query_constituent_data')

    const on = buildCampaignManagerSystemPrompt(
      ctx({ constituentToolEnabled: true }),
    )
    expect(on).toContain('query_constituent_data')
    expect(on).toContain('describe_constituent_data')
  })

  // Party is a registration only where the state reports one
  // (peopleDb/partySource.ts); the tool description says how L2 assigned it
  // elsewhere, so the prompt only has to stop calling it one.
  it('calls party a registration only where the state registers by party', () => {
    const registered = buildCampaignManagerSystemPrompt(
      ctx({ constituentToolEnabled: true, districtState: 'CA' }),
    )
    expect(registered).toContain(
      'Party registration and modeled partisanship breakdowns ARE allowed',
    )
    const modeled = buildCampaignManagerSystemPrompt(
      ctx({ constituentToolEnabled: true, districtState: 'MN' }),
    )
    expect(modeled).toContain(
      'Party and modeled partisanship breakdowns ARE allowed',
    )
    expect(modeled).not.toContain('Party registration and modeled')
    const primary = buildCampaignManagerSystemPrompt(
      ctx({ constituentToolEnabled: true, districtState: 'IL' }),
    )
    expect(primary).toContain(
      'Party and modeled partisanship breakdowns ARE allowed',
    )
    // The record's state keeps the clock; only the district's decides party.
    const unknown = buildCampaignManagerSystemPrompt(
      ctx({ constituentToolEnabled: true, state: 'MN', districtState: null }),
    )
    expect(unknown).toContain(
      'Party registration and modeled partisanship breakdowns ARE allowed',
    )
  })

  it('advertises the CRM contact tools only when they are registered', () => {
    const off = buildCampaignManagerSystemPrompt(ctx())
    expect(off).not.toContain('count_contacts')
    expect(off).not.toContain('describe_filter_dimensions')

    const on = buildCampaignManagerSystemPrompt(
      ctx({
        crmToolsEnabled: true,
        isPro: true,
        organization: { slug: 'win-campaign' } as Organization,
      }),
    )
    expect(on).toContain('count_contacts')
    expect(on).toContain('describe_filter_dimensions')

    // Flag on but no org row resolved = tools not registered, so no block.
    const noOrg = buildCampaignManagerSystemPrompt(
      ctx({ crmToolsEnabled: true, organization: null }),
    )
    expect(noOrg).not.toContain('count_contacts')
  })

  it('tells a campaign without Pro what it can do and where the gate is', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        crmToolsEnabled: true,
        savedFilterToolsEnabled: true,
        isPro: false,
        organization: { slug: 'win-campaign' } as Organization,
      }),
    )

    expect(prompt).toContain('count_contacts')
    expect(prompt).toContain('This campaign does not have Pro')
    // Saved lists and precincts are not registered for it.
    expect(prompt).not.toContain('crud_saved_filters')
    expect(prompt).not.toContain('list_precincts')
  })

  it('keeps the full voter-data guidance when Pro status is unknown', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        crmToolsEnabled: true,
        savedFilterToolsEnabled: true,
        isPro: null,
        organization: { slug: 'win-campaign' } as Organization,
      }),
    )

    expect(prompt).toContain('count_contacts')
    expect(prompt).toContain('crud_saved_filters')
  })

  it('advertises the saved-list tool only when it is registered', () => {
    const readOnly = buildCampaignManagerSystemPrompt(
      ctx({
        crmToolsEnabled: true,
        isPro: true,
        organization: { slug: 'win-campaign' } as Organization,
      }),
    )
    expect(readOnly).toContain('count_contacts')
    expect(readOnly).not.toContain('crud_saved_filters')
    expect(readOnly).not.toContain('present_list_proposal')

    const withWrites = buildCampaignManagerSystemPrompt(
      ctx({
        crmToolsEnabled: true,
        savedFilterToolsEnabled: true,
        isPro: true,
        organization: { slug: 'win-campaign' } as Organization,
      }),
    )
    expect(withWrites).toContain('crud_saved_filters')
    expect(withWrites).toContain('present_list_proposal')
  })

  it('offers a list card to a campaign without Pro, behind the Pro gate', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        crmToolsEnabled: true,
        savedFilterToolsEnabled: true,
        isPro: false,
        organization: { slug: 'win-campaign' } as Organization,
      }),
    )
    expect(prompt).toContain('present_list_proposal')
    expect(prompt).not.toContain('crud_saved_filters')
  })

  it('teaches the map rules only where show_list_map is registered', () => {
    const crm = ctx({
      crmToolsEnabled: true,
      savedFilterToolsEnabled: true,
      isPro: true,
      organization: { slug: 'win-campaign' } as Organization,
    })
    const without = buildCampaignManagerSystemPrompt(crm, ['count_contacts'])
    expect(without).not.toContain('LIST MAP RULES')
    expect(without).not.toContain('DRAWN AREA RULES')

    const withMap = buildCampaignManagerSystemPrompt(crm, [
      'count_contacts',
      'show_list_map',
    ])
    expect(withMap).toContain('LIST MAP RULES')
    expect(withMap).toContain('DRAWN AREA RULES')
    const block = withMap.slice(
      withMap.indexOf('LIST MAP RULES'),
      withMap.indexOf('Drawing is optional'),
    )
    expect(block).not.toMatch(/constituent|holder|official/i)
  })

  it('offers a sampled text card only where both tools are registered', () => {
    const crm = ctx({
      crmToolsEnabled: true,
      savedFilterToolsEnabled: true,
      isPro: true,
      organization: { slug: 'win-campaign' } as Organization,
    })
    const noTools = buildCampaignManagerSystemPrompt(crm)
    expect(noTools).not.toContain('SAMPLING RULES')
    expect(noTools).not.toContain('size_outreach_sample')
    expect(noTools).not.toContain('present_outreach_proposal')

    const sizeOnly = buildCampaignManagerSystemPrompt(crm, [
      'count_contacts',
      'size_outreach_sample',
    ])
    expect(sizeOnly).not.toContain('SAMPLING RULES')

    const prompt = buildCampaignManagerSystemPrompt(crm, [
      'count_contacts',
      'crud_saved_filters',
      'size_outreach_sample',
      'present_outreach_proposal',
    ])
    expect(prompt).toContain('SAMPLING RULES')
    expect(prompt).toContain(
      'Texting all 58,520 is about $2,048. Texting 2,767 of them is ' +
        'about $97 and should bring back about 83 replies.',
    )
    const block = prompt
      .slice(prompt.indexOf('SAMPLING RULES'))
      .split('\n\n')[0]
    expect(block).not.toContain('constituent')
    expect(block).not.toContain('official')
    expect(block).not.toContain('{{first_name}}')
  })

  describe('SMS compliance cutoff', () => {
    const outreachTools = [
      'count_contacts',
      'crud_saved_filters',
      'size_outreach_sample',
      'present_outreach_proposal',
      'ask_clarify_question',
    ]
    const crm = {
      crmToolsEnabled: true,
      savedFilterToolsEnabled: true,
      isPro: true,
      organization: { slug: 'win-campaign' } as Organization,
    }

    it('closes texting with the cutoff date when the window is closed', () => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({
          ...crm,
          smsCompliance: 'closed',
          smsCutoffDate: '2026-10-15',
        }),
        outreachTools,
      )
      expect(prompt).toContain('TEXTING IS CLOSED FOR THIS RACE')
      expect(prompt).toContain(
        'The deadline to get verified for texting was Thursday, October ' +
          '15, 2026 and has passed.',
      )
      expect(prompt).toContain('Never a text: texting is closed for this race.')
      expect(prompt).not.toContain(
        'A text for a short answer from a large group.',
      )
    })

    it('closes texting without the CRM tools too', () => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({ smsCompliance: 'closed', smsCutoffDate: '2026-10-15' }),
      )
      expect(prompt).toContain('TEXTING IS CLOSED FOR THIS RACE')
      expect(prompt).not.toContain('SAMPLING RULES')
    })

    it.each(['open', 'closing', 'not_applicable', null] as const)(
      'leaves texting alone when the window is %s',
      (smsCompliance) => {
        const prompt = buildCampaignManagerSystemPrompt(
          ctx({ ...crm, smsCompliance, smsCutoffDate: '2026-10-15' }),
          outreachTools,
        )
        expect(prompt).not.toContain('TEXTING IS CLOSED')
        expect(prompt).not.toContain('Never a text')
        expect(prompt).toContain(
          'A text for a short answer from a large group.',
        )
      },
    )
  })

  it('reads past sends only where the tool is registered', () => {
    const base = ctx({})
    expect(buildCampaignManagerSystemPrompt(base)).not.toContain(
      'PAST OUTREACH',
    )
    const withRead = buildCampaignManagerSystemPrompt(base, [
      'read_past_outreach',
    ])
    expect(withRead).toContain('PAST OUTREACH')
    expect(withRead).not.toContain('present_past_outreach')
    expect(
      buildCampaignManagerSystemPrompt(base, [
        'read_past_outreach',
        'present_past_outreach',
      ]),
    ).toContain('present_past_outreach')
    expect(withRead).not.toContain('read_outreach_feedback')
    const withNotes = buildCampaignManagerSystemPrompt(base, [
      'read_past_outreach',
      'read_outreach_feedback',
    ])
    expect(withNotes).toContain(
      'When the candidate asks what voters said at the doors or on calls, call read_outreach_feedback',
    )
  })

  it('asks choices as a card only where the clarify tool is registered', () => {
    const base = ctx({})
    expect(buildCampaignManagerSystemPrompt(base)).not.toContain(
      'ask_clarify_question',
    )

    const withClarify = buildCampaignManagerSystemPrompt(base, [
      'ask_clarify_question',
    ])
    expect(withClarify).not.toContain(
      'When you recommend more than one piece of outreach',
    )

    expect(
      buildCampaignManagerSystemPrompt(base, [
        'ask_clarify_question',
        'present_outreach_proposal',
      ]),
    ).toContain('When you recommend more than one piece of outreach')
  })

  it('runs the Campaign Story intake, one question at a time, when incomplete', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        story: {
          why: null,
          background: null,
          positions: [],
          complete: false,
          missing: ['why', 'background', 'positions'],
        },
      }),
    )
    expect(prompt).toContain('one at a time')
  })

  it('explains every failed reason the plan status can return', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        story: {
          why: 'w',
          background: 'b',
          positions: [{ title: 't', description: 'd' }],
          complete: true,
          missing: [],
        },
      }),
    )
    for (const reason of StrategicLandscapeFailedReasonSchema.options) {
      expect(prompt).toContain(`'${reason}'`)
    }
  })

  it('does not re-run the intake once the story is complete', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        story: {
          why: 'w',
          background: 'b',
          positions: [{ title: 't', description: 'd' }],
          complete: true,
          missing: [],
        },
      }),
    )
    expect(prompt).toContain('finished their Campaign Story')
    expect(prompt).not.toContain('one at a time')
  })

  it('says nothing about ballot status when the candidate never answered', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).not.toContain('already on the ballot')
  })

  it('carries the ballot-access playbook for a qualified-not-filed candidate', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ ballotStatus: 'qualified-not-filed' }),
    )
    expect(prompt).toContain('Getting on the ballot is the single most')
    expect(prompt).not.toContain('has not committed to running yet')
  })

  it('carries the playbook plus the still-deciding caveat when considering', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ ballotStatus: 'considering' }),
    )
    expect(prompt).toContain('Getting on the ballot is the single most')
    expect(prompt).toContain('has not committed to running yet')
  })

  it('states the filing period close as the deadline, with days remaining', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        state: 'IL',
        now: at('2026-08-19'),
        ballotStatus: 'qualified-not-filed',
        filingPeriodStart: '2026-09-01',
        filingPeriodEnd: '2026-09-15',
      }),
    )
    expect(prompt).toContain(
      'Filing opens Tuesday, September 1, 2026 (in 13 days).',
    )
    expect(prompt).toContain(
      'filing deadline for this race is Tuesday, September 15, 2026',
    )
    expect(prompt).toContain('27 days from today')
  })

  it('singularizes the day count on the last day', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        state: 'IL',
        now: at('2026-09-14'),
        ballotStatus: 'qualified-not-filed',
        filingPeriodEnd: '2026-09-15',
      }),
    )
    expect(prompt).toContain('1 day from today')
  })

  it('flags a passed deadline as ambiguous rather than as time remaining', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        state: 'IL',
        now: at('2026-02-24'),
        ballotStatus: 'qualified-not-filed',
        filingPeriodEnd: '2026-01-15',
      }),
    )
    expect(prompt).toContain('has already passed')
    expect(prompt).not.toContain('day from today')
    expect(prompt).not.toContain('days from today')
  })

  // The count is taken from the candidate's own calendar day, so the deadline
  // day reads as due today right up to local midnight, and the day after it
  // reads as passed. Telling someone they missed a deadline that is actually
  // today is the worst error here.
  it('treats the deadline day as due today, not as passed', () => {
    for (const now of [
      at('2026-09-15'),
      new Date('2026-09-16T04:30:00.000Z'),
    ]) {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({
          state: 'IL',
          now,
          ballotStatus: 'qualified-not-filed',
          filingPeriodEnd: '2026-09-15',
        }),
      )
      expect(prompt).toContain('that is TODAY')
      expect(prompt).not.toContain('has already passed')
      expect(prompt).not.toContain('0 days from today')
    }
  })

  it('treats the day after the deadline as passed', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        state: 'IL',
        now: at('2026-09-16'),
        ballotStatus: 'qualified-not-filed',
        filingPeriodEnd: '2026-09-15',
      }),
    )
    expect(prompt).toContain('has already passed')
    expect(prompt).not.toContain('that is TODAY')
  })

  it('names the opening date and the missing deadline when only the start is on record', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        state: 'IL',
        now: at('2026-10-05'),
        ballotStatus: 'qualified-not-filed',
        filingPeriodStart: '2026-11-16',
        filingPeriodEnd: null,
      }),
    )
    // The race block and the guidance must agree about what the record holds.
    expect(prompt).toContain(
      'Filing period on record: opens Monday, November 16, 2026 (in 42 days)',
    )
    expect(prompt).toContain(
      'Filing opens Monday, November 16, 2026 (in 42 days), but the record has no end date',
    )
    expect(prompt).not.toContain('no filing period')
  })

  it('says the deadline is unknown when the race has no filing period', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ ballotStatus: 'qualified-not-filed', filingPeriodEnd: null }),
    )
    expect(prompt).toContain('no filing period')
  })

  it('states the other ballot answers without the filing playbook', () => {
    for (const status of ['on-ballot', 'testing'] as const) {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({ ballotStatus: status }),
      )
      expect(prompt).toContain('already on the ballot. They answered')
      expect(prompt).not.toContain('Getting on the ballot is the single most')
    }
  })

  it('puts the office, district, and level in the race context', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ district: 'Ward 3', officeLevel: 'CITY' }),
    )
    expect(prompt).toContain('District: Ward 3')
    expect(prompt).toContain('Office level: CITY')
  })

  it('sends the manager to BallotReady before web search when a race resolved', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ ballotStatus: 'qualified-not-filed', raceId: 'br-hash-1' }),
    )
    expect(prompt).toContain('call get_ballot_requirements FIRST')
  })

  it('falls back to web search when the campaign has no race record', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ ballotStatus: 'qualified-not-filed', raceId: null }),
    )
    expect(prompt).toContain('no BallotReady race record')
    expect(prompt).not.toContain('call get_ballot_requirements FIRST')
  })

  it('does not advertise the ballot tool to a candidate already on the ballot', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ ballotStatus: 'on-ballot', raceId: 'br-hash-1' }),
    )
    expect(prompt).not.toContain('get_ballot_requirements')
  })

  it('falls back to web search for what BallotReady leaves null', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        ballotStatus: 'qualified-not-filed',
        raceId: 'br-hash-1',
        webSearchEnabled: true,
      }),
    )
    expect(prompt).toContain('Use web_search to fill what it leaves null')
  })

  it('never mentions web search when the search tool is not registered', () => {
    for (const raceId of ['br-hash-1', null]) {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({
          ballotStatus: 'qualified-not-filed',
          raceId,
          webSearchEnabled: false,
        }),
      )
      expect(prompt).not.toContain('web_search')
      expect(prompt).toContain('no web-search tool on this turn')
    }
  })

  it('marks search-derived facts inline, not only in a footnote', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ webSearchEnabled: true }),
    )
    expect(prompt).toContain('not only in a footnote')
  })

  it('carries no search-provenance rule when search is off', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ webSearchEnabled: false }),
    )
    expect(prompt).not.toContain('not only in a footnote')
    expect(prompt).not.toContain(
      guardrailLine('search_provenance', 'campaign_assistant'),
    )
  })

  it('pins the legal line to one the finish-time check recognizes', () => {
    // A statute-citing reply that carries the line gets nothing appended.
    expect(
      legalAdviceBackstop(
        `RCW 42.17A applies. ${LEGAL_LINE}`,
        'campaign_assistant',
      ),
    ).toBeNull()
  })

  describe('compose-handoff rules (win_social)', () => {
    it('lists every Win social purpose', () => {
      const prompt = buildCampaignManagerSystemPrompt(ctx({}))
      for (const purpose of SOCIAL_PURPOSE_VALUES) {
        expect(prompt).toContain(purpose)
      }
    })

    it('says "candidate", never "official" (candidate vocabulary)', () => {
      const prompt = buildCampaignManagerSystemPrompt(ctx({}))
      expect(prompt).not.toContain('the official')
    })
  })
})

describe('public profile address', () => {
  const URL = 'https://goodparty.org/people/renee-diaz-0189abcd'

  it('hands over the live address verbatim and forbids building one', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ publicProfile: { status: 'live', url: URL } }),
    )
    expect(prompt).toContain(
      `The candidate's public profile is live at ${URL}. That is its only address`,
    )
  })

  it('withholds an address while the profile is not published, without claiming no page exists', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ publicProfile: { status: 'not-live' } }),
    )
    expect(prompt).toContain(
      "The candidate's public profile is not published. Do not give or print an address for it until it is live; they publish it from the Public Profile page.",
    )
    expect(prompt).not.toContain('/people/')
  })

  it('withholds an address while a removal is on record, without sending them to publish', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ publicProfile: { status: 'removed' } }),
    )
    expect(prompt).toContain(
      "The candidate's public profile page is not being served: a removal is on record. Do not give or print an address for it.",
    )
    expect(prompt).not.toContain('they publish it')
    expect(prompt).not.toContain('/people/')
  })

  it('says the address could not be determined instead of guessing', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ publicProfile: { status: 'unknown' } }),
    )
    expect(prompt).toContain(
      "The address of the candidate's public profile could not be determined today. Do not give one",
    )
    expect(prompt).not.toContain('/people/')
  })
})

describe('guardrail lines on the Campaign Manager', () => {
  it('asks for the legal line from the registry', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).toContain(LEGAL_LINE)
    expect(LEGAL_LINE).toBe(guardrailLine('legal_advice', 'campaign_assistant'))
  })

  it('closes a stated election rule with the registry line', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).toContain(
      guardrailLine('election_rule_verify', 'campaign_assistant'),
    )
  })

  it('asks for the small-count line only where the data tool is registered', () => {
    const line = guardrailLine('small_count', 'campaign_assistant')
    expect(
      buildCampaignManagerSystemPrompt(ctx({ constituentToolEnabled: true })),
    ).toContain(line)
    expect(
      buildCampaignManagerSystemPrompt(ctx({ constituentToolEnabled: false })),
    ).not.toContain(line)
  })

  it('asks for the search line in exact words when search is on', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ webSearchEnabled: true }),
    )
    expect(prompt).toContain(
      guardrailLine('search_provenance', 'campaign_assistant'),
    )
  })
})
