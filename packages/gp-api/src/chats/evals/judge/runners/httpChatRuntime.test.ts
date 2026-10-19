import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatMessageRole, ChatScope } from '../../../../generated/prisma'
import type { TestServiceContext } from '@/test-service'
import { SPEND_ENV, SPEND_VALUE } from '../config'
import type { ArmEnv } from '../sweepEnv'
import type { JudgeSession } from '../judgeClerkSession'
import { configDigest, parseStreamEvents } from './chatSeam'
import { UnsupportedOnRuntimeError, type DriveableCase } from './chatRuntime'
import {
  chatArmRuntimeFor,
  httpChatRuntime,
  unsupportedReasons,
} from './httpChatRuntime'

// Driven against a REAL http server on a loopback port rather than a mocked
// axios. Three of the things this runtime has to get right are properties of
// the client and not of the code around it — that an SSE body comes back
// whole and unparsed, that a 401 is visible rather than thrown, and that the
// Authorization header is the one the session just handed out — and a mock
// of axios asserts the mock.

interface Recorded {
  method: string
  url: string
  authorization?: string
  organizationSlug?: string
  accept?: string
  body: string
}

interface Reply {
  status: number
  body: string
  contentType?: string
}

interface Target {
  baseUrl: string
  recorded: Recorded[]
  close: () => Promise<void>
}

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const servers: Server[] = []

const startTarget = async (
  route: (req: Recorded) => Reply,
): Promise<Target> => {
  const recorded: Recorded[] = []
  const server = createServer((req, res) => {
    void (async () => {
      const entry: Recorded = {
        method: req.method ?? '',
        url: req.url ?? '',
        ...(typeof req.headers.authorization === 'string' && {
          authorization: req.headers.authorization,
        }),
        ...(typeof req.headers['x-organization-slug'] === 'string' && {
          organizationSlug: req.headers['x-organization-slug'],
        }),
        ...(typeof req.headers.accept === 'string' && {
          accept: req.headers.accept,
        }),
        body: await readBody(req),
      }
      recorded.push(entry)
      const reply = route(entry)
      res.writeHead(reply.status, {
        'Content-Type': reply.contentType ?? 'application/json',
      })
      res.end(reply.body)
    })()
  })
  servers.push(server)
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  )
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    recorded,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  )
})

const session = (over: Partial<JudgeSession> = {}): JudgeSession => ({
  token: async () => 'first-token',
  refused: async () => 'second-token',
  ...over,
})

const runtimeFor = (
  target: Target,
  over: Partial<Parameters<typeof httpChatRuntime>[0]> = {},
) =>
  httpChatRuntime({
    baseUrl: target.baseUrl,
    session: session(),
    waitMs: 60,
    pollMs: 1,
    ...over,
  })

const json = (value: unknown): Reply => ({
  status: 200,
  body: JSON.stringify(value),
})

const telemetryTurn = (over: Record<string, unknown> = {}) => ({
  sweepId: 'chief-of-staff-case-1-abcd1234',
  turnIndex: 1,
  assistantMessageId: 'msg-1',
  promptHash: `sha256:${'a'.repeat(64)}`,
  promptHashVersion: 'sha256-system-prompt-v1',
  toolNames: ['get_my_notes'],
  toolSteps: [{ toolCallId: 'call-1', name: 'get_my_notes' }],
  toolQueries: ['SELECT 1'],
  dataVersion: null,
  model: 'claude-sonnet-4-6',
  inputTokens: 1000,
  outputTokens: 100,
  createdAt: '2026-10-18T00:00:00.000Z',
  ...over,
})

const spending = (): void => {
  vi.stubEnv(SPEND_ENV, SPEND_VALUE)
}

const driveable = (over: Partial<DriveableCase> = {}): DriveableCase => ({
  agentId: 'chief_of_staff',
  caseId: 'case-1',
  scope: ChatScope.chief_of_staff,
  realModel: true,
  ...over,
})

