import { describe, expect, it } from 'vitest'
import {
  buildCampaignManagerSystemPrompt,
  CampaignManagerContext,
} from './campaignManagerPrompt'

const ctx = (
  over: Partial<CampaignManagerContext> = {},
): CampaignManagerContext => ({
  candidateFirstName: 'Renee',
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
