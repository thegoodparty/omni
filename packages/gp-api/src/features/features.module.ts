import { Global, Module } from '@nestjs/common'
import { FeaturesService } from './services/features.service'
import { CampaignExperimentAssignmentService } from './services/campaignExperimentAssignment.service'
import { FeaturesController } from './features.controller'
import { UsersModule } from 'src/users/users.module'

@Global()
@Module({
  controllers: [FeaturesController],
  providers: [FeaturesService, CampaignExperimentAssignmentService],
  exports: [FeaturesService, CampaignExperimentAssignmentService],
  imports: [UsersModule],
})
export class FeaturesModule {}
