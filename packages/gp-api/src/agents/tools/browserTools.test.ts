import { describe, expect, it } from 'vitest'
import { browserTools } from './browserTools'

describe('browserTools', () => {
  it('exposes the reading subset of Playwright MCP, with its schemas as Zod', () => {
    expect(browserTools.map((t) => t.name)).toEqual([
      'browser_navigate',
      'browser_navigate_back',
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_select_option',
      'browser_press_key',
      'browser_wait_for',
    ])
    const click = browserTools.find((t) => t.name === 'browser_click')
    expect(
      click?.input.safeParse({ element: 'Docs', target: 'e12' }).success,
    ).toBe(true)
    expect(click?.input.safeParse({ element: 'Docs' }).success).toBe(false)
  })
})
