import { describe, expect, it, vi } from 'vitest'
import {
  DatabricksSqlProvider,
  type DbsqlClientLike,
  type DbsqlConnectOptions,
  type DbsqlOperationLike,
  type DbsqlSessionInstanceLike,
  type DbsqlSessionLike,
} from './databricksProvider'

const noop = (): undefined => undefined
const HOST = 'host.cloud.databricks.com'
const PATH = '/sql/1.0/warehouses/abc'
const SELECT_X = 'SELECT 1 AS x'
const SELECT_N = 'SELECT 1 AS n'

interface ExecuteCall {
  sql: string
  runAsync?: boolean
}

interface FakeOperationOptions {
  rows: unknown[]
  columns?: string[]
  schemaReturnsNull?: boolean
  noGetSchema?: boolean
}

const makeOperation = (opts: FakeOperationOptions): DbsqlOperationLike => {
  const op: DbsqlOperationLike = {
    fetchAll: vi.fn(async () => opts.rows),
    close: vi.fn(async () => noop()),
  }
  if (!opts.noGetSchema) {
    op.getSchema = vi.fn(async () => {
      if (opts.schemaReturnsNull) return null
      if (!opts.columns) return undefined
      return { columns: opts.columns.map((c) => ({ columnName: c })) }
    })
  }
  return op
}

interface FakeFactoryState {
  clientFactoryCalls: number
  connectCalls: number
  openSessionCalls: number
  clientCloseCalls: number
  sessionCloseCalls: number
  executeCalls: ExecuteCall[]
  lastOperations: DbsqlOperationLike[]
  failNextExecute?: Error
  responder: (sql: string) => DbsqlOperationLike
}

const makeFactory = (
  responder: (sql: string) => DbsqlOperationLike,
): { factory: () => DbsqlClientLike; state: FakeFactoryState } => {
  const state: FakeFactoryState = {
    clientFactoryCalls: 0,
    connectCalls: 0,
    openSessionCalls: 0,
    clientCloseCalls: 0,
    sessionCloseCalls: 0,
    executeCalls: [],
    lastOperations: [],
    responder,
  }

  const factory = (): DbsqlClientLike => {
    state.clientFactoryCalls++
    return {
      connect: async () => {
        state.connectCalls++
        const session: DbsqlSessionLike = {
          openSession: async () => {
            state.openSessionCalls++
            const sessionInstance: DbsqlSessionInstanceLike = {
              executeStatement: async (sql, opts) => {
                state.executeCalls.push({ sql, runAsync: opts?.runAsync })
                if (state.failNextExecute) {
                  const err = state.failNextExecute
                  state.failNextExecute = undefined
                  throw err
                }
                const op = state.responder(sql)
                state.lastOperations.push(op)
                return op
              },
              close: async () => {
                state.sessionCloseCalls++
              },
            }
            return sessionInstance
          },
          close: async () => {
            state.clientCloseCalls++
          },
        }
        return session
      },
    }
  }

  return { factory, state }
}

const baseOpts = {
  hostname: 'example.cloud.databricks.com',
  httpPath: '/sql/1.0/warehouses/xyz',
  accessToken: 'dapi-secret',
}

