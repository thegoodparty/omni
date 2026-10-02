import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
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
        ...PASSED,
        AWS_ACCESS_KEY_ID: 'super-secret-id',
        AWS_SECRET_ACCESS_KEY: 'super-secret-key',
      }).credentials?.accessKeyId,
    ).toBe('ASIAREALKEY')
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
