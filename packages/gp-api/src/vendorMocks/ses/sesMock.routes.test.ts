import {
  CreateTenantCommand,
  SendBulkEmailCommand,
  SendEmailCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2'
import {
  CloudWatchClient,
  GetMetricDataCommand,
} from '@aws-sdk/client-cloudwatch'
import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { useAppEnvOverrides } from '@/shared/test-utils/appEnvOverrides'

useAppEnvOverrides({ IS_NON_PROD_DEPLOY: true, VENDOR_MODE: 'mock' })

const service = useTestService()
const PATH = '/v1/vendor-mocks/ses'

const buildClient = () =>
  new SESv2Client({
    region: 'us-west-2',
    endpoint: `${service.client.defaults.baseURL}${PATH}`,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  })

describe('SES vendor mock', () => {
  it('accepts a SESv2 SendEmail from the SDK and returns a message id', async () => {
    const result = await buildClient().send(
      new SendEmailCommand({
        FromEmailAddress: 'a@example.com',
        Destination: { ToAddresses: ['b@example.com'] },
        Content: {
          Simple: {
            Subject: { Data: 's' },
            Body: { Text: { Data: 't' } },
          },
        },
      }),
    )
    expect(result.MessageId).toMatch(/^mock-/)
  })

  it('refuses a send with no destination', async () => {
    const res = await service.client.post(
      `${PATH}/v2/email/outbound-emails`,
      {},
      { validateStatus: () => true },
    )
    expect(res.status).toBe(400)
  })

  const bulk = (tenant: string, tag: string, count: number) =>
    buildClient().send(
      new SendBulkEmailCommand({
        FromEmailAddress: 'a@example.com',
        TenantName: tenant,
        DefaultContent: { Template: { TemplateName: 't', TemplateData: '{}' } },
        DefaultEmailTags: [{ Name: 'outreachEmailId', Value: tag }],
        BulkEmailEntries: Array.from({ length: count }, (_, i) => ({
          Destination: { ToAddresses: [`p${i}@example.com`] },
        })),
      }),
    )

  it('accepts a bulk send and refuses one through a paused tenant', async () => {
    const tenant = `test-mock-${Date.now()}`
    await buildClient().send(new CreateTenantCommand({ TenantName: tenant }))
    await expect(
      buildClient().send(new CreateTenantCommand({ TenantName: tenant })),
    ).rejects.toMatchObject({ name: 'AlreadyExistsException' })

    const sent = await bulk(tenant, 'mock-a', 2)
    expect(sent.BulkEmailEntryResults?.map((r) => r.Status)).toEqual([
      'SUCCESS',
      'SUCCESS',
    ])

    await service.client.post(`${PATH}/test/tenants/${tenant}/status`, {
      sendingStatus: 'DISABLED',
    })
    await expect(bulk(tenant, 'mock-a', 1)).rejects.toMatchObject({
      name: 'MessageRejected',
      message: expect.stringContaining(':tenant/'),
    })
  })

  it('answers GetMetricData from what was sent, or from scripted numbers', async () => {
    const tenant = `test-metrics-${Date.now()}`
    const tag = `mock-${Date.now()}`
    await buildClient().send(new CreateTenantCommand({ TenantName: tenant }))
    await bulk(tenant, tag, 3)
    const cloudwatch = new CloudWatchClient({
      region: 'us-west-2',
      endpoint: `${service.client.defaults.baseURL}${PATH}/cloudwatch`,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    })
    const read = async () => {
      const result = await cloudwatch.send(
        new GetMetricDataCommand({
          StartTime: new Date(Date.now() - 3_600_000),
          EndTime: new Date(),
          MetricDataQueries: ['Send', 'Bounce'].map((name) => ({
            Id: name.toLowerCase(),
            MetricStat: {
              Metric: {
                Namespace: 'AWS/SES',
                MetricName: name,
                Dimensions: [{ Name: 'outreachEmailId', Value: tag }],
              },
              Period: 60,
              Stat: 'Sum',
            },
          })),
        }),
      )
      return Object.fromEntries(
        (result.MetricDataResults ?? []).map((r) => [r.Id, r.Values ?? []]),
      )
    }
    expect(await read()).toEqual({ send: [3], bounce: [] })

    await service.client.post(`${PATH}/test/metrics/${tag}`, {
      send: 600,
      bounce: 30,
    })
    expect(await read()).toEqual({ send: [600], bounce: [30] })
  })
})
