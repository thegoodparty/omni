import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { User } from '@/generated/prisma'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { JudgeTelemetryAccessGuard } from './guards/judgeTelemetryAccess.guard'
import { ListJudgeTurnsResponseSchema } from './schemas/listJudgeTurns.schema'
import { JudgeTurnTelemetryService } from './services/judgeTurnTelemetry.service'

// What the Universal Judge's chat arms read back once they drive a deployed
// gp-api over HTTP instead of patching one in their own process.
@Controller('judge')
@UseGuards(JudgeTelemetryAccessGuard)
export class JudgeController {
  constructor(private readonly telemetry: JudgeTurnTelemetryService) {}

  @Get('conversations/:id/turns')
  @ResponseSchema(ListJudgeTurnsResponseSchema)
  listTurns(@Param('id') id: string, @ReqUser() user: User) {
    return this.telemetry.listTurns(id, user.id)
  }
}
