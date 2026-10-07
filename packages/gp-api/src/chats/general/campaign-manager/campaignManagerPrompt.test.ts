import { describe, expect, it, vi } from 'vitest'
import {
  buildCampaignManagerSystemPrompt,
  CampaignManagerContext,
  LEGAL_LINE,
  type LiveRaceData,
} from './campaignManagerPrompt'
import { professionalAdviceDisclaimer } from '../services/professionalAdviceCheck'
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
  ...over,
})

// Noon Central on the given day: the same calendar day in every US zone, so
// the counts and the date line agree whatever the test machine's zone is.
const at = (day: string): Date => new Date(`${day}T17:00:00.000Z`)

describe('buildCampaignManagerSystemPrompt', () => {
  it('frames the agent as a campaign manager', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt.toLowerCase()).toContain('campaign manager')
  })

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
    expect(prompt).toContain(
      'A text message you draft for the candidate to send must say who is ' +
        'sending it: their first name and the office they are running for',
    )
    expect(prompt).toContain('never write a placeholder such as [Your Name]')
  })

  // The product map's status line is the only place the prompt says whether
  // this campaign has Pro; the generic access rule reads it from there.
  it('tells the manager when the campaign is locked out of Pro areas', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx({ isPro: false }))
    expect(prompt).toContain('Pro status: this campaign does not have Pro')
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
    expect(prompt).toContain(
      'The dates on record are a snapshot taken when the candidate set up the race.',
    )
    expect(prompt).not.toContain('refreshed monthly')
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
            'Voter registration: closed Friday, October 2, 2026 (3 days ago) (BallotReady)\n' +
            'Early voting: opens Saturday, October 24, 2026 (in 19 days), closes Sunday, November 1, 2026 (in 27 days) (BallotReady)\n' +
            'Mail ballot requests: close Saturday, October 24, 2026 (in 19 days) (BallotReady)\n' +
            'Votes needed to win: about 1,234 (model estimate). Voter contact goal: about 4,936 (model estimate).',
        )
        expect(prompt).not.toContain('disagree')
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
          'Voter registration: opened Tuesday, September 1, 2026 (34 days ago), closes Monday, October 19, 2026 (in 14 days) (BallotReady)',
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
        expect(prompt).toContain('Early voting: opens Saturday, October 24')
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

  it('carries the nonpartisan and agent-not-chatbot guardrails', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx()).toLowerCase()
    expect(prompt).toContain('nonpartisan')
    // It must not claim it can do the in-person work only the candidate can do.
    expect(prompt).toContain('cannot')
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
    // ...without implying the story is a prerequisite. The product map lands
    // in this same prompt saying there is no gate, and the two contradicting
    // each other is what sent candidates away from a tab that works.
    expect(prompt).toContain('does not wait on the Campaign Story')
    expect(prompt).not.toContain('it is built from the Campaign Story')
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
    expect(on).toContain('Pro upgrade')
    expect(on).toContain(
      'name any part of the request the filter could not apply',
    )

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
    expect(prompt).toContain('takes them to the Pro upgrade')
    expect(prompt).toContain('Do not describe what happens after')
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

    const withWrites = buildCampaignManagerSystemPrompt(
      ctx({
        crmToolsEnabled: true,
        savedFilterToolsEnabled: true,
        isPro: true,
        organization: { slug: 'win-campaign' } as Organization,
      }),
    )
    expect(withWrites).toContain('crud_saved_filters')
    expect(withWrites).toContain('40 characters')
    expect(withWrites).toContain('duplicated')
    expect(withWrites).toContain('confirm the size')
    expect(withWrites).toContain('report the count crud_saved_filters returned')
    expect(withWrites).toContain('abbreviating it does not make it belong')
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
    expect(prompt).toContain('size a random sample with size_outreach_sample')
    expect(prompt).toContain('When the text asks voters something')
    expect(prompt).toContain(
      'Texting all 58,520 is about $2,048. 2,767 picked at random is ' +
        'about $97 and should bring back about 83 replies.',
    )
    expect(prompt).toContain(
      "I'd text 2,767 of the 58,520, picked at random. About 83 replies " +
        'is enough to tell how voters feel about it.',
    )
    expect(prompt).toContain('never work out a sample or a cost yourself')
    expect(prompt).toContain('On the card, count stays the whole audience')
    expect(prompt).toContain('Present the text with present_outreach_proposal')
    expect(prompt).toContain(
      'Do not save a list for it with crud_saved_filters',
    )
    expect(prompt).toContain('this is Renee, candidate for Asheville City')
    expect(prompt).toContain('"Paid for by"')
    expect(prompt).not.toContain('sample.size set to the sampleSize')
    expect(prompt).not.toContain('/dashboard/outreach?compose=text')
    const block = prompt
      .slice(prompt.indexOf('SAMPLING RULES'))
      .split('\n\n')[0]
    expect(block).toContain('WHAT THE TEXT NEEDS')
    expect(block).not.toContain('constituent')
    expect(block).not.toContain('official')
    expect(block).not.toContain('{{first_name}}')
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
    expect(prompt).toContain('Campaign Story')
    expect(prompt).toContain('one at a time')
    // Offers the existing "Help me rewrite" elaboration + triggers generation.
    expect(prompt).toContain('Help me rewrite')
    expect(prompt).toContain('campaign_story generate')
    // Finishing the story IS the request, so generation fires without a
    // confirmation turn: candidates read "would you like me to?" as another
    // step to clear rather than as being handed control.
    expect(prompt).toContain('call campaign_story generate straight away')
    expect(prompt.toLowerCase()).toContain('do not ask whether to generate')
    expect(prompt.toLowerCase()).not.toContain('when they confirm')
  })

  it('saves each story answer as it is given, so dropping off mid-intake keeps what was answered', () => {
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
    const lower = prompt.toLowerCase()
    // The answer is persisted on receipt, not held for the other questions...
    expect(lower).toContain('as soon as they give it')
    expect(lower).toContain('answers one question and stops')
    // ...and the old defer-the-first-draft instruction is gone.
    expect(lower).not.toContain('do not save their first draft')
    // But an unapproved AI rewrite still must not replace it (it publishes).
    expect(lower).toContain('never save a rewrite they have not approved')
  })

  it('tells the manager how to read the generate status so it never misreads generating as an error', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        story: {
          why: 'w',
          background: 'b',
          positions: [],
          complete: false,
          missing: ['positions'],
        },
      }),
    )
    // The async result: 'generating' is the success case, 'failed' means retry.
    expect(prompt).toContain('generating')
    expect(prompt).toContain('failed')
    expect(prompt.toLowerCase()).toContain('never call it an error')
  })

  it('pins the failed-reason guidance and the no-guessing rule', () => {
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
    expect(prompt).toContain('race_lookup_failed')
    expect(prompt).toContain('attempts_exhausted')
    expect(prompt).toContain('queue_failed')
    const lower = prompt.toLowerCase()
    expect(lower).toContain('race lookup failed')
    expect(lower).toContain('cannot be regenerated automatically')
    expect(lower).toContain('offer to try again')
    expect(lower).toContain(
      'never state or imply a cause the tool did not return',
    )
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
    // Editing an answer regenerates the plan off the save itself, so the
    // manager must neither ask nor call generate — generate is a no-op on an
    // already-generated plan, which is how the old "offer to regenerate"
    // instruction produced an acceptance that did nothing.
    expect(prompt.toLowerCase()).toContain('do not ask whether to regenerate')
    expect(prompt).not.toContain('offer to regenerate')
    expect(prompt).toContain('campaign_story save')
  })

  it('says nothing about ballot status when the candidate never answered', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).not.toContain('already on the ballot')
  })

  it('carries the ballot-access playbook for a qualified-not-filed candidate', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ ballotStatus: 'qualified-not-filed' }),
    )
    expect(prompt).toContain('have NOT filed yet')
    expect(prompt).toContain('Getting on the ballot is the single most')
    expect(prompt).toContain('web_search')
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
    expect(prompt).toContain('best source available')
    expect(prompt).toContain(
      'snapshot taken when the candidate set up the race',
    )
    expect(prompt).toContain('confirm it with the filing office')
    expect(prompt).not.toContain('refreshed monthly')
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
    expect(prompt).toContain('the record is stale')
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
    expect(prompt).toContain('never guess a deadline')
    expect(prompt).not.toContain('no filing period')
  })

  it('says the deadline is unknown when the race has no filing period', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ ballotStatus: 'qualified-not-filed', filingPeriodEnd: null }),
    )
    expect(prompt).toContain('no filing period')
    expect(prompt).toContain('never guess a date')
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
    expect(prompt).toContain('fill what it leaves null')
  })

  it('falls back to web search when the campaign has no race record', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ ballotStatus: 'qualified-not-filed', raceId: null }),
    )
    expect(prompt).toContain('no BallotReady race record')
    expect(prompt).not.toContain('call get_ballot_requirements FIRST')
    expect(prompt).toContain('Use web_search for any ballot-access question')
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
    expect(prompt).toContain('call get_ballot_requirements FIRST')
    expect(prompt).toContain('Use web_search to fill what it leaves null')
    expect(prompt).toContain('noDataFound')
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
      expect(prompt).toContain('Never fill a gap from memory')
    }
  })

  it('marks search-derived facts inline, not only in a footnote', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ webSearchEnabled: true }),
    )
    expect(prompt).toContain('not only in a footnote')
    expect(prompt).toContain(
      'every search, not only questions about the ballot',
    )
  })

  it('adds a verify line to public-facing drafts built from search results', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ webSearchEnabled: true }),
    )
    expect(prompt).toContain(
      'Double-check these numbers and names before you use them.',
    )
  })

  it('carries no search-provenance rule when search is off', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({ webSearchEnabled: false }),
    )
    expect(prompt).not.toContain('not only in a footnote')
    expect(prompt).not.toContain(
      'Double-check these numbers and names before you use them.',
    )
  })

  it('says which part of advice is an assumption, on or off search', () => {
    for (const webSearchEnabled of [true, false]) {
      const prompt = buildCampaignManagerSystemPrompt(ctx({ webSearchEnabled }))
      expect(prompt).toContain('rests on an assumption')
      expect(prompt).toContain('say plainly which part is the assumption')
    }
  })

  it('defines a legal question by intent, with tools on or off', () => {
    const allOff = ctx({
      webSearchEnabled: false,
      helpCenterToolEnabled: false,
    })
    for (const prompt of [
      buildCampaignManagerSystemPrompt(ctx()),
      buildCampaignManagerSystemPrompt(allOff),
    ]) {
      expect(prompt).toContain('underlying intent')
      expect(prompt).toContain('what the law allows, prohibits, requires')
      expect(prompt).toContain('Getting on the ballot and filing to run')
    }
  })

  it('attributes the rule to a source or says none established it', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).toContain('attribute the rule to that source')
    expect(prompt).toContain(
      'do not supply the missing rule from model knowledge',
    )
    expect(prompt).toContain('identify what remains unresolved')
    expect(prompt).toContain('practical next steps')
  })

  it('keeps product facts separate from legal requirements', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).toContain(
      'Keep product facts separate from legal requirements',
    )
    expect(prompt).toContain(
      'does not establish what the law permits or requires',
    )
  })

  it('keeps ordinary campaign work out of the legal route', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).toContain('Ordinary campaign work is not a legal question')
    expect(prompt).toContain(
      'Drafting, strategy, product how-tos, and tool use',
    )
  })

  it('handles mixed product and legal requests part by part', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).toContain('For a mixed request')
    expect(prompt).toContain('answer each part under the applicable rule')
  })

  it('pins the legal line to one the finish-time check recognizes', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).toContain(`include this line: "${LEGAL_LINE}"`)
    // A statute-citing reply that carries the line gets nothing appended.
    expect(
      professionalAdviceDisclaimer(`RCW 42.17A applies. ${LEGAL_LINE}`),
    ).toBeNull()
  })

  it('never invents facts (candidate-in-control guardrail)', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx()).toLowerCase()
    expect(prompt).toContain('never invent')
    expect(prompt).toContain('estimate')
  })

  it('stays coherent with no numbers and no tasks', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        officeName: null,
        location: null,
        electionDate: null,
        topTasks: [],
      }),
    )
    expect(prompt.toLowerCase()).toContain('campaign manager')
    expect(prompt.length).toBeGreaterThan(0)
  })

  describe('compose-handoff rules (win_social)', () => {
    it('includes the rules', () => {
      const prompt = buildCampaignManagerSystemPrompt(ctx({}))
      expect(prompt).toContain('COMPOSE HANDOFF RULES')
      expect(prompt).toContain('persuade_voters')
    })

    it('says "candidate", never "official" (candidate vocabulary)', () => {
      const prompt = buildCampaignManagerSystemPrompt(ctx({}))
      expect(prompt).toContain('the candidate clearly wants')
      expect(prompt).not.toContain('the official')
    })
  })
})