describe('DatabricksSqlProvider', () => {
  it('executes a SELECT and returns columns from schema metadata', async () => {
    const { factory, state } = makeFactory(() =>
      makeOperation({ rows: [{ n: 1 }], columns: ['n'] }),
    )
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      clientFactory: factory,
    })

    const result = await provider.query(SELECT_N)

    expect(result).toEqual({ columns: ['n'], rows: [{ n: 1 }] })
    expect(state.executeCalls).toEqual([{ sql: SELECT_N, runAsync: true }])
  })

  it('derives columns from the first row when getSchema returns null', async () => {
    const { factory } = makeFactory(() =>
      makeOperation({
        rows: [{ id: 7, label: 'x' }],
        schemaReturnsNull: true,
      }),
    )
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      clientFactory: factory,
    })

    const result = await provider.query('SELECT id, label FROM t')

    expect(result.columns).toEqual(['id', 'label'])
    expect(result.rows).toEqual([{ id: 7, label: 'x' }])
  })

  it('derives columns from the first row when getSchema is unavailable', async () => {
    const { factory } = makeFactory(() =>
      makeOperation({
        rows: [{ a: 'one', b: 'two' }],
        noGetSchema: true,
      }),
    )
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      clientFactory: factory,
    })

    const result = await provider.query('SELECT a, b FROM t')

    expect(result.columns).toEqual(['a', 'b'])
  })

  it('returns empty rowset without crashing on no results', async () => {
    const { factory } = makeFactory(() =>
      makeOperation({ rows: [], schemaReturnsNull: true }),
    )
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      clientFactory: factory,
    })

    const result = await provider.query('SELECT 1 WHERE 1 = 0')

    expect(result).toEqual({ columns: [], rows: [] })
  })

  it('opens the session lazily — no connect on construction', async () => {
    const { factory, state } = makeFactory(() =>
      makeOperation({ rows: [], schemaReturnsNull: true }),
    )

    new DatabricksSqlProvider({ ...baseOpts, clientFactory: factory })

    expect(state.clientFactoryCalls).toBe(0)
    expect(state.connectCalls).toBe(0)
    expect(state.openSessionCalls).toBe(0)
  })

  it('reuses the session across queries', async () => {
    const { factory, state } = makeFactory(() =>
      makeOperation({ rows: [{ x: 1 }], columns: ['x'] }),
    )
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      clientFactory: factory,
    })

    await provider.query(SELECT_X)
    await provider.query(SELECT_X)
    await provider.query(SELECT_X)

    expect(state.clientFactoryCalls).toBe(1)
    expect(state.connectCalls).toBe(1)
    expect(state.openSessionCalls).toBe(1)
    expect(state.executeCalls).toHaveLength(3)
  })

  it('self-heals within one query when USE CATALOG fails once', async () => {
    const { factory, state } = makeFactory(() =>
      makeOperation({ rows: [{ x: 1 }], columns: ['x'] }),
    )
    state.failNextExecute = new Error('catalog unavailable')
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      catalog: 'goodparty_data_catalog',
      schema: 'dbt',
      clientFactory: factory,
    })

    const result = await provider.query(SELECT_X)

    expect(result).toEqual({ columns: ['x'], rows: [{ x: 1 }] })
    expect(state.executeCalls.map((c) => c.sql)).toEqual([
      'USE CATALOG goodparty_data_catalog',
      'USE CATALOG goodparty_data_catalog',
      'USE SCHEMA dbt',
      SELECT_X,
    ])
    expect(state.openSessionCalls).toBe(2)
  })

  it('applies catalog and schema on first query, not on subsequent', async () => {
    const { factory, state } = makeFactory(() =>
      makeOperation({ rows: [{ x: 1 }], columns: ['x'] }),
    )
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      catalog: 'goodparty_data_catalog',
      schema: 'dbt',
      clientFactory: factory,
    })

    await provider.query(SELECT_X)
    await provider.query('SELECT 2 AS x')

    expect(state.executeCalls.map((c) => c.sql)).toEqual([
      'USE CATALOG goodparty_data_catalog',
      'USE SCHEMA dbt',
      SELECT_X,
      'SELECT 2 AS x',
    ])
  })

  it('close() closes operation, session, and client; is idempotent', async () => {
    const { factory, state } = makeFactory(() =>
      makeOperation({ rows: [{ x: 1 }], columns: ['x'] }),
    )
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      clientFactory: factory,
    })

    await provider.query(SELECT_X)
    const op = state.lastOperations[state.lastOperations.length - 1]

    await provider.close()
    await provider.close()

    expect(op?.close).toHaveBeenCalledTimes(1)
    expect(state.sessionCloseCalls).toBe(1)
    expect(state.clientCloseCalls).toBe(1)
  })

  it('close() is safe when called without any prior query', async () => {
    const { factory, state } = makeFactory(() =>
      makeOperation({ rows: [], schemaReturnsNull: true }),
    )
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      clientFactory: factory,
    })

    await expect(provider.close()).resolves.toBeUndefined()
    expect(state.clientCloseCalls).toBe(0)
    expect(state.sessionCloseCalls).toBe(0)
  })

  it('reconnects and retries once when a cached session goes bad', async () => {
    const { factory, state } = makeFactory(() =>
      makeOperation({ rows: [{ x: 1 }], columns: ['x'] }),
    )
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      clientFactory: factory,
    })

    await provider.query(SELECT_X)

    state.failNextExecute = new Error(
      'THTTPException: Received a response with a bad HTTP status code: 400',
    )
    const result = await provider.query(SELECT_X)

    expect(result).toEqual({ columns: ['x'], rows: [{ x: 1 }] })
    expect(state.connectCalls).toBe(2)
    expect(state.openSessionCalls).toBe(2)
    expect(state.sessionCloseCalls).toBe(1)
    expect(state.clientCloseCalls).toBe(1)
  })

  it('propagates the error when the retry also fails, then recovers', async () => {
    const boom = new Error('boom')
    const { factory, state } = makeFactory(() =>
      makeOperation({ rows: [{ x: 1 }], columns: ['x'] }),
    )
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      clientFactory: factory,
    })
    const healthyResponder = state.responder

    state.responder = () => {
      throw boom
    }
    await expect(provider.query(SELECT_X)).rejects.toBe(boom)
    expect(state.connectCalls).toBe(2)

    state.responder = healthyResponder
    const result = await provider.query(SELECT_X)

    expect(result).toEqual({ columns: ['x'], rows: [{ x: 1 }] })
    expect(state.connectCalls).toBe(3)
  })

  it('times out a hung query and recovers on a fresh session', async () => {
    let hang = true
    const hungOpClose = vi.fn(async () => noop())
    const { factory, state } = makeFactory(() =>
      hang
        ? {
            fetchAll: () => new Promise<unknown[]>(() => undefined),
            close: hungOpClose,
          }
        : makeOperation({ rows: [{ x: 1 }], columns: ['x'] }),
    )
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      queryTimeoutMs: 25,
      clientFactory: factory,
    })

    await expect(provider.query(SELECT_X)).rejects.toThrow(
      /timed out after 25ms/,
    )
    expect(state.sessionCloseCalls).toBe(1)
    // The hung operation's finally can never run — the deadline path must
    // close the handle itself or it leaks on the warehouse.
    expect(hungOpClose).toHaveBeenCalledTimes(1)

    hang = false
    const result = await provider.query(SELECT_X)

    expect(result).toEqual({ columns: ['x'], rows: [{ x: 1 }] })
    expect(state.connectCalls).toBe(2)
  })

  it('holds the deadline even when closing the dead session hangs', async () => {
    const { factory, state } = makeFactory(() => ({
      fetchAll: () => new Promise<unknown[]>(() => undefined),
      close: async () => noop(),
    }))
    const hangingFactory = (): DbsqlClientLike => {
      const client = factory()
      return {
        connect: async (opts) => {
          const conn = await client.connect(opts)
          return {
            openSession: async () => {
              const session = await conn.openSession()
              return {
                executeStatement: session.executeStatement,
                close: () => new Promise<void>(() => undefined),
              }
            },
            close: () => new Promise<void>(() => undefined),
          }
        },
      }
    }
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      queryTimeoutMs: 25,
      clientFactory: hangingFactory,
    })

    await expect(provider.query(SELECT_X)).rejects.toThrow(
      /timed out after 25ms/,
    )
    expect(state.executeCalls).toHaveLength(1)
  })

  it('concurrent failures on one dead session share a single reconnect', async () => {
    const boom = new Error('dead session')
    const tick = (): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, 0))
    let gateConnects = false
    let releaseConnGate = (): void => undefined
    const connGate = new Promise<void>((resolve) => {
      releaseConnGate = resolve
    })
    let releaseFailGate = (): void => undefined
    const failGate = new Promise<void>((resolve) => {
      releaseFailGate = resolve
    })
    let execCount = 0
    let connectCalls = 0
    const factory = (): DbsqlClientLike => ({
      connect: async () => {
        connectCalls++
        if (gateConnects) await connGate
        return {
          openSession: async () => ({
            executeStatement: async () => {
              execCount++
              // call 1: healthy warm-up. calls 2+3: the two concurrent
              // queries hitting the dead session — the second failure is
              // delayed until the first caller's reconnect is in flight.
              if (execCount === 2) throw boom
              if (execCount === 3) {
                await failGate
                throw boom
              }
              return makeOperation({ rows: [{ x: 1 }], columns: ['x'] })
            },
            close: async () => noop(),
          }),
          close: async () => noop(),
        }
      },
    })
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      clientFactory: factory,
    })

    await provider.query(SELECT_X)

    gateConnects = true
    const first = provider.query(SELECT_X)
    const second = provider.query(SELECT_X)
    await tick()
    releaseFailGate()
    await tick()
    releaseConnGate()

    const results = await Promise.all([first, second])

    expect(results[0]).toEqual({ columns: ['x'], rows: [{ x: 1 }] })
    expect(results[1]).toEqual({ columns: ['x'], rows: [{ x: 1 }] })
    // One shared reconnect — the second caller's reset must not tear down
    // the first caller's in-flight retry connection.
    expect(connectCalls).toBe(2)
  })

  it('times out a hung connect and tears down the late session', async () => {
    let releaseConnect = (): void => undefined
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve
    })
    let gated = true
    let sessionClosed = 0
    let connClosed = 0
    const factory = (): DbsqlClientLike => ({
      connect: async () => {
        if (gated) await connectGate
        return {
          openSession: async () => ({
            executeStatement: async () =>
              makeOperation({ rows: [{ n: 1 }], columns: ['n'] }),
            close: async () => {
              sessionClosed++
            },
          }),
          close: async () => {
            connClosed++
          },
        }
      },
    })
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      queryTimeoutMs: 20,
      clientFactory: factory,
    })

    await expect(provider.query(SELECT_N)).rejects.toThrow(
      /timed out after 20ms/,
    )

    gated = false
    releaseConnect()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The late-arriving session belongs to an abandoned attempt: torn down.
    expect(sessionClosed).toBe(1)
    expect(connClosed).toBe(1)

    const result = await provider.query(SELECT_N)
    expect(result).toEqual({ columns: ['n'], rows: [{ n: 1 }] })
    expect(sessionClosed).toBe(1)
  })

  it('passes BigInt row values through unchanged', async () => {
    const { factory } = makeFactory(() =>
      makeOperation({ rows: [{ n: 42n }], columns: ['n'] }),
    )
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      clientFactory: factory,
    })

    const result = await provider.query('SELECT 42 AS n')

    expect(result.columns).toEqual(['n'])
    expect(result.rows).toEqual([{ n: 42n }])
    expect(result.rows[0]?.n).toBe(42n)
  })

  it('passes null column values through unchanged', async () => {
    const { factory } = makeFactory(() =>
      makeOperation({
        rows: [{ name: null, count: 100n }],
        columns: ['name', 'count'],
      }),
    )
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      clientFactory: factory,
    })

    const result = await provider.query('SELECT name, count FROM t')

    expect(result.columns).toEqual(['name', 'count'])
    expect(result.rows).toEqual([{ name: null, count: 100n }])
  })

  it('rejects catalog values containing SQL metacharacters', () => {
    expect(
      () =>
        new DatabricksSqlProvider({
          ...baseOpts,
          catalog: 'foo;DROP TABLE x',
          clientFactory: () => ({ connect: async () => ({}) as never }),
        }),
    ).toThrow(/invalid catalog/)
  })

  it('rejects schema values containing SQL metacharacters', () => {
    expect(
      () =>
        new DatabricksSqlProvider({
          ...baseOpts,
          schema: 'a b',
          clientFactory: () => ({ connect: async () => ({}) as never }),
        }),
    ).toThrow(/invalid schema/)
  })

  it('rejects catalog values starting with a digit', () => {
    expect(
      () =>
        new DatabricksSqlProvider({
          ...baseOpts,
          catalog: '1bad',
          clientFactory: () => ({ connect: async () => ({}) as never }),
        }),
    ).toThrow(/invalid catalog/)
  })

  it('accepts valid identifier catalog and schema values', () => {
    const { factory } = makeFactory(() =>
      makeOperation({ rows: [], schemaReturnsNull: true }),
    )
    expect(
      () =>
        new DatabricksSqlProvider({
          ...baseOpts,
          catalog: 'goodparty_data_catalog',
          schema: 'dbt',
          clientFactory: factory,
        }),
    ).not.toThrow()
  })

  it('passes a PAT to the underlying client', async () => {
    const connectArgs: DbsqlConnectOptions[] = []
    const factory = (): DbsqlClientLike => ({
      connect: async (opts) => {
        connectArgs.push(opts)
        return {
          openSession: async () => ({
            executeStatement: async () =>
              makeOperation({ rows: [{ n: 1 }], columns: ['n'] }),
            close: async () => noop(),
          }),
          close: async () => noop(),
        }
      },
    })

    const provider = new DatabricksSqlProvider({
      hostname: HOST,
      httpPath: PATH,
      accessToken: 'dapi-token',
      clientFactory: factory,
    })

    await provider.query(SELECT_N)

    expect(connectArgs).toEqual([
      {
        host: HOST,
        path: PATH,
        token: 'dapi-token',
      },
    ])
  })

  it('uses OAuth M2M when client id + secret are set (over a PAT)', async () => {
    const connectArgs: DbsqlConnectOptions[] = []
    const factory = (): DbsqlClientLike => ({
      connect: async (opts) => {
        connectArgs.push(opts)
        return {
          openSession: async () => ({
            executeStatement: async () =>
              makeOperation({ rows: [{ n: 1 }], columns: ['n'] }),
            close: async () => noop(),
          }),
          close: async () => noop(),
        }
      },
    })

    const provider = new DatabricksSqlProvider({
      hostname: HOST,
      httpPath: PATH,
      accessToken: 'dapi-token',
      oauthClientId: 'client-id',
      oauthClientSecret: 'client-secret',
      clientFactory: factory,
    })

    await provider.query(SELECT_N)

    expect(connectArgs).toEqual([
      {
        host: HOST,
        path: PATH,
        authType: 'databricks-oauth',
        oauthClientId: 'client-id',
        oauthClientSecret: 'client-secret',
      },
    ])
  })

  it('throws on query when no credential is configured', async () => {
    const provider = new DatabricksSqlProvider({
      hostname: HOST,
      httpPath: PATH,
      clientFactory: () => ({ connect: async () => ({}) as never }),
    })

    await expect(provider.query(SELECT_N)).rejects.toThrow(/no credential/)
  })

  it('rejects queries after close with a clear "closed" error', async () => {
    const { factory } = makeFactory(() =>
      makeOperation({ rows: [{ n: 1 }], columns: ['n'] }),
    )
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      clientFactory: factory,
    })

    await provider.query(SELECT_N)
    await provider.close()

    await expect(provider.query(SELECT_N)).rejects.toThrow(/provider is closed/)
  })

  it('tears down a connection that finishes connecting after close', async () => {
    let releaseConnect = (): void => undefined
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve
    })
    let sessionClosed = 0
    let connClosed = 0
    const factory = (): DbsqlClientLike => ({
      connect: async () => {
        await connectGate
        return {
          openSession: async () => ({
            executeStatement: async () =>
              makeOperation({ rows: [{ n: 1 }], columns: ['n'] }),
            close: async () => {
              sessionClosed++
            },
          }),
          close: async () => {
            connClosed++
          },
        }
      },
    })
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      clientFactory: factory,
    })

    const queryPromise = provider.query(SELECT_N)
    await provider.close()
    releaseConnect()

    await expect(queryPromise).rejects.toThrow(/provider is closed/)
    // The late-arriving session + connection are torn down, not leaked.
    expect(sessionClosed).toBe(1)
    expect(connClosed).toBe(1)
  })
})
