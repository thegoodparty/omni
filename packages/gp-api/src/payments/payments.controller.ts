import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common'
import { UserRole } from '../generated/prisma'
import { Roles } from 'src/authentication/decorators/Roles.decorator'
import { Stripe } from 'stripe'
import { PublicAccess } from '../authentication/decorators/PublicAccess.decorator'
import { StripeService } from '../vendors/stripe/services/stripe.service'
import { PaymentEventsService } from './services/paymentEventsService'
import { PaymentsService } from './services/payments.service'
import { PinoLogger } from 'nestjs-pino'

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly stripeService: StripeService,
    private readonly stripeEvents: PaymentEventsService,
    private readonly paymentsService: PaymentsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PaymentsController.name)
  }

  @Post('events')
  @PublicAccess()
  @HttpCode(HttpStatus.OK)
  async handleStripeEvent(
    @Req() { rawBody }: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string>,
  ) {
    const stripeSignature = headers['stripe-signature']
    if (!stripeSignature) {
      throw new BadRequestException('Stripe-Signature header is missing')
    }

    let event: Stripe.Event
    try {
      event = await this.stripeService.parseWebhookEvent(
        // NestJS raw body is typed as unknown — framework does not expose Buffer type statically
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        rawBody as Buffer,
        stripeSignature,
      )
    } catch (e) {
      this.logger.warn({ e }, 'Failed to parse Stripe event')
      throw new BadRequestException('Failed to parse Stripe event')
    }

    this.logger.debug({ event }, `processing event.type => ${event.type}`)
    try {
      await this.stripeEvents.handleEvent(event)
    } catch (e) {
      this.logger.error({ e }, 'Failed to process Stripe event')
      // Rethrown as-is. Wrapping an unrecognised error in a BadRequestException
      // answered 400 for a failure on OUR side of the line — the event is past
      // signature verification here, so it is genuinely from Stripe and only our
      // handling of it can still break. EXCLUDED_STATUS_CODES in
      // deploy/components/alerting/controller-alerts.ts drops 400 on purpose, so
      // a webhook that could not write the payment it was told about paged
      // nobody and appeared in no error rate.
      //
      // Every 400 this endpoint returned in the 30 days to 2026-09-17 reached it
      // through this catch, and every one was a Prisma error: P2034 write
      // conflicts (3 prod, 72 dev) plus one prod P2002. The signature/parse
      // branch above — the only 400 here that a caller can actually cause —
      // logged nothing at all in the same window, so the wrapper was never
      // describing a malformed request, only relabelling database faults as one.
      //
      // Rethrowing restores PrismaExceptionFilter, which the wrapper was
      // pre-empting by catching these first: it already classifies exactly these
      // codes (#1874), and reads P2034 as transient — a 503 that alerts, and the
      // retry Prisma's own guidance asks for. Anything non-Prisma lands on
      // HttpExceptionFilter as a 500. An HttpException a handler raised
      // deliberately still passes through untouched, including the 502s that are
      // this endpoint's real failure volume (270 prod, 1,284 dev).
      //
      // This does not change what Stripe does. Stripe redelivers every non-2xx
      // alike for up to three days, so 400 and 503 are retried identically; the
      // handlers are already written for that redelivery (AGENTS.md § Draft-first
      // outreach fulfillment depends on it). The status only decides who finds out.
      throw e
    }
  }

  @Patch('fix-missing-customer-id')
  @Roles(UserRole.admin)
  @HttpCode(HttpStatus.OK)
  async fixMissingCustomerIds() {
    return this.paymentsService.fixMissingCustomerIds()
  }
}
