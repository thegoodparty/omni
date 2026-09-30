import { Body, Controller, Post, UseGuards, UsePipes } from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { SubscribeService } from './subscribe.service'
import { SubscribeEmailSchema } from './subscribeEmail.schema'
import { PublicAccess } from 'src/authentication/decorators/PublicAccess.decorator'
import { SubscribeRateLimitGuard } from './guards/subscribeRateLimit.guard'

@PublicAccess()
@Controller('subscribe')
@UsePipes(ZodValidationPipe)
export class SubscribeController {
  constructor(private readonly subscribeService: SubscribeService) {}

  @Post()
  @UseGuards(SubscribeRateLimitGuard)
  async subscribeEmail(@Body() body: SubscribeEmailSchema) {
    return this.subscribeService.subscribeEmail(body)
  }
}
