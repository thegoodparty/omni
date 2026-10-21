import { Module } from '@nestjs/common'
import { SubscribeService } from './subscribe.service'
import { SubscribeController } from './subscribe.controller'
import { SubscribeRateLimitGuard } from './guards/subscribeRateLimit.guard'

@Module({
  controllers: [SubscribeController],
  providers: [SubscribeService, SubscribeRateLimitGuard],
  exports: [SubscribeService],
})
export class SubscribeModule {}
