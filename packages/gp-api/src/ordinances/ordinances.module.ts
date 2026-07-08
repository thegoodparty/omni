import { Module } from '@nestjs/common'
import { AgentExperimentsModule } from '@/agentExperiments/agentExperiments.module'
import { CronModule } from '@/cron/cron.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { OrdinancesController } from './ordinances.controller'
import { OrdinanceCodePersistService } from './services/ordinanceCodePersist.service'
import { OrdinanceCodeReadService } from './services/ordinanceCodeRead.service'
import { OrdinanceDispatchService } from './services/ordinanceDispatch.service'

@Module({
  imports: [AgentExperimentsModule, AwsModule, CronModule, OrganizationsModule],
  controllers: [OrdinancesController],
  providers: [
    OrdinanceCodePersistService,
    OrdinanceCodeReadService,
    OrdinanceDispatchService,
  ],
  exports: [OrdinanceCodePersistService, OrdinanceDispatchService],
})
export class OrdinancesModule {}
