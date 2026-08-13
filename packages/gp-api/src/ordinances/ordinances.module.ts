import { Module, forwardRef } from '@nestjs/common'
import { AgentExperimentsModule } from '@/agentExperiments/agentExperiments.module'
import { CronModule } from '@/cron/cron.module'
import { LlmModule } from '@/llm/llm.module'
import { OrganizationsModule } from '@/organizations/organizations.module'
import { AwsModule } from '@/vendors/aws/aws.module'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { QueueProducerModule } from '@/queue/producer/queueProducer.module'
import { OrdinancesController } from './ordinances.controller'
import { OrdinanceFlowController } from './controllers/ordinanceFlow.controller'
import { OrdinancesService } from './services/ordinances.service'
import { OrdinanceExportService } from './services/ordinanceExport.service'
import { OrdinanceCodePersistService } from './services/ordinanceCodePersist.service'
import { OrdinanceCodeReadService } from './services/ordinanceCodeRead.service'
import { OrdinanceDispatchService } from './services/ordinanceDispatch.service'
import { OrdinanceQualityReportService } from './services/ordinanceQualityReport.service'
import { OrdinanceDraftRevisionService } from './services/ordinanceDraftRevision.service'
import { OrdinanceQualityLoopService } from './services/ordinanceQualityLoop.service'

@Module({
  imports: [
    AgentExperimentsModule,
    AwsModule,
    CronModule,
    LlmModule,
    OrganizationsModule,
    QueueProducerModule,
    forwardRef(() => ElectedOfficeModule),
  ],
  controllers: [OrdinancesController, OrdinanceFlowController],
  providers: [
    OrdinancesService,
    OrdinanceExportService,
    OrdinanceCodePersistService,
    OrdinanceCodeReadService,
    OrdinanceDispatchService,
    OrdinanceQualityReportService,
    OrdinanceDraftRevisionService,
    OrdinanceQualityLoopService,
  ],
  exports: [
    OrdinancesService,
    OrdinanceCodePersistService,
    OrdinanceDispatchService,
    OrdinanceQualityLoopService,
  ],
})
export class OrdinancesModule {}
