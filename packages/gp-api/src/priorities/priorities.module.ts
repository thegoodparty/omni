import { Module, forwardRef } from '@nestjs/common'
import { ElectedOfficeModule } from '@/electedOffice/electedOffice.module'
import { PrioritiesController } from './priorities.controller'
import { PrioritiesService } from './services/priorities.service'

@Module({
  imports: [forwardRef(() => ElectedOfficeModule)],
  controllers: [PrioritiesController],
  providers: [PrioritiesService],
  exports: [PrioritiesService],
})
export class PrioritiesModule {}
