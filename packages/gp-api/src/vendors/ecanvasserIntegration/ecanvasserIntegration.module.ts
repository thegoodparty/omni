import { forwardRef, Module } from '@nestjs/common'
import { EcanvasserIntegrationService } from './services/ecanvasserIntegration.service'
import { EcanvasserIntegrationController } from './ecanvasserIntegration.controller'
import { CampaignsModule } from '../../campaigns/campaigns.module'
import { HttpModule } from '@nestjs/axios'
import { SurveyService } from './services/survey.service'
import { EcanvasserService } from './services/ecanvasser.service'
import { EcanvasserAttributionService } from './services/ecanvasserAttribution.service'
import { SlackModule } from 'src/vendors/slack/slack.module'
import { ClerkModule } from '@/vendors/clerk/clerk.module'
import { ContactsModule } from '@/contacts/contacts.module'
import { VoterOutreachActivityModule } from '@/voterOutreachActivity/voterOutreachActivity.module'
import { ECANVASSER_ATTRIBUTION_SERVICE } from './ecanvasserIntegration.types'

@Module({
  imports: [
    forwardRef(() => CampaignsModule),
    HttpModule,
    SlackModule,
    ClerkModule,
    forwardRef(() => ContactsModule),
    VoterOutreachActivityModule,
  ],
  controllers: [EcanvasserIntegrationController],
  providers: [
    EcanvasserIntegrationService,
    SurveyService,
    EcanvasserService,
    {
      provide: ECANVASSER_ATTRIBUTION_SERVICE,
      useClass: EcanvasserAttributionService,
    },
  ],
  exports: [EcanvasserIntegrationService, SurveyService],
})
export class EcanvasserIntegrationModule {}
