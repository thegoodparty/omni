import { describe, expect, it } from 'vitest'
import { buildShowListMapTool } from './showListMap.tool'

describe('buildShowListMapTool', () => {
  const tool = buildShowListMapTool()

  // The args are the widget payload — that is the whole mechanism, since a
  // persisted chat segment stores a tool call's args and never its result.
  // A payload the schema would not accept is a card that cannot replay.
  it('accepts a list id and a name as the payload', () => {
    expect(
      tool.inputSchema.parse({ listId: 42, name: 'Traverse Heights renters' }),
    ).toEqual({ listId: 42, name: 'Traverse Heights renters' })
  })

  it('rejects a list id that is not a real one', () => {
    for (const listId of [0, -1, 1.5]) {
      expect(tool.inputSchema.safeParse({ listId, name: 'x' }).success).toBe(
        false,
      )
    }
  })

  it('rejects a payload with no name to title the card', () => {
    expect(tool.inputSchema.safeParse({ listId: 1 }).success).toBe(false)
    expect(tool.inputSchema.safeParse({ listId: 1, name: '' }).success).toBe(
      false,
    )
  })

  // Display-only by design: it reads nothing and writes nothing, so no
  // person passes through the model's context on the way to the map. The
  // webapp fetches the members itself from the id.
  it('only acknowledges, echoing the id it was given', async () => {
    expect(await tool.execute({ listId: 7, name: 'Downtown' })).toEqual({
      shown: true,
      listId: 7,
    })
  })
})
