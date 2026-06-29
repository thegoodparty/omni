import { Injectable } from '@nestjs/common'
import { UsersService } from '../../users/services/users.service'
import { Experiment } from '@amplitude/experiment-node-server'
import { User } from '../../generated/prisma'
import { PinoLogger } from 'nestjs-pino'
import type { ExperimentVariants } from '@goodparty_org/contracts'

// User attributes sent to Amplitude for segment targeting. Mirrors the fields
// gp-webapp's buildUserTraits sends so server and client evaluations match.
// A type (not interface) so it stays assignable to fetchV2's index signature.
type ExperimentUserProperties = {
  email: string
  name?: string
  phone?: string
  zip?: string
}

const AMPLITUDE_PROJECT_API_KEY = process.env.AMPLITUDE_PROJECT_API_KEY
if (!AMPLITUDE_PROJECT_API_KEY) {
  throw new Error('AMPLITUDE_PROJECT_API_KEY is not set')
}

// The .env.example default. Local dev runs with this placeholder and no real
// Amplitude, so every remote flag evaluation 401s. We treat that as "local box"
// and default gated features ON so they stay developable; a real key fails
// closed instead (see isFeatureEnabled).
const PLACEHOLDER_API_KEY = 'some_key'
const usingPlaceholderKey = AMPLITUDE_PROJECT_API_KEY === PLACEHOLDER_API_KEY

const amplitude = Experiment.initializeRemote(AMPLITUDE_PROJECT_API_KEY)

@Injectable()
export class FeaturesService {
  constructor(
    private readonly usersService: UsersService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FeaturesService.name)
  }

  /**
   * Determines if the specified feature is enabled for the given user.
   *
   * If Amplitude can't be reached, degrades instead of throwing so a flag
   * outage never 500s a gated route: fail closed (off) with a real key, and
   * default on with the local placeholder key so gated features stay
   * developable on a dev box that has no real Amplitude.
   */
  async isFeatureEnabled(params: {
    user: number | User
    feature: string
  }): Promise<boolean> {
    const user =
      typeof params.user === 'number'
        ? await this.usersService.findUniqueOrThrow({
            where: { id: params.user },
          })
        : params.user

    try {
      const variants = await amplitude.fetchV2({
        user_id: user.id.toString(),
        user_properties: {
          email: user.email,
        },
      })

      const value = variants[params.feature]?.value === 'on'

      this.logger.info({
        userId: user.id,
        feature: params.feature,
        value,
        msg: 'Calculated feature toggle for user',
      })

      return value
    } catch (err) {
      this.logger.warn({
        err,
        userId: user.id,
        feature: params.feature,
        fallback: usingPlaceholderKey,
        msg: 'Amplitude flag evaluation failed; using fallback',
      })
      return usingPlaceholderKey
    }
  }

  /**
   * Resolves every flag for the user in a single evaluation, so gp-webapp can
   * seed its client SDK and render gated surfaces without the browser ever
   * reaching Amplitude (which ad blockers and some networks block). User
   * properties mirror gp-webapp's buildUserTraits so server and client
   * evaluations target the same segments.
   */
  async getAllVariants(user: User): Promise<ExperimentVariants> {
    try {
      const variants = await amplitude.fetchV2({
        user_id: user.id.toString(),
        user_properties: this.buildUserProperties(user),
      })

      return Object.fromEntries(
        Object.entries(variants).map(([flag, variant]) => [
          flag,
          { value: variant.value ?? variant.key, key: variant.key },
        ]),
      )
    } catch (err) {
      // Mirror isFeatureEnabled: an Amplitude outage must not 500 the seed
      // endpoint. Returning no variants lets the client fall back to its own
      // SDK evaluation rather than crashing the page that requested the seed.
      this.logger.warn({
        err,
        userId: user.id,
        msg: 'Amplitude fetchV2 failed in getAllVariants; returning empty variants',
      })
      return {}
    }
  }

  private buildUserProperties(user: User): ExperimentUserProperties {
    const properties: ExperimentUserProperties = { email: user.email }
    const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
    if (name) properties.name = name
    if (user.phone) properties.phone = user.phone
    if (user.zip) properties.zip = user.zip
    return properties
  }
}
