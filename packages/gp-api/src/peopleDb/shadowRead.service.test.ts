import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShadowReadService } from './shadowRead.service'

const ENV_KEYS = [
  'PEOPLE_DB_DUAL_READ',
  'PEOPLE_DATABRICKS_WAREHOUSE_ID',
  'PEOPLE_DATABRICKS_API_KEY',
] as const

const configure = (): void => {
  process.env.PEOPLE_DB_DUAL_READ = 'true'
  process.env.PEOPLE_DATABRICKS_WAREHOUSE_ID = 'abc123'
  process.env.PEOPLE_DATABRICKS_API_KEY = 'token'
}

describe('ShadowReadService', () => {
  let service: ShadowReadService
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
    for (const k of ENV_KEYS) delete process.env[k]
    service = new ShadowReadService(
      { setContext: vi.fn(), info: vi.fn(), log: vi.fn() } as never,
      {} as never,
    )
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  // authoritative = Databricks, comparison = Postgres
  const call = (
    authoritative: () => Promise<string>,
    comparison: () => Promise<string>,
  ) =>
    service.compare({
      op: 'count',
      districtId: 'd1',
      authoritative,
      comparison,
      fingerprintAuthoritative: (v: string) => v,
      fingerprintComparison: (v: string) => v,
    })

  it('is disabled without the flag', () => {
    expect(service.enabled).toBe(false)
  })

  it('stays disabled when the flag is on but no credential resolves', () => {
    process.env.PEOPLE_DB_DUAL_READ = 'true'
    expect(service.enabled).toBe(false)
  })

  it('is enabled only with both the flag and a credential', () => {
    configure()
    expect(service.enabled).toBe(true)
  })

  it('returns the databricks value, not the postgres one', async () => {
    configure()
    const result = await call(
      () => Promise.resolve('dbx'),
      () => Promise.resolve('pg'),
    )
    expect(result).toBe('dbx')
  })

  it('a rejecting postgres comparison cannot fail the request', async () => {
    configure()
    const result = await call(
      () => Promise.resolve('dbx'),
      () => Promise.reject(new Error('statement timeout')),
    )
    expect(result).toBe('dbx')
  })

  it('a hanging postgres comparison cannot delay the response', async () => {
    configure()
    let settle: (v: string) => void = () => undefined
    const started = performance.now()
    const result = await call(
      () => Promise.resolve('dbx'),
      () => new Promise<string>((resolve) => (settle = resolve)),
    )
    // Resolved while the comparison is still outstanding, which is the point.
    expect(result).toBe('dbx')
    expect(performance.now() - started).toBeLessThan(500)
    settle('late')
  })

  it('propagates a databricks failure as the original error', async () => {
    configure()
    // Databricks is authoritative, so its failure is the request's failure —
    // deliberately NOT masked by falling back to Postgres.
    const boom = new Error('warehouse unreachable')
    await expect(
      call(
        () => Promise.reject(boom),
        () => Promise.resolve('pg'),
      ),
    ).rejects.toBe(boom)
  })

  it('still runs the comparison when databricks fails', async () => {
    configure()
    const comparison = vi.fn().mockResolvedValue('pg')
    await expect(
      call(() => Promise.reject(new Error('nope')), comparison),
    ).rejects.toThrow('nope')
    expect(comparison).toHaveBeenCalledTimes(1)
  })
})
