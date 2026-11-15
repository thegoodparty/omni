import { BadGatewayException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import * as vendorSchemaMetrics from './shared/vendorSchema.metrics'
import { SlackService } from './slack/services/slack.service'
import { VendorDriftProbeService } from './vendorDriftProbe.service'
import { VercelService } from './vercel/services/vercel.service'
import {
  appEnvOverrides,
  useAppEnvOverrides,
} from '@/shared/test-utils/appEnvOverrides'

useAppEnvOverrides({ VENDOR_MODE: 'live' })

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
  let slack: { message: ReturnType<typeof vi.fn> }
  let peerlyIdentity: {
    fetchIdentitiesBodyForProbe: ReturnType<typeof vi.fn>
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
  let recordVendorSchemaMismatch: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    appEnvOverrides.VENDOR_MODE = 'live'
    recordVendorSchemaMismatch = vi
      .spyOn(vendorSchemaMetrics, 'recordVendorSchemaMismatch')
      .mockImplementation(() => undefined)
    vi.stubEnv('DRIFT_PROBE_PEERLY_IDENTITY_ID', 'approved-identity')
    vi.clearAllMocks()
    logger = createMockLogger()
    slack = { message: vi.fn().mockResolvedValue('ok') }
    peerlyIdentity = {
      fetchIdentitiesBodyForProbe: vi
        .fn()
        .mockResolvedValue({ identities: [validIdentity] }),
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
    expect(peerlyIdentity.fetchIdentitiesBodyForProbe).toHaveBeenCalledTimes(1)
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

    expect(peerlyIdentity.getIdentityUseCases).not.toHaveBeenCalled()
    expect(
      results.find((result) => result.endpoint === '/v2/tdlc/:id/get_usecases'),
    ).toMatchObject({ status: 'skipped' })
  })
})
