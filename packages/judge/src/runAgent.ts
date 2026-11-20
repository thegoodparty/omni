import type { AgentRunResult, AgentRunStatus } from './suite'

// The one way the judge reaches a background agent: two routes on the arm's own
// base URL. The judge holds no AWS, S3, SQS or Databricks access, and never
// learns which engine ran the agent.
//
//   POST /agents/:name/runs   { input }  -> { runId }
//   GET  /agents/runs/:runId             -> { status, artifact, error }
//
// Signed in as the run's test user, like any other org route.

export type RunAgentTransport = {
  // A JSON POST, already authed as the run's user. Resolves to the parsed body.
  post: (path: string, body: unknown) => Promise<unknown>
  get: (path: string) => Promise<unknown>
}

const STATUSES: readonly AgentRunStatus[] = [
  'queued',
  'running',
  'completed',
  'failed',
  'superseded',
]

export const parseRunStatus = (value: unknown): AgentRunStatus => {
  if (
    typeof value !== 'string' ||
    !STATUSES.includes(value as AgentRunStatus)
  ) {
    throw new Error(`Unrecognised agent run status '${String(value)}'`)
  }
  return value as AgentRunStatus
}

export type RunAgentOptions = {
  transport: RunAgentTransport
  // How often to ask, and for how long. A background run is minutes; the
  // default gives it an hour before giving up.
  pollIntervalMs?: number
  timeoutMs?: number
  // Injected so a test drives the clock instead of waiting.
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  onPoll?: (runId: string, status: AgentRunStatus) => void
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const runAgentThroughRoutes = async (
  name: string,
  input: unknown,
  options: RunAgentOptions,
): Promise<AgentRunResult> => {
  const {
    transport,
    pollIntervalMs = 5_000,
    timeoutMs = 60 * 60 * 1_000,
    now = Date.now,
    sleep = defaultSleep,
    onPoll,
  } = options

  const created = await transport.post(`/v1/agents/${name}/runs`, { input })
  const runId = (created as { runId?: unknown } | null)?.runId
  if (typeof runId !== 'string' || !runId) {
    throw new Error(
      `POST /v1/agents/${name}/runs did not return a runId: ${JSON.stringify(created)}`,
    )
  }

  const deadline = now() + timeoutMs
  for (;;) {
    const polled = (await transport.get(`/v1/agents/runs/${runId}`)) as {
      engine?: unknown
      status?: unknown
      artifact?: unknown
      error?: unknown
    } | null
    const status = parseRunStatus(polled?.status)
    onPoll?.(runId, status)
    const engine =
      typeof polled?.engine === 'string' ? { engine: polled.engine } : {}

    if (status === 'completed') {
      return {
        runId,
        status,
        ...engine,
        artifact: polled?.artifact ?? null,
        error: null,
      }
    }
    if (status === 'failed' || status === 'superseded') {
      const error =
        typeof polled?.error === 'string' && polled.error
          ? polled.error
          : `run ${status}`
      return {
        runId,
        status,
        ...engine,
        artifact: polled?.artifact ?? null,
        error,
      }
    }
    if (now() >= deadline) {
      throw new Error(
        `agent run ${runId} (${name}) was still ${status} after ${timeoutMs}ms`,
      )
    }
    await sleep(pollIntervalMs)
  }
}
