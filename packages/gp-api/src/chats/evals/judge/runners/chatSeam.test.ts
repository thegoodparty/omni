import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createMockLogger } from 'src/shared/test-utils/mockLogger.util'
import {
  LlmService,
  type AnthropicProvider,
  type AnthropicProviderFactory,
  type GenerateObjectFn,
  type GenerateTextFn,
  type LlmStreamOptions,
  type LlmTool,
  type StreamTextFn,
} from '@/llm/services/llm.service'
import { DatabricksSqlProvider } from '@/llm/tools/databricksProvider'
import type { S3Service } from '@/vendors/aws/services/s3.service'
import { BriefingAnnotationHandler } from '@/chats/briefing-chats/briefingAnnotation.handler'
import { BriefingArtifactCacheService } from '@/chats/briefing-chats/services/briefingArtifactCache.service'
import type {
  BriefingContextResult,
  BriefingContextService,
} from '@/chats/briefing-chats/services/briefingContext.service'
import type { BriefingNotesService } from '@/chats/briefing-chats/services/briefingNotes.service'
import { todayInTimezone } from '@/chats/briefing-chats/services/systemPromptBuilder'
import { HENDERSONVILLE_FIXTURE } from '@/chats/briefing-chats/evals/fixtures/hendersonvilleBriefing.fixture'
import { SPEND_ENV, SPEND_VALUE } from '../config'
import {
  UnpinnableSqlError,
  assertTestProcess,
  buildTrace,
  configDigest,
  installBriefingFixture,
  installLlmCapture,
  instrumentDatabricksProvider,
  instrumentTools,
  parseStreamEvents,
  pinDeltaVersion,
  readTurnTokens,
  toolFailureRefusal,
  type ChatTurnScript,
  traceErrorText,
  type StreamEvent,
  type ToolOutcome,
  type TurnCapture,
} from './chatSeam'
import type { ToolFailure } from '../cases'

const stubAnthropicFactory: AnthropicProviderFactory = () =>
  ({
    languageModel: (model: string) => ({ modelId: model }) as never,
    webSearchTool: () => ({}) as never,
  }) as AnthropicProvider

const buildLlm = (): {
  llm: LlmService
  streamTextFn: ReturnType<typeof vi.fn>
} => {
  const streamTextFn = vi.fn()
  const llm = new LlmService(
    createMockLogger(),
    streamTextFn as unknown as StreamTextFn,
    vi.fn() as unknown as GenerateTextFn,
    vi.fn() as unknown as GenerateObjectFn,
    stubAnthropicFactory,
  )
  return { llm, streamTextFn }
}

const okTool = {
  description: 'ok',
  inputSchema: z.object({}),
  execute: () => 'ok',
} satisfies LlmTool

const failTool = {
  description: 'fail',
  inputSchema: z.object({}),
  execute: () => {
    throw new Error('credential not configured')
  },
} satisfies LlmTool

const optionsWith = (tools: Record<string, LlmTool>): LlmStreamOptions => ({
  messages: [
    { role: 'system', content: 'You are the chief of staff.' },
    { role: 'user', content: 'What are my priorities?' },
  ],
  tools,
  models: ['claude-sonnet-4-6'],
})

const scriptWithToolSteps = (
  count: number,
  tool = 'ok_tool',
): ChatTurnScript => ({
  steps: [
    { kind: 'text', text: 'looking' },
    ...Array.from({ length: count }, () => ({
      kind: 'tool' as const,
      tool,
      input: {},
    })),
    { kind: 'text', text: 'here is the answer' },
  ],
  usage: { inputTokens: 31_213, outputTokens: 227 },
})

const drain = async (stream: AsyncIterable<string>): Promise<string> => {
  const parts: string[] = []
  for await (const delta of stream) parts.push(delta)
  return parts.join('')
}

// The scope allowlist a real pin is built from.
const TABLES = ['serve_agent_voters']

// Enables the paid path for one call. Nothing here reaches Anthropic: the
// stubbed streamTextFn stands in for the model.
// Reads the constant rather than a literal: the two gates that decide whether
// real money moves were written against different strings on different
// branches, and a test that hardcodes one of them hides the next drift.
const withSpendEnabled = <T>(fn: () => T): T => {
  const previous = process.env[SPEND_ENV]
  process.env[SPEND_ENV] = SPEND_VALUE
  try {
    return fn()
  } finally {
    if (previous === undefined) delete process.env[SPEND_ENV]
    else process.env[SPEND_ENV] = previous
  }
}

