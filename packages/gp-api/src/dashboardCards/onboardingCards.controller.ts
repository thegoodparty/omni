import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { ElectedOffice, User } from '../generated/prisma'
import {
  OnboardingCardKeyParam,
  OnboardingCardKeyParamSchema,
  OnboardingCardsResponse,
  OnboardingCardsResponseSchema,
} from '@goodparty_org/contracts'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { OnboardingCardsService } from './services/onboardingCards.service'

@Controller('dashboard/onboarding-cards')
export class OnboardingCardsController {
  constructor(private readonly cards: OnboardingCardsService) {}

  @UseElectedOffice()
  @Get()
  @ResponseSchema(OnboardingCardsResponseSchema)
  async list(
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
  ): Promise<OnboardingCardsResponse> {
    const cards = await this.cards.listStatuses({
      electedOfficeId: electedOffice.id,
      ownerUserId: user.id,
      organizationSlug: electedOffice.organizationSlug,
    })
    return { cards }
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
