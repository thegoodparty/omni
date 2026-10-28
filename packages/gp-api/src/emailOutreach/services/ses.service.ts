import { Injectable } from '@nestjs/common'
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import { PinoLogger } from 'nestjs-pino'
import { AwsService } from '@/vendors/aws/services/aws.service'
import {
  OTEL_SERVICE_ENVIRONMENT,
  vendorBaseUrl,
  VENDOR_MODE,
} from '@/shared/util/appEnvironment.util'

export const SES_REGION = 'us-west-2'

// Dev and prod share one AWS account, so the sets carry the environment.
export const OUTREACH_CONFIGURATION_SET = `outreach-${OTEL_SERVICE_ENVIRONMENT ?? 'dev'}`

export interface SesSendInput {
  from: string
  to: string
  subject: string
  html: string
  text: string
  tenantName?: string
}

@Injectable()
export class SesService extends AwsService {
  private readonly client: SESv2Client

  constructor(protected readonly logger: PinoLogger) {
    super(logger)
    this.logger.setContext(SesService.name)
    this.client = new SESv2Client({
      region: SES_REGION,
      // Only set in mock mode; live leaves it unset so the SDK resolves the
      // regional endpoint itself.
      ...(VENDOR_MODE === 'mock'
        ? {
            endpoint: vendorBaseUrl('ses', ''),
            // The mock never checks a signature, and a mock run has no AWS
            // session to resolve credentials from.
            credentials: { accessKeyId: 'mock', secretAccessKey: 'mock' },
          }
        : {}),
    })
  }

  async sendEmail(input: SesSendInput): Promise<string | undefined> {
    return this.executeAwsOperation(async () => {
      const result = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: input.from,
          Destination: { ToAddresses: [input.to] },
          ConfigurationSetName: OUTREACH_CONFIGURATION_SET,
          ...(input.tenantName ? { TenantName: input.tenantName } : {}),
          Content: {
            Simple: {
              Subject: { Data: input.subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: input.html, Charset: 'UTF-8' },
                Text: { Data: input.text, Charset: 'UTF-8' },
              },
            },
          },
        }),
      )
      return result.MessageId
    }, 'sesSendEmail')
  }
}
