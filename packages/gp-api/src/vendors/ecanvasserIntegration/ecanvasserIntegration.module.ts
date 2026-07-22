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
import { ECANVASSER_REQUEST_TIMEOUT_MS } from './services/ecanvasser.service'

@Module({
  imports: [
    forwardRef(() => CampaignsModule),
    // Default a request timeout for all outbound Ecanvasser HTTP calls so a
    // slow/hanging upstream can't wedge the sync indefinitely. EcanvasserService
    // also sets this per-request as defense in depth.
    HttpModule.register({ timeout: ECANVASSER_REQUEST_TIMEOUT_MS }),
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
