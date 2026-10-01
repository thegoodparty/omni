import { AwsService } from '@/vendors/aws/services/aws.service'
import { getEnv } from '@/shared/util/env.util'
import {
  GetSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import {
  DEV_ENV_PACKAGE_VALUES,
  DevEnvBundleResponse,
  DevEnvPackage,
} from '@goodparty_org/contracts'
import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { DECLARED_ENV_VARS, isDevEnvPackage } from '../devEnv.manifest'

// LOCAL_DEV_ENV is a curated, dev-only blob keyed by package. Absent (or an
// absent LOCAL_DEV_ENV_SECRET_ID) the feature is dark, not fatal — the secret
// is an ops prerequisite that can lag the code.
const VENDING_UNAVAILABLE =
  'Local dev env vending is not configured in this environment.'

const { AWS_REGION: region = 'us-west-2' } = process.env

const SecretBlobSchema = z.record(z.string(), z.record(z.string(), z.string()))
type SecretBlob = z.infer<typeof SecretBlobSchema>

@Injectable()
export class DevEnvService extends AwsService {
  private readonly secrets: SecretsManagerClient

  constructor(protected readonly logger: PinoLogger) {
    super(logger)
    this.secrets = new SecretsManagerClient({ region })
  }

  async getBundles(
    packages: DevEnvPackage[] | undefined,
    githubLogin: string | undefined,
  ): Promise<DevEnvBundleResponse> {
    const requested = packages ?? [...DEV_ENV_PACKAGE_VALUES]
    const blob = await this.loadSecretBlob()

    // Audit trail for the whole abuse posture (there is no rate limit):
    // who fetched, when, and for which packages. Never the values.
    this.logger.info(
      { githubLogin, packages: requested },
      'Vended local dev env bundle',
    )

    return {
      bundles: requested.map((name) => ({
        package: name,
        variables: blob[name] ?? {},
      })),
    }
  }

  private async loadSecretBlob(): Promise<SecretBlob> {
    const secretId = getEnv('LOCAL_DEV_ENV_SECRET_ID')
    if (!secretId) {
      throw new ServiceUnavailableException(VENDING_UNAVAILABLE)
    }

    const { SecretString } = await this.executeAwsOperation(async () => {
      try {
        return await this.secrets.send(
          new GetSecretValueCommand({ SecretId: secretId }),
        )
      } catch (err) {
        if (err instanceof ResourceNotFoundException) {
          this.logger.error({ err }, 'LOCAL_DEV_ENV secret does not exist')
          throw new ServiceUnavailableException(VENDING_UNAVAILABLE)
        }
        throw err
      }
    }, 'local dev env secret fetch')

    if (!SecretString) {
      throw new ServiceUnavailableException(VENDING_UNAVAILABLE)
    }

    return this.parseSecretBlob(SecretString)
  }

  // Fails the whole fetch on anything the blob holds that the env contracts
  // do not declare, rather than vending it. A key nothing reads is either a
  // typo in the secret or a variable a package dropped, and silently handing
  // it to a laptop turns both into a confusing local boot hours later.
  private parseSecretBlob(secretString: string): SecretBlob {
    let parsed: ReturnType<typeof SecretBlobSchema.safeParse>
    try {
      parsed = SecretBlobSchema.safeParse(JSON.parse(secretString))
    } catch (err) {
      this.logger.error({ err }, 'LOCAL_DEV_ENV secret is not valid JSON')
      throw new InternalServerErrorException(
        'The local dev env secret is malformed.',
      )
    }

    if (!parsed.success) {
      this.logger.error(
        { err: parsed.error },
        'LOCAL_DEV_ENV secret is not a package-keyed map of strings',
      )
      throw new InternalServerErrorException(
        'The local dev env secret is malformed.',
      )
    }

    const undeclared: string[] = []
    for (const [name, variables] of Object.entries(parsed.data)) {
      if (!isDevEnvPackage(name)) {
        undeclared.push(name)
        continue
      }
      const declared = DECLARED_ENV_VARS[name]
      undeclared.push(
        ...Object.keys(variables)
          .filter((key) => !declared.has(key))
          .map((key) => `${name}.${key}`),
      )
    }

    if (undeclared.length > 0) {
      this.logger.error(
        { undeclared },
        'LOCAL_DEV_ENV holds keys no env contract declares',
      )
      throw new InternalServerErrorException(
        `The local dev env secret holds keys no env contract declares: ${undeclared.join(', ')}`,
      )
    }

    return parsed.data
  }
}
