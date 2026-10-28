import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'

type JsonBody = Record<string, unknown>

// SESv2 is a REST JSON API, so the SDK posts to the operation's own path
// under the mock's base URL. Only SendEmail so far.
@Controller('vendor-mocks/ses')
@PublicAccess()
export class SesMockController {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(SesMockController.name)
  }

  @Post('v2/email/outbound-emails')
  @HttpCode(HttpStatus.OK)
  sendEmail(@Body() body: JsonBody | undefined) {
    if (VENDOR_MODE !== 'mock') throw new NotFoundException()
    const destination = body?.Destination
    if (!destination || typeof destination !== 'object') {
      throw new BadRequestException({
        message: 'Destination is required',
        __type: 'BadRequestException',
      })
    }
    return { MessageId: `mock-${randomUUID()}` }
  }
}
