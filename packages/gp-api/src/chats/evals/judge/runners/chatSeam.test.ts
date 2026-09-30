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
import type {
  DatabricksProvider,
  DatabricksRowSet,
} from '@/llm/tools/queryDatabricks.tool'
import {
  UnpinnableSqlError,
  assertTestProcess,
  buildTrace,
  configDigest,
  installLlmCapture,
  instrumentDatabricksProvider,
  parseStreamEvents,
  pinDeltaVersion,
  readTurnTokens,
  type ChatTurnScript,
  traceErrorText,
  type StreamEvent,
  type ToolOutcome,
} from './chatSeam'

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
const withSpendEnabled = <T>(fn: () => T): T => {
  const previous = process.env.JUDGE_SPEND
  process.env.JUDGE_SPEND = '1'
  try {
    return fn()
  } finally {
    if (previous === undefined) delete process.env.JUDGE_SPEND
    else process.env.JUDGE_SPEND = previous
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
  const buildProvider = (): {
    provider: DatabricksProvider
    seen: string[]
  } => {
    const seen: string[] = []
    const provider: DatabricksProvider = {
      query: (sql: string): Promise<DatabricksRowSet> => {
        seen.push(sql)
        return Promise.resolve({ columns: [], rows: [] })
      },
    }
    return { provider, seen }
  }

  const sql = 'SELECT COUNT(*) AS count FROM serve_agent_voters'
  const pin = { version: '3237', tables: TABLES }

  it('rejects a bad pinned version before the turn starts', () => {
    const { provider } = buildProvider()
    expect(() =>
      instrumentDatabricksProvider(provider, { ...pin, version: 'latest' }),
    ).toThrow(UnpinnableSqlError)
  })

  it('rejects a pin with no table to apply it to', () => {
    const { provider } = buildProvider()
    expect(() =>
      instrumentDatabricksProvider(provider, { version: '3237', tables: [] }),
    ).toThrow(UnpinnableSqlError)
  })

  // A rejected install patched nothing, so it must not record the provider as
  // patched: one malformed case would otherwise kill every well-formed case
  // behind it in the sweep, with an error naming a concurrency bug that never
  // happened — sending the operator after the wrong thing entirely.
  it('leaves the provider claimable after a rejected install', async () => {
    const { provider, seen } = buildProvider()
    expect(() =>
      instrumentDatabricksProvider(provider, {
        version: 'latest',
        tables: TABLES,
      }),
    ).toThrow(UnpinnableSqlError)

    const instrumented = instrumentDatabricksProvider(provider, pin)
    await provider.query(sql)
    instrumented.restore()

    expect(instrumented.queries).toEqual([sql])
    expect(seen).toEqual([`${sql} VERSION AS OF 3237`])
  })

  it('records the agent SQL verbatim and runs the pinned form', async () => {
    const { provider, seen } = buildProvider()
    const instrumented = instrumentDatabricksProvider(provider, pin)

    await provider.query(sql)

    expect(instrumented.queries).toEqual([sql])
    expect(seen).toEqual([`${sql} VERSION AS OF 3237`])
  })

  it('runs the query unchanged when no version is pinned', async () => {
    const { provider, seen } = buildProvider()
    const instrumented = instrumentDatabricksProvider(provider)

    await provider.query(sql)

    expect(instrumented.queries).toEqual([sql])
    expect(seen).toEqual([sql])
  })

  it('stops recording once restored', async () => {
    const { provider, seen } = buildProvider()
    const instrumented = instrumentDatabricksProvider(provider, pin)
    instrumented.restore()

    await provider.query(sql)

    expect(instrumented.queries).toEqual([])
    expect(seen).toEqual([sql])
  })

  it('restores a provider that carries query on its prototype', async () => {
    // Every real provider is a class, so this is the branch production takes.
    const seen: string[] = []
    class FakeProvider implements DatabricksProvider {
      query(statement: string): Promise<DatabricksRowSet> {
        seen.push(statement)
        return Promise.resolve({ columns: [], rows: [] })
      }
    }
    const provider = new FakeProvider()
    const instrumented = instrumentDatabricksProvider(provider, pin)
    instrumented.restore()

    await provider.query(sql)

    expect(instrumented.queries).toEqual([])
    expect(seen).toEqual([sql])
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
