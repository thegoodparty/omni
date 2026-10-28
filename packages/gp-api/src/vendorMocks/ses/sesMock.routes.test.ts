import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
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
})
