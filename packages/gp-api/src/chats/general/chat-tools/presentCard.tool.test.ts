import { describe, expect, it } from 'vitest'
import {
  buildPresentCardTool,
  offeredCardKinds,
  presentCardPromptBlock,
} from './presentCard.tool'

describe('buildPresentCardTool', () => {
  const tool = buildPresentCardTool({
    kinds: ['outside_contact', 'list_proposal', 'list_map'],
  })

  const proposal = {
    kind: 'list_proposal',
    name: 'North Asheville homeowners',
    summary: 'Homeowners with a cell phone on file.',
    count: 24361,
    filters: { homeownerYes: true, hasCellPhone: true },
  } as const

  it('accepts a card of a kind the surface offers', () => {
    expect(
      tool.inputSchema.parse({
        card: { kind: 'list_map', listId: 42, name: 'Traverse Heights' },
      }),
    ).toEqual({
      card: { kind: 'list_map', listId: 42, name: 'Traverse Heights' },
    })
  })

  it('rejects a kind the surface does not offer', () => {
    expect(
      tool.inputSchema.safeParse({
        card: { kind: 'past_outreach', outreachIds: [1], note: 'x' },
      }).success,
    ).toBe(false)
  })

  // The filter in a proposal goes to the create route untouched, so it has
  // to be one the route will take.
  it('rejects a list filter key the list create would not understand', () => {
    expect(
      tool.inputSchema.safeParse({
        card: { ...proposal, filters: { notARealColumn: true } },
      }).success,
    ).toBe(false)
  })

  it('rejects a map with no real list id', () => {
    for (const listId of [0, -1, 1.5]) {
      expect(
        tool.inputSchema.safeParse({
          card: { kind: 'list_map', listId, name: 'x' },
        }).success,
      ).toBe(false)
    }
  })

  it('refuses to offer a list that holds nobody', async () => {
    expect(
      await tool.execute({ card: { ...proposal, count: 0 } }),
    ).toHaveProperty('error')
  })

  it('saves nothing when it presents', async () => {
    expect(await tool.execute({ card: proposal })).toEqual({
      presented: true,
    })
  })

  it('needs at least one kind', () => {
    expect(() => buildPresentCardTool({ kinds: [] })).toThrow()
  })
})

describe('offeredCardKinds', () => {
  it('reads the kinds off the registered tool', () => {
    expect(
      offeredCardKinds({
        present_card: buildPresentCardTool({ kinds: ['past_outreach'] }),
      }),
    ).toEqual(['past_outreach'])
  })

  it('is empty when no card tool is registered', () => {
    expect(offeredCardKinds({})).toEqual([])
  })
})

describe('presentCardPromptBlock', () => {
  it('lists each offered kind with its description and fields', () => {
    const block = presentCardPromptBlock(['list_map'])

    expect(block).toContain('`list_map`: A saved list on a map')
    expect(block).toContain(
      '  - `listId`: Id of the saved list to map, as returned by crud_saved_filters.',
    )
    expect(block).not.toContain('outside_contact')
  })

  it('marks optional fields', () => {
    expect(presentCardPromptBlock(['outside_contact'])).toContain(
      '  - `email` (optional): ',
    )
  })
})