describe('posting a turn', () => {
  // The SSE body has to arrive whole and unparsed. buildTrace reads a failed
  // tool off a `tool_call` whose `toolCallId` has no matching `tool_result`,
  // and that is the ONLY evidence an HTTP arm has — there is no execute seam
  // over there to report an outcome.
  it('hands the stream back verbatim, call ids intact', async () => {
    const frames = [
      'data: {"type":"tool_call","toolName":"get_my_notes",' +
        '"toolCallId":"call-a"}',
      'data: {"type":"tool_result","toolCallId":"call-a"}',
      'data: {"type":"tool_call","toolName":"get_my_notes",' +
        '"toolCallId":"call-b"}',
      'data: {"type":"text","delta":"hello"}',
      'data: {"type":"done","assistantMessageId":"msg-1"}',
    ].join('\n\n')
    const target = await startTarget(() => ({
      status: 200,
      body: frames,
      contentType: 'text/event-stream',
    }))

    const posted = await runtimeFor(target).postTurn({
      messagesPath: '/v1/chats/conv-1/messages?scope=chief_of_staff',
      organizationSlug: 'judge-abc',
      content: 'how many notes do I have?',
    })

    expect(posted.status).toBe(200)
    expect(posted.body).toBe(frames)
    const events = parseStreamEvents(posted.body)
    expect(events.map((e) => e.toolCallId)).toEqual([
      'call-a',
      'call-a',
      'call-b',
      undefined,
      undefined,
    ])
  })

  it('sends the organization slug the in-process client sends', async () => {
    const target = await startTarget(() => ({
      status: 200,
      body: 'data: {"type":"done"}',
      contentType: 'text/event-stream',
    }))
    await runtimeFor(target).postTurn({
      messagesPath: '/v1/chats/conv-1/messages?scope=chief_of_staff',
      organizationSlug: 'judge-abc',
      content: 'hi',
    })
    expect(target.recorded[0]?.organizationSlug).toBe('judge-abc')
    expect(target.recorded[0]?.accept).toBe('text/event-stream')
  })

  // A one-frame body is valid JSON on its own line but not valid JSON whole.
  // axios' default transform would still hand back a string here; the point
  // of pinning it is the body that DOES parse.
  it('does not let axios parse a body that happens to be JSON', async () => {
    const target = await startTarget(() => ({
      status: 200,
      body: '{"type":"done"}',
      contentType: 'application/json',
    }))
    const posted = await runtimeFor(target).postTurn({
      messagesPath: '/v1/chats/conv-1/messages?scope=chief_of_staff',
      organizationSlug: 'judge-abc',
      content: 'hi',
    })
    expect(posted.body).toBe('{"type":"done"}')
  })
})

describe('the Clerk session', () => {
  it('bears the token on every call', async () => {
    const target = await startTarget(() =>
      json({ conversationId: 'conv-1', created: true }),
    )
    await runtimeFor(target)
      .openConversation({
        scope: ChatScope.chief_of_staff,
        organizationSlug: 'judge-abc',
      })
      .catch(() => undefined)
    expect(target.recorded[0]?.authorization).toBe('Bearer first-token')
  })

  // A 401 is the one status this retries, and only once: `refused()` is what
  // decides whether a retry is even possible, and it throws rather than
  // re-minting when the refusal cannot be expiry.
  it('renews once on a 401 and replays with the new token', async () => {
    let calls = 0
    const target = await startTarget(() => {
      calls += 1
      return calls === 1
        ? { status: 401, body: '{}' }
        : {
            status: 201,
            body: JSON.stringify({ conversationId: 'conv-1', created: true }),
          }
    })
    const opened = await runtimeFor(target).openConversation({
      scope: ChatScope.chief_of_staff,
      organizationSlug: 'judge-abc',
    })
    expect(opened.conversationId).toBe('conv-1')
    expect(target.recorded.map((r) => r.authorization)).toEqual([
      'Bearer first-token',
      'Bearer second-token',
    ])
  })

  it('does not swallow what refused() throws', async () => {
    const target = await startTarget(() => ({ status: 401, body: '{}' }))
    await expect(
      runtimeFor(target, {
        session: session({
          refused: () => Promise.reject(new Error('minted 3s ago')),
        }),
      }).openConversation({
        scope: ChatScope.chief_of_staff,
        organizationSlug: 'judge-abc',
      }),
    ).rejects.toThrow('minted 3s ago')
  })
})

