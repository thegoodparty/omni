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
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { Campaign, User } from '../generated/prisma'
import { PaymentHoldsCardService } from './services/paymentHoldsCard.service'

@Controller('outreach/holds')
@UseCampaign()
@UseInterceptors(ZodResponseInterceptor)
export class PaymentHoldsController {
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
    @ReqCampaign() campaign: Campaign,
    @Param('outreachId', ParseIntPipe) outreachId: number,
    @Body(new ZodValidationPipe(PaymentHoldCardRequestSchema))
    { paymentMethodId }: PaymentHoldCardRequest,
  ): Promise<PaymentHoldCardResponse> {
    return this.cards.updateCard(
      { campaignId: campaign.id },
      outreachId,
      user.id,
      paymentMethodId,
    )
  }
}
