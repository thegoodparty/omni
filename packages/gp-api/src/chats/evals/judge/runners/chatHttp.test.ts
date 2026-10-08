import { describe, expect, it } from 'vitest'
import { CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER } from '@/chats/services/chatStream.service'
import { toolBudgetExhaustedNote } from '@/llm/services/llm.service'
import { PRICING_VERSION } from '../pricing'
import { CiContextSchema } from '../record'
import { UNRECORDED_TOOL_ERROR, errorClass } from '../toolErrorDetails'
import {
  CHAT_INTERRUPTED_MARKER,
  TOOL_BUDGET_FALLBACK_REPLY,
  caseInput,
  chatToolErrorDetails,
  ciContextFromEnv,
  classifyChatStatus,
  combineChatStatus,
  joinTurnReplies,
  parseStreamFrames,
  reindexTrace,
  runChatHttpCase,
  traceErrorText,
  turnTrace,
  usageOutcome,
  type ChatHttpRequest,
  type ConversationUsage,
  type StreamFrame,
} from './chatHttp'
import type { JudgeAccount } from './judgeAccount'

const env = (vars: Record<string, string>): NodeJS.ProcessEnv => vars

describe('the copies of server strings', () => {
  // The runner reads this reply as `blocked`. If the note is reworded and
  // this copy is not, a turn that ran out of tool budget reads as produced.
  it('keeps the reply the tool-budget note instructs', () => {
    expect(String(toolBudgetExhaustedNote.content)).toContain(
      TOOL_BUDGET_FALLBACK_REPLY,
    )
  })

  it('keeps the marker the route persists for an interrupted turn', () => {
    expect(CHAT_INTERRUPTED_MARKER).toBe(CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER)
  })
})

describe('classifyChatStatus', () => {
  it('reads an ordinary answer as an agent result', () => {
    expect(classifyChatStatus('Three priorities.', false, [])).toBe('produced')
  })

  it('reads a stream error as infrastructure, never as a result', () => {
    expect(classifyChatStatus('partial text', true, [])).toBe('infraError')
  })

  it('reads a missing assistant turn as infrastructure', () => {
    expect(classifyChatStatus(null, false, [])).toBe('infraError')
  })

  it('reads the interrupted sentinel as infrastructure', () => {
    expect(classifyChatStatus(CHAT_INTERRUPTED_MARKER, false, [])).toBe(
      'infraError',
    )
  })

  it('reads an empty answer as infrastructure', () => {
    expect(classifyChatStatus('   \n ', false, [])).toBe('infraError')
  })

  it('reads the tool-budget fallback as blocked, keeping its output', () => {
    expect(
      classifyChatStatus(TOOL_BUDGET_FALLBACK_REPLY, false, [
        TOOL_BUDGET_FALLBACK_REPLY,
      ]),
    ).toBe('blocked')
  })

  it('does not read an unlisted refusal as blocked', () => {
    expect(
      classifyChatStatus('I would rather not answer that.', false, [
        TOOL_BUDGET_FALLBACK_REPLY,
      ]),
    ).toBe('produced')
  })
})

describe('combineChatStatus', () => {
  it("is the single turn's status for a one-turn case", () => {
    expect(combineChatStatus(['produced'])).toBe('produced')
    expect(combineChatStatus(['blocked'])).toBe('blocked')
    expect(combineChatStatus(['infraError'])).toBe('infraError')
  })

  it('reports a broken turn however well the rest went', () => {
    expect(combineChatStatus(['produced', 'infraError', 'produced'])).toBe(
      'infraError',
    )
  })

  it('reports a fallback turn even when a later turn recovered', () => {
    expect(combineChatStatus(['blocked', 'produced'])).toBe('blocked')
  })

  it('reports no turns at all as infraError', () => {
    expect(combineChatStatus([])).toBe('infraError')
  })
})

describe('joinTurnReplies', () => {
  it('leaves a single reply exactly as it was', () => {
    expect(joinTurnReplies(['You have three priorities.'])).toBe(
      'You have three priorities.',
    )
  })

  it('labels each reply of a conversation', () => {
    expect(joinTurnReplies(['first', 'second\n\nwith a gap'])).toBe(
      '[turn 1]\nfirst\n\n[turn 2]\nsecond\n\nwith a gap',
    )
  })
})

