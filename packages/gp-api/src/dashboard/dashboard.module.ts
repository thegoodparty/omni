import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { Module } from '@nestjs/common'
import { DashboardController } from './dashboard.controller'
import { SupportEstimateService } from './services/supportEstimate.service'

@Module({
  imports: [ElectedOfficeModule],
  controllers: [DashboardController],
  providers: [SupportEstimateService],
  exports: [SupportEstimateService],
})
export class DashboardModule {}
