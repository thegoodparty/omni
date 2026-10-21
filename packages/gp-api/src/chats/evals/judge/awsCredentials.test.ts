import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ARM_AWS_ENV, judgeAwsClientConfig } from './awsCredentials'

const PASSED = {
  [ARM_AWS_ENV.accessKeyId]: 'ASIAREALKEY',
  [ARM_AWS_ENV.secretAccessKey]: 'real-secret',
  [ARM_AWS_ENV.sessionToken]: 'real-token',
}

describe('judgeAwsClientConfig', () => {
  it('hands the clients all three passed credentials', () => {
    expect(judgeAwsClientConfig(PASSED)).toEqual({
      credentials: {
        accessKeyId: 'ASIAREALKEY',
        secretAccessKey: 'real-secret',
        sessionToken: 'real-token',
      },
    })
  })

  // What the arm actually sees: `.env.test` has already put its stubs under
  // the SDK's own names, and those must not be what the clients sign with.
  it('ignores the stubs under the names the SDK reads', () => {
    expect(
      judgeAwsClientConfig({
        [ARM_AWS_ENV.accessKeyId]: 'ASIAREALKEY',
        [ARM_AWS_ENV.secretAccessKey]: 'real-secret',
        AWS_ACCESS_KEY_ID: 'super-secret-id',
        AWS_SECRET_ACCESS_KEY: 'super-secret-key',
        AWS_SESSION_TOKEN: 'stale-shell-token',
      }),
    ).toEqual({
      credentials: {
        accessKeyId: 'ASIAREALKEY',
        secretAccessKey: 'real-secret',
      },
    })
  })

  // Literal names, not the constant: a test built from ARM_AWS_ENV moves with
  // it, so a swapped pair would read the real secret as the key id unseen.
  it('reads exactly the three JUDGE_ names, each into its own field', () => {
    expect(
      judgeAwsClientConfig({
        JUDGE_AWS_ACCESS_KEY_ID: 'ASIAREALKEY',
        JUDGE_AWS_SECRET_ACCESS_KEY: 'real-secret',
        JUDGE_AWS_SESSION_TOKEN: 'real-token',
      }),
    ).toEqual({
      credentials: {
        accessKeyId: 'ASIAREALKEY',
        secretAccessKey: 'real-secret',
        sessionToken: 'real-token',
      },
    })
  })

  // The original failure's shape: a real token with nothing to sign beside it.
  it('refuses a session token with no key pair', () => {
    expect(() =>
      judgeAwsClientConfig({ [ARM_AWS_ENV.sessionToken]: 'real-token' }),
    ).toThrow(/must be passed together/)
  })

  it('leaves out a session token that was not passed', () => {
    const { [ARM_AWS_ENV.sessionToken]: _token, ...keys } = PASSED
    expect(judgeAwsClientConfig(keys).credentials).not.toHaveProperty(
      'sessionToken',
    )
  })

  // A credentials step that failed exports nothing, and a workflow
  // expression over an unset variable is the empty string.
  it.each([
    {},
    {
      [ARM_AWS_ENV.accessKeyId]: '',
      [ARM_AWS_ENV.secretAccessKey]: '',
      [ARM_AWS_ENV.sessionToken]: '',
    },
  ])('defers to the SDK chain when nothing is passed (%#)', (env) => {
    expect(judgeAwsClientConfig(env)).toEqual({})
  })

  it.each([[ARM_AWS_ENV.accessKeyId], [ARM_AWS_ENV.secretAccessKey]])(
    'refuses half a key pair, missing %s',
    (missing) => {
      expect(() => judgeAwsClientConfig({ ...PASSED, [missing]: '' })).toThrow(
        /must be passed together/,
      )
    },
  )
})

// Every client makes the bare call, so the default has to be the real one.
describe('the bare call the clients make', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('reads process.env', () => {
    vi.stubEnv(ARM_AWS_ENV.accessKeyId, 'ASIAREALKEY')
    vi.stubEnv(ARM_AWS_ENV.secretAccessKey, 'real-secret')
    vi.stubEnv(ARM_AWS_ENV.sessionToken, 'real-token')
    expect(judgeAwsClientConfig().credentials?.accessKeyId).toBe('ASIAREALKEY')
  })
})

// The fix only holds while `.env.test` leaves these names alone: if it ever
// defined one, vitest would stub it exactly as it stubs the SDK's own.
describe('the names the credentials travel under', () => {
  const envTest = readFileSync(
    path.resolve(__dirname, '../../../../.env.test'),
    'utf8',
  )

  it.each(Object.values(ARM_AWS_ENV))('%s is not in .env.test', (name) => {
    expect(envTest).not.toMatch(new RegExp(`^${name}=`, 'm'))
  })

  it('the SDK names they stand in for are', () => {
    expect(envTest).toMatch(/^AWS_ACCESS_KEY_ID=/m)
  })
})
