import { describe, expect, it } from 'vitest'
import { parseRunStatus, runAgentThroughRoutes } from './runAgent'

const transportOf = (
  created: unknown,
  polls: unknown[],
): {
  calls: string[]
  transport: {
    post: (p: string, b: unknown) => Promise<unknown>
    get: (p: string) => Promise<unknown>
  }
} => {
  const calls: string[] = []
  let index = 0
  return {
    calls,
    transport: {
      post: async (path, body) => {
        calls.push(`POST ${path} ${JSON.stringify(body)}`)
        return created
      },
      get: async (path) => {
        calls.push(`GET ${path}`)
        const value = polls[Math.min(index, polls.length - 1)]
        index += 1
        return value
      },
    },
  }
}

const instant = {
  sleep: async () => {},
}

describe('runAgentThroughRoutes', () => {
  it('posts the input and returns the artifact once the run completes', async () => {
    const { calls, transport } = transportOf({ runId: 'run-1' }, [
      { status: 'queued' },
      { status: 'running' },
      { status: 'completed', artifact: { summary: 'done' }, error: null },
    ])
    const result = await runAgentThroughRoutes(
      'trending_issues',
      { a: 1 },
      {
        transport,
        ...instant,
      },
    )
    expect(result).toEqual({
      runId: 'run-1',
      status: 'completed',
      artifact: { summary: 'done' },
      error: null,
    })
    expect(calls[0]).toBe(
      'POST /v1/agents/trending_issues/runs {"input":{"a":1}}',
    )
    expect(calls.filter((call) => call.startsWith('GET'))).toHaveLength(3)
    expect(calls[1]).toBe('GET /v1/agents/runs/run-1')
  })

  it('returns a failed run with its error, rather than throwing', async () => {
    const { transport } = transportOf({ runId: 'run-2' }, [
      { status: 'failed', artifact: null, error: 'model exploded' },
    ])
    const result = await runAgentThroughRoutes(
      'agent',
      {},
      {
        transport,
        ...instant,
      },
    )
    expect(result.status).toBe('failed')
    expect(result.error).toBe('model exploded')
  })

  it('names a superseded run as a failure, because nothing was produced', async () => {
    const { transport } = transportOf({ runId: 'run-3' }, [
      { status: 'superseded', artifact: null },
    ])
    const result = await runAgentThroughRoutes(
      'agent',
      {},
      {
        transport,
        ...instant,
      },
    )
    expect(result.status).toBe('superseded')
    expect(result.error).toBe('run superseded')
  })

  it('throws when the create route returns no runId', async () => {
    const { transport } = transportOf({}, [])
    await expect(
      runAgentThroughRoutes('agent', {}, { transport, ...instant }),
    ).rejects.toThrow(/did not return a runId/)
  })

  it('throws on an unrecognised status rather than polling forever', async () => {
    const { transport } = transportOf({ runId: 'run-4' }, [
      { status: 'exploded' },
    ])
    await expect(
      runAgentThroughRoutes('agent', {}, { transport, ...instant }),
    ).rejects.toThrow(/Unrecognised agent run status/)
  })

  it('times out while the run is still going', async () => {
    let clock = 0
    const { transport } = transportOf({ runId: 'run-5' }, [
      { status: 'running' },
    ])
    await expect(
      runAgentThroughRoutes(
        'agent',
        {},
        {
          transport,
          pollIntervalMs: 1,
          timeoutMs: 10,
          now: () => (clock += 5),
          sleep: async () => {},
        },
      ),
    ).rejects.toThrow(/still running/)
  })

  it('reports each status it sees to onPoll', async () => {
    const seen: string[] = []
    const { transport } = transportOf({ runId: 'run-6' }, [
      { status: 'queued' },
      { status: 'completed', artifact: 'x' },
    ])
    await runAgentThroughRoutes(
      'agent',
      {},
      {
        transport,
        ...instant,
        onPoll: (_runId, status) => seen.push(status),
      },
    )
    expect(seen).toEqual(['queued', 'completed'])
  })
})

describe('parseRunStatus', () => {
  it('accepts the five statuses the route returns', () => {
    for (const status of [
      'queued',
      'running',
      'completed',
      'failed',
      'superseded',
    ]) {
      expect(parseRunStatus(status)).toBe(status)
    }
  })

  it('rejects anything else', () => {
    expect(() => parseRunStatus('done')).toThrow(/Unrecognised/)
    expect(() => parseRunStatus(undefined)).toThrow(/Unrecognised/)
  })
})