describe('assertTestProcess', () => {
  it('refuses to patch a live singleton outside a test process', () => {
    const vitestFlag = process.env.VITEST
    const nodeEnv = process.env.NODE_ENV
    delete process.env.VITEST
    process.env.NODE_ENV = 'production'
    try {
      expect(() => assertTestProcess('installLlmCapture')).toThrow(
        'may only run in a test process',
      )
    } finally {
      if (vitestFlag === undefined) delete process.env.VITEST
      else process.env.VITEST = vitestFlag
      if (nodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = nodeEnv
    }
  })
})

describe('traceErrorText', () => {
  it('keeps the failure class', () => {
    expect(traceErrorText(new TypeError('no rows'))).toBe('TypeError: no rows')
  })

  it('strips the identifiers a vendor error echoes back', () => {
    const err = new Error(
      'statement failed: SELECT ... WHERE id IN ' +
        "('0199f4aa-1c2e-7bb1-9d0f-6d3c1a2b4e55') AND email = 'a.b@x.org' " +
        'AND phone = 15095551234',
    )
    const text = traceErrorText(err)

    expect(text).toContain('[id]')
    expect(text).toContain('[email]')
    expect(text).toContain('[digits]')
    expect(text).not.toContain('0199f4aa')
    expect(text).not.toContain('a.b@x.org')
  })

  // Cut first and a secret straddling the bound leaves a fragment too short
  // for its shape to match, so it is stored in the clear.
  it('redacts the whole error before it cuts', () => {
    const text = traceErrorText(
      new Error(`${'a '.repeat(92)}sk-ant-zzzzzzzzzzzz`),
    )
    expect(text).not.toMatch(/zz/)
  })

  it('bounds a vendor error that dumps a whole response body', () => {
    expect(traceErrorText(new Error('x'.repeat(5_000))).length).toBe(200)
  })
})

describe('configDigest', () => {
  it('ignores the order tools were registered in', () => {
    expect(configDigest('prompt', ['b', 'a'])).toBe(
      configDigest('prompt', ['a', 'b']),
    )
  })

  it('changes when the prompt changes', () => {
    expect(configDigest('prompt a', ['t'])).not.toBe(
      configDigest('prompt b', ['t']),
    )
  })

  it('changes when a tool is added', () => {
    expect(configDigest('prompt', ['a'])).not.toBe(
      configDigest('prompt', ['a', 'b']),
    )
  })

  it('cannot be forged by moving text across the prompt/tool boundary', () => {
    expect(configDigest('a\0b', [])).not.toBe(configDigest('a', ['b']))
  })
})

describe('pinDeltaVersion', () => {
  const sql =
    'SELECT COUNT(*) AS count FROM serve_agent_voters ' +
    "WHERE state_postal_code = 'WA'"

  it('pins the table the query reads', () => {
    expect(pinDeltaVersion(sql, '3237', TABLES)).toBe(
      'SELECT COUNT(*) AS count FROM serve_agent_voters VERSION AS OF 3237 ' +
        "WHERE state_postal_code = 'WA'",
    )
  })

  it('leaves an already-pinned query alone', () => {
    const pinned = pinDeltaVersion(sql, '3237', TABLES)
    expect(pinDeltaVersion(pinned, '9999', TABLES)).toBe(pinned)
  })

  it('pins every table reference a joined query reads', () => {
    const joined =
      'SELECT COUNT(*) AS count FROM serve_agent_voters a ' +
      'JOIN serve_agent_voters b ON a.id = b.household_id'

    expect(pinDeltaVersion(joined, '3237', TABLES)).toBe(
      'SELECT COUNT(*) AS count FROM serve_agent_voters VERSION AS OF 3237 ' +
        'a JOIN serve_agent_voters VERSION AS OF 3237 b ' +
        'ON a.id = b.household_id',
    )
  })

  it('pins a backticked reference to the same allowed table', () => {
    const quoted = 'SELECT COUNT(*) AS count FROM `serve_agent_voters`'

    expect(pinDeltaVersion(quoted, '3237', TABLES)).toBe(
      'SELECT COUNT(*) AS count FROM `serve_agent_voters` VERSION AS OF 3237',
    )
  })

  it('leaves a string literal that happens to read like SQL alone', () => {
    const literal =
      'SELECT COUNT(*) AS count FROM serve_agent_voters ' +
      "WHERE City = 'FROM DOWNTOWN'"

    expect(pinDeltaVersion(literal, '3237', TABLES)).toBe(
      'SELECT COUNT(*) AS count FROM serve_agent_voters VERSION AS OF 3237 ' +
        "WHERE City = 'FROM DOWNTOWN'",
    )
  })

  // `FROM` is also SQL's argument separator. The validator restricts which
  // COLUMNS a function may read, not which functions may appear, so all three
  // of these reach the pin as fully validated SQL — and splicing VERSION AS OF
  // into one produces a Spark parse error the trace blames on the vendor, in
  // whichever single arm's model happened to write it.
  it('leaves the FROM inside EXTRACT alone', () => {
    const extract =
      'SELECT SUM(CASE WHEN EXTRACT(YEAR FROM registration_date) > 2020 ' +
      'THEN 1 ELSE 0 END) AS recent, COUNT(*) AS count ' +
      "FROM serve_agent_voters WHERE district_name = 'D1'"

    expect(pinDeltaVersion(extract, '3237', TABLES)).toBe(
      'SELECT SUM(CASE WHEN EXTRACT(YEAR FROM registration_date) > 2020 ' +
        'THEN 1 ELSE 0 END) AS recent, COUNT(*) AS count ' +
        'FROM serve_agent_voters VERSION AS OF 3237 ' +
        "WHERE district_name = 'D1'",
    )
  })

  it('leaves the FROM inside SUBSTRING alone', () => {
    const substring =
      'SELECT COUNT(*) AS count FROM serve_agent_voters ' +
      "WHERE SUBSTRING(district_name FROM 1 FOR 2) = 'D1'"

    expect(pinDeltaVersion(substring, '3237', TABLES)).toBe(
      'SELECT COUNT(*) AS count FROM serve_agent_voters VERSION AS OF 3237 ' +
        "WHERE SUBSTRING(district_name FROM 1 FOR 2) = 'D1'",
    )
  })

  it('leaves the FROM inside TRIM alone', () => {
    const trim =
      'SELECT COUNT(*) AS count FROM serve_agent_voters ' +
      "WHERE TRIM(LEADING '0' FROM district_name) = 'D1'"

    expect(pinDeltaVersion(trim, '3237', TABLES)).toBe(
      'SELECT COUNT(*) AS count FROM serve_agent_voters VERSION AS OF 3237 ' +
        "WHERE TRIM(LEADING '0' FROM district_name) = 'D1'",
    )
  })

  it('refuses to pass an unpinnable query through unpinned', () => {
    expect(() => pinDeltaVersion('SELECT 1', '3237', TABLES)).toThrow(
      UnpinnableSqlError,
    )
  })

  // Nothing but a function argument to rewrite, so nothing was pinned. A
  // query this shape cannot happen — the validator demands a table — but
  // passing it through unpinned is the one outcome that must not.
  it('refuses a query whose only FROM is a function argument', () => {
    expect(() =>
      pinDeltaVersion(
        'SELECT EXTRACT(YEAR FROM registration_date)',
        '3237',
        TABLES,
      ),
    ).toThrow(UnpinnableSqlError)
  })

  it('refuses a version that is not a whole number', () => {
    expect(() =>
      pinDeltaVersion(sql, '1 WHERE 1=1 UNION SELECT Voters_FirstName', TABLES),
    ).toThrow(UnpinnableSqlError)
  })
})

describe('instrumentDatabricksProvider', () => {
  const sql = 'SELECT COUNT(*) AS count FROM serve_agent_voters'
  const pin = { version: '3237', tables: TABLES }

  // A REAL provider, because the patch is on DatabricksSqlProvider's
  // prototype: an instance of anything else would not be instrumented, and
  // instrumenting one instance is exactly the bug this replaced.
  // `CONSTITUENT_DATA_PROVIDER` is registered by both
  // chief-of-staff.module.ts and priority-flow.module.ts with two independent
  // factories, so a container lookup by that token returns one of two
  // providers by Nest's ordering rather than by which handler is about to
  // run.
  const sqlProvider = (seen: string[]): DatabricksSqlProvider =>
    new DatabricksSqlProvider({
      hostname: 'host.cloud.databricks.com',
      httpPath: '/sql/1.0/warehouses/abc',
      accessToken: 'unused-in-this-test',
      logger: { warn: () => undefined },
      clientFactory: () => ({
        connect: async () => ({
          openSession: async () => ({
            executeStatement: async (statement: string) => {
              seen.push(statement)
              return {
                fetchAll: async () => [],
                close: async () => undefined,
              }
            },
            close: async () => undefined,
          }),
          close: async () => undefined,
        }),
      }),
    })

  it('rejects a bad pinned version before the turn starts', () => {
    expect(() =>
      instrumentDatabricksProvider({ ...pin, version: 'latest' }),
    ).toThrow(UnpinnableSqlError)
  })

  it('rejects a pin with no table to apply it to', () => {
    expect(() =>
      instrumentDatabricksProvider({ version: '3237', tables: [] }),
    ).toThrow(UnpinnableSqlError)
  })

  // A rejected install patched nothing, so it must not record the target as
  // patched: one malformed case would otherwise kill every well-formed case
  // behind it in the sweep, with an error naming a concurrency bug that never
  // happened — sending the operator after the wrong thing entirely. On the
  // prototype the stakes are higher than on an instance, because the entry
  // outlives every provider the process builds.
  it('leaves the class claimable after a rejected install', async () => {
    const seen: string[] = []
    const provider = sqlProvider(seen)
    expect(() =>
      instrumentDatabricksProvider({ version: 'latest', tables: TABLES }),
    ).toThrow(UnpinnableSqlError)

    const instrumented = instrumentDatabricksProvider(pin)
    await provider.query(sql)
    instrumented.restore()

    expect(instrumented.queries).toEqual([sql])
    expect(seen).toEqual([`${sql} VERSION AS OF 3237`])
  })

  it('records the agent SQL verbatim and runs the pinned form', async () => {
    const seen: string[] = []
    const provider = sqlProvider(seen)
    const instrumented = instrumentDatabricksProvider(pin)

    await provider.query(sql)
    instrumented.restore()

    expect(instrumented.queries).toEqual([sql])
    expect(seen).toEqual([`${sql} VERSION AS OF 3237`])
  })

  // THE POINT OF PATCHING THE CLASS. The instrumented run never sees this
  // provider — it is built afterwards, the way a second module's factory
  // builds its own — and it is still pinned and recorded. Under the old
  // instance patch this arm read the live table and reported no queries.
  it('instruments a provider the caller never handed over', async () => {
    const seen: string[] = []
    const instrumented = instrumentDatabricksProvider(pin)
    const neighbour = sqlProvider(seen)

    await neighbour.query(sql)
    instrumented.restore()

    expect(instrumented.queries).toEqual([sql])
    expect(seen).toEqual([`${sql} VERSION AS OF 3237`])
  })

  it('runs the query unchanged when no version is pinned', async () => {
    const seen: string[] = []
    const provider = sqlProvider(seen)
    const instrumented = instrumentDatabricksProvider()

    await provider.query(sql)
    instrumented.restore()

    expect(instrumented.queries).toEqual([sql])
    expect(seen).toEqual([sql])
  })

  it('stops recording once restored', async () => {
    const seen: string[] = []
    const provider = sqlProvider(seen)
    const instrumented = instrumentDatabricksProvider(pin)
    instrumented.restore()

    await provider.query(sql)

    expect(instrumented.queries).toEqual([])
    expect(seen).toEqual([sql])
  })

  // Restoring has to put the ORIGINAL prototype method back, not delete the
  // property: deleting it would leave every provider in the process with no
  // query method at all. This is the prototype form of the old "restores a
  // provider that carries query on its prototype" case — that one built a
  // stand-in class, which a prototype patch does not touch at all.
  it('leaves the class callable after a second install', async () => {
    const seen: string[] = []
    const provider = sqlProvider(seen)
    instrumentDatabricksProvider(pin).restore()
    const second = instrumentDatabricksProvider({ ...pin, version: '4000' })

    await provider.query(sql)
    second.restore()

    expect(second.queries).toEqual([sql])
    expect(seen).toEqual([`${sql} VERSION AS OF 4000`])
  })

  it('refuses two overlapping installs', () => {
    const first = instrumentDatabricksProvider()
    expect(() => instrumentDatabricksProvider()).toThrow(
      /already installed on this instance/,
    )
    first.restore()
  })
})

describe('parseStreamEvents', () => {
  it('reads the data frames and skips everything else', () => {
    const body =
      ': keep-alive comment\n\n' +
      'data: {"type":"text","delta":"hi"}\n\n' +
      'data: {"type":"tool_call","toolName":"crud_priorities"}\n\n' +
      'data: {"type":"done"}\n\n'

    expect(parseStreamEvents(body)).toEqual([
      { type: 'text', delta: 'hi' },
      { type: 'tool_call', toolName: 'crud_priorities' },
      { type: 'done' },
    ])
  })

  it('keeps a frame carrying fields this build does not read', () => {
    const body = 'data: {"type":"citation","attachmentId":"a1"}\n\n'
    expect(parseStreamEvents(body)).toEqual([{ type: 'citation' }])
  })

  it('keeps the frames a stream cut off mid-frame did deliver', () => {
    const body =
      'data: {"type":"text","delta":"hi"}\n\n' + 'data: {"type":"tool_c\n\n'
    expect(parseStreamEvents(body)).toEqual([{ type: 'text', delta: 'hi' }])
  })
})

describe('buildTrace', () => {
  const textEvent: StreamEvent = { type: 'text', delta: 'x' }
  const toolEvent = (toolName: string): StreamEvent => ({
    type: 'tool_call',
    toolName,
  })

  it('collapses a run of text deltas into one step', () => {
    const trace = buildTrace([textEvent, textEvent, textEvent], [])
    expect(trace).toEqual([{ index: 0, kind: 'text' }])
  })

  it('does not let a keep-alive ping split a run of text', () => {
    const trace = buildTrace([textEvent, { type: 'ping' }, textEvent], [])
    expect(trace).toEqual([{ index: 0, kind: 'text' }])
  })

  it('attaches the failure only the execute seam saw', () => {
    const outcomes: ToolOutcome[] = [
      { tool: 'query_constituent_data', error: 'PeopleDbxUnavailableError' },
    ]
    const trace = buildTrace(
      [textEvent, toolEvent('query_constituent_data'), textEvent],
      outcomes,
    )

    expect(trace).toEqual([
      { index: 0, kind: 'text' },
      {
        index: 1,
        kind: 'tool',
        tool: 'query_constituent_data',
        error: 'PeopleDbxUnavailableError',
      },
      { index: 2, kind: 'text' },
    ])
  })

  it('matches repeated calls to one tool in call order', () => {
    const outcomes: ToolOutcome[] = [
      { tool: 'get_briefing' },
      { tool: 'get_briefing', error: 'boom' },
    ]
    const trace = buildTrace(
      [toolEvent('get_briefing'), toolEvent('get_briefing')],
      outcomes,
    )

    expect(trace[0]?.error).toBeUndefined()
    expect(trace[1]?.error).toBe('boom')
  })

  it('keeps a failure the route never announced', () => {
    const trace = buildTrace([textEvent], [{ tool: 'silent', error: 'boom' }])
    expect(trace).toEqual([
      { index: 0, kind: 'text' },
      { index: 1, kind: 'tool', tool: 'silent', error: 'boom' },
    ])
  })

  it('records a stream error as an error step', () => {
    const trace = buildTrace(
      [{ type: 'error', code: 'upstream_unavailable', message: 'down' }],
      [],
    )
    expect(trace).toEqual([{ index: 0, kind: 'error', error: 'down' }])
  })
})

describe('installLlmCapture', () => {
  it('captures the rendered prompt and the sorted tool names', async () => {
    const { llm } = buildLlm()
    const installed = installLlmCapture(llm, { script: scriptWithToolSteps(1) })

    const result = await llm.streamChatCompletion(
      optionsWith({ ok_tool: okTool, a_tool: okTool }),
    )
    await drain(result.textStream)
    installed.restore()

    expect(installed.capture.systemPrompt).toBe('You are the chief of staff.')
    expect(installed.capture.toolNames).toEqual(['a_tool', 'ok_tool'])
    expect(installed.capture.model).toBe('claude-sonnet-4-6')
  })

  it('maps input and output tokens onto the record fields in order', async () => {
    const { llm } = buildLlm()
    const installed = installLlmCapture(llm, {
      script: {
        steps: [{ kind: 'text', text: 'hi' }],
        usage: { inputTokens: 31_213, outputTokens: 227 },
      },
    })

    const result = await llm.streamChatCompletion(optionsWith({}))
    await drain(result.textStream)
    await readTurnTokens(installed.capture)
    installed.restore()

    expect(installed.capture.tokens).toEqual({ input: 31_213, output: 227 })
  })

  it('refuses a second install on the same instance', async () => {
    const { llm } = buildLlm()
    const script = scriptWithToolSteps(0)
    const installed = installLlmCapture(llm, { script })

    expect(() => installLlmCapture(llm, { script })).toThrow(
      'already installed',
    )

    installed.restore()
    // Restored, so the next arm may claim it again.
    installLlmCapture(llm, { script }).restore()
    await Promise.resolve()
  })

  // The real path bills Anthropic for every turn of a sweep, and a forgotten
  // `script` field type-checks cleanly, so it takes two deliberate acts to
  // reach. Nothing below spends anything: streamTextFn stands in for the
  // model.
  it('refuses to reach the paid model when no script was given', () => {
    const { llm } = buildLlm()
    expect(() => installLlmCapture(llm)).toThrow('was given no script')
  })

  it('refuses the paid model unless the spend flag is set', () => {
    const { llm } = buildLlm()
    expect(() => installLlmCapture(llm, { realModel: true })).toThrow(
      'JUDGE_SPEND',
    )
  })

  it('leaves the service claimable after a refused install', () => {
    const { llm } = buildLlm()
    expect(() => installLlmCapture(llm)).toThrow('was given no script')

    const installed = installLlmCapture(llm, {
      script: scriptWithToolSteps(0),
    })
    installed.restore()
  })

  // The two cases above are refused by a guard that runs BEFORE the claim, so
  // they would still pass if `claim` went back to recording the target up
  // front. This one throws INSIDE the install — binding a method that is not
  // there — which is the only shape that tells the two apart: nothing was
  // patched, so nothing may be recorded, and there is no restore handle to
  // clear it with.
  it('leaves the target claimable when the patch itself throws', () => {
    const half = {} as unknown as LlmService
    expect(() =>
      installLlmCapture(half, { script: scriptWithToolSteps(0) }),
    ).toThrow(TypeError)

    Object.assign(half, {
      streamChatCompletion: () => Promise.reject(new Error('never called')),
    })
    installLlmCapture(half, { script: scriptWithToolSteps(0) }).restore()
  })

  it('reports the scripted tool calls it made', async () => {
    const { llm } = buildLlm()
    const installed = installLlmCapture(llm, { script: scriptWithToolSteps(2) })

    const result = await llm.streamChatCompletion(
      optionsWith({ ok_tool: okTool }),
    )
    await drain(result.textStream)
    const calls = await result.toolCalls
    installed.restore()

    expect(calls.map((call) => call.function.name)).toEqual([
      'ok_tool',
      'ok_tool',
    ])
  })

  it('refuses a script whose input the tool schema rejects', async () => {
    const { llm } = buildLlm()
    const strictTool = {
      description: 'strict',
      inputSchema: z.object({ id: z.string() }),
      execute: () => 'ok',
    } satisfies LlmTool
    const installed = installLlmCapture(llm, {
      script: {
        steps: [{ kind: 'tool', tool: 'strict_tool', input: { id: 7 } }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    })

    const result = await llm.streamChatCompletion(
      optionsWith({ strict_tool: strictTool }),
    )
    await expect(drain(result.textStream)).rejects.toThrow(
      'input its own schema rejects',
    )
    installed.restore()
  })

  it('resolves finalText before the stream is drained', async () => {
    const { llm } = buildLlm()
    const installed = installLlmCapture(llm, { script: scriptWithToolSteps(1) })

    const result = await llm.streamChatCompletion(
      optionsWith({ ok_tool: okTool }),
    )
    // Read first, exactly as a consumer holding the already-settled promise
    // the real result returns would.
    const finalText = await result.finalText
    await drain(result.textStream)
    installed.restore()

    expect(finalText).toBe('lookinghere is the answer')
  })

  it('records a failed tool step and still finishes the turn', async () => {
    const { llm } = buildLlm()
    const installed = installLlmCapture(llm, {
      script: scriptWithToolSteps(1, 'fail_tool'),
    })

    const result = await llm.streamChatCompletion(
      optionsWith({ fail_tool: failTool }),
    )
    const text = await drain(result.textStream)
    installed.restore()

    expect(text).toBe('lookinghere is the answer')
    expect(installed.capture.outcomes).toEqual([
      { tool: 'fail_tool', error: 'Error: credential not configured' },
    ])
  })

  it('drives the scope tool hooks the real stream service listens on', async () => {
    const { llm } = buildLlm()
    const installed = installLlmCapture(llm, { script: scriptWithToolSteps(2) })
    const started: string[] = []
    const ended: string[] = []

    const result = await llm.streamChatCompletion({
      ...optionsWith({ ok_tool: okTool }),
      onToolCallStart: ({ name }) => started.push(name),
      onToolCallEnd: ({ name }) => ended.push(name),
    })
    const text = await drain(result.textStream)
    installed.restore()

    expect(started).toEqual(['ok_tool', 'ok_tool'])
    expect(ended).toEqual(['ok_tool', 'ok_tool'])
    expect(text).toBe('lookinghere is the answer')
  })

  it('refuses a script that calls a tool the turn never registered', async () => {
    const { llm } = buildLlm()
    const installed = installLlmCapture(llm, {
      script: scriptWithToolSteps(1, 'nope'),
    })

    const result = await llm.streamChatCompletion(optionsWith({}))
    await expect(drain(result.textStream)).rejects.toThrow(
      'did not register as an executable tool',
    )
    installed.restore()
  })

  it('reports the whole loop usage, not the final step, on a real turn', async () => {
    const { llm, streamTextFn } = buildLlm()
    // The AI SDK's `usage` is the LAST step's; `totalUsage` spans every step
    // of the tool loop, which is the only figure that describes a turn.
    streamTextFn.mockReturnValue({
      textStream: (async function* () {
        yield 'answer'
      })(),
      text: Promise.resolve('answer'),
      usage: Promise.resolve({
        inputTokens: 900,
        outputTokens: 12,
        totalTokens: 912,
      }),
      totalUsage: Promise.resolve({
        inputTokens: 31_213,
        outputTokens: 227,
        totalTokens: 31_440,
      }),
      toolCalls: Promise.resolve([]),
    })
    const installed = withSpendEnabled(() =>
      installLlmCapture(llm, { realModel: true }),
    )

    const result = await llm.streamChatCompletion(optionsWith({}))
    await drain(result.textStream)
    await readTurnTokens(installed.capture)
    installed.restore()

    expect(installed.capture.tokens).toEqual({ input: 31_213, output: 227 })
  })

  it('puts the real method back when restored', async () => {
    const { llm, streamTextFn } = buildLlm()
    const installed = installLlmCapture(llm, { script: scriptWithToolSteps(0) })
    installed.restore()
    streamTextFn.mockReturnValue({
      textStream: (async function* () {
        yield 'real'
      })(),
      text: Promise.resolve('real'),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      toolCalls: Promise.resolve([]),
    })

    const result = await llm.streamChatCompletion(optionsWith({}))

    expect(await drain(result.textStream)).toBe('real')
  })
})

// FORCING A TOOL TO FAIL, at the one seam that already wrapped every tool's
// execute. The capability was there; what was missing was a way for a case to
// name the tool and the mode.
describe('a forced tool failure', () => {
  const ran: string[] = []
  const watchedTool = {
    description: 'watched',
    inputSchema: z.object({}),
    execute: () => {
      ran.push('called')
      return 'ok'
    },
  } satisfies LlmTool

  const wrap = (
    failure: ToolFailure,
    tools: Record<string, LlmTool> = { watched: watchedTool },
  ): { outcomes: ToolOutcome[]; tools: Record<string, LlmTool> } => {
    const outcomes: ToolOutcome[] = []
    const wrapped = instrumentTools(tools, { outcomes, failure })
    if (!wrapped) throw new Error('nothing wrapped')
    return { outcomes, tools: wrapped }
  }

  const execute = async (
    tools: Record<string, LlmTool>,
    name: string,
  ): Promise<unknown> => {
    const tool = tools[name]
    if (!tool || !('execute' in tool)) {
      throw new Error(`${name} is not executable`)
    }
    return tool.execute({})
  }

  // The real tool is NOT called. An ordinance present_* tool commits its own
  // record, and a case that says the tool failed must not leave that write
  // behind.
  it('rejects without running the real tool', async () => {
    ran.length = 0
    const { tools } = wrap({ tool: 'watched', mode: 'error' })

    await expect(execute(tools, 'watched')).rejects.toThrow(/forced failure/)
    expect(ran).toEqual([])
  })

  it('records the step as a tool error, the way a real failure is', async () => {
    const { outcomes, tools } = wrap({ tool: 'watched', mode: 'error' })

    await expect(execute(tools, 'watched')).rejects.toThrow()
    expect(outcomes).toEqual([
      { tool: 'watched', error: expect.stringContaining('forced failure') },
    ])
  })

  // Named so a forced timeout is the same failure CLASS a real one is.
  it('raises a timeout as a TimeoutError after its delay', async () => {
    const { outcomes, tools } = wrap({
      tool: 'watched',
      mode: 'timeout',
      afterMs: 5,
    })
    const started = Date.now()

    await expect(execute(tools, 'watched')).rejects.toThrow(/forced timeout/)
    expect(Date.now() - started).toBeGreaterThanOrEqual(4)
    expect(outcomes[0]?.error).toContain('TimeoutError')
  })

  // One tool named, one tool failed. A directive that took every tool down
  // would measure a dead agent rather than a missing capability.
  it('leaves every other tool alone', async () => {
    ran.length = 0
    const { outcomes, tools } = wrap(
      { tool: 'watched', mode: 'error' },
      { watched: watchedTool, other: watchedTool },
    )

    await expect(execute(tools, 'other')).resolves.toBe('ok')
    expect(ran).toEqual(['called'])
    expect(outcomes).toEqual([{ tool: 'other' }])
  })
})

// A directive naming a tool the turn never registered has to be a LOUD
// refusal. In the record it is indistinguishable from a case the agent simply
// never needed the tool for, so a silently ignored one produces a verdict
// about a condition nobody applied.
describe('toolFailureRefusal', () => {
  it('passes a directive naming a tool the turn offered', () => {
    expect(
      toolFailureRefusal({ tool: 'get_briefing', mode: 'error' }, [
        'get_briefing',
        'list_briefings',
      ]),
    ).toBeUndefined()
  })

  it('refuses a tool the turn never registered, and says what it had', () => {
    const reason = toolFailureRefusal({ tool: 'get_brief', mode: 'error' }, [
      'list_briefings',
      'get_briefing',
    ])
    expect(reason).toContain('get_brief')
    expect(reason).toContain('get_briefing, list_briefings')
  })

  // A turn with no tools at all is exactly a turn where every named tool is
  // unknown, and it never reaches the wrapper — which is why this check lives
  // outside instrumentTools.
  it('refuses when the turn registered no tools at all', () => {
    expect(toolFailureRefusal({ tool: 'anything', mode: 'error' }, [])).toMatch(
      /registered no such tool/,
    )
  })

  it('passes when the case named no tool to fail', () => {
    expect(toolFailureRefusal(undefined, [])).toBeUndefined()
  })
})

describe('installLlmCapture with a tool-failure directive', () => {
  const script: ChatTurnScript = {
    steps: [{ kind: 'tool', tool: 'ok_tool', input: {} }],
    usage: { inputTokens: 10, outputTokens: 1 },
  }

  it('refuses a directive naming a tool the turn never had', async () => {
    const { llm } = buildLlm()
    const installed = installLlmCapture(llm, {
      script,
      toolFailure: { tool: 'no_such_tool', mode: 'error' },
    })

    await expect(
      llm.streamChatCompletion(optionsWith({ ok_tool: okTool })),
    ).rejects.toThrow(/registered no such tool/)
    installed.restore()

    // THE THROW IS WHAT KEEPS THE TURN FROM BEING PAID FOR, and these two
    // fields are the evidence. Both are assigned only AFTER the stream
    // returns, so undefined means the refusal landed before it — which
    // `streamTextFn` could not have told us, since a scripted turn never
    // calls it either way.
    expect(installed.capture.model).toBeUndefined()
    expect(installed.capture.readUsage).toBeUndefined()
  })

  it('records the refusal as well as throwing it', async () => {
    const { llm } = buildLlm()
    const installed = installLlmCapture(llm, {
      script,
      toolFailure: { tool: 'no_such_tool', mode: 'error' },
    })

    await expect(
      llm.streamChatCompletion(optionsWith({ ok_tool: okTool })),
    ).rejects.toThrow()
    installed.restore()

    // The record is what lets the runner NAME the mistake: the chat route
    // catches a throw out of the seam and writes an error chunk, so on the
    // throw alone the run would come back as an ordinary infraError.
    expect(installed.capture.directiveError).toMatch(/no_such_tool/)
  })

  it('says nothing when the directive names a tool the turn has', async () => {
    const { llm } = buildLlm()
    const installed = installLlmCapture(llm, {
      script,
      toolFailure: { tool: 'ok_tool', mode: 'error' },
    })

    const result = await llm.streamChatCompletion(
      optionsWith({ ok_tool: okTool }),
    )
    await drain(result.textStream)
    installed.restore()

    expect(installed.capture.directiveError).toBeUndefined()
    expect(installed.capture.outcomes).toEqual([
      { tool: 'ok_tool', error: expect.stringContaining('forced failure') },
    ])
  })
})

// A multi-turn case is ONE install across SEVERAL turns, and the capture's
// usage promise is replaced by each turn. Read once at the end it would
// report the last turn's tokens as the whole conversation's.
describe('readTurnTokens across several turns', () => {
  const capture = (): TurnCapture => ({
    toolNames: [],
    turnsPriced: 0,
    outcomes: [],
  })

  it('accumulates the turns it is given and counts them', async () => {
    const one = capture()
    one.readUsage = () =>
      Promise.resolve({ inputTokens: 100, outputTokens: 10, totalTokens: 110 })
    await readTurnTokens(one)
    one.readUsage = () =>
      Promise.resolve({ inputTokens: 250, outputTokens: 20, totalTokens: 270 })
    await readTurnTokens(one)

    expect(one.tokens).toEqual({ input: 350, output: 30 })
    expect(one.turnsPriced).toBe(2)
  })

  // Called twice on one turn — which the runner does not do, but a partial
  // failure path could — the same numbers must not be folded in twice.
  it('folds one turn in once however often it is read', async () => {
    const one = capture()
    one.readUsage = () =>
      Promise.resolve({ inputTokens: 100, outputTokens: 10, totalTokens: 110 })
    await readTurnTokens(one)
    await readTurnTokens(one)

    expect(one.tokens).toEqual({ input: 100, output: 10 })
    expect(one.turnsPriced).toBe(1)
  })

  // A turn whose usage promise rejected leaves the count behind the turns
  // driven, which is what makes the run unpriceable rather than cheap.
  it('leaves the count short when a turn never reported', async () => {
    const one = capture()
    one.readUsage = () =>
      Promise.resolve({ inputTokens: 100, outputTokens: 10, totalTokens: 110 })
    await readTurnTokens(one)
    one.readUsage = () => Promise.reject(new Error('stream aborted'))
    await expect(readTurnTokens(one)).rejects.toThrow('stream aborted')

    expect(one.turnsPriced).toBe(1)
    expect(one.tokens).toEqual({ input: 100, output: 10 })
  })

  it('reports nothing at all when no turn reported', async () => {
    const one = capture()
    await readTurnTokens(one)

    expect(one.tokens).toBeUndefined()
    expect(one.turnsPriced).toBe(0)
  })
})

// THE BRIEFING SEAM, against the real classes. The patch is on both
// prototypes, so an instance of anything else would prove nothing about the
// instance the briefing route holds.
describe('installBriefingFixture', () => {
  const JUDGE_BUCKET = 'judge-fixture-briefings'
  const FIXTURE = {
    bucket: JUDGE_BUCKET,
    artifactContent: '{"judge":"fixture"}',
    today: '2026-05-14',
  }

  const cacheOver = (s3Reads: string[]): BriefingArtifactCacheService =>
    new BriefingArtifactCacheService(
      {
        getFile: async (bucket: string, key: string) => {
          s3Reads.push(`${bucket}/${key}`)
          return 's3 body'
        },
      } as unknown as S3Service,
      createMockLogger(),
    )

  // A context whose briefing lives in `bucket`. Everything else is the
  // prompt evals' fixture, which is enough for toContext to run for real.
  const handlerOver = (bucket: string): BriefingAnnotationHandler => {
    const loaded = {
      annotation: HENDERSONVILLE_FIXTURE.annotation,
      briefing: { ...HENDERSONVILLE_FIXTURE.briefing, artifactBucket: bucket },
      artifactContent: HENDERSONVILLE_FIXTURE.artifactContent,
      user: HENDERSONVILLE_FIXTURE.user,
      office: HENDERSONVILLE_FIXTURE.office,
    } as BriefingContextResult
    return new BriefingAnnotationHandler(
      {
        loadContext: async () => loaded,
        loadContextByConversation: async () => loaded,
      } as unknown as BriefingContextService,
      {
        countNotesForUser: async () => 0,
      } as unknown as BriefingNotesService,
    )
  }

  const realToday = todayInTimezone(
    HENDERSONVILLE_FIXTURE.briefing.meetingTimezone,
  )

  it('serves the fixture for its bucket without reaching S3', async () => {
    const s3Reads: string[] = []
    const cache = cacheOver(s3Reads)
    const seam = installBriefingFixture(FIXTURE)
    try {
      expect(
        await cache.get(JUDGE_BUCKET, 'judge-fixture/a/briefing.json'),
      ).toBe(FIXTURE.artifactContent)
      expect(s3Reads).toEqual([])
      // Any other bucket is still S3's, so a briefing nobody seeded is never
      // handed the judge's artifact.
      expect(await cache.get('briefing-artifacts', 'office/x.json')).toBe(
        's3 body',
      )
      expect(s3Reads).toEqual(['briefing-artifacts/office/x.json'])
    } finally {
      seam.restore()
    }
  })

  it('pins today on a judge briefing, through both context entries', async () => {
    // Unreachable as a test of the pin if the real date happened to equal it.
    expect(realToday).not.toBe(FIXTURE.today)
    const handler = handlerOver(JUDGE_BUCKET)
    const seam = installBriefingFixture(FIXTURE)
    try {
      expect((await handler.loadContext('conv', 42)).today).toBe(FIXTURE.today)
      expect((await handler.loadContextForAnnotation('ann', 42)).today).toBe(
        FIXTURE.today,
      )
    } finally {
      seam.restore()
    }
  })

  it('leaves the date of a briefing it did not seed alone', async () => {
    const handler = handlerOver('briefing-artifacts')
    const seam = installBriefingFixture(FIXTURE)
    try {
      expect((await handler.loadContext('conv', 42)).today).toBe(realToday)
    } finally {
      seam.restore()
    }
  })

  it('puts both prototypes back on restore', async () => {
    const s3Reads: string[] = []
    const cache = cacheOver(s3Reads)
    const handler = handlerOver(JUDGE_BUCKET)
    installBriefingFixture(FIXTURE).restore()

    expect(await cache.get(JUDGE_BUCKET, 'k')).toBe('s3 body')
    expect(s3Reads).toEqual([`${JUDGE_BUCKET}/k`])
    expect((await handler.loadContext('conv', 42)).today).toBe(realToday)
    expect((await handler.loadContextForAnnotation('ann', 42)).today).toBe(
      realToday,
    )
  })

  // Restore releases the claim, so the next case of the sweep can install.
  it('can be installed again once restored', () => {
    installBriefingFixture(FIXTURE).restore()
    let again: ReturnType<typeof installBriefingFixture> | undefined
    expect(() => {
      again = installBriefingFixture(FIXTURE)
    }).not.toThrow()
    again?.restore()
  })

  // Two overlapping installs would restore out of order and leave a patch on
  // the class for the life of the process.
  it('refuses a second install while one is in place', () => {
    const seam = installBriefingFixture(FIXTURE)
    try {
      expect(() => installBriefingFixture(FIXTURE)).toThrow('already installed')
    } finally {
      seam.restore()
    }
  })

  it('refuses outside a test process, and patches nothing', async () => {
    const vitestFlag = process.env.VITEST
    const nodeEnv = process.env.NODE_ENV
    delete process.env.VITEST
    process.env.NODE_ENV = 'production'
    try {
      expect(() => installBriefingFixture(FIXTURE)).toThrow(
        'may only run in a test process',
      )
    } finally {
      if (vitestFlag === undefined) delete process.env.VITEST
      else process.env.VITEST = vitestFlag
      if (nodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = nodeEnv
    }
    const s3Reads: string[] = []
    expect(await cacheOver(s3Reads).get(JUDGE_BUCKET, 'k')).toBe('s3 body')
    // Claimable, which it would not be if the refusal had recorded it.
    installBriefingFixture(FIXTURE).restore()
  })
})
