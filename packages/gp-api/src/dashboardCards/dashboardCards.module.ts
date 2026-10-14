import { Module, forwardRef } from '@nestjs/common'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { OutreachReportBackModule } from '@/outreach/outreachReportBack.module'
import { DashboardCardsController } from './dashboardCards.controller'
import { DashboardCardsService } from './services/dashboardCards.service'
import { OnboardingCardsController } from './onboardingCards.controller'
import { OnboardingCardsService } from './services/onboardingCards.service'

@Module({
  imports: [forwardRef(() => ElectedOfficeModule), OutreachReportBackModule],
  controllers: [DashboardCardsController, OnboardingCardsController],
  providers: [DashboardCardsService, OnboardingCardsService],
  exports: [DashboardCardsService, OnboardingCardsService],
})
export class DashboardCardsModule {}
