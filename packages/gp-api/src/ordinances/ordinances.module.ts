import { Module, forwardRef } from '@nestjs/common'
import { AgentExperimentsModule } from '@/agentExperiments/agentExperiments.module'
import { CronModule } from '@/cron/cron.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { OrdinancesController } from './ordinances.controller'
import { OrdinanceFlowController } from './controllers/ordinanceFlow.controller'
import { OrdinancesService } from './services/ordinances.service'
import { OrdinanceCodePersistService } from './services/ordinanceCodePersist.service'
import { OrdinanceCodeReadService } from './services/ordinanceCodeRead.service'
import { OrdinanceDispatchService } from './services/ordinanceDispatch.service'

@Module({
  imports: [
    AgentExperimentsModule,
    AwsModule,
    CronModule,
    OrganizationsModule,
    forwardRef(() => ElectedOfficeModule),
  ],
  controllers: [OrdinancesController, OrdinanceFlowController],
  providers: [
    OrdinancesService,
    OrdinanceCodePersistService,
    OrdinanceCodeReadService,
    OrdinanceDispatchService,
  ],
  exports: [
    OrdinancesService,
    OrdinanceCodePersistService,
    OrdinanceDispatchService,
  ],
})
export class OrdinancesModule {}
