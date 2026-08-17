import { Module } from '@nestjs/common'
import { SinchController } from './sinch.controller'
import { SinchTokenService } from './services/sinchToken.service'
import { SmsService } from './services/sms.service'
import { SmsOptOutService } from './services/smsOptOut.service'

// PrismaService and PinoLogger come from global modules, so this module only
// registers the Sinch send path and its inbound opt-out callback.
@Module({
  controllers: [SinchController],
  providers: [SinchTokenService, SmsService, SmsOptOutService],
  exports: [SmsService, SmsOptOutService],
})
export class SinchModule {}
