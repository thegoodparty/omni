import { Module, forwardRef } from '@nestjs/common'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { PrioritiesController } from './priorities.controller'
import { PrioritiesService } from './services/priorities.service'
import { PriorityStatusService } from './services/priorityStatus.service'

@Module({
  imports: [forwardRef(() => ElectedOfficeModule)],
  controllers: [PrioritiesController],
  providers: [PrioritiesService, PriorityStatusService],
  exports: [PrioritiesService, PriorityStatusService],
})
export class PrioritiesModule {}
