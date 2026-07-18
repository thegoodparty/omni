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
  location: 'Springfield, IL',
  weeksToElection: 7,
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
