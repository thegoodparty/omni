import type { Type } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appEnvOverrides,
  useAppEnvOverrides,
} from '@/shared/test-utils/appEnvOverrides'
import { useTestService } from '@/test-service'
import { AwsRoute53Service } from './aws/services/awsRoute53.service'
import { CallhubNumbersService } from './callhub/services/callhubNumbers.service'
import { CallhubPhonebookService } from './callhub/services/callhubPhonebook.service'
import { GeoapifyRoutePlannerService } from './geoapify/services/geoapifyRoutePlanner.service'
import { PeerlyAccountService } from './peerly/services/peerlyAccount.service'
import { PeerlyIdentityService } from './peerly/services/peerlyIdentity.service'
import * as vendorSchemaMetrics from './shared/vendorSchema.metrics'
import { SlackService } from './slack/services/slack.service'
import { SlackChannel } from './slack/slackService.types'
import { VendorDriftProbeService } from './vendorDriftProbe.service'
import { VercelService } from './vercel/services/vercel.service'

useAppEnvOverrides({ VENDOR_MODE: 'live' })

const service = useTestService({ jobs: true })

const validIdentity = {
  identity_id: 'id-1',
  identity_name: 'Some Identity',
  start_date: '2024-01-01',
  account_id: 'acct-1',
  tcr_identity_status: 'APPROVED',
}

const page = { count: 0, next: null, previous: null, results: [] }

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

describe('vendorDriftProbe schedule', () => {
  const get = <S>(type: Type<S>): S => service.app.get(type)
  let fetchIdentities: ReturnType<typeof vi.spyOn>
  let fetchRouting: ReturnType<typeof vi.spyOn>
  let slackMessage: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    appEnvOverrides.VENDOR_MODE = 'live'
    vi.stubEnv('DRIFT_PROBE_PEERLY_IDENTITY_ID', 'approved-identity')
    vi.spyOn(vendorSchemaMetrics, 'recordVendorSchemaMismatch')
    fetchIdentities = vi
      .spyOn(get(PeerlyIdentityService), 'fetchIdentitiesBodyForProbe')
      .mockResolvedValue({ identities: [validIdentity] })
    vi.spyOn(
      get(PeerlyIdentityService),
      'getIdentityUseCases',
    ).mockResolvedValue([])
    vi.spyOn(
      get(PeerlyAccountService),
      'fetchBalanceBodyForProbe',
    ).mockResolvedValue({ balance: 5, credit_limit: 100 })
    vi.spyOn(
      get(CallhubNumbersService),
      'fetchRentedNumbersBodyForProbe',
    ).mockResolvedValue(page)
    vi.spyOn(
      get(CallhubPhonebookService),
      'fetchPhonebooksBodyForProbe',
    ).mockResolvedValue(page)
    fetchRouting = vi
      .spyOn(get(GeoapifyRoutePlannerService), 'fetchRoutingBodyForProbe')
      .mockResolvedValue(routingBody)
    vi.spyOn(get(VercelService), 'checkDomainPrice').mockResolvedValue({
      price: 12,
    })
    vi.spyOn(get(AwsRoute53Service), 'listPrices').mockResolvedValue({
      $metadata: {},
      Prices: [{ Name: 'com' }],
    })
    slackMessage = vi
      .spyOn(get(SlackService), 'message')
      .mockResolvedValue('ok')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('posts nothing when every probe passes', async () => {
    await service.jobs.runSchedule('vendorDriftProbe')

    expect(fetchIdentities).toHaveBeenCalledTimes(1)
    expect(fetchRouting).toHaveBeenCalledTimes(1)
    expect(slackMessage).not.toHaveBeenCalled()
  })

  it('posts one summary naming vendor, endpoint and issue path when Peerly drifts', async () => {
    fetchIdentities.mockResolvedValue({
      identities: [{ ...validIdentity, identity_id: 12345, ein: '99-9999999' }],
    })

    await service.jobs.runSchedule('vendorDriftProbe')

    expect(fetchRouting).toHaveBeenCalledTimes(1)
    expect(slackMessage).toHaveBeenCalledTimes(1)
    const [message, channel] = slackMessage.mock.calls[0] ?? []
    expect(channel).toBe(SlackChannel.bot10DlcCompliance)
    const text = JSON.stringify(message)
    expect(text).toContain('peerly')
    expect(text).toContain('/identities/listByAccount')
    expect(text).toContain('identities.0.identity_id')
    expect(text).toContain('schema mismatch')
    // Values from the body never reach Slack.
    expect(text).not.toContain('12345')
    expect(text).not.toContain('99-9999999')
  })

  it('logs at error, without retrying, when the Slack post resolves undefined', async () => {
    vi.spyOn(get(VercelService), 'checkDomainPrice').mockRejectedValue(
      new Error('boom'),
    )
    slackMessage.mockResolvedValue(undefined)
    const logError = vi.spyOn(get(VendorDriftProbeService)['logger'], 'error')

    await service.jobs.runSchedule('vendorDriftProbe')

    expect(logError).toHaveBeenCalledWith(
      { failed: 1 },
      'vendor drift probe could not post its summary to Slack',
    )
    expect(fetchRouting).toHaveBeenCalledTimes(1)
  })

  it('calls no vendor in mock mode', async () => {
    appEnvOverrides.VENDOR_MODE = 'mock'

    await service.jobs.runSchedule('vendorDriftProbe')

    expect(fetchIdentities).not.toHaveBeenCalled()
    expect(fetchRouting).not.toHaveBeenCalled()
    expect(slackMessage).not.toHaveBeenCalled()
  })
})
