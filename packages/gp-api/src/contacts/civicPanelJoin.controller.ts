import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  CivicPanelJoinPageSchema,
  CivicPanelShareCodeSchema,
  JoinCivicPanelInputSchema,
  JoinCivicPanelResponseSchema,
  type JoinCivicPanelInput,
} from '@goodparty_org/contracts'
import { PublicAccess } from 'src/authentication/decorators/PublicAccess.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { CivicPanelJoinRateLimitGuard } from './guards/civicPanelJoinRateLimit.guard'
import { CivicPanelJoinService } from './services/civicPanelJoin.service'

// The office's public civic panel join page. No account and no organization
// header: the share code alone names the office.
@Controller('civic-panel/join')
@PublicAccess()
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class CivicPanelJoinController {
  constructor(private readonly joins: CivicPanelJoinService) {}

  @Get(':code')
  @ResponseSchema(CivicPanelJoinPageSchema)
  async readJoinPage(
    @Param('code', new ZodValidationPipe(CivicPanelShareCodeSchema))
    code: string,
  ) {
    return this.joins.readJoinPage(code)
  }

  @Post(':code')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(JoinCivicPanelResponseSchema)
  @UseGuards(CivicPanelJoinRateLimitGuard)
  async join(
    @Param('code', new ZodValidationPipe(CivicPanelShareCodeSchema))
    code: string,
    @Body(new ZodValidationPipe(JoinCivicPanelInputSchema))
    body: JoinCivicPanelInput,
  ) {
    return this.joins.joinFromPage(code, body)
  }
}
