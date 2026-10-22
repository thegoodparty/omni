import { BadGatewayException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CronLockService } from '@/cron/services/cronLock.service'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { AwsRoute53Service } from './aws/services/awsRoute53.service'
import { CallhubNumbersService } from './callhub/services/callhubNumbers.service'
import { CallhubPhonebookService } from './callhub/services/callhubPhonebook.service'
import {
  GeoapifyHttpStatusError,
  GeoapifyRoutePlannerService,
} from './geoapify/services/geoapifyRoutePlanner.service'
import { PeerlyAccountService } from './peerly/services/peerlyAccount.service'
import { PeerlyIdentityService } from './peerly/services/peerlyIdentity.service'
import { recordVendorSchemaMismatch } from './shared/vendorSchema.metrics'
import { SlackService } from './slack/services/slack.service'
import { SlackChannel } from './slack/slackService.types'
import { VendorDriftProbeService } from './vendorDriftProbe.service'
import { VercelService } from './vercel/services/vercel.service'

const appEnv = vi.hoisted(() => ({ vendorMode: 'live' }))
vi.mock('@/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/util/appEnvironment.util')>()
  return {
    ...actual,
    get VENDOR_MODE() {
      return appEnv.vendorMode
    },
  }
})
vi.mock('./shared/vendorSchema.metrics', () => ({
  recordVendorSchemaMismatch: vi.fn(),
}))

const validIdentity = {
  identity_id: 'id-1',
  identity_name: 'Some Identity',
  start_date: '2024-01-01',
  account_id: 'acct-1',
  tcr_identity_status: 'APPROVED',
}

const rentedPage = { count: 0, next: null, previous: null, results: [] }
const phonebookPage = { count: 0, next: null, previous: null, results: [] }

const routingBody = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[-77, 38]] },
      properties: { legs: [{ time: 10, distance: 20 }] },
    },
  ],
}

