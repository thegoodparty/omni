import { HttpException, Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { isAxiosError } from 'axios'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { CronLockService } from '@/cron/services/cronLock.service'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import { AwsRoute53Service } from './aws/services/awsRoute53.service'
import { CallhubPhonebookService } from './callhub/services/callhubPhonebook.service'
import { CallhubNumbersService } from './callhub/services/callhubNumbers.service'
import { PhonebookPageSchema } from './callhub/schemas/callhubPhonebook.schema'
import { RentedNumbersPageSchema } from './callhub/schemas/callhubNumber.schema'
import { RoutingResponseSchema } from './geoapify/schemas/geoapify.schema'
import { GeoapifyHttpStatusError } from './geoapify/services/geoapifyRoutePlanner.service'
import { GeoapifyRoutePlannerService } from './geoapify/services/geoapifyRoutePlanner.service'
import { peerlyIdentityUseCaseResponseBodySchema } from './peerly/schemas/peerlyIdentity.schema'
import { peerlyGetIdentitiesResponseBodySchema } from './peerly/schemas/peerlyIdentity.schema'
import { AccountBalanceResponseDto } from './peerly/schemas/peerlyAccount.schema'
import { PeerlyAccountService } from './peerly/services/peerlyAccount.service'
import { PeerlyIdentityService } from './peerly/services/peerlyIdentity.service'
import { parseVendorResponse } from './shared/parseVendorResponse'
import { SlackService } from './slack/services/slack.service'
import { SlackChannel, SlackMessageType } from './slack/slackService.types'
import {
  driftProbeRoute53PricesSchema,
  driftProbeVercelPriceSchema,
} from './vendorDriftProbe.schemas'
import { VercelService } from './vercel/services/vercel.service'

const PROBE_JOB = 'vendorDriftProbe'
// 04:41 Eastern: off the hour, and before the 10DLC owners' workday so a
// failure is in the channel when they open it.
const PROBE_CRON = '41 4 * * *'

// Any domain works: the price lookup answers per TLD, and the probe never
// buys. Fixed so the call is the same every night.
const VERCEL_PROBE_DOMAIN = 'goodparty.org'

// Two points a few blocks apart. The Routing API bills per waypoint, so two is
// the cheapest call that still returns a real route. [lng, lat].
const GEOAPIFY_PROBE_WAYPOINTS: [number, number][] = [
  [-77.0365, 38.8977],
  [-77.0091, 38.8899],
]

type ProbeStatus = 'pass' | 'schema_mismatch' | 'call_failed' | 'skipped'

export type DriftProbeResult = {
  vendor: string
  endpoint: string
  status: ProbeStatus
  // Issue paths for a mismatch, an HTTP status or error class for a failed
  // call, the reason for a skip. Never any part of a response body.
  detail?: string
}

type Probe = {
  vendor: string
  endpoint: string
  // Resolves when the call succeeded and parsed. Rejects with a ZodError for a
  // mismatch or with whatever the client threw for a failed call. Resolves
  // with a string to skip, explaining why.
  run: () => Promise<string | undefined>
}

// Status only. A client error can carry the request URL (Geoapify puts the API
// key in it), a response body, or a token, so the message is never read.
const describeFailure = (error: unknown): string => {
  if (error instanceof GeoapifyHttpStatusError) return `HTTP ${error.status}`
  if (isAxiosError(error)) {
    const status = error.response?.status ?? error.status
    return status
      ? `HTTP ${status}`
      : `no response (${error.code ?? 'unknown'})`
  }
  if (error instanceof HttpException) return `HTTP ${error.getStatus()}`
  return error instanceof Error ? error.name : 'unknown error'
}

const describeMismatch = (error: z.ZodError): string => {
  const paths = [
    ...new Set(error.issues.map((issue) => issue.path.join('.') || '(root)')),
  ]
  return paths.join(', ')
}

const STATUS_LABEL: Record<Exclude<ProbeStatus, 'pass' | 'skipped'>, string> = {
  schema_mismatch: 'schema mismatch',
  call_failed: 'call failed',
}

// Drift layer 3: the prod mismatch watch only sees endpoints prod traffic
// hits, so this calls a fixed set of read-only vendor endpoints each night with
// prod credentials and parses each with the shared schemas in enforce mode.
// Posts to Slack only when something failed.
@Injectable()
export class VendorDriftProbeService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly cronLock: CronLockService,
    private readonly slack: SlackService,
    private readonly peerlyIdentity: PeerlyIdentityService,
    private readonly peerlyAccount: PeerlyAccountService,
    private readonly callhubNumbers: CallhubNumbersService,
    private readonly callhubPhonebooks: CallhubPhonebookService,
    private readonly geoapify: GeoapifyRoutePlannerService,
    private readonly vercel: VercelService,
    private readonly route53: AwsRoute53Service,
  ) {
    this.logger.setContext(VendorDriftProbeService.name)
  }

  @Cron(PROBE_CRON, { name: PROBE_JOB, timeZone: EASTERN_TIMEZONE })
  async runNightlyProbe(): Promise<void> {
    // Mock mode would probe our own mocks. In practice only prod is live.
    if (VENDOR_MODE !== 'live') return

    // Pinned so claim and completion resolve to the same slot.
    const now = new Date()
    if (!(await this.cronLock.tryClaimDailyRun(PROBE_JOB, now))) return

    try {
      const results = await this.runProbes()
      const failures = results.filter(
        (result) =>
          result.status === 'schema_mismatch' ||
          result.status === 'call_failed',
      )
      this.logger.info(
        {
          passed: results.filter((result) => result.status === 'pass').length,
          skipped: results.filter((result) => result.status === 'skipped')
            .length,
          failed: failures.length,
        },
        'vendor drift probe finished',
      )
      if (failures.length > 0) await this.postSummary(results)
    } catch (err) {
      this.logger.error({ err }, 'vendor drift probe failed')
    } finally {
      await this.cronLock.markCompleted(PROBE_JOB, now)
    }
  }

  // allSettled so one vendor's outage does not hide the others.
  async runProbes(): Promise<DriftProbeResult[]> {
    const probes = this.buildProbes()
    const settled = await Promise.allSettled(probes.map((probe) => probe.run()))
    return settled.flatMap((outcome, index): DriftProbeResult[] => {
      const probe = probes[index]
      if (!probe) return []
      const { vendor, endpoint } = probe
      if (outcome.status === 'fulfilled') {
        return [
          typeof outcome.value === 'string'
            ? { vendor, endpoint, status: 'skipped', detail: outcome.value }
            : { vendor, endpoint, status: 'pass' },
        ]
      }
      const error: unknown = outcome.reason
      if (error instanceof z.ZodError) {
        return [
          {
            vendor,
            endpoint,
            status: 'schema_mismatch',
            detail: describeMismatch(error),
          },
        ]
      }
      const detail = describeFailure(error)
      this.logger.warn({ vendor, endpoint, detail }, 'drift probe call failed')
      return [{ vendor, endpoint, status: 'call_failed', detail }]
    })
  }

  private enforce<S extends z.ZodType>(
    schema: S,
    body: unknown,
    vendor: string,
    endpoint: string,
  ): z.infer<S> {
    return parseVendorResponse(schema, body, {
      vendor,
      endpoint,
      mode: 'enforce',
      logger: this.logger,
    })
  }

  // The probes never call retrieve_cv: Peerly asked us to keep it to one call
  // a minute, and this set must stay clear of it.
  private buildProbes(): Probe[] {
    return [
      {
        vendor: 'peerly',
        endpoint: '/identities/listByAccount',
        run: async () => {
          const body = await this.peerlyIdentity.fetchIdentitiesBodyForProbe()
          this.enforce(
            peerlyGetIdentitiesResponseBodySchema,
            body,
            'peerly',
            '/identities/listByAccount',
          )
          return undefined
        },
      },
      {
        vendor: 'peerly',
        endpoint: '/accounts/:accountId/balance',
        run: async () => {
          const balance = await this.peerlyAccount.fetchBalanceBodyForProbe()
          this.enforce(
            AccountBalanceResponseDto.schema,
            balance,
            'peerly',
            '/accounts/:accountId/balance',
          )
          return undefined
        },
      },
      {
        vendor: 'peerly',
        endpoint: '/v2/tdlc/:id/get_usecases',
        run: async () => {
          const identityId = process.env.DRIFT_PROBE_PEERLY_IDENTITY_ID
          if (!identityId) return 'DRIFT_PROBE_PEERLY_IDENTITY_ID is not set'
          const useCases =
            await this.peerlyIdentity.getIdentityUseCases(identityId)
          this.enforce(
            peerlyIdentityUseCaseResponseBodySchema,
            useCases,
            'peerly',
            '/v2/tdlc/:id/get_usecases',
          )
          return undefined
        },
      },
      {
        vendor: 'callhub',
        endpoint: '/v1/numbers/rented_calling_numbers/',
        run: async () => {
          const body =
            await this.callhubNumbers.fetchRentedNumbersBodyForProbe()
          this.enforce(
            RentedNumbersPageSchema,
            body,
            'callhub',
            '/v1/numbers/rented_calling_numbers/',
          )
          return undefined
        },
      },
      {
        vendor: 'callhub',
        endpoint: '/v1/phonebooks/',
        run: async () => {
          const body =
            await this.callhubPhonebooks.fetchPhonebooksBodyForProbe()
          this.enforce(PhonebookPageSchema, body, 'callhub', '/v1/phonebooks/')
          return undefined
        },
      },
      {
        vendor: 'geoapify',
        endpoint: '/v1/routing',
        run: async () => {
          const body = await this.geoapify.fetchRoutingBodyForProbe({
            mode: 'drive',
            waypoints: GEOAPIFY_PROBE_WAYPOINTS,
          })
          this.enforce(RoutingResponseSchema, body, 'geoapify', '/v1/routing')
        },
      },
      {
        vendor: 'vercel',
        endpoint: 'domainsRegistrar.getDomainPrice',
        run: async () => {
          const price = await this.vercel.checkDomainPrice(VERCEL_PROBE_DOMAIN)
          this.enforce(
            driftProbeVercelPriceSchema,
            price,
            'vercel',
            'domainsRegistrar.getDomainPrice',
          )
          return undefined
        },
      },
      {
        vendor: 'route53',
        endpoint: 'ListPrices',
        run: async () => {
          const prices = await this.route53.listPrices()
          this.enforce(
            driftProbeRoute53PricesSchema,
            prices,
            'route53',
            'ListPrices',
          )
          return undefined
        },
      },
    ]
  }

  // Vendor, endpoint, and issue paths or a status. Nothing from a body.
  private async postSummary(results: DriftProbeResult[]): Promise<void> {
    const lines = results
      .filter(
        (
          result,
        ): result is DriftProbeResult & {
          status: 'schema_mismatch' | 'call_failed'
        } =>
          result.status === 'schema_mismatch' ||
          result.status === 'call_failed',
      )
      .map(
        (result) =>
          `- ${result.vendor} ${result.endpoint}: ${STATUS_LABEL[result.status]} (${result.detail})`,
      )
    const posted = await this.slack.message(
      {
        blocks: [
          {
            type: SlackMessageType.SECTION,
            text: {
              type: SlackMessageType.MRKDWN,
              text: `*Nightly vendor drift probe: ${lines.length} of ${results.length} probes failed*\n${lines.join('\n')}`,
            },
          },
        ],
      },
      SlackChannel.bot10DlcCompliance,
    )
    // SlackService.message swallows its own errors and resolves undefined.
    if (posted === undefined) {
      this.logger.error(
        { failed: lines.length },
        'vendor drift probe could not post its summary to Slack',
      )
    }
  }
}