describe('staging and tearing down a case', () => {
  it('asks the fixture route, never for a slug of its own', async () => {
    const target = await startTarget(() => ({
      status: 201,
      body: JSON.stringify({ organizationSlug: 'judge-case-1-abcd1234' }),
    }))
    const staged = await runtimeFor(target).stageCase({
      agentId: 'chief_of_staff',
      sweepId: 'judge-19284756312-1',
      slugKey: 'case-1-1',
    })
    expect(staged.organizationSlug).toBe('judge-case-1-abcd1234')
    expect(target.recorded[0]?.url).toBe('/v1/test-fixtures/judge-chat-cases')
    // The sweep id goes over the wire and the slug does not: the server
    // derives the organization, so no caller can name one.
    expect(JSON.parse(target.recorded[0]?.body ?? '{}')).toEqual({
      agentId: 'chief_of_staff',
      sweepId: 'judge-19284756312-1',
      slugKey: 'case-1-1',
    })
  })

  it('removes the fixture, because the target outlives the sweep', async () => {
    const target = await startTarget(() =>
      json({ organizationSlug: 'judge-x', removed: true }),
    )
    await runtimeFor(target).tearDownCase('judge-x')
    expect(target.recorded[0]?.method).toBe('DELETE')
    expect(target.recorded[0]?.url).toBe(
      '/v1/test-fixtures/judge-chat-cases/judge-x',
    )
  })

  it('says so when nothing was removed', async () => {
    const target = await startTarget(() =>
      json({ organizationSlug: 'judge-x', removed: false }),
    )
    await expect(runtimeFor(target).tearDownCase('judge-x')).rejects.toThrow(
      /judge-x was not removed/,
    )
  })
})

describe('reading the assistant turn back', () => {
  const conversation = (messages: unknown[]) => ({
    conversationId: 'conv-1',
    scope: ChatScope.chief_of_staff,
    title: null,
    messages,
    usage: { complete: true, byModel: [] },
  })

  const message = (id: string, role: string, content: string) => ({
    id,
    role,
    content,
    createdAt: '2026-10-18T00:00:00.000Z',
  })

  // Keyed on the id the `done` frame named, not "the last assistant row":
  // campaign_assistant seeds a scripted opener, and folding that into the
  // output would have the judge compare two arms on seed data.
  it('picks the row the done frame named', async () => {
    const target = await startTarget(() =>
      json(
        conversation([
          message('msg-opener', ChatMessageRole.assistant, 'seeded opener'),
          message('msg-user', ChatMessageRole.user, 'question'),
          message('msg-1', ChatMessageRole.assistant, 'the answer'),
        ]),
      ),
    )
    const text = await runtimeFor(target).readAssistantText({
      conversationId: 'conv-1',
      scope: ChatScope.chief_of_staff,
      organizationSlug: 'judge-abc',
      assistantMessageId: 'msg-1',
    })
    expect(text).toBe('the answer')
    expect(target.recorded[0]?.url).toBe(
      '/v1/chats/conv-1?scope=chief_of_staff',
    )
  })

  it('is null when the turn persisted nothing', async () => {
    const target = await startTarget(() => json(conversation([])))
    expect(
      await runtimeFor(target).readAssistantText({
        conversationId: 'conv-1',
        scope: ChatScope.chief_of_staff,
        organizationSlug: 'judge-abc',
        assistantMessageId: 'msg-1',
      }),
    ).toBeNull()
  })
})