describe('VendorDriftProbeService', () => {
  let service: VendorDriftProbeService
  let cronLock: {
    tryClaimDailyRun: ReturnType<typeof vi.fn>
    markCompleted: ReturnType<typeof vi.fn>
  }
  let slack: { message: ReturnType<typeof vi.fn> }
  let peerlyIdentity: {
    getIdentities: ReturnType<typeof vi.fn>
    getIdentityUseCases: ReturnType<typeof vi.fn>
  }
  let peerlyAccount: { fetchBalanceBodyForProbe: ReturnType<typeof vi.fn> }
  let callhubNumbers: {
    fetchRentedNumbersBodyForProbe: ReturnType<typeof vi.fn>
  }
  let callhubPhonebooks: {
    fetchPhonebooksBodyForProbe: ReturnType<typeof vi.fn>
  }
  let geoapify: { fetchRoutingBodyForProbe: ReturnType<typeof vi.fn> }
  let vercel: { checkDomainPrice: ReturnType<typeof vi.fn> }
  let route53: { listPrices: ReturnType<typeof vi.fn> }
  let logger: PinoLogger

  beforeEach(async () => {
    appEnv.vendorMode = 'live'
    vi.stubEnv('DRIFT_PROBE_PEERLY_IDENTITY_ID', 'approved-identity')
    vi.clearAllMocks()
    logger = createMockLogger()
    cronLock = {
      tryClaimDailyRun: vi.fn().mockResolvedValue(true),
      markCompleted: vi.fn().mockResolvedValue(undefined),
    }
    slack = { message: vi.fn().mockResolvedValue('ok') }
    peerlyIdentity = {
      getIdentities: vi.fn().mockResolvedValue([validIdentity]),
      getIdentityUseCases: vi.fn().mockResolvedValue([
        {
          identity_id: 'id-1',
          account_id: 'acct-1',
          usecase: 'POLITICAL',
          tcr_campaign_id: 'C123',
          submitted: 1,
          activated: 1,
        },
      ]),
    }
    peerlyAccount = {
      fetchBalanceBodyForProbe: vi
        .fn()
        .mockResolvedValue({ balance: 5, credit_limit: 100 }),
    }
    callhubNumbers = {
      fetchRentedNumbersBodyForProbe: vi.fn().mockResolvedValue(rentedPage),
    }
    callhubPhonebooks = {
      fetchPhonebooksBodyForProbe: vi.fn().mockResolvedValue(phonebookPage),
    }
    geoapify = {
      fetchRoutingBodyForProbe: vi.fn().mockResolvedValue(routingBody),
    }
    vercel = {
      checkDomainPrice: vi.fn().mockResolvedValue({ price: 12 }),
    }
    route53 = {
      listPrices: vi.fn().mockResolvedValue({ Prices: [{ Name: 'com' }] }),
    }

    const module = await Test.createTestingModule({
      providers: [
        VendorDriftProbeService,
        { provide: PinoLogger, useValue: logger },
        { provide: CronLockService, useValue: cronLock },
        { provide: SlackService, useValue: slack },
        { provide: PeerlyIdentityService, useValue: peerlyIdentity },
        { provide: PeerlyAccountService, useValue: peerlyAccount },
        { provide: CallhubNumbersService, useValue: callhubNumbers },
        { provide: CallhubPhonebookService, useValue: callhubPhonebooks },
        { provide: GeoapifyRoutePlannerService, useValue: geoapify },
        { provide: VercelService, useValue: vercel },
        { provide: AwsRoute53Service, useValue: route53 },
      ],
    }).compile()
    service = module.get(VendorDriftProbeService)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const calledEveryClient = () => {
    expect(peerlyIdentity.getIdentities).toHaveBeenCalledTimes(1)
    expect(peerlyAccount.fetchBalanceBodyForProbe).toHaveBeenCalledTimes(1)
    expect(peerlyIdentity.getIdentityUseCases).toHaveBeenCalledWith(
      'approved-identity',
    )
    expect(callhubNumbers.fetchRentedNumbersBodyForProbe).toHaveBeenCalledTimes(
      1,
    )
    expect(callhubPhonebooks.fetchPhonebooksBodyForProbe).toHaveBeenCalledTimes(
      1,
    )
    expect(geoapify.fetchRoutingBodyForProbe).toHaveBeenCalledTimes(1)
    expect(vercel.checkDomainPrice).toHaveBeenCalledTimes(1)
    expect(route53.listPrices).toHaveBeenCalledTimes(1)
  }

  it('posts nothing when every probe passes', async () => {
    await service.runNightlyProbe()

    calledEveryClient()
    expect(slack.message).not.toHaveBeenCalled()
    expect(recordVendorSchemaMismatch).not.toHaveBeenCalled()
    expect(cronLock.markCompleted).toHaveBeenCalledTimes(1)
  })

  it('posts one summary naming vendor, endpoint and issue path when Peerly drifts, and still runs the rest', async () => {
    peerlyIdentity.getIdentities.mockResolvedValue([
      { ...validIdentity, identity_id: 12345, ein: '99-9999999' },
    ])

    await service.runNightlyProbe()

    calledEveryClient()
    expect(slack.message).toHaveBeenCalledTimes(1)
    const [message, channel] = slack.message.mock.calls[0] ?? []
    expect(channel).toBe(SlackChannel.bot10DlcCompliance)
    const text = JSON.stringify(message)
    expect(text).toContain('peerly')
    expect(text).toContain('/identities/listByAccount')
    expect(text).toContain('identities.0.identity_id')
    expect(text).toContain('schema mismatch')
    // Values from the body never reach Slack.
    expect(text).not.toContain('12345')
    expect(text).not.toContain('99-9999999')
    expect(recordVendorSchemaMismatch).toHaveBeenCalledWith(
      'peerly',
      '/identities/listByAccount',
    )
  })

  it('reports a thrown CallHub call as call failed with a status only, and the others pass', async () => {
    callhubNumbers.fetchRentedNumbersBodyForProbe.mockRejectedValue(
      new BadGatewayException('secret-token-abc in the message'),
    )

    const results = await service.runProbes()

    const failed = results.filter((result) => result.status !== 'pass')
    expect(failed).toEqual([
      {
        vendor: 'callhub',
        endpoint: '/v1/numbers/rented_calling_numbers/',
        status: 'call_failed',
        detail: 'HTTP 502',
      },
    ])
    calledEveryClient()

    await service.runNightlyProbe()
    expect(slack.message).toHaveBeenCalledTimes(1)
    const text = JSON.stringify(slack.message.mock.calls[0]?.[0])
    expect(text).toContain('callhub')
    expect(text).toContain('call failed')
    expect(text).not.toContain('secret-token-abc')
    expect(recordVendorSchemaMismatch).not.toHaveBeenCalled()
  })

  it('reports CallHub body drift as a schema mismatch and counts it', async () => {
    callhubPhonebooks.fetchPhonebooksBodyForProbe.mockResolvedValue({
      count: 'many',
      next: null,
      previous: null,
      results: [],
    })

    const results = await service.runProbes()

    expect(
      results.find((result) => result.endpoint === '/v1/phonebooks/'),
    ).toEqual({
      vendor: 'callhub',
      endpoint: '/v1/phonebooks/',
      status: 'schema_mismatch',
      detail: 'count',
    })
    expect(recordVendorSchemaMismatch).toHaveBeenCalledWith(
      'callhub',
      '/v1/phonebooks/',
    )
  })

  it('reports a Geoapify status without the request URL', async () => {
    geoapify.fetchRoutingBodyForProbe.mockRejectedValue(
      new GeoapifyHttpStatusError(401),
    )

    const results = await service.runProbes()

    expect(results.find((result) => result.vendor === 'geoapify')).toEqual({
      vendor: 'geoapify',
      endpoint: '/v1/routing',
      status: 'call_failed',
      detail: 'HTTP 401',
    })
  })

  it('flags a Route53 price list that came back empty', async () => {
    route53.listPrices.mockResolvedValue({ Prices: [] })

    const results = await service.runProbes()

    expect(results.find((result) => result.vendor === 'route53')).toMatchObject(
      { status: 'schema_mismatch', detail: 'Prices' },
    )
  })

  it('skips the use-case probe with a note when no identity is configured, without alerting', async () => {
    vi.stubEnv('DRIFT_PROBE_PEERLY_IDENTITY_ID', '')

    const results = await service.runProbes()
    await service.runNightlyProbe()

    expect(peerlyIdentity.getIdentityUseCases).not.toHaveBeenCalled()
    expect(
      results.find((result) => result.endpoint === '/v2/tdlc/:id/get_usecases'),
    ).toMatchObject({ status: 'skipped' })
    expect(slack.message).not.toHaveBeenCalled()
  })

  it('logs at error when the Slack post resolves undefined', async () => {
    vercel.checkDomainPrice.mockRejectedValue(new Error('boom'))
    slack.message.mockResolvedValue(undefined)

    await service.runNightlyProbe()

    expect(logger.error).toHaveBeenCalledWith(
      { failed: 1 },
      'vendor drift probe could not post its summary to Slack',
    )
    expect(cronLock.markCompleted).toHaveBeenCalledTimes(1)
  })

  it('returns immediately in mock mode without claiming the lock or calling a vendor', async () => {
    appEnv.vendorMode = 'mock'

    await service.runNightlyProbe()

    expect(cronLock.tryClaimDailyRun).not.toHaveBeenCalled()
    expect(peerlyIdentity.getIdentities).not.toHaveBeenCalled()
    expect(geoapify.fetchRoutingBodyForProbe).not.toHaveBeenCalled()
    expect(slack.message).not.toHaveBeenCalled()
  })

  it('does not run the probes when the daily lock is already claimed', async () => {
    cronLock.tryClaimDailyRun.mockResolvedValue(false)

    await service.runNightlyProbe()

    expect(cronLock.tryClaimDailyRun).toHaveBeenCalledWith(
      'vendorDriftProbe',
      expect.any(Date),
    )
    expect(peerlyIdentity.getIdentities).not.toHaveBeenCalled()
    expect(slack.message).not.toHaveBeenCalled()
    expect(cronLock.markCompleted).not.toHaveBeenCalled()
  })
})
