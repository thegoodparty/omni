import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { ElectedOffice } from '../generated/prisma'
import {
  OnboardingCardKeyParam,
  OnboardingCardKeyParamSchema,
  OnboardingCardsResponse,
  OnboardingCardsResponseSchema,
} from '@goodparty_org/contracts'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { OnboardingCardsService } from './services/onboardingCards.service'

@Controller('dashboard/onboarding-cards')
export class OnboardingCardsController {
  constructor(private readonly cards: OnboardingCardsService) {}

  @UseElectedOffice()
  @Get()
  @ResponseSchema(OnboardingCardsResponseSchema)
  async list(
    @ReqElectedOffice() electedOffice: ElectedOffice,
  ): Promise<OnboardingCardsResponse> {
    const cards = await this.cards.listStatuses(electedOffice.id)
    return { cards }
  }

  // The webapp calls this when the meet card's button opens the intro.
  @UseElectedOffice()
  @Put(':key/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async complete(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param(new ZodValidationPipe(OnboardingCardKeyParamSchema))
    { key }: OnboardingCardKeyParam,
  ): Promise<void> {
    await this.cards.complete(electedOffice.id, key)
  }

  @UseElectedOffice()
  @Put(':key/skip')
  @HttpCode(HttpStatus.NO_CONTENT)
  async skip(
    @ReqElectedOffice() electedOffice: ElectedOffice,
    @Param(new ZodValidationPipe(OnboardingCardKeyParamSchema))
    { key }: OnboardingCardKeyParam,
  ): Promise<void> {
    await this.cards.skip(electedOffice.id, key)
  }
}
