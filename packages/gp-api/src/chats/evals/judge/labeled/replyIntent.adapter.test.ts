import { HttpStatus } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GEMINI_DECISIONS_URL } from '@/decisionModels/providers/gemini.provider'
import type { AgentEntry } from '../agents'
import type { ArmCaseRequest } from '../sweepArm'
import { ARM_GEMINI_KEY_ENV, replyIntentAdapter } from './replyIntent.adapter'
import { runLabeledCase } from './run'

const TEST_ARM_KEY = 'test-judge-gemini-key'

const AGENT: AgentEntry = {
  agentId: 'reply_intent',
  shape: 'labeled',
  cases: 'reply_intent.json',
  status: 'pending',
}

const request = (text: string): ArmCaseRequest => ({
  agent: AGENT,
  case: {
    caseId: 'fictional_case',
    input: { text, channel: 'text' },
    expected: { optOut: true, civicPanelJoin: false, civicPanelLeave: false },
  },
  attempt: 1,
  sweepId: 'swp_reply_intent',
  arm: 'candidate',
  variant: { ref: 'feat/x', commit: 'c'.repeat(40) },
  spends: true,
})

// Reads every reply as unlikely to be anything, so a regex opt-out shows
// the floor and nothing else turns true.
const geminiAllLow = () =>
  new Response(
    JSON.stringify({
      answers: {
        optOut: { type: 'noul', noul: 0.1, confidence: 0.8 },
        civicPanelJoin: { type: 'noul', noul: 0.02, confidence: 0.9 },
        civicPanelLeave: { type: 'noul', noul: 0.03, confidence: 0.9 },
      },
      usage: { total_input_tokens: 600 },
    }),
    { status: HttpStatus.OK },
  )

const invalidKey = () =>
  new Response(
    JSON.stringify({
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        details: [{ reason: 'API_KEY_INVALID' }],
      },
    }),
    { status: HttpStatus.BAD_REQUEST },
  )

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
  vi.stubEnv(ARM_GEMINI_KEY_ENV, TEST_ARM_KEY)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('replyIntentAdapter on a spending arm', () => {
  it('runs the decision-model path with the arm key and reports its spend', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(geminiAllLow()))

    const result = await replyIntentAdapter(
      { text: 'Thanks, see you at the fair', channel: 'door' },
      { spends: true },
    )

    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(String(url)).toBe(GEMINI_DECISIONS_URL)
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe(TEST_ARM_KEY)
    expect(result).toEqual({
      labels: {
        optOut: { value: false, probabilities: { true: 0.1, false: 0.9 } },
        civicPanelJoin: {
          value: false,
          probabilities: { true: 0.02, false: 0.98 },
        },
        civicPanelLeave: {
          value: false,
          probabilities: { true: 0.03, false: 0.97 },
        },
      },
      usage: { inputTokens: 600, costUsd: (600 / 1_000_000) * 0.1 },
      model: 'gemini-decision-1',
    })
  })

  it('keeps the regex opt-out floor', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(geminiAllLow()))

    const result = await replyIntentAdapter(
      { text: 'STOP', channel: 'text' },
      { spends: true },
    )

    expect(result.labels.optOut).toEqual({
      value: true,
      probabilities: { true: 0.99, false: 1 - 0.99 },
    })
  })

  it('records an infraError, not a regex answer, when the key is missing', async () => {
    vi.stubEnv(ARM_GEMINI_KEY_ENV, '')

    const record = await runLabeledCase(request('STOP'))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(record.status).toBe('infraError')
    expect(record.output).toBeNull()
    expect(JSON.stringify(record.trace)).toContain(ARM_GEMINI_KEY_ENV)
  })

  it('records an infraError when Gemini rejects the key', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(invalidKey()))

    const record = await runLabeledCase(request('STOP'))

    expect(record.status).toBe('infraError')
    expect(record.output).toBeNull()
    expect(JSON.stringify(record.trace)).toContain('Gemini rejected the key')
  })
})

describe('replyIntentAdapter on a dry arm', () => {
  it('makes no call even with a key in the environment', async () => {
    const result = await replyIntentAdapter(
      { text: 'STOP', channel: 'call' },
      { spends: false },
    )

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.model).toBe('regex')
    expect(result.usage).toBeUndefined()
  })
})