describe('waiting for the turn telemetry row', () => {
  const beginSpending = async (target: Target) => {
    spending()
    return runtimeFor(target).beginCase({
      scope: ChatScope.chief_of_staff,
      realModel: true,
    })
  }

  // The write is `void …​.catch(log)` inside ChatStreamService, so the row can
  // land after the body this arm has already read. Reading once loses it.
  it('polls until the row lands rather than reading once', async () => {
    let calls = 0
    const target = await startTarget(() => {
      calls += 1
      return json({
        conversationId: 'conv-1',
        turns: calls < 3 ? [] : [telemetryTurn()],
      })
    })
    const instrumentation = await beginSpending(target)
    await instrumentation.observeTurn({
      conversationId: 'conv-1',
      drivenTurn: 1,
      completed: true,
    })
    expect(calls).toBe(3)
    expect(instrumentation.capture.tokens).toEqual({
      input: 1000,
      output: 100,
    })
  })

  it('fails with a bounded wait and names where to look', async () => {
    const target = await startTarget(() =>
      json({ conversationId: 'conv-1', turns: [] }),
    )
    const instrumentation = await beginSpending(target)
    await expect(
      instrumentation.observeTurn({
        conversationId: 'conv-1',
        drivenTurn: 2,
        completed: true,
      }),
    ).rejects.toThrow(
      /no judge telemetry row for turn 2 of conversation conv-1 after 60ms/,
    )
  })

  // gp-api records the row only on a clean finish, so an interrupted turn
  // has nothing to wait for and spending the whole bound on it is waste.
  it('does not wait at all when the turn wrote no done frame', async () => {
    const target = await startTarget(() =>
      json({ conversationId: 'conv-1', turns: [] }),
    )
    const instrumentation = await beginSpending(target)
    await expect(
      instrumentation.observeTurn({
        conversationId: 'conv-1',
        drivenTurn: 1,
        completed: false,
      }),
    ).rejects.toThrow(/wrote no `done` frame/)
    expect(target.recorded).toHaveLength(0)
  })

  // The server derives turnIndex from its own replay window, which counts a
  // scope's scripted opener and saturates at MAX_CHAT_HISTORY_MESSAGES. The
  // arm waits for the next row rather than a number it computed.
  it('takes the next row after the last one it saw, whatever its index', async () => {
    const turns = [telemetryTurn({ turnIndex: 2, toolNames: ['a'] })]
    const target = await startTarget(() =>
      json({ conversationId: 'conv-1', turns }),
    )
    const instrumentation = await beginSpending(target)
    await instrumentation.observeTurn({
      conversationId: 'conv-1',
      drivenTurn: 1,
      completed: true,
    })
    turns.push(
      telemetryTurn({
        turnIndex: 4,
        toolNames: ['b'],
        toolQueries: ['SELECT 2'],
        inputTokens: 7,
        outputTokens: 3,
        model: 'claude-opus-4-7',
      }),
    )
    await instrumentation.observeTurn({
      conversationId: 'conv-1',
      drivenTurn: 2,
      completed: true,
    })
    // Accumulated across the conversation, not the last turn's alone.
    expect(instrumentation.capture.tokens).toEqual({
      input: 1007,
      output: 103,
    })
    expect(instrumentation.capture.turnsPriced).toBe(2)
    expect(instrumentation.capture.model).toBe('claude-opus-4-7')
    expect(instrumentation.toolQueries).toEqual(['SELECT 1', 'SELECT 2'])
    // The UNION across the case, because its other reader uses it as the
    // allowlist of names gp-api really registered.
    expect(instrumentation.capture.toolNames).toEqual(['a', 'b'])
  })

  // A turn whose usage never resolved leaves turnsPriced behind the turn
  // count, which is what makes the run unpriceable rather than cheap.
  it('does not price a turn whose usage never resolved', async () => {
    const target = await startTarget(() =>
      json({
        conversationId: 'conv-1',
        turns: [telemetryTurn({ inputTokens: null, outputTokens: null })],
      }),
    )
    const instrumentation = await beginSpending(target)
    await instrumentation.observeTurn({
      conversationId: 'conv-1',
      drivenTurn: 1,
      completed: true,
    })
    expect(instrumentation.capture.turnsPriced).toBe(0)
    expect(instrumentation.capture.tokens).toBeUndefined()
  })

  it('names all three meanings of the route 404ing', async () => {
    const target = await startTarget(() => ({ status: 404, body: '{}' }))
    const instrumentation = await beginSpending(target)
    await expect(
      instrumentation.observeTurn({
        conversationId: 'conv-1',
        drivenTurn: 1,
        completed: true,
      }),
    ).rejects.toThrow(/not preview or dev.*not the judge fixture user/s)
  })
})

