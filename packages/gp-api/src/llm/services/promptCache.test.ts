import type { ModelMessage, ToolSet } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  readCacheUsage,
  withSystemCache,
  withTailCache,
  withToolsCache,
} from './promptCache'

const BREAKPOINT = { anthropic: { cacheControl: { type: 'ephemeral' } } }

const messages: ModelMessage[] = [
  { role: 'system', content: 'a' },
  { role: 'user', content: 'b' },
  { role: 'assistant', content: 'c' },
  { role: 'user', content: 'd' },
]

describe('promptCache', () => {
  it('withSystemCache marks only the last system message', () => {
    const out = withSystemCache([
      { role: 'system', content: 'one' },
      { role: 'system', content: 'two' },
      { role: 'user', content: 'u' },
    ])
    expect(out.map((m) => m.providerOptions)).toEqual([
      undefined,
      BREAKPOINT,
      undefined,
    ])
  })

  it('withSystemCache leaves a prompt with no system message alone', () => {
    const input: ModelMessage[] = [{ role: 'user', content: 'u' }]
    expect(withSystemCache(input)).toBe(input)
  })

  it('withTailCache marks only the last message and keeps existing options', () => {
    const out = withTailCache([
      ...messages.slice(0, 3),
      {
        role: 'user',
        content: 'd',
        providerOptions: { other: { x: 1 } },
      },
    ])
    expect(out.slice(0, 3).every((m) => m.providerOptions === undefined)).toBe(
      true,
    )
    expect(out[3]?.providerOptions).toEqual({ other: { x: 1 }, ...BREAKPOINT })
  })

  it('withTailCache does not mutate its input', () => {
    withTailCache(messages)
    expect(messages.every((m) => m.providerOptions === undefined)).toBe(true)
  })

  it('withToolsCache marks the last client tool and skips provider tools', () => {
    const tools = {
      first: { type: 'function', description: 'f' },
      second: { type: 'function', description: 's' },
      search: { type: 'provider', id: 'anthropic.web_search_20250305' },
    } as unknown as ToolSet
    const out = withToolsCache(tools) as Record<string, unknown>
    expect(out.first).toEqual(tools.first)
    expect(out.second).toEqual({ ...tools.second, providerOptions: BREAKPOINT })
    expect(out.search).toBe(tools.search)
  })

  it('withToolsCache is a no-op with only provider tools', () => {
    const tools = {
      search: { type: 'provider', id: 'x' },
    } as unknown as ToolSet
    expect(withToolsCache(tools)).toBe(tools)
  })

  it('readCacheUsage defaults to zero', () => {
    expect(readCacheUsage({})).toEqual({
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(
      readCacheUsage({
        inputTokenDetails: { cacheReadTokens: 7, cacheWriteTokens: 3 },
      }),
    ).toEqual({ cachedInputTokens: 7, cacheWriteTokens: 3 })
  })
})
