import { describe, expect, it } from 'vitest'
import { buildPresentListProposalTool } from './presentListProposal.tool'

describe('buildPresentListProposalTool', () => {
  const tool = buildPresentListProposalTool()

  const proposal = {
    name: 'North Asheville homeowners',
    summary: 'Homeowners with a cell phone on file.',
    count: 24361,
    filters: { homeownerYes: true, hasCellPhone: true },
  }

  // The args are the card, and the filter in them goes to the create route
  // untouched, so it has to be one the route will take.
  it('accepts a counted filter as the card', () => {
    expect(tool.inputSchema.parse(proposal)).toEqual(proposal)
  })

  it('rejects a filter key the list create would not understand', () => {
    expect(
      tool.inputSchema.safeParse({
        ...proposal,
        filters: { notARealColumn: true },
      }).success,
    ).toBe(false)
  })

  it('rejects a name longer than a list name can be', () => {
    expect(
      tool.inputSchema.safeParse({ ...proposal, name: 'x'.repeat(41) }).success,
    ).toBe(false)
  })

  it('refuses to offer a list that holds nobody', async () => {
    expect(await tool.execute({ ...proposal, count: 0 })).toHaveProperty(
      'error',
    )
  })

  it('saves nothing when it presents', async () => {
    expect(await tool.execute(proposal)).toEqual({
      presented: true,
    })
  })
})