describe('the config digest over HTTP', () => {
  it('is unobserved until a turn is seen', async () => {
    const target = await startTarget(() => json({}))
    spending()
    const instrumentation = await runtimeFor(target).beginCase({
      scope: ChatScope.chief_of_staff,
      realModel: true,
    })
    expect(instrumentation.configDigest()).toBe('unobserved')
  })

  const digestAfter = async (turn: Record<string, unknown>) => {
    const target = await startTarget(() =>
      json({ conversationId: 'conv-1', turns: [telemetryTurn(turn)] }),
    )
    spending()
    const instrumentation = await runtimeFor(target).beginCase({
      scope: ChatScope.chief_of_staff,
      realModel: true,
    })
    await instrumentation.observeTurn({
      conversationId: 'conv-1',
      drivenTurn: 1,
      completed: true,
    })
    return instrumentation.configDigest()
  }

  it('is stable for the same inputs', async () => {
    expect(await digestAfter({})).toBe(await digestAfter({}))
  })

  it('moves with the prompt hash and with the tool names', async () => {
    const baseline = await digestAfter({})
    expect(
      await digestAfter({ promptHash: `sha256:${'b'.repeat(64)}` }),
    ).not.toBe(baseline)
    expect(
      await digestAfter({ toolNames: ['get_my_notes', 'web_search'] }),
    ).not.toBe(baseline)
    expect(await digestAfter({ promptHashVersion: 'sha256-v2' })).not.toBe(
      baseline,
    )
  })

  it('does not move with the order the tool names arrive in', async () => {
    expect(await digestAfter({ toolNames: ['a', 'b'] })).toBe(
      await digestAfter({ toolNames: ['b', 'a'] }),
    )
  })

  // THE PARITY FINDING, pinned so nobody reports it as achieved. The
  // in-process digest hashes the rendered system prompt; the telemetry route
  // carries only sha256 of it, because the prompt is deliberately never
  // stored (see prisma/schema/judgeTurnTelemetry.prisma). sha256 cannot be
  // undone, so the two digests are different functions of different inputs
  // and the prefix is what keeps a reader from comparing them.
  it('is a DIFFERENT digest from the in-process one, and says so', async () => {
    const prompt = 'You are the Chief of Staff.'
    const inProcess = configDigest(prompt, ['get_my_notes'])
    const overHttp = await digestAfter({})
    expect(inProcess).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(overHttp).toMatch(/^sha256-prompthash:[0-9a-f]{64}$/)
    expect(overHttp).not.toBe(inProcess)
  })
})

