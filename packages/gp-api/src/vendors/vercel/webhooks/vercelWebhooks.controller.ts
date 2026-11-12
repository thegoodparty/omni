import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { createHmac, timingSafeEqual } from 'crypto'
import { PinoLogger } from 'nestjs-pino'
import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { resolveEnvVar } from '@/shared/env/env'
import { recordVercelAlert } from './vercelAlert.metrics'
import { VercelWebhookEventSchema } from './vercelWebhooks.schema'

const VERCEL_USAGE_DASHBOARD =
  'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fusage&title=Go+to+Usage'

@Controller('webhooks/vercel')
export class VercelWebhooksController {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(VercelWebhooksController.name)
  }

  @Post()
  @PublicAccess()
  @HttpCode(HttpStatus.OK)
  handleEvent(
    @Req() { rawBody }: RawBodyRequest<Request>,
    @Headers('x-vercel-signature') signature: string | undefined,
    @Body() body: unknown,
  ) {
    const secret = resolveEnvVar('VERCEL_WEBHOOK_SECRET')
    if (!secret.configured) {
      throw new ServiceUnavailableException(
        'Vercel webhooks are disabled: set VERCEL_WEBHOOK_SECRET',
      )
    }

    // Vercel signs the raw body: HMAC-SHA1, hex, in x-vercel-signature
    // (https://vercel.com/docs/webhooks/webhooks-api#securing-webhooks).
    // Spend Management budget webhooks are signed the same way.
    const expected = createHmac('sha1', secret.value)
      // NestJS raw body is typed as unknown — framework does not expose Buffer type statically
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      .update((rawBody as Buffer | undefined) ?? '')
      .digest()
    const received = Buffer.from(signature ?? '', 'hex')
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException('Invalid x-vercel-signature')
    }

    const parsed = VercelWebhookEventSchema.safeParse(body)
    if (!parsed.success) {
      recordVercelAlert('unrecognized')
      this.logger.error(
        { issues: parsed.error.issues, vercelBody: body },
        'Vercel webhook body failed its schema',
      )
      throw new BadRequestException('Unrecognized Vercel webhook body')
    }

    const event = parsed.data
    switch (event.type) {
      case 'budget.reached':
        recordVercelAlert(event.type, event.payload.thresholdPercent)
        this.logger.warn(
          {
            vercelEvent: event.type,
            vercelEventId: event.id,
            vercelTeamId: event.payload.teamId,
            thresholdPercent: event.payload.thresholdPercent,
            budgetAmount: event.payload.budgetAmount,
            currentSpend: event.payload.currentSpend,
            dashboardUrl: VERCEL_USAGE_DASHBOARD,
          },
          'Vercel alert received',
        )
        break
      case 'alerts.triggered':
        recordVercelAlert(event.type)
        this.logger.warn(
          {
            vercelEvent: event.type,
            vercelEventId: event.id,
            vercelProject: event.payload.projectSlug ?? event.payload.projectId,
            severity: event.payload.severity,
            alerts: event.payload.alerts,
            dashboardUrl:
              event.payload.links?.observability ?? VERCEL_USAGE_DASHBOARD,
          },
          'Vercel alert received',
        )
        break
      case 'firewall.attack':
        recordVercelAlert(event.type)
        this.logger.warn(
          {
            vercelEvent: event.type,
            vercelEventId: event.id,
            vercelProject: event.payload.projectId,
            dashboardUrl: VERCEL_USAGE_DASHBOARD,
          },
          'Vercel alert received',
        )
        break
    }
  }
}
