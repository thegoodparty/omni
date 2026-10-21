import type { Profiler } from 'node:inspector'
import { describe, expect, it } from 'vitest'
import { summarizeProfile } from './stallProfiler.summary'

const frame = (functionName: string, url = '', lineNumber = 0) => ({
  functionName,
  url,
  lineNumber,
  columnNumber: 0,
  scriptId: '0',
})

const profile: Profiler.Profile = {
  startTime: 0,
  endTime: 1,
  nodes: [
    { id: 1, callFrame: frame('(root)'), children: [2, 3, 5] },
    {
      id: 2,
      callFrame: frame('handler', 'file:///app/dist/chats.js', 9),
      children: [4],
      hitCount: 1,
    },
    { id: 3, callFrame: frame('(idle)'), hitCount: 50 },
    {
      id: 4,
      callFrame: frame('stringify', 'file:///app/dist/json.js', 41),
      hitCount: 30,
    },
    { id: 5, callFrame: frame('(garbage collector)'), hitCount: 10 },
  ],
}

describe('summarizeProfile', () => {
  it('ranks busy frames by self time and leaves idle time out', () => {
    const summary = summarizeProfile(profile, 10)

    expect(summary.busyMs).toBe(410)
    expect(summary.topSelf).toEqual([
      { name: 'stringify dist/json.js:42', ms: 300 },
      { name: '(garbage collector)', ms: 100 },
      { name: 'handler dist/chats.js:10', ms: 10 },
    ])
  })

  it('reports the leaf-first call stack behind the busiest samples', () => {
    const summary = summarizeProfile(profile, 10)

    expect(summary.topStacks[0]).toEqual({
      name: 'stringify dist/json.js:42 < handler dist/chats.js:10',
      ms: 300,
    })
  })
})
