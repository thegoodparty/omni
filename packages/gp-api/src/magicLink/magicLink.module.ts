import { Module } from '@nestjs/common'
import { SinchModule } from '../vendors/sinch/sinch.module'
import { MagicLinkResolveRateLimitGuard } from './guards/magicLinkResolveRateLimit.guard'
import { MagicLinkController } from './magicLink.controller'
import { MagicLinkService } from './magicLink.service'
import { MagicLinkDeliveryService } from './magicLinkDelivery.service'

// CrmUsersService (the HubSpot mirror dependency) and PrismaService are provided
// by global modules (UsersModule is @Global; Prisma + Pino are global), so this
// module only needs SinchModule for SMS delivery.
@Module({
  imports: [SinchModule],
  controllers: [MagicLinkController],
  providers: [
    MagicLinkService,
    MagicLinkDeliveryService,
    MagicLinkResolveRateLimitGuard,
  ],
  exports: [MagicLinkService, MagicLinkDeliveryService],
})
export class MagicLinkModule {}
