import {
  GetSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import {
  BadGatewayException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ServiceException } from '@smithy/smithy-client'
import { mockClient } from 'aws-sdk-client-mock'
import { PinoLogger } from 'nestjs-pino'
import { createMockLogger } from 'src/shared/test-utils/mockLogger.util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevEnvService } from './devEnv.service'

const SECRET_ID = 'LOCAL_DEV_ENV'

// Not a real credential — a shaped stand-in so the leak assertions read true.
const CLERK_DEV_VALUE = 'sk_test_devenvservicetest'

const wellFormedBlob = {
  'gp-api': {
    CLERK_SECRET_KEY: CLERK_DEV_VALUE,
    OTEL_SERVICE_ENVIRONMENT: 'dev',
  },
  'gp-webapp': {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_devenvservicetest',
  },
  mcp: {
    GRAFANA_SERVICE_ACCOUNT_TOKEN: 'glsa_devenvservicetest',
  },
}

const secretsMock = mockClient(SecretsManagerClient)

// Everything a logger was handed this test, so "no secret was logged" can be
// asserted against the whole audit path rather than one call.
const loggedJson = (logger: PinoLogger) =>
  JSON.stringify(
    [logger.info, logger.error, logger.debug].map(
      (fn) => vi.mocked(fn).mock.calls,
    ),
  )

describe('DevEnvService', () => {
  let service: DevEnvService
  let logger: PinoLogger

  const givenSecret = (secretString: string) =>
    secretsMock
      .on(GetSecretValueCommand)
      .resolves({ SecretString: secretString })

  beforeEach(() => {
    process.env.LOCAL_DEV_ENV_SECRET_ID = SECRET_ID
    secretsMock.reset()
    logger = createMockLogger()
    service = new DevEnvService(logger)
  })

  afterEach(() => {
    delete process.env.LOCAL_DEV_ENV_SECRET_ID
  })

  it('returns a bundle per package from a well-formed blob', async () => {
    givenSecret(JSON.stringify(wellFormedBlob))

    await expect(service.getBundles(undefined, 'octocat')).resolves.toEqual({
      bundles: [
        { package: 'gp-api', variables: wellFormedBlob['gp-api'] },
        { package: 'gp-webapp', variables: wellFormedBlob['gp-webapp'] },
        { package: 'mcp', variables: wellFormedBlob.mcp },
      ],
    })
  })

  it('vends an empty bundle for a package the blob has no entry for yet', async () => {
    givenSecret(JSON.stringify({ 'gp-api': wellFormedBlob['gp-api'] }))

    await expect(service.getBundles(['mcp'], 'octocat')).resolves.toEqual({
      bundles: [{ package: 'mcp', variables: {} }],
    })
  })

  it('reads the secret named by LOCAL_DEV_ENV_SECRET_ID', async () => {
    givenSecret(JSON.stringify(wellFormedBlob))

    await service.getBundles(['gp-api'], 'octocat')

    expect(
      secretsMock.commandCalls(GetSecretValueCommand)[0]?.args[0].input,
    ).toEqual({ SecretId: SECRET_ID })
  })

  it('returns only the packages the caller asked for', async () => {
    givenSecret(JSON.stringify(wellFormedBlob))

    await expect(service.getBundles(['gp-webapp'], 'octocat')).resolves.toEqual(
      {
        bundles: [
          { package: 'gp-webapp', variables: wellFormedBlob['gp-webapp'] },
        ],
      },
    )
  })

  it('audits the fetch by login without logging any value', async () => {
    givenSecret(JSON.stringify(wellFormedBlob))

    await service.getBundles(undefined, 'octocat')

    expect(logger.info).toHaveBeenCalledWith(
      {
        githubLogin: 'octocat',
        packages: ['gp-api', 'gp-webapp', 'mcp'],
      },
      'Vended local dev env bundle',
    )
    expect(loggedJson(logger)).not.toContain(CLERK_DEV_VALUE)
  })

  it('fails loudly on a key no env contract declares', async () => {
    givenSecret(
      JSON.stringify({ 'gp-api': { CLERK_SECRET_KEYY: CLERK_DEV_VALUE } }),
    )

    await expect(service.getBundles(undefined, 'octocat')).rejects.toThrow(
      /gp-api\.CLERK_SECRET_KEYY/,
    )
  })

  it('fails loudly on an mcp key the Grafana launcher does not read', async () => {
    givenSecret(JSON.stringify({ mcp: { GRAFANA_API_KEY: 'glsa_x' } }))

    await expect(service.getBundles(undefined, 'octocat')).rejects.toThrow(
      /mcp\.GRAFANA_API_KEY/,
    )
  })

  it('fails loudly on a package the bundle contract does not know', async () => {
    givenSecret(JSON.stringify({ 'gp-elections': { FOO: 'bar' } }))

    await expect(service.getBundles(undefined, 'octocat')).rejects.toThrow(
      InternalServerErrorException,
    )
  })

  it('vends nothing from a blob that failed the manifest check', async () => {
    givenSecret(
      JSON.stringify({
        'gp-api': { CLERK_SECRET_KEY: CLERK_DEV_VALUE, NOT_A_VAR: 'x' },
      }),
    )

    await expect(service.getBundles(undefined, 'octocat')).rejects.toThrow(
      InternalServerErrorException,
    )
    expect(logger.info).not.toHaveBeenCalled()
    expect(loggedJson(logger)).not.toContain(CLERK_DEV_VALUE)
  })

  it('fails loudly when the blob is not JSON', async () => {
    givenSecret('not json at all')

    await expect(service.getBundles(undefined, 'octocat')).rejects.toThrow(
      InternalServerErrorException,
    )
  })

  it('fails loudly when the blob is not a package-keyed map of strings', async () => {
    givenSecret(JSON.stringify({ 'gp-api': 'CLERK_SECRET_KEY=x' }))

    await expect(service.getBundles(undefined, 'octocat')).rejects.toThrow(
      InternalServerErrorException,
    )
  })

  it('reports vending unavailable when the secret id is unset', async () => {
    delete process.env.LOCAL_DEV_ENV_SECRET_ID

    await expect(service.getBundles(undefined, 'octocat')).rejects.toThrow(
      ServiceUnavailableException,
    )
    expect(secretsMock.commandCalls(GetSecretValueCommand)).toHaveLength(0)
  })

  it('reports vending unavailable when the secret does not exist yet', async () => {
    secretsMock.on(GetSecretValueCommand).rejects(
      new ResourceNotFoundException({
        message: "Secrets Manager can't find the specified secret.",
        $metadata: {},
      }),
    )

    await expect(service.getBundles(undefined, 'octocat')).rejects.toThrow(
      ServiceUnavailableException,
    )
  })

  it('502s when Secrets Manager itself is failing', async () => {
    secretsMock.on(GetSecretValueCommand).rejects(
      new ServiceException({
        name: 'InternalServiceError',
        $fault: 'server',
        $metadata: {},
      }),
    )

    await expect(service.getBundles(undefined, 'octocat')).rejects.toThrow(
      BadGatewayException,
    )
  })

  it('reports vending unavailable when the secret holds no string value', async () => {
    secretsMock
      .on(GetSecretValueCommand)
      .resolves({ SecretBinary: new Uint8Array([1, 2, 3]) })

    await expect(service.getBundles(undefined, 'octocat')).rejects.toThrow(
      ServiceUnavailableException,
    )
  })
})
