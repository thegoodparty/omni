import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import { mockClient } from 'aws-sdk-client-mock'
import { afterEach, describe, expect, it } from 'vitest'
import { installBraveKey } from './braveKey'

const secrets = mockClient(SecretsManagerClient)

afterEach(() => {
  secrets.reset()
})

// A blob shaped like GP_API_DEV: a flat object of string keys, of which this
// reads exactly one.
const blob = (extra: Record<string, string> = {}) =>
  JSON.stringify({
    DB_PASSWORD: 'unused',
    BRAVE_API_KEY: 'brave-dev',
    ...extra,
  })

describe('installBraveKey', () => {
  it('installs the key from the dev app secret on the name the tool reads', async () => {
    secrets.on(GetSecretValueCommand).resolves({ SecretString: blob() })
    const env: NodeJS.ProcessEnv = {}

    await expect(installBraveKey(env)).resolves.toBe(true)

    expect(env.BRAVE_API_KEY).toBe('brave-dev')
    expect(
      secrets.commandCalls(GetSecretValueCommand)[0]?.args[0].input,
    ).toEqual({ SecretId: 'GP_API_DEV' })
  })

  it('leaves a key that is already in the environment alone, with no read', async () => {
    const env: NodeJS.ProcessEnv = { BRAVE_API_KEY: 'from-the-shell' }

    await expect(installBraveKey(env)).resolves.toBe(true)

    expect(env.BRAVE_API_KEY).toBe('from-the-shell')
    expect(secrets.commandCalls(GetSecretValueCommand)).toHaveLength(0)
  })

  it.each([
    [
      'the secret has no BRAVE_API_KEY',
      { SecretString: JSON.stringify({ DB_PASSWORD: 'x' }) },
    ],
    ['the secret string is absent', {}],
    ['the blob is not JSON', { SecretString: 'not json' }],
  ])('reads %s as no key rather than throwing', async (_name, reply) => {
    secrets.on(GetSecretValueCommand).resolves(reply)
    const env: NodeJS.ProcessEnv = {}

    await expect(installBraveKey(env)).resolves.toBe(false)

    expect(env.BRAVE_API_KEY).toBeUndefined()
  })

  it('reads a refused or failed read as no key rather than throwing', async () => {
    secrets
      .on(GetSecretValueCommand)
      .rejects(new Error('AccessDeniedException'))
    const env: NodeJS.ProcessEnv = {}

    await expect(installBraveKey(env)).resolves.toBe(false)

    expect(env.BRAVE_API_KEY).toBeUndefined()
  })

  it('never returns the value, only whether it installed one', async () => {
    secrets.on(GetSecretValueCommand).resolves({ SecretString: blob() })
    const env: NodeJS.ProcessEnv = {}

    const installed = await installBraveKey(env)

    expect(installed).toBe(true)
    expect(JSON.stringify(installed)).not.toContain('brave-dev')
  })
})
