import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShadowReadService } from './shadowRead.service'

const ENV_KEYS = [
  'PEOPLE_DB_SHADOW_READ',
  'PEOPLE_DATABRICKS_SERVER_HOSTNAME',
  'PEOPLE_DATABRICKS_HTTP_PATH',
  'PEOPLE_DATABRICKS_API_KEY',
] as const

const configure = (): void => {
  process.env.PEOPLE_DB_SHADOW_READ = 'true'
  process.env.PEOPLE_DATABRICKS_SERVER_HOSTNAME = 'example.databricks.com'
  process.env.PEOPLE_DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/abc123'
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

  const call = (
    primary: () => Promise<string>,
    shadow: () => Promise<string>,
  ) =>
    service.compare({
      op: 'count',
      districtId: 'd1',
      primary,
      shadow,
      fingerprintPrimary: (v) => v,
      fingerprintShadow: (v) => v,
    })

  it('does not run the shadow read when disabled', async () => {
    const shadow = vi.fn()
    expect(await call(() => Promise.resolve('pg'), shadow)).toBe('pg')
    expect(shadow).not.toHaveBeenCalled()
  })

  it('stays disabled when the flag is on but no credential resolves', async () => {
    process.env.PEOPLE_DB_SHADOW_READ = 'true'
    const shadow = vi.fn()
    expect(service.enabled).toBe(false)
    await call(() => Promise.resolve('pg'), shadow)
    expect(shadow).not.toHaveBeenCalled()
  })

  it('returns the postgres value, never the shadow value', async () => {
    configure()
    const result = await call(
      () => Promise.resolve('pg'),
      () => Promise.resolve('dbx'),
    )
    expect(result).toBe('pg')
  })

  it('a rejecting shadow read cannot fail the request', async () => {
    configure()
    const result = await call(
      () => Promise.resolve('pg'),
      () => Promise.reject(new Error('warehouse unreachable')),
    )
    expect(result).toBe('pg')
  })

  it('a hanging shadow read cannot delay the response', async () => {
    configure()
    let settle: (v: string) => void = () => undefined
    const started = performance.now()
    const result = await call(
      () => Promise.resolve('pg'),
      () => new Promise<string>((resolve) => (settle = resolve)),
    )
    // Resolved while the shadow is still outstanding, which is the whole point.
    expect(result).toBe('pg')
    expect(performance.now() - started).toBeLessThan(500)
    settle('late')
  })

  it('propagates the original postgres error untouched', async () => {
    configure()
    const boom = new Error('statement timeout')
    await expect(
      call(
        () => Promise.reject(boom),
        () => Promise.resolve('dbx'),
      ),
    ).rejects.toBe(boom)
  })

  it('starts the shadow read even when postgres fails', async () => {
    configure()
    const shadow = vi.fn().mockResolvedValue('dbx')
    await expect(
      call(() => Promise.reject(new Error('nope')), shadow),
    ).rejects.toThrow('nope')
    expect(shadow).toHaveBeenCalledTimes(1)
  })
})
