import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { Module, forwardRef } from '@nestjs/common'
import { DashboardController } from './dashboard.controller'
import { SupportEstimateService } from './services/supportEstimate.service'

@Module({
  imports: [forwardRef(() => ElectedOfficeModule)],
  controllers: [DashboardController],
  providers: [SupportEstimateService],
  exports: [SupportEstimateService],
})
export class DashboardModule {}
