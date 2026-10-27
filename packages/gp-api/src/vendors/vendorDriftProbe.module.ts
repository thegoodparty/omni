import { Module } from '@nestjs/common'
import { CronModule } from '@/cron/cron.module'
import { AwsModule } from './aws/aws.module'
import { CallhubModule } from './callhub/callhub.module'
import { GeoapifyModule } from './geoapify/geoapify.module'
import { PeerlyModule } from './peerly/peerly.module'
import { SlackModule } from './slack/slack.module'
import { VendorDriftProbeService } from './vendorDriftProbe.service'
import { VercelModule } from './vercel/vercel.module'

// Registered on its own because no existing module imports all five vendor
// modules. The cron returns at once unless VENDOR_MODE is live (prod, or dev
// when flipped to live as the rollback lever).
@Module({
  imports: [
    CronModule,
    SlackModule,
    PeerlyModule,
    CallhubModule,
    GeoapifyModule,
    VercelModule,
    AwsModule,
  ],
  providers: [VendorDriftProbeService],
})
export class VendorDriftProbeModule {}
