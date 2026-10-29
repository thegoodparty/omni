import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common'
import { EmailPausedSendsResponseSchema } from '@goodparty_org/contracts'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { OutreachEmailAdminService } from './services/outreachEmailAdmin.service'

@Controller('admin/outreach/email')
@UseGuards(AdminOrM2MGuard)
export class OutreachEmailAdminController {
  constructor(private readonly admin: OutreachEmailAdminService) {}

  @Get('paused')
  @ResponseSchema(EmailPausedSendsResponseSchema)
  paused() {
    return this.admin.listPaused()
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resume(@Param('id', ParseIntPipe) id: number) {
    await this.admin.resume(id)
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(@Param('id', ParseIntPipe) id: number) {
    await this.admin.cancel(id)
  }
}