describe('reindexTrace', () => {
  it("renumbers two turns' steps as one sequence", () => {
    expect(
      reindexTrace([
        { index: 0, kind: 'text' },
        { index: 1, kind: 'tool', tool: 'a' },
        { index: 0, kind: 'text' },
      ]).map((step) => step.index),
    ).toEqual([0, 1, 2])
  })
})

describe('caseInput', () => {
  it('records a plain question exactly as it always has', () => {
    expect(
      caseInput({ caseId: 'a', question: 'What are my priorities?' }),
    ).toEqual({ kind: 'question', value: 'What are my priorities?' })
  })

  it('records several turns as a transcript', () => {
    expect(caseInput({ caseId: 'a', turns: ['one', 'two'] })).toEqual({
      kind: 'transcript',
      value: { turns: ['one', 'two'] },
    })
  })
})

describe('ciContextFromEnv', () => {
  it('is absent on a local run', () => {
    expect(ciContextFromEnv(env({}))).toBeUndefined()
  })

  it('takes the PR number from the merge ref', () => {
    const ci = ciContextFromEnv(
      env({
        GITHUB_REPOSITORY: 'thegoodparty/omni',
        GITHUB_RUN_ID: '36592029654',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_REF: 'refs/pull/2198/merge',
      }),
    )
    expect(CiContextSchema.parse(ci)).toEqual({
      repo: 'thegoodparty/omni',
      prNumber: 2198,
      workflowRunId: '36592029654',
      workflowRunAttempt: 1,
      workflowRunUrl:
        'https://github.com/thegoodparty/omni/actions/runs/36592029654',
    })
  })

  it('prefers the PR number judge.yml hands the arms', () => {
    const ci = ciContextFromEnv(
      env({
        GITHUB_REPOSITORY: 'thegoodparty/omni',
        GITHUB_RUN_ID: '1',
        GITHUB_REF: 'refs/pull/9/merge',
        JUDGE_PR_NUMBER: '2371',
      }),
    )
    expect(ci?.prNumber).toBe(2371)
  })

  it('points a re-run at the attempt that produced it', () => {
    const ci = ciContextFromEnv(
      env({
        GITHUB_REPOSITORY: 'thegoodparty/omni',
        GITHUB_RUN_ID: '7',
        GITHUB_RUN_ATTEMPT: '3',
      }),
    )
    expect(ci?.workflowRunUrl).toBe(
      'https://github.com/thegoodparty/omni/actions/runs/7/attempts/3',
    )
  })
})

describe('traceErrorText', () => {
  it('keeps the failure class', () => {
    expect(traceErrorText(new TypeError('no rows'))).toBe('TypeError: no rows')
  })

  it('strips an email a server error echoes back', () => {
    expect(traceErrorText(new Error('no user a.b@x.org'))).toContain('[email]')
  })

  it('bounds an error that dumps a whole response body', () => {
    expect(traceErrorText(new Error('x'.repeat(5_000))).length).toBe(200)
  })
})

describe('parseStreamFrames', () => {
  it('reads the data frames and skips everything else', () => {
    const body =
      ': keep-alive comment\n\n' +
      'data: {"type":"text","delta":"hi"}\n\n' +
      'data: {"type":"tool_call","toolName":"crud_priorities","args":{}}\n\n' +
      'data: {"type":"done","assistantMessageId":"m1"}\n\n'
    expect(parseStreamFrames(body)).toEqual([
      { type: 'text' },
      { type: 'tool_call', toolName: 'crud_priorities' },
      { type: 'done', assistantMessageId: 'm1' },
    ])
  })

  it('keeps the frames a stream cut off mid-frame did deliver', () => {
    const body = 'data: {"type":"text","delta":"hi"}\n\ndata: {"type":"tool_c'
    expect(parseStreamFrames(body)).toEqual([{ type: 'text' }])
  })
})

