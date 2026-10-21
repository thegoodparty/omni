import { Injectable } from '@nestjs/common'
import { UsersService } from '../../users/services/users.service'
import { Experiment } from '@amplitude/experiment-node-server'
import { Organization, User } from '../../generated/prisma'
import { PinoLogger } from 'nestjs-pino'
import type { ExperimentVariants } from '@goodparty_org/contracts'
import { resolveEnvVar } from '../../shared/env/env'
import { ISSUE_CAPTURE_FLAG } from '../../constituentFeedback/util/issueCaptureFlag.util'

// Flags that roll out by organization, not by person: anyone acting in an
// org reads what its owner reads. Amplitude buckets by user id, so a
// percentage rollout evaluated per person would split a candidate from
// their own volunteers. Routes gated on one of these pass the org's owner
// to isFeatureEnabled themselves.
export const ORGANIZATION_FLAGS: ReadonlySet<string> = new Set([
  ISSUE_CAPTURE_FLAG,
])

// User attributes sent to Amplitude for segment targeting. Mirrors the fields
// gp-webapp's buildUserTraits sends so server and client evaluations match.
// A type (not interface) so it stays assignable to fetchV2's index signature.
type ExperimentUserProperties = {
  email: string
  name?: string
  phone?: string
  zip?: string
}

// The .env.example default (ENV_VAR_CONTRACT's documented placeholder). Local
// dev runs with this placeholder and no real Amplitude, so every remote flag
// evaluation 401s. We treat that as "local box" and default gated features ON
// so they stay developable; a real key fails closed instead (see
// isFeatureEnabled).
const amplitudeKey = resolveEnvVar('AMPLITUDE_PROJECT_API_KEY')

// Deferred to first real use rather than created at import time — it's only
// ever reached once amplitudeKey.configured is true (see the placeholder
// short-circuits below), so importing this module never talks to Amplitude.
let amplitudeClient: ReturnType<typeof Experiment.initializeRemote> | null =
  null
const getAmplitudeClient = () => {
  if (!amplitudeClient) {
    amplitudeClient = Experiment.initializeRemote(
      amplitudeKey.configured ? amplitudeKey.value : '',
    )
  }
  return amplitudeClient
}

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
   * The local placeholder key defaults every gated feature on without ever
   * calling Amplitude, so features stay developable on a dev box that has no
   * real key. With a real key, an unreachable Amplitude degrades instead of
   * throwing — fail closed (off) — so a flag outage never 500s a gated route.
   */
  async isFeatureEnabled(params: {
    user: number | User
    feature: string
  }): Promise<boolean> {
    // The placeholder key always 401s upstream — skip the doomed round-trip
    // (its retries cost real seconds per gated request, enough to push CI
    // tests into their timeout) and go straight to the local-box default.
    // Before the user lookup: the answer doesn't depend on the user, so the
    // DB read would be wasted too.
    if (!amplitudeKey.configured) {
      return true
    }

    const user =
      typeof params.user === 'number'
        ? await this.usersService.findUniqueOrThrow({
            where: { id: params.user },
          })
        : params.user

    try {
      const variants = await getAmplitudeClient().fetchV2({
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
      // Only reachable with a real key (placeholder short-circuits above):
      // fail closed so a flag outage never 500s a gated route.
      this.logger.warn({
        err,
        userId: user.id,
        feature: params.feature,
        msg: 'Amplitude flag evaluation failed; failing closed',
      })
      return false
    }
  }

  /**
   * Resolves every flag for the user in a single evaluation, so gp-webapp can
   * seed its client SDK and render gated surfaces without the browser ever
   * reaching Amplitude (which ad blockers and some networks block). User
   * properties mirror gp-webapp's buildUserTraits so server and client
   * evaluations target the same segments.
   *
   * Given the organization the request acts in, ORGANIZATION_FLAGS come
   * from its owner's evaluation instead, so a volunteer's pages gate the
   * way the routes they call do.
   */
  async getAllVariants(
    user: User,
    organization?: Organization,
  ): Promise<ExperimentVariants> {
    // Same placeholder short-circuit as isFeatureEnabled: the fetch can only
    // 401, and the client falls back to its own SDK evaluation regardless.
    if (!amplitudeKey.configured) {
      return {}
    }

    if (!organization || organization.ownerId === user.id) {
      return this.fetchVariants(user)
    }

    const [own, owners] = await Promise.all([
      this.fetchVariants(user),
      this.usersService
        .findUniqueOrThrow({ where: { id: organization.ownerId } })
        .then((owner) => this.fetchVariants(owner))
        // Every page seeds from this call, so an owner that cannot be read
        // degrades like an Amplitude outage rather than 500ing the page.
        .catch((err: Error): ExperimentVariants => {
          this.logger.warn({
            err,
            userId: user.id,
            ownerId: organization.ownerId,
            msg: 'Owner lookup failed in getAllVariants; org flags read off',
          })
          return {}
        }),
    ])

    // A failed owner fetch leaves these flags out, which reads off.
    return {
      ...Object.fromEntries(
        Object.entries(own).filter(([flag]) => !ORGANIZATION_FLAGS.has(flag)),
      ),
      ...Object.fromEntries(
        Object.entries(owners).filter(([flag]) => ORGANIZATION_FLAGS.has(flag)),
      ),
    }
  }

  private async fetchVariants(user: User): Promise<ExperimentVariants> {
    try {
      const variants = await getAmplitudeClient().fetchV2({
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
