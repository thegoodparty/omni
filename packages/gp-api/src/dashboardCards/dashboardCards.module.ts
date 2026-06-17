import { Module, forwardRef } from '@nestjs/common'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { DashboardCardsController } from './dashboardCards.controller'
import { DashboardCardsService } from './services/dashboardCards.service'

@Module({
  imports: [forwardRef(() => ElectedOfficeModule)],
  controllers: [DashboardCardsController],
  providers: [DashboardCardsService],
  exports: [DashboardCardsService],
})
export class DashboardCardsModule {}
