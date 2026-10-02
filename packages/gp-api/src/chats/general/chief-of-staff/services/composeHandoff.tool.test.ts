import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildComposeHandoffTool } from './composeHandoff.tool'

describe('buildComposeHandoffTool', () => {
  it("serve_social tool's JSON input schema is a top-level object with no anyOf", () => {
    const tool = buildComposeHandoffTool('serve_social')
    const jsonSchema = z.toJSONSchema(tool.inputSchema)
    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema).not.toHaveProperty('anyOf')
  })

  it("win_social tool's JSON input schema is a top-level object with no anyOf", () => {
    const tool = buildComposeHandoffTool('win_social')
    const jsonSchema = z.toJSONSchema(tool.inputSchema)
    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema).not.toHaveProperty('anyOf')
  })

  it('serve_social execute round-trips a serve_social payload', async () => {
    const tool = buildComposeHandoffTool('serve_social')
    const result = await tool.execute({
      channel: 'serve_social',
      draftText: 'hello constituents',
    })
    expect(result).toEqual({
      channel: 'serve_social',
      draftText: 'hello constituents',
    })
  })

  it('win_social execute round-trips a win_social payload', async () => {
    const tool = buildComposeHandoffTool('win_social')
    const result = await tool.execute({
      channel: 'win_social',
      draftText: 'hello voters',
      purpose: 'persuade_voters',
    })
    expect(result).toEqual({
      channel: 'win_social',
      draftText: 'hello voters',
      purpose: 'persuade_voters',
    })
  })

  it('serve_social tool rejects a win_social payload', () => {
    const tool = buildComposeHandoffTool('serve_social')
    const crossChannelInput = {
      channel: 'win_social',
      draftText: 'hello voters',
    } as unknown as Parameters<typeof tool.execute>[0]
    expect(() => tool.execute(crossChannelInput)).toThrow()
  })

  it('win_social tool rejects a serve_social payload', () => {
    const tool = buildComposeHandoffTool('win_social')
    const crossChannelInput = {
      channel: 'serve_social',
      draftText: 'hello constituents',
    } as unknown as Parameters<typeof tool.execute>[0]
    expect(() => tool.execute(crossChannelInput)).toThrow()
  })
})
