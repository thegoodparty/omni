import { describe, expect, it } from 'vitest'
import {
  buildCampaignManagerSystemPrompt,
  CampaignManagerContext,
} from './campaignManagerPrompt'
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
  weeksToElection: 7,
  ballotStatus: null,
  filingPeriodStart: null,
  filingPeriodEnd: null,
  daysToFilingDeadline: null,
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
  story: null,
  plan: null,
  ...over,
})

describe('buildCampaignManagerSystemPrompt', () => {
  it('frames the agent as a campaign manager', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt.toLowerCase()).toContain('campaign manager')
  })

  it('injects the office, location, and weeks-to-election when present', () => {
    const prompt = buildCampaignManagerSystemPrompt(ctx())
    expect(prompt).toContain('City Council')
    expect(prompt).toContain('Springfield, IL')
    expect(prompt).toContain('7')
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
        organization: { slug: 'win-campaign' } as Organization,
      }),
    )
    expect(on).toContain('count_contacts')
    expect(on).toContain('describe_filter_dimensions')
    expect(on).toContain('Pro upgrade')

    // Flag on but no org row resolved = tools not registered, so no block.
    const noOrg = buildCampaignManagerSystemPrompt(
      ctx({ crmToolsEnabled: true, organization: null }),
    )
    expect(noOrg).not.toContain('count_contacts')
  })

  it('advertises the saved-list tool only when it is registered', () => {
    const readOnly = buildCampaignManagerSystemPrompt(
      ctx({
        crmToolsEnabled: true,
        organization: { slug: 'win-campaign' } as Organization,
      }),
    )
    expect(readOnly).toContain('count_contacts')
    expect(readOnly).not.toContain('crud_saved_filters')

    const withWrites = buildCampaignManagerSystemPrompt(
      ctx({
        crmToolsEnabled: true,
        savedFilterToolsEnabled: true,
        organization: { slug: 'win-campaign' } as Organization,
      }),
    )
    expect(withWrites).toContain('crud_saved_filters')
    expect(withWrites).toContain('40 characters')
    expect(withWrites).toContain('duplicated')
    expect(withWrites).toContain('confirm the size')
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
    // Candidate-in-control: only generate on confirmation.
    expect(prompt.toLowerCase()).toContain('when they confirm')
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
        ballotStatus: 'qualified-not-filed',
        filingPeriodStart: '2026-09-01',
        filingPeriodEnd: '2026-09-15',
        daysToFilingDeadline: 27,
      }),
    )
    expect(prompt).toContain('Filing opens 2026-09-01')
    expect(prompt).toContain('filing deadline for this race is 2026-09-15')
    expect(prompt).toContain('27 days from today')
    expect(prompt).toContain('best source available')
    expect(prompt).toContain('confirm it with the filing office')
  })

  it('singularizes the day count on the last day', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        ballotStatus: 'qualified-not-filed',
        filingPeriodEnd: '2026-09-15',
        daysToFilingDeadline: 1,
      }),
    )
    expect(prompt).toContain('1 day from today')
  })

  it('flags a passed deadline as ambiguous rather than as time remaining', () => {
    const prompt = buildCampaignManagerSystemPrompt(
      ctx({
        ballotStatus: 'qualified-not-filed',
        filingPeriodEnd: '2026-01-15',
        daysToFilingDeadline: -40,
      }),
    )
    expect(prompt).toContain('has already passed')
    expect(prompt).toContain('the record is stale')
    expect(prompt).not.toContain('day from today')
    expect(prompt).not.toContain('days from today')
  })

  // The server clock runs ahead of every US timezone for part of each day, so 0
  // and -1 can both still be the deadline day where the candidate is. Telling
  // someone they missed a deadline that is actually today is the worst error
  // here, so the boundary reads as urgent-today, never as passed.
  it.each([0, -1])(
    'treats a day count of %i as due today, not as passed',
    (daysToFilingDeadline) => {
      const prompt = buildCampaignManagerSystemPrompt(
        ctx({
          ballotStatus: 'qualified-not-filed',
          filingPeriodEnd: '2026-09-15',
          daysToFilingDeadline,
        }),
      )
      expect(prompt).toContain('that is TODAY')
      expect(prompt).not.toContain('has already passed')
      expect(prompt).not.toContain('0 days from today')
    },
  )

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
        weeksToElection: null,
        topTasks: [],
      }),
    )
    expect(prompt.toLowerCase()).toContain('campaign manager')
    expect(prompt.length).toBeGreaterThan(0)
  })
})
