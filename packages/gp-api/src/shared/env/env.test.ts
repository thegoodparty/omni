import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveEnvVar } from './env'

describe('resolveEnvVar', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reports a var with no documented placeholder as unconfigured when unset', () => {
    vi.stubEnv('VERCEL_TOKEN', '')
    expect(resolveEnvVar('VERCEL_TOKEN')).toEqual({ configured: false })
  })

  it('reports a var with no documented placeholder as configured when set', () => {
    vi.stubEnv('VERCEL_TOKEN', 'a-real-token')
    expect(resolveEnvVar('VERCEL_TOKEN')).toEqual({
      configured: true,
      value: 'a-real-token',
    })
  })

  it('reports a var with a documented placeholder as unconfigured when unset', () => {
    vi.stubEnv('AMPLITUDE_PROJECT_API_KEY', '')
    expect(resolveEnvVar('AMPLITUDE_PROJECT_API_KEY')).toEqual({
      configured: false,
    })
  })

  it('reports a var with a documented placeholder as unconfigured when left at the placeholder', () => {
    vi.stubEnv('AMPLITUDE_PROJECT_API_KEY', 'some_key')
    expect(resolveEnvVar('AMPLITUDE_PROJECT_API_KEY')).toEqual({
      configured: false,
    })
  })

  it('reports a var with a documented placeholder as configured with a real value', () => {
    vi.stubEnv('AMPLITUDE_PROJECT_API_KEY', 'real-project-key')
    expect(resolveEnvVar('AMPLITUDE_PROJECT_API_KEY')).toEqual({
      configured: true,
      value: 'real-project-key',
    })
  })

  it('throws for a name not declared in ENV_VAR_CONTRACT', () => {
    expect(() => resolveEnvVar('NOT_A_REAL_ENV_VAR')).toThrow(
      'NOT_A_REAL_ENV_VAR is not declared in ENV_VAR_CONTRACT',
    )
  })
})
