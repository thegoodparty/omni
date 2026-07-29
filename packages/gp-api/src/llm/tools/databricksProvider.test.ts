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
  logger: { warn: noop },
}

const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

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
    const firstBoom = new Error('first boom')
    const retryBoom = new Error('retry boom')
    const { factory, state } = makeFactory(() =>
      makeOperation({ rows: [{ x: 1 }], columns: ['x'] }),
    )
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      clientFactory: factory,
    })
    const healthyResponder = state.responder

    let attempts = 0
    state.responder = () => {
      attempts++
      throw attempts === 1 ? firstBoom : retryBoom
    }
    await expect(provider.query(SELECT_X)).rejects.toBe(retryBoom)
    expect(state.connectCalls).toBe(2)

    state.responder = healthyResponder
    const result = await provider.query(SELECT_X)

    expect(result).toEqual({ columns: ['x'], rows: [{ x: 1 }] })
    expect(state.connectCalls).toBe(3)
  })

  it('keeps the session when a statement fails after execution starts', async () => {
    const sqlError = new Error('TABLE_OR_VIEW_NOT_FOUND: bad_table')
    let failFetch = false
    const { factory, state } = makeFactory(() =>
      failFetch
        ? {
            fetchAll: vi.fn(async () => {
              throw sqlError
            }),
            close: vi.fn(async () => noop()),
          }
        : makeOperation({ rows: [{ x: 1 }], columns: ['x'] }),
    )
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      clientFactory: factory,
    })

    await provider.query(SELECT_X)

    failFetch = true
    await expect(provider.query('SELECT bad FROM t')).rejects.toBe(sqlError)

    failFetch = false
    const result = await provider.query(SELECT_X)

    expect(result).toEqual({ columns: ['x'], rows: [{ x: 1 }] })
    // A statement-level error must not tear down the shared session, must
    // not re-execute the failing SQL, and must not force a reconnect.
    expect(state.connectCalls).toBe(1)
    expect(state.sessionCloseCalls).toBe(0)
    expect(state.executeCalls).toHaveLength(3)
  })

  it('retries a statement aborted by a sibling reset of the session', async () => {
    // Models the real driver: closing a session rejects its in-flight
    // fetchAll with an operation-closed error.
    const abortError = new Error('The operation was closed')
    let execCount = 0
    let connectCalls = 0
    let abortInflight: (() => void) | undefined
    const factory = (): DbsqlClientLike => ({
      connect: async () => {
        connectCalls++
        return {
          openSession: async () => ({
            executeStatement: async () => {
              execCount++
              if (execCount === 2) {
                return {
                  fetchAll: () =>
                    new Promise<unknown[]>((_, reject) => {
                      abortInflight = () => reject(abortError)
                    }),
                  close: async () => noop(),
                }
              }
              if (execCount === 3) {
                throw new Error('THTTPException: bad HTTP status code: 400')
              }
              return makeOperation({ rows: [{ x: 1 }], columns: ['x'] })
            },
            close: async () => {
              abortInflight?.()
            },
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

    const slow = provider.query(SELECT_X)
    await tick()
    const failing = provider.query(SELECT_X)

    const results = await Promise.all([slow, failing])

    expect(results[0]).toEqual({ columns: ['x'], rows: [{ x: 1 }] })
    expect(results[1]).toEqual({ columns: ['x'], rows: [{ x: 1 }] })
    expect(connectCalls).toBe(2)
  })

  it('resets the session when the retry attempt times out', async () => {
    let execCount = 0
    const { factory, state } = makeFactory(() => {
      execCount++
      if (execCount === 1) {
        throw new Error('dead session')
      }
      if (execCount === 2) {
        return {
          fetchAll: () => new Promise<unknown[]>(() => undefined),
          close: vi.fn(async () => noop()),
        }
      }
      return makeOperation({ rows: [{ x: 1 }], columns: ['x'] })
    })
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      queryTimeoutMs: 25,
      clientFactory: factory,
    })

    await expect(provider.query(SELECT_X)).rejects.toThrow(
      /timed out after 25ms/,
    )

    const result = await provider.query(SELECT_X)

    expect(result).toEqual({ columns: ['x'], rows: [{ x: 1 }] })
    // The hung retry session must have been reset — recovery needs a third
    // connection, not a reuse of the wedged one.
    expect(state.connectCalls).toBe(3)
  })

  it('keeps a newer connect attempt when an older one fails late', async () => {
    const gates: Array<(err?: Error) => void> = []
    let connectCalls = 0
    const factory = (): DbsqlClientLike => ({
      connect: () => {
        connectCalls++
        return new Promise<DbsqlSessionLike>((resolve, reject) => {
          gates.push((err?: Error) =>
            err
              ? reject(err)
              : resolve({
                  openSession: async () => ({
                    executeStatement: async () =>
                      makeOperation({ rows: [{ n: 1 }], columns: ['n'] }),
                    close: async () => noop(),
                  }),
                  close: async () => noop(),
                }),
          )
        })
      },
    })
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      queryTimeoutMs: 20,
      clientFactory: factory,
    })

    await expect(provider.query(SELECT_N)).rejects.toThrow(/timed out/)

    const second = provider.query(SELECT_N)
    await tick()
    gates[0]?.(new Error('old connect failed late'))
    await tick()
    const third = provider.query(SELECT_N)
    await tick()
    gates[1]?.()

    expect(await second).toEqual({ columns: ['n'], rows: [{ n: 1 }] })
    expect(await third).toEqual({ columns: ['n'], rows: [{ n: 1 }] })
    // The old attempt's late failure must not evict the newer connect slot —
    // the third query shares the second's connection.
    expect(connectCalls).toBe(2)
  })

  it('reaps a wedged session setup when the deadline fires', async () => {
    let connClosed = 0
    let sessionClosed = 0
    const factory = (): DbsqlClientLike => ({
      connect: async () => ({
        openSession: async () => ({
          executeStatement: async () => ({
            fetchAll: () => new Promise<unknown[]>(() => undefined),
            close: async () => noop(),
          }),
          close: async () => {
            sessionClosed++
          },
        }),
        close: async () => {
          connClosed++
        },
      }),
    })
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      catalog: 'goodparty_data_catalog',
      queryTimeoutMs: 25,
      clientFactory: factory,
    })

    await expect(provider.query(SELECT_X)).rejects.toThrow(
      /timed out after 25ms/,
    )
    await tick()

    // The connection wedged inside USE CATALOG is torn down, not leaked as
    // a live socket with a forever-polling driver loop.
    expect(connClosed).toBe(1)
    expect(sessionClosed).toBe(1)
  })

  it('close() reaps a connect wedged in session setup', async () => {
    let connClosed = 0
    let sessionClosed = 0
    const factory = (): DbsqlClientLike => ({
      connect: async () => ({
        openSession: async () => ({
          executeStatement: async () => ({
            fetchAll: () => new Promise<unknown[]>(() => undefined),
            close: async () => noop(),
          }),
          close: async () => {
            sessionClosed++
          },
        }),
        close: async () => {
          connClosed++
        },
      }),
    })
    const provider = new DatabricksSqlProvider({
      ...baseOpts,
      catalog: 'goodparty_data_catalog',
      queryTimeoutMs: 500,
      clientFactory: factory,
    })

    const wedged = provider.query(SELECT_X)
    wedged.catch(noop)
    await tick()

    await provider.close()
    await tick()

    expect(connClosed).toBe(1)
    expect(sessionClosed).toBe(1)
  })

  it('recovers after the shared reconnect fails for concurrent callers', async () => {
    const connectError = new Error('connection refused')
    let execCount = 0
    let connectCalls = 0
    let gateConnects = false
    let releaseGate = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const factory = (): DbsqlClientLike => ({
      connect: async () => {
        connectCalls++
        if (gateConnects) {
          await gate
          throw connectError
        }
        return {
          openSession: async () => ({
            executeStatement: async () => {
              execCount++
              if (execCount === 2 || execCount === 3) {
                throw new Error('dead session')
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
    releaseGate()

    await expect(first).rejects.toBe(connectError)
    await expect(second).rejects.toBe(connectError)

    gateConnects = false
    const result = await provider.query(SELECT_X)

    expect(result).toEqual({ columns: ['x'], rows: [{ x: 1 }] })
    expect(connectCalls).toBe(3)
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