describe('turnTrace', () => {
  const text: StreamFrame = { type: 'text' }
  const call = (toolName: string): StreamFrame => ({
    type: 'tool_call',
    toolName,
  })
  const result = (toolName: string): StreamFrame => ({
    type: 'tool_result',
    toolName,
  })

  it('collapses a run of text into one step, across a ping', () => {
    expect(turnTrace([text, { type: 'ping' }, text])).toEqual([
      { index: 0, kind: 'text' },
    ])
  })

  it('reads a call that got its result as a tool that worked', () => {
    expect(
      turnTrace([call('get_briefing'), result('get_briefing'), text]),
    ).toEqual([
      { index: 0, kind: 'tool', tool: 'get_briefing' },
      { index: 1, kind: 'text' },
    ])
  })

  it('reads a call that never got its result as a tool error', () => {
    const trace = turnTrace([
      call('get_briefing'),
      call('get_briefing'),
      result('get_briefing'),
    ])
    expect(trace[0]?.error).toBeUndefined()
    expect(trace[1]?.error).toBe(UNRECORDED_TOOL_ERROR)
  })

  // The provider runs web search and streams no result for it.
  it('never counts web search as an error', () => {
    expect(turnTrace([call('web_search'), text])).toEqual([
      { index: 0, kind: 'tool', tool: 'web_search' },
      { index: 1, kind: 'text' },
    ])
  })

  it('records a stream error as an error step', () => {
    expect(
      turnTrace([{ type: 'error', code: 'aborted', message: 'too long' }]),
    ).toEqual([{ index: 0, kind: 'error', error: 'too long' }])
  })
})

describe('chatToolErrorDetails', () => {
  it('stores a tool name only when it has a registered tool shape', () => {
    const details = chatToolErrorDetails([
      {
        index: 0,
        kind: 'tool',
        tool: 'crud_priorities',
        error: UNRECORDED_TOOL_ERROR,
      },
      {
        index: 1,
        kind: 'tool',
        tool: 'Jane Doe',
        error: UNRECORDED_TOOL_ERROR,
      },
      { index: 2, kind: 'tool', tool: 'crud_priorities' },
    ])
    expect(details.map((d) => d.tool)).toEqual(['crud_priorities', 'unknown'])
    expect(details.map((d) => errorClass(d.message))).toEqual([
      'unrecorded',
      'unrecorded',
    ])
  })
})

describe('usageOutcome', () => {
  const usage = (
    complete: boolean,
    byModel: ConversationUsage['byModel'],
  ): ConversationUsage => ({ complete, byModel })

  it('prices a whole conversation answered by one model', () => {
    const measured = usageOutcome(
      usage(true, [
        { model: 'claude-sonnet-4-6', inputTokens: 31_213, outputTokens: 227 },
      ]),
    )
    expect(measured.model).toBe('claude-sonnet-4-6')
    expect(measured.tokens).toEqual({
      input: 31_213,
      output: 227,
      cacheRead: 0,
      cacheWrite: 0,
    })
    expect(measured.cost?.usdAtCapture).toBeCloseTo(0.097, 3)
    expect(measured.cost?.pricingVersion).toBe(PRICING_VERSION)
  })

  it('treats a deployment that reports no usage as unmeasured', () => {
    const measured = usageOutcome(undefined)
    expect(measured.model).toBe('unobserved')
    expect(measured.tokens.input).toBe(0)
    expect(measured.cost).toBeUndefined()
    expect(measured.unpriced).toMatch(/no usage/)
  })

  it('keeps the model but prices nothing when a message went unmeasured', () => {
    const measured = usageOutcome(
      usage(false, [
        { model: 'claude-sonnet-4-6', inputTokens: 10, outputTokens: 2 },
      ]),
    )
    expect(measured.model).toBe('claude-sonnet-4-6')
    expect(measured.tokens.input).toBe(0)
    expect(measured.cost).toBeUndefined()
  })

  it('prices nothing for a conversation answered by two models', () => {
    const measured = usageOutcome(
      usage(true, [
        { model: 'claude-sonnet-4-6', inputTokens: 10, outputTokens: 2 },
        { model: 'claude-opus-4-7', inputTokens: 10, outputTokens: 2 },
      ]),
    )
    expect(measured.model).toBe('unobserved')
    expect(measured.cost).toBeUndefined()
  })

  it('keeps the counts of a model with no rates, and no cost', () => {
    const measured = usageOutcome(
      usage(true, [
        { model: 'claude-opus-4-7', inputTokens: 10, outputTokens: 2 },
      ]),
    )
    expect(measured.tokens.input).toBe(10)
    expect(measured.cost).toBeUndefined()
    expect(measured.unpriced).toMatch(/claude-opus-4-7/)
  })
})

