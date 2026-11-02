import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common'
import {
  PaymentHoldCardIntentResponse,
  PaymentHoldCardIntentResponseSchema,
  PaymentHoldCardRequest,
  PaymentHoldCardRequestSchema,
  PaymentHoldCardResponse,
  PaymentHoldCardResponseSchema,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { ElectedOffice, User } from '../generated/prisma'
import { PaymentHoldsCardService } from './services/paymentHoldsCard.service'

@Controller('outreach/serve/holds')
@UseElectedOffice()
@UseInterceptors(ZodResponseInterceptor)
export class PaymentHoldsServeController {
  constructor(private readonly cards: PaymentHoldsCardService) {}

  @Post('card-intent')
  @ResponseSchema(PaymentHoldCardIntentResponseSchema)
  createCardIntent(
    @ReqUser() user: User,
  ): Promise<PaymentHoldCardIntentResponse> {
    return this.cards.createIntent(user.id)
  }

  @Post(':outreachId/card')
  @ResponseSchema(PaymentHoldCardResponseSchema)
  updateCard(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param('outreachId', ParseIntPipe) outreachId: number,
    @Body(new ZodValidationPipe(PaymentHoldCardRequestSchema))
    { paymentMethodId }: PaymentHoldCardRequest,
  ): Promise<PaymentHoldCardResponse> {
    return this.cards.updateCard(
      { organizationSlug: electedOffice.organizationSlug },
      outreachId,
      user.id,
      paymentMethodId,
    )
  }
}
