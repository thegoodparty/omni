import { describe, expect, it } from 'vitest'
import {
  buildCampaignManagerSystemPrompt,
  CampaignManagerContext,
} from './campaignManagerPrompt'

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
  story: null,
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

  it('advertises the constituent-data tool only when it is enabled', () => {
    const off = buildCampaignManagerSystemPrompt(ctx())
    expect(off).not.toContain('query_constituent_data')

    const on = buildCampaignManagerSystemPrompt(
      ctx({ constituentToolEnabled: true }),
    )
    expect(on).toContain('query_constituent_data')
    expect(on).toContain('describe_constituent_data')
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