describe('what an HTTP arm refuses, and why', () => {
  it.each([
    [
      'a canned script',
      { script: { steps: [], usage: { inputTokens: 1, outputTokens: 1 } } },
      /canned script replaces the model/,
    ],
    [
      'neither script nor realModel',
      { realModel: undefined },
      /neither a script nor realModel/,
    ],
    [
      'a briefing chat',
      { scope: ChatScope.briefing_annotation },
      /briefing_annotation records no judge telemetry/,
    ],
    [
      'a prior transcript',
      { priorTranscript: [{ role: 'user' as const, content: 'hi' }] },
      /no route writes one/,
    ],
    [
      'a forced tool failure',
      { toolFailure: { tool: 'get_my_notes', mode: 'error' as const } },
      /execute hook/,
    ],
    ['a pinned Delta version', { dataVersion: '412' }, /never applied/],
    [
      'an account state nothing can read back',
      { accountState: { pro: true, district: true } },
      /district, pro/,
    ],
  ])('refuses %s', (_name, over, expected) => {
    spending()
    const reasons = unsupportedReasons(
      driveable(over as Partial<DriveableCase>),
    )
    expect(reasons.join(' | ')).toMatch(expected)
  })

  it('refuses the real model without the spend switch', () => {
    vi.stubEnv(SPEND_ENV, '')
    expect(unsupportedReasons(driveable()).join(' | ')).toMatch(
      /JUDGE_SPEND is not "true"/,
    )
  })

  it('drives a plain spending case', () => {
    spending()
    expect(unsupportedReasons(driveable())).toEqual([])
  })

  // Every reason, not the first: a case list that leans on three things an
  // HTTP arm cannot do should learn all three from one failed arm.
  it('names every reason at once, with the agent and the case', async () => {
    spending()
    const target = await startTarget(() => json({}))
    expect(() =>
      runtimeFor(target).assertCanDrive(
        driveable({
          dataVersion: '412',
          toolFailure: { tool: 'x', mode: 'error' },
          priorTranscript: [{ role: 'user', content: 'hi' }],
        }),
      ),
    ).toThrow(UnsupportedOnRuntimeError)
    try {
      runtimeFor(target).assertCanDrive(
        driveable({
          dataVersion: '412',
          toolFailure: { tool: 'x', mode: 'error' },
          priorTranscript: [{ role: 'user', content: 'hi' }],
        }),
      )
    } catch (err) {
      const text = err instanceof Error ? err.message : ''
      expect(text).toContain('chief_of_staff/case-1')
      expect(text).toContain('"http" runtime')
      expect(text).toContain('never applied')
      expect(text).toContain('execute hook')
      expect(text).toContain('no route writes one')
    }
  })
})

describe('chatArmRuntimeFor', () => {
  const service = {} as TestServiceContext
  const env = (over: Partial<ArmEnv>): ArmEnv =>
    ({
      sweepId: 's',
      agentIds: ['chief_of_staff'],
      spends: true,
      explicitSelection: false,
      arm: 'candidate',
      baseRef: 'main',
      candidateSha: 'abc',
      armCommit: 'abc',
      fixtureValues: {},
      armRuntime: 'inprocess',
      ...over,
    }) as ArmEnv

  it('hands back the in-process runtime by default', () => {
    expect(
      chatArmRuntimeFor(env({ armRuntime: 'inprocess' }), service).kind,
    ).toBe('inprocess')
  })

  it('hands back the HTTP runtime when the arm asked for one', () => {
    vi.stubEnv('JUDGE_CLERK_SESSION_TOKEN', 'aaa.bbb.ccc')
    vi.stubEnv('JUDGE_CLERK_SESSION_EXPIRES_AT', '2099-01-01T00:00:00.000Z')
    expect(
      chatArmRuntimeFor(
        env({ armRuntime: 'http', targetBaseUrl: 'https://pr-7.example.com' }),
        service,
      ).kind,
    ).toBe('http')
  })

  // The arm holds no Clerk secret by design, so it cannot mint one. Saying
  // that is better than failing somewhere inside an HTTP client.
  it('refuses when the mint step published no session', () => {
    vi.stubEnv('JUDGE_CLERK_SESSION_TOKEN', '')
    vi.stubEnv('JUDGE_CLERK_SESSION_EXPIRES_AT', '')
    expect(() =>
      chatArmRuntimeFor(
        env({ armRuntime: 'http', targetBaseUrl: 'https://pr-7.example.com' }),
        service,
      ),
    ).toThrow(/JUDGE_CLERK_SESSION_TOKEN is not set/)
  })
})
