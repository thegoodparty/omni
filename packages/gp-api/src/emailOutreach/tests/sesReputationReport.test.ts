import {
  CloudWatchClient,
  GetMetricDataCommand,
  GetMetricDataCommandOutput,
  ScanBy,
} from '@aws-sdk/client-cloudwatch'
import { ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { SesService } from '../services/ses.service'
import { SesReputationReportService } from '../services/sesReputationReport.service'
import {
  sesAccountReputation,
  setSesAccountReputation,
} from '../util/sesReputation.metrics'

const service = useTestService()

let ses: SesService
let report: SesReputationReportService

const reputationData = (values: {
  bounceRate?: number[]
  complaintRate?: number[]
}): GetMetricDataCommandOutput => ({
  $metadata: {},
  MetricDataResults: [
    { Id: 'bounceRate', Values: values.bounceRate ?? [] },
    { Id: 'complaintRate', Values: values.complaintRate ?? [] },
  ],
})

beforeEach(() => {
  ses = service.app.get(SesService)
  report = service.app.get(SesReputationReportService)
  vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
})

afterEach(() => {
  setSesAccountReputation({ bounceRate: null, complaintRate: null })
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('SesService.getAccountReputation', () => {
  it('asks for the account metrics, newest first, with no dimensions', async () => {
    const read = vi
      .spyOn(CloudWatchClient.prototype, 'send')
      .mockImplementation(async () =>
        reputationData({ bounceRate: [0.021, 0.01], complaintRate: [0.0004] }),
      )

    const reputation = await ses.getAccountReputation(
      new Date('2026-11-02T09:00:00Z'),
      new Date('2026-11-02T12:00:00Z'),
    )

    expect(reputation).toEqual({ bounceRate: 0.021, complaintRate: 0.0004 })
    const command = read.mock.calls[0]?.[0]
    expect(command).toBeInstanceOf(GetMetricDataCommand)
    const input =
      command instanceof GetMetricDataCommand ? command.input : undefined
    expect(input?.ScanBy).toBe(ScanBy.TIMESTAMP_DESCENDING)
    expect(input?.MetricDataQueries?.map((q) => q.MetricStat)).toEqual([
      {
        Metric: { Namespace: 'AWS/SES', MetricName: 'Reputation.BounceRate' },
        Period: 300,
        Stat: 'Average',
      },
      {
        Metric: {
          Namespace: 'AWS/SES',
          MetricName: 'Reputation.ComplaintRate',
        },
        Period: 300,
        Stat: 'Average',
      },
    ])
  })

  it('answers null for a rate with no datapoint, never zero', async () => {
    vi.spyOn(CloudWatchClient.prototype, 'send').mockImplementation(async () =>
      reputationData({ bounceRate: [0.02] }),
    )

    const reputation = await ses.getAccountReputation(new Date(), new Date())

    expect(reputation).toEqual({ bounceRate: 0.02, complaintRate: null })
  })
})

describe('SesReputationReportService.report', () => {
  it('exports the latest reading from the last three hours', async () => {
    const read = vi
      .spyOn(ses, 'getAccountReputation')
      .mockResolvedValue({ bounceRate: 0.035, complaintRate: 0.0002 })

    await report.report()

    expect(sesAccountReputation()).toEqual({
      bounceRate: 0.035,
      complaintRate: 0.0002,
    })
    const [start, end] = read.mock.calls[0] ?? []
    expect((end?.getTime() ?? 0) - (start?.getTime() ?? 0)).toBe(
      3 * 60 * 60 * 1000,
    )
  })

  it('stops exporting a rate CloudWatch has no datapoint for', async () => {
    setSesAccountReputation({ bounceRate: 0.04, complaintRate: 0.0002 })
    vi.spyOn(ses, 'getAccountReputation').mockResolvedValue({
      bounceRate: null,
      complaintRate: 0.0001,
    })

    await report.report()

    expect(sesAccountReputation()).toEqual({
      bounceRate: null,
      complaintRate: 0.0001,
    })
  })

  it('keeps the last reading when CloudWatch cannot be read', async () => {
    setSesAccountReputation({ bounceRate: 0.04, complaintRate: 0.0002 })
    vi.spyOn(ses, 'getAccountReputation').mockRejectedValue(
      new ServiceUnavailableException('throttled'),
    )

    await report.report()

    expect(sesAccountReputation()).toEqual({
      bounceRate: 0.04,
      complaintRate: 0.0002,
    })
  })

  it('reads nothing outside prod', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'dev')
    const read = vi.spyOn(ses, 'getAccountReputation')

    await report.report()

    expect(read).not.toHaveBeenCalled()
    expect(sesAccountReputation()).toEqual({
      bounceRate: null,
      complaintRate: null,
    })
  })
})