describe('runChatHttpCase', () => {
  const BASE = 'https://gp-api.test'
  const account: JudgeAccount = {
    token: 'token-1',
    organizationSlug: 'eo-1',
  }
  const sse = (...frames: object[]): string =>
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')

  // A deployment that answers each turn with the reply it is handed, and
  // reports the conversation's usage when asked.
  const fakeApi = (
    replies: { frames: object[]; content: string }[],
    reportedUsage?: ConversationUsage,
  ) => {
    const calls: { method: string; url: string; body?: string }[] = []
    const persisted: { id: string; role: string; content: string }[] = []
    let turn = 0
    const fetchImpl: typeof fetch = (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? init.body : undefined
      calls.push({ method, url, ...(body !== undefined && { body }) })
      const json = (value: object): Response =>
        new Response(JSON.stringify(value), { status: 200 })
      if (url === `${BASE}/v1/version`)
        return Promise.resolve(json({ commit: 'abc123' }))
      if (method === 'POST' && url === `${BASE}/v1/chats`) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ conversationId: 'c1', created: true }),
            {
              status: 201,
            },
          ),
        )
      }
      if (method === 'POST' && url.startsWith(`${BASE}/v1/chats/c1/messages`)) {
        const reply = replies[turn]
        turn += 1
        if (reply === undefined)
          return Promise.resolve(new Response('', { status: 500 }))
        persisted.push({
          id: `m${turn}`,
          role: 'assistant',
          content: reply.content,
        })
        return Promise.resolve(
          new Response(sse(...reply.frames), { status: 200 }),
        )
      }
      if (method === 'GET' && url.startsWith(`${BASE}/v1/chats/c1`)) {
        return Promise.resolve(
          json({
            messages: persisted,
            ...(reportedUsage !== undefined && { usage: reportedUsage }),
          }),
        )
      }
      return Promise.resolve(new Response('', { status: 404 }))
    }
    return { calls, fetchImpl }
  }

  const requestFor = (
    fetchImpl: typeof fetch,
    overrides: Partial<ChatHttpRequest> = {},
  ): ChatHttpRequest => ({
    agentId: 'chief_of_staff',
    case: { caseId: 'priorities', question: 'What are my priorities?' },
    sweepId: 's1',
    arm: 'candidate',
    attempt: 1,
    ref: 'feature',
    baseUrl: BASE,
    account: () => Promise.resolve(account),
    fetchImpl,
    ...overrides,
  })

  it('records one turn from the stream, the conversation and the version', async () => {
    const api = fakeApi(
      [
        {
          frames: [
            { type: 'tool_call', toolName: 'crud_priorities', args: {} },
            { type: 'tool_result', toolName: 'crud_priorities', result: [] },
            { type: 'tool_call', toolName: 'web_search', args: {} },
            { type: 'text', delta: 'Three.' },
            { type: 'done', assistantMessageId: 'm1' },
          ],
          content: 'You have three priorities.',
        },
      ],
      {
        complete: true,
        byModel: [
          { model: 'claude-sonnet-4-6', inputTokens: 1_000, outputTokens: 100 },
        ],
      },
    )
    const record = await runChatHttpCase(requestFor(api.fetchImpl))

    expect(record.status).toBe('produced')
    expect(record.output).toEqual({
      kind: 'text',
      value: 'You have three priorities.',
    })
    expect(record.variant).toEqual({
      ref: 'feature',
      commit: 'abc123',
      model: 'claude-sonnet-4-6',
      configDigest: 'deploy:abc123',
    })
    expect(record.telemetry.toolCalls).toBe(2)
    expect(record.telemetry.toolErrors).toBe(0)
    expect(record.telemetry.tokens.input).toBe(1_000)
    expect(record.telemetry.cost).toBeDefined()
    expect(record.liveWeb).toBe(true)
    expect(record.toolQueries).toEqual([])
    expect(record.dataVersion).toBeUndefined()

    const create = api.calls.find((call) => call.url === `${BASE}/v1/chats`)
    expect(JSON.parse(create?.body ?? '{}')).toEqual({
      scope: 'chief_of_staff',
    })
    expect(
      api.calls.some((call) =>
        call.url.endsWith('/v1/chats/c1/messages?scope=chief_of_staff'),
      ),
    ).toBe(true)
  })

  it('labels every reply of a several-turn case', async () => {
    const api = fakeApi([
      { frames: [{ type: 'done', assistantMessageId: 'm1' }], content: 'one' },
      { frames: [{ type: 'done', assistantMessageId: 'm2' }], content: 'two' },
    ])
    const record = await runChatHttpCase(
      requestFor(api.fetchImpl, {
        case: { caseId: 'two-turns', turns: ['first?', 'second?'] },
      }),
    )
    expect(record.output?.value).toBe('[turn 1]\none\n\n[turn 2]\ntwo')
    expect(record.input).toEqual({
      kind: 'transcript',
      value: { turns: ['first?', 'second?'] },
    })
  })

  it('stops at a broken turn and records the case as infraError', async () => {
    const api = fakeApi([
      {
        frames: [
          { type: 'error', code: 'internal', message: 'Chat stream failed.' },
        ],
        content: CHAT_INTERRUPTED_MARKER,
      },
      { frames: [{ type: 'done', assistantMessageId: 'm2' }], content: 'two' },
    ])
    const record = await runChatHttpCase(
      requestFor(api.fetchImpl, {
        case: { caseId: 'two-turns', turns: ['first?', 'second?'] },
      }),
    )
    expect(record.status).toBe('infraError')
    expect(record.output).toBeNull()
    expect(
      api.calls.filter((call) => call.url.includes('/messages')).length,
    ).toBe(1)
  })

  it('counts a tool with no result as an unrecorded tool error', async () => {
    const api = fakeApi([
      {
        frames: [
          { type: 'tool_call', toolName: 'get_briefing', args: {} },
          { type: 'done', assistantMessageId: 'm1' },
        ],
        content: 'I could not read it.',
      },
    ])
    const record = await runChatHttpCase(requestFor(api.fetchImpl))
    expect(record.telemetry.toolErrors).toBe(1)
    expect(record.toolErrorDetails).toEqual([
      { tool: 'get_briefing', message: UNRECORDED_TOOL_ERROR },
    ])
  })

  it('prices nothing and says why when the deployment reports no usage', async () => {
    const api = fakeApi([
      { frames: [{ type: 'done', assistantMessageId: 'm1' }], content: 'one' },
    ])
    const record = await runChatHttpCase(requestFor(api.fetchImpl))
    expect(record.status).toBe('produced')
    expect(record.variant.model).toBe('unobserved')
    expect(record.telemetry.cost).toBeUndefined()
    expect(record.trace.at(-1)?.error).toMatch(/no usage/)
  })

  it('records an account that could not be made as infraError', async () => {
    const api = fakeApi([])
    const record = await runChatHttpCase(
      requestFor(api.fetchImpl, {
        account: () => Promise.reject(new Error('Clerk said no')),
      }),
    )
    expect(record.status).toBe('infraError')
    expect(record.variant.commit).toBe('abc123')
    expect(record.trace).toEqual([
      { index: 0, kind: 'error', error: 'Error: Clerk said no' },
    ])
  })

  it('opens a briefing chat on its briefing route', async () => {
    const calls: string[] = []
    const fetchImpl: typeof fetch = (input, init) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/v1/version')) {
        return Promise.resolve(new Response(JSON.stringify({ commit: 'abc' })))
      }
      if (url.endsWith('/v1/briefing-chats')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ annotationId: 'a1', conversationId: 'c1' }),
            { status: 201 },
          ),
        )
      }
      if (url.endsWith('/v1/briefing-chats/a1/messages')) {
        return Promise.resolve(
          new Response(sse({ type: 'done', assistantMessageId: 'm1' })),
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            messages: [{ id: 'm1', role: 'assistant', content: 'Two votes.' }],
          }),
        ),
      )
    }
    const record = await runChatHttpCase(
      requestFor(fetchImpl, {
        agentId: 'briefing_annotation',
        account: () =>
          Promise.resolve({
            ...account,
            briefing: {
              meetingDate: '2026-05-19',
              anchor: { jsonPath: null, start: null, end: null },
            },
          }),
      }),
    )
    expect(record.output?.value).toBe('Two votes.')
    expect(calls).toContain(`GET ${BASE}/v1/briefing-chats/a1`)
  })
})
